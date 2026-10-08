import { cn } from '@/lib/cn';

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cn('-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
