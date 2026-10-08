import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'violet';

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};
const dots: Record<Tone, string> = {
  neutral: 'bg-slate-400', success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-red-500',
  info: 'bg-sky-500', brand: 'bg-brand-500', violet: 'bg-violet-500',
};

export function Badge({ tone = 'neutral', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  );
}
