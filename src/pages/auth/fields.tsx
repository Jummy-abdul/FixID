import { useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Eye, EyeOff, X } from 'lucide-react';
import { Input } from '@/components/ui';
import { PASSWORD_RULES } from '@/auth/authCore';
import { COUNTRIES, countryByCode } from '@/data/countries';
import { cn } from '@/lib/cn';

/** Six single-digit boxes with auto-advance, paste and backspace navigation. */
export function OtpInput({ value, onChange, invalid, disabled, onComplete }: {
  value: string; onChange: (v: string) => void; invalid?: boolean; disabled?: boolean; onComplete?: (v: string) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  const setAt = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    const v = next.join('').slice(0, 6);
    onChange(v);
    if (/^\d{6}$/.test(v)) onComplete?.(v);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      setAt(i - 1, '');
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
    if (pasted.length === 6) onComplete?.(pasted);
  };

  return (
    <div role="group" aria-label="Verification code" className="flex gap-2 sm:gap-3">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} disabled={disabled}
          inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={1} aria-label={`Digit ${i + 1}`} aria-invalid={invalid || undefined}
          onPaste={onPaste} onKeyDown={(e) => onKey(i, e)} onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, '').slice(-1);
            if (!ch) return setAt(i, '');
            setAt(i, ch);
            if (i < 5) refs.current[i + 1]?.focus();
          }}
          className={cn('h-14 w-12 rounded-xl border bg-white text-center text-xl font-semibold text-slate-900 shadow-sm transition-colors focus:outline-none focus:ring-2 sm:h-16 sm:w-14',
            invalid ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20')} />
      ))}
    </div>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField({ label, value, onChange, error, autoComplete, autoFocus, describedBy }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; autoComplete: string; autoFocus?: boolean; describedBy?: string;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <Input id={id} type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
          autoFocus={autoFocus} aria-invalid={error ? true : undefined} aria-describedby={[error ? `${id}-error` : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined}
          className="h-11 pr-11" />
        <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600">
          {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {error && <p id={`${id}-error`} className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function PasswordRules({ password, id }: { password: string; id?: string }) {
  return (
    <ul id={id} className="space-y-1.5 text-sm" aria-label="Password requirements">
      {PASSWORD_RULES.map((r) => {
        const met = r.test(password);
        return (
          <li key={r.id} className={cn('flex items-center gap-2', met ? 'text-emerald-700' : 'text-slate-500')}>
            <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', met ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400')}>
              {met ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-2.5 w-2.5" aria-hidden="true" />}
            </span>
            {r.label}<span className="sr-only">{met ? ' (met)' : ' (not met)'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Searchable country picker (combobox with a filtered listbox). */
export function CountryCombobox({ value, onChange, error, label = 'Country', required }: {
  value: string; onChange: (code: string) => void; error?: string; label?: string; required?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = countryByCode(value);
  const options = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    return COUNTRIES.filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
  }, [query]);

  const choose = (code: string) => {
    onChange(code);
    setQuery(null);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); choose(options[active].code); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(null); }
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}{required && <span className="ml-0.5 text-red-500">*</span>}</label>
      <div className="relative">
        <Input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
          placeholder="Search countries" className="h-11 pr-10"
          value={query ?? selected?.name ?? ''}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)} onKeyDown={onKey}
          onBlur={() => setTimeout(() => { setOpen(false); setQuery(null); }, 120)} />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label="Countries" className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200">
          {options.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matching countries</li>}
          {options.map((c, i) => (
            <li key={c.code} role="option" aria-selected={c.code === value} onMouseDown={(e) => { e.preventDefault(); choose(c.code); }}
              className={cn('flex cursor-pointer items-center justify-between px-3 py-2 text-sm', i === active ? 'bg-brand-50 text-brand-800' : 'text-slate-700')}>
              {c.name}
              {c.code === value && <Check className="h-4 w-4 text-brand-600" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
      {error && <p id={`${id}-error`} className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  );
}
