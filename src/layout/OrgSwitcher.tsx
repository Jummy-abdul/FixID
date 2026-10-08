import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui';
import { INDUSTRY_LABEL } from '@/domain/labels';
import { useSession } from '@/store/AppStore';
import { cn } from '@/lib/cn';

export function OrgSwitcher() {
  const { organization, organizations, switchOrganization } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white py-1.5 pl-1.5 pr-2.5 text-left shadow-sm hover:bg-slate-50">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-[11px] font-bold text-brand-700">{organization.shortName}</span>
        <span className="hidden leading-tight sm:block">
          <span className="block max-w-[200px] truncate text-sm font-medium text-slate-900">{organization.name}</span>
          <span className="block text-[11px] text-slate-500">{INDUSTRY_LABEL[organization.industry]}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div role="listbox" aria-label="Switch organization" className="absolute left-0 z-40 mt-2 w-72 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
          <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your organizations</p>
          {organizations.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={o.id === organization.id}
              onClick={() => {
                setOpen(false);
                if (o.id === organization.id) return;
                switchOrganization(o.id);
                navigate('/');
                toast({ tone: 'info', title: `Switched to ${o.name}` });
              }}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50', o.id === organization.id && 'bg-slate-50')}>
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-[11px] font-bold text-slate-600">{o.shortName}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium text-slate-900">{o.name}</span>
                <span className="block text-[11px] text-slate-500">{INDUSTRY_LABEL[o.industry]}</span>
              </span>
              {o.id === organization.id && <Check className="h-4 w-4 text-brand-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
