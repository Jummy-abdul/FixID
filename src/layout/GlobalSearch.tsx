import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, Search, User } from 'lucide-react';
import { useOrgData } from '@/store/AppStore';
import { cn } from '@/lib/cn';

interface Result { id: string; kind: 'person' | 'credential'; title: string; subtitle: string; href: string }

export function GlobalSearch() {
  const { members, credentials, memberById, credentialTypeById } = useOrgData();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const people = members
      .filter((m) => m.displayName.toLowerCase().includes(q) || m.idSwitchId.toLowerCase().includes(q) || m.externalRef?.value.toLowerCase().includes(q))
      .slice(0, 5)
      .map<Result>((m) => ({ id: m.id, kind: 'person', title: m.displayName, subtitle: `${m.relationship} · ${m.externalRef?.value ?? m.idSwitchId}`, href: `/people/${m.id}` }));
    const creds = credentials
      .filter((c) => c.identifier.toLowerCase().includes(q))
      .slice(0, 5)
      .map<Result>((c) => ({ id: c.id, kind: 'credential', title: c.identifier, subtitle: `${credentialTypeById.get(c.credentialTypeId)?.name} · ${memberById.get(c.memberId)?.displayName}`, href: `/credentials/${c.id}` }));
    return [...people, ...creds];
  }, [query, members, credentials, memberById, credentialTypeById]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); setOpen(true); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  const go = (r: Result) => { navigate(r.href); setOpen(false); setQuery(''); inputRef.current?.blur(); };

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open && query.length >= 2}
        aria-controls="global-search-results"
        aria-label="Search people and credentials"
        placeholder="Search people, ID numbers, credentials…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && results[active]) go(results[active]);
          if (e.key === 'Escape') setOpen(false);
        }}
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-14 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 text-[10px] font-medium text-slate-400 sm:block">Ctrl K</kbd>
      {open && query.trim().length >= 2 && (
        <div id="global-search-results" role="listbox" className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-slate-500">No people or credentials match “{query}”.</p>
          ) : results.map((r, i) => (
            <button key={r.kind + r.id} type="button" role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)} onClick={() => go(r)}
              className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-slate-50')}>
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                {r.kind === 'person' ? <User className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4" />}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-medium text-slate-900">{r.title}</span>
                <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
