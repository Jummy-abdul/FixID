import { isUnresolved, type VerificationException } from '@/domain/exceptions';
import type { ActivityDecision } from '@/domain/activitySettings';
import { stageOf } from '@/domain/transactions';
import type { ActivityConfig, VerificationAttempt } from '@/domain/types';
import { currentDecision, exceptionsOf } from './exceptionOps';
import { participation } from './sharingOps';
import type { AppState } from './state';

/**
 * Operational metrics computed from stored transactions and exceptions only: nothing here is sampled,
 * estimated or invented. Every function takes an explicit scope (an organization, or a shared activity and
 * its participants), so callers can't accidentally widen it.
 */

export interface Period { from?: string; to?: string }
const inPeriod = (at: string, p: Period) => (!p.from || at >= p.from) && (!p.to || at <= p.to);

/** Finished transactions of one organization (in-progress attempts aren't counted as attempts yet). */
export function organizationTransactions(state: AppState, organizationId: string, period: Period = {}): VerificationAttempt[] {
  return state.data.verificationAttempts.filter((a) => a.organizationId === organizationId && a.status !== 'in-progress' && inPeriod(a.completedAt ?? a.startedAt, period));
}

export interface Summary {
  attempts: number;
  completed: number;
  allowed: number;
  denied: number;
  pendingReview: number;
  unableToComplete: number;
  /** Interrupted and timed out before a result. Counted as attempts, never as an outcome. */
  incomplete: number;
  cancelled: number;
  byDecision: Record<ActivityDecision | 'none', number>;
  byMatch: Record<string, number>;
  byEligibility: Record<string, number>;
  bySource: { local: number; external: number };
  simulated: number;
}

/** Counts by the transaction's current disposition, with original identity and eligibility results kept apart. */
export function summarize(state: AppState, attempts: VerificationAttempt[]): Summary {
  const s: Summary = {
    attempts: attempts.length, completed: 0, allowed: 0, denied: 0, pendingReview: 0, unableToComplete: 0, incomplete: 0, cancelled: 0,
    byDecision: { allow: 0, deny: 0, 'pending-review': 0, 'unable-to-decide': 0, none: 0 }, byMatch: {}, byEligibility: {}, bySource: { local: 0, external: 0 }, simulated: 0,
  };
  for (const a of attempts) {
    const e = a.exceptionId ? exceptionsOf(state).find((x) => x.id === a.exceptionId) : undefined;
    const d = a.status === 'completed' ? currentDecision(a, e) : undefined;
    const stage = stageOf(a);
    if (a.status === 'cancelled') s.cancelled += 1;
    if (stage === 'incomplete') s.incomplete += 1;
    if (d === 'allow') s.allowed += 1;
    if (d === 'deny') s.denied += 1;
    if (d === 'pending-review') s.pendingReview += 1;
    if (d === 'unable-to-decide' || stage === 'unable-to-complete') s.unableToComplete += 1;
    if (a.status === 'completed' && d !== 'pending-review' && d !== 'unable-to-decide') s.completed += 1;
    s.byDecision[d ?? 'none'] += 1;
    if (a.match) s.byMatch[a.match.status] = (s.byMatch[a.match.status] ?? 0) + 1;
    if (a.eligibilityStatus) s.byEligibility[a.eligibilityStatus] = (s.byEligibility[a.eligibilityStatus] ?? 0) + 1;
    s.bySource[a.identitySource === 'external' ? 'external' : 'local'] += 1;
    if (a.simulated) s.simulated += 1;
  }
  return s;
}

/** Per-activity breakdown (names and counts only). */
export function activityBreakdown(state: AppState, attempts: VerificationAttempt[]) {
  const by = new Map<string, VerificationAttempt[]>();
  for (const a of attempts) by.set(a.activityId, [...(by.get(a.activityId) ?? []), a]);
  return [...by.entries()].map(([activityId, list]) => ({ activityId, activityName: list[0].activityName, organizationId: list[0].organizationId, ...summarize(state, list) }))
    .sort((x, y) => y.attempts - x.attempts);
}

/* ---------------- Shared activity results ---------------- */

export interface ParticipantSummary {
  organizationId: string;
  name: string;
  participation: string;
  verifiers: number;
  summary: Summary;
  lastActivity?: string;
}

/**
 * Transactions of a shared activity, for its owner: those performed by the owner and by its participating
 * organizations for this activity only (never their other activities or records).
 */
export function sharedActivityTransactions(state: AppState, activity: ActivityConfig, period: Period = {}, organizationId?: string): VerificationAttempt[] {
  return state.data.verificationAttempts.filter((a) => a.activityId === activity.id && (a.organizationId === activity.organizationId || a.activityOwnerId === activity.organizationId)
    && (!organizationId || a.organizationId === organizationId) && a.status !== 'in-progress' && inPeriod(a.completedAt ?? a.startedAt, period));
}

/** Exceptions of a shared activity visible to its owner: those it reviews, and its own. */
export function sharedActivityExceptions(state: AppState, activity: ActivityConfig, organizationId?: string): VerificationException[] {
  return exceptionsOf(state).filter((e) => e.activityId === activity.id && (e.reviewOrganizationId === activity.organizationId || e.organizationId === activity.organizationId)
    && (!organizationId || e.organizationId === organizationId));
}

/** Results of a shared activity by organization, for its owner. */
export function sharedResults(state: AppState, activity: ActivityConfig, period: Period = {}) {
  const orgIds = [activity.organizationId, ...(activity.sharing?.participants ?? []).map((p) => p.organizationId)];
  const rows: ParticipantSummary[] = orgIds.map((orgId) => {
    const tx = sharedActivityTransactions(state, activity, period, orgId);
    return {
      organizationId: orgId, name: state.data.organizations.find((o) => o.id === orgId)?.name ?? orgId,
      participation: participation(activity, orgId) ?? 'removed',
      verifiers: state.data.verifierAssignments.filter((v) => v.activityId === activity.id && v.organizationId === orgId && v.status === 'active').length,
      summary: summarize(state, tx), lastActivity: tx.map((a) => a.completedAt ?? a.startedAt).sort().pop(),
    };
  });
  const exceptions = sharedActivityExceptions(state, activity);
  return {
    rows, summary: summarize(state, sharedActivityTransactions(state, activity, period)),
    participating: (activity.sharing?.participants ?? []).filter((p) => p.status === 'active').length,
    exceptions: { total: exceptions.length, unresolved: exceptions.filter(isUnresolved).length },
  };
}

/* ---------------- Exceptions ---------------- */

/** Exception figures. Resolution time is only computed from exceptions that actually have a recorded resolution. */
export function exceptionSummary(list: VerificationException[]) {
  const resolved = list.filter((e) => e.resolution && e.resolution.outcome !== 'reverification-required');
  const hours = resolved.map((e) => (new Date(e.resolution!.at).getTime() - new Date(e.createdAt).getTime()) / 3_600_000).filter((h) => h >= 0);
  const count = <K extends string>(key: (e: VerificationException) => K) => list.reduce<Record<string, number>>((m, e) => ({ ...m, [key(e)]: (m[key(e)] ?? 0) + 1 }), {});
  return {
    total: list.length, open: list.filter(isUnresolved).length, resolved: list.filter((e) => e.status === 'resolved' || e.status === 'closed').length,
    byReason: count((e) => e.reason), byActivity: count((e) => e.activityName), byOrganization: count((e) => e.organizationId),
    /** Median hours from creation to resolution, or null when nothing has been resolved. */
    medianResolutionHours: hours.length ? [...hours].sort((a, b) => a - b)[Math.floor(hours.length / 2)] : null,
  };
}

/** CSV of aggregate rows only. No people, references, identity attributes or biometric data. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}
