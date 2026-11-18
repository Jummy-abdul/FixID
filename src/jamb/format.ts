import { formatDate } from '@/lib/dates';

/** Date and time with the year, e.g. "9 Nov 2022, 10:36" (records here span several years). */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${formatDate(iso)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
