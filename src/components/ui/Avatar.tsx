import { cn } from '@/lib/cn';
import { initials } from '@/lib/identifiers';

const palette = ['bg-brand-100 text-brand-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800', 'bg-violet-100 text-violet-700', 'bg-sky-100 text-sky-700', 'bg-rose-100 text-rose-700'];

export function Avatar({ name, initials: label, photoUrl, size = 'md', className }: { name: string; initials?: string; photoUrl?: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const sizes = { sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-14 w-14 text-lg' };
  if (photoUrl) {
    return <img src={photoUrl} alt="" className={cn('shrink-0 rounded-full object-cover', sizes[size], className)} />;
  }
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', palette[hash % palette.length], sizes[size], className)}>
      {label ?? initials(name)}
    </span>
  );
}
