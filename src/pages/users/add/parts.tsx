import type { ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StepId } from './draft';

export const STEPS: { id: Exclude<StepId, 'done'>; label: string }[] = [
  { id: 'type', label: 'User type' },
  { id: 'credential', label: 'Credential' },
  { id: 'details', label: 'Details' },
  { id: 'identity', label: 'Identity' },
  { id: 'review', label: 'Review' },
];

export function Stepper({ current, reusedCredential, onSelect }: { current: StepId; reusedCredential: boolean; onSelect: (s: StepId) => void }) {
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const done = i < index;
          const active = i === index;
          const label = s.id === 'credential' && reusedCredential && i !== index ? 'Credential · saved' : s.label;
          const body = (
            <>
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done ? 'bg-brand-600 text-white' : active ? 'bg-white text-brand-700 ring-2 ring-brand-600' : 'bg-slate-100 text-slate-500')}>
                {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn('hidden text-sm font-medium md:inline', active ? 'text-slate-900' : done ? 'text-slate-700' : 'text-slate-400')}>{label}</span>
            </>
          );
          return (
            <li key={s.id} className="flex flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
              {done ? (
                <button type="button" onClick={() => onSelect(s.id)} className="flex items-center gap-2 rounded-md hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  aria-label={`Back to ${s.label}`}>
                  {body}
                </button>
              ) : <span className="flex items-center gap-2">{body}</span>}
              {i < STEPS.length - 1 && <span className={cn('h-px flex-1', done ? 'bg-brand-300' : 'bg-slate-200')} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StepShell({ title, description, children, footer }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <section aria-labelledby="step-title" className="rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="px-6 pt-7 sm:px-8">
        <h2 id="step-title" className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-1.5 max-w-2xl text-slate-500">{description}</p>}
      </div>
      <div className="px-6 py-6 sm:px-8">{children}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">{footer}</div>
    </section>
  );
}

export function FormSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 border-t border-slate-100 py-6 first:border-t-0 first:pt-0 last:pb-0">
      <legend className="sr-only">{title}</legend>
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <p className="text-sm font-semibold text-slate-900" aria-hidden="true">{title}</p>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        <div className="space-y-4 lg:col-span-2">{children}</div>
      </div>
    </fieldset>
  );
}

export function RadioCard({ checked, onSelect, title, description, badge, disabled, name }: {
  checked: boolean; onSelect: () => void; title: ReactNode; description?: ReactNode; badge?: ReactNode; disabled?: boolean; name?: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={checked} aria-disabled={disabled || undefined} disabled={disabled} name={name} onClick={onSelect}
      className={cn('flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:border-slate-300')}>
      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', checked ? 'border-brand-600 bg-brand-600' : 'border-slate-300')}>
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">{title}{badge}</span>
        {description && <span className="mt-0.5 block text-sm text-slate-500">{description}</span>}
      </span>
    </button>
  );
}

const CALLOUT = {
  info: { cls: 'bg-sky-50 text-sky-900 ring-sky-200', icon: Info },
  success: { cls: 'bg-emerald-50 text-emerald-900 ring-emerald-200', icon: CheckCircle2 },
  warning: { cls: 'bg-amber-50 text-amber-900 ring-amber-200', icon: AlertTriangle },
  danger: { cls: 'bg-red-50 text-red-900 ring-red-200', icon: XCircle },
};

export function Callout({ tone = 'info', title, children, action }: { tone?: keyof typeof CALLOUT; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const { cls, icon: Icon } = CALLOUT[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cn('flex gap-3 rounded-xl p-4 text-sm ring-1 ring-inset', cls)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-1', 'opacity-90')}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
