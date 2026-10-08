import { addDays, startOfDay } from '@/lib/dates';
import type { Credential, Decision, Transaction } from './types';

export function isExpiringWithin(c: Credential, days: number, now: Date): boolean {
  if (c.status !== 'active' || !c.expiresAt) return false;
  const exp = new Date(c.expiresAt);
  return exp >= now && exp <= addDays(now, days);
}

export function transactionsSince(txs: Transaction[], since: Date): Transaction[] {
  const t = since.toISOString();
  return txs.filter((x) => x.occurredAt >= t);
}

export function allowRate(txs: Transaction[]): number | null {
  if (txs.length === 0) return null;
  return txs.filter((t) => t.decision === 'allow').length / txs.length;
}

export interface DailyDecisions { date: Date; allow: number; deny: number; indeterminate: number; total: number }

export function dailyDecisions(txs: Transaction[], days: number, now: Date): DailyDecisions[] {
  const today = startOfDay(now);
  const buckets: DailyDecisions[] = Array.from({ length: days }, (_, i) => ({
    date: addDays(today, i - days + 1), allow: 0, deny: 0, indeterminate: 0, total: 0,
  }));
  const first = buckets[0].date.getTime();
  for (const t of txs) {
    const idx = Math.floor((startOfDay(new Date(t.occurredAt)).getTime() - first) / 86_400_000);
    if (idx < 0 || idx >= days) continue;
    buckets[idx][t.decision as Decision] += 1;
    buckets[idx].total += 1;
  }
  return buckets;
}

export function formatPercent(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 1000) / 10}%`;
}

export type TimeRange = 'today' | '7d' | '30d' | 'all';

export function rangeStart(range: TimeRange, now: Date): Date | null {
  if (range === 'today') return startOfDay(now);
  if (range === '7d') return addDays(startOfDay(now), -6);
  if (range === '30d') return addDays(startOfDay(now), -29);
  return null;
}
