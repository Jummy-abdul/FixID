import { isUnresolved, type VerificationException } from '@/domain/exceptions';
import type { ActivityDecision, VerificationProgramme } from '@/domain/programmes';
import { stageOf } from '@/domain/transactions';
import type { ActivityConfig, VerificationAttempt } from '@/domain/types';
import { currentDecision, exceptionsOf } from './exceptionOps';
import { activityPolicy, participation, sourceProblem } from './programmeOps';
import type { AppState } from './state';

/**
 * Operational metrics computed from stored transactions and exceptions only: nothing here is sampled,
 * estimated or invented. Every function takes an explicit scope (an organization, or a programme and its
 * participants), so callers can't accidentally widen it.
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
    attempts: attempts.length, completed: 0, allowed: 0, denied: 0, pendingReview: 0, unableToComplete: 0, cancelled: 0,
    byDecision: { allow: 0, deny: 0, 'pending-review': 0, 'unable-to-decide': 0, none: 0 }, byMatch: {}, byEligibility: {}, bySource: { local: 0, external: 0 }, simulated: 0,
  };
  for (const a of attempts) {
    const e = a.exceptionId ? exceptionsOf(state).find((x) => x.id === a.exceptionId) : undefined;
    const d = a.status === 'completed' ? currentDecision(a, e) : undefined;
    const stage = stageOf(a);
    if (a.status === 'cancelled') s.cancelled += 1;
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

/* ---------------- Programme oversight ---------------- */

export type ConfigurationStatus = 'meets-requirements' | 'action-required' | 'not-evaluated';
export const CONFIGURATION_STATUS_LABEL: Record<ConfigurationStatus, string> = { 'meets-requirements': 'Meets Requirements', 'action-required': 'Action Required', 'not-evaluated': 'Not Evaluated' };

/**
 * Programme Configuration Status of one programme-linked activity: whether it is set up to satisfy the
 * programme's mandatory requirements. A configuration check, not a legal or regulatory compliance claim.
 */
export function activityConfigurationStatus(state: AppState, activity: ActivityConfig, programme: VerificationProgramme): { status: ConfigurationStatus; checks: { label: string; ok: boolean; detail?: string }[] } {
  if (programme.status === 'draft' || activity.status === 'draft') return { status: 'not-evaluated', checks: [] };
  const policy = activityPolicy(state, activity);
  const req = programme.requirements;
  const own = policy.own;
  const src = policy.effective.identitySource;
  const integrationProblem = src.kind === 'external' ? sourceProblem(policy.integration, policy.effective.method) : null;
  const checks = [
    { label: 'Required identity source configured', ok: own.identitySource.kind === req.identitySource.kind && (req.identitySource.kind === 'local' || (own.identitySource.kind === 'external' && own.identitySource.integrationId === req.identitySource.integrationId)) },
    { label: 'Required verification method applied', ok: req.method !== 'face' || own.method === 'face' },
    { label: 'Mandatory liveness enabled', ok: req.liveness !== 'required' || own.liveness === 'required' },
    { label: 'Integration available', ok: !integrationProblem, ...(integrationProblem ? { detail: integrationProblem } : {}) },
    { label: 'Activity active', ok: activity.status === 'active' },
  ];
  return { status: checks.every((c) => c.ok) ? 'meets-requirements' : 'action-required', checks };
}

export interface ParticipantSummary {
  organizationId: string;
  name: string;
  participation: string;
  activities: ActivityConfig[];
  activeActivities: number;
  summary: Summary;
  lastActivity?: string;
  configuration: ConfigurationStatus;
}

/** Programme-linked transactions of the programme's participants (never their other activities). */
export function programmeTransactions(state: AppState, programme: VerificationProgramme, period: Period = {}, organizationId?: string): VerificationAttempt[] {
  const participants = new Set(programme.participants.map((p) => p.organizationId).concat(programme.scope === 'own' ? [programme.ownerOrganizationId] : []));
  return state.data.verificationAttempts.filter((a) => a.programmeId === programme.id && participants.has(a.organizationId) && (!organizationId || a.organizationId === organizationId)
    && a.status !== 'in-progress' && inPeriod(a.completedAt ?? a.startedAt, period));
}

/** Programme exceptions: those routed to the programme's reviewers. Local exceptions stay with their organization. */
export function programmeExceptions(state: AppState, programme: VerificationProgramme, organizationId?: string): VerificationException[] {
  return exceptionsOf(state).filter((e) => e.programmeId === programme.id && e.route === 'programme' && (!organizationId || e.organizationId === organizationId));
}

export function oversight(state: AppState, programme: VerificationProgramme, period: Period = {}) {
  const orgIds = programme.scope === 'own' ? [programme.ownerOrganizationId] : programme.participants.map((p) => p.organizationId);
  const rows: ParticipantSummary[] = orgIds.map((orgId) => {
    const activities = state.data.activityConfigs.filter((a) => a.organizationId === orgId && a.programmeId === programme.id);
    const tx = programmeTransactions(state, programme, period, orgId);
    const statuses = activities.map((a) => activityConfigurationStatus(state, a, programme).status);
    const configuration: ConfigurationStatus = !statuses.length || statuses.every((x) => x === 'not-evaluated') ? 'not-evaluated' : statuses.includes('action-required') ? 'action-required' : 'meets-requirements';
    return {
      organizationId: orgId, name: state.data.organizations.find((o) => o.id === orgId)?.name ?? orgId,
      participation: participation(programme, orgId) ?? 'removed', activities, activeActivities: activities.filter((a) => a.status === 'active').length,
      summary: summarize(state, tx), lastActivity: tx.map((a) => a.completedAt ?? a.startedAt).sort().pop(), configuration,
    };
  });
  const all = programmeTransactions(state, programme, period);
  const exceptions = programmeExceptions(state, programme);
  return {
    rows, summary: summarize(state, all),
    participating: programme.participants.filter((p) => p.status === 'active').length + (programme.scope === 'own' ? 1 : 0),
    activeActivities: rows.reduce((n, r) => n + r.activeActivities, 0),
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
