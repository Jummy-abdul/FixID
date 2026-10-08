export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : '—';
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const future = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const wrap = (s: string) => (future ? `in ${s}` : `${s} ago`);
  if (mins < 1) return 'just now';
  if (mins < 60) return wrap(`${mins}m`);
  const hours = Math.round(mins / 60);
  if (hours < 24) return wrap(`${hours}h`);
  const days = Math.round(hours / 24);
  if (days < 30) return wrap(`${days}d`);
  return formatDate(iso);
}

export function daysBetween(fromIso: string | Date, toIso: string | Date): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return Math.round((b - a) / 86_400_000);
}
