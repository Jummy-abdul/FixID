import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

export function StatCard({ label, value, hint, icon, to, tone = 'brand' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; to?: string; tone?: 'brand' | 'emerald' | 'amber' | 'violet' }) {
  const tones = { brand: 'bg-brand-50 text-brand-600', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet-50 text-violet-600' };
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {icon && <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tones[tone])}>{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </>
  );
  const cls = 'block rounded-xl border border-slate-200 bg-white p-5 shadow-card';
  return to ? <Link to={to} className={cn(cls, 'transition hover:border-brand-300 hover:shadow-md')}>{body}</Link> : <div className={cls}>{body}</div>;
}
