import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, FlaskConical, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { sourceLabel } from '@/components/verification/RequirementsSummary';
import {
  activityCounts, displayStatus, eligibilityMode, eligibilityOutcome, identityStatus, maskIdentifier, outcomeExplanation, scheduleSummary,
} from '@/domain/activityLifecycle';
import type { ActivityConfig, VerificationAttempt } from '@/domain/types';
import { eligibleParticipants } from '@/domain/verification';
import { formatCoordinate, formatRadius } from '@/domain/location';
import { participantProgress, participantStatuses } from '@/domain/participantStatus';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { activityPolicy } from '@/store/sharingOps';
import { useSession, useStore } from '@/store/AppStore';

/**
 * What a verifier needs to know about an assigned activity: its status, when and where, the identity source,
 * and progress so far. Progress counts this organization's own records for the activity.
 */
export function useVerifierActivity(activity: ActivityConfig) {
  const { state } = useStore();
  const { organization } = useSession();
  const records = state.data.verificationAttempts.filter((a) => a.activityId === activity.id && a.organizationId === organization.id && a.status !== 'in-progress');
  const counts = activityCounts(records);
  const mode = eligibilityMode(activity);
  const eligible = mode === 'selected' ? eligibleParticipants(state.data, activity.organizationId, activity.participants) : null;
  const verifiedPeople = eligible ? new Set(records.filter((r) => r.subject?.memberId && eligible.has(r.subject.memberId) && identityStatus(r) === 'verified').map((r) => r.subject!.memberId)).size : 0;
  const policy = activityPolicy(state, activity);
  return {
    status: displayStatus(activity), schedule: scheduleSummary(activity.schedule), place: activityPlace(activity), mode, records, counts,
    eligible: eligible?.size ?? null, verifiedPeople, policy, source: sourceLabel(policy.effective.identitySource, policy.integration),
    owner: activity.organizationId !== organization.id ? state.data.organizations.find((o) => o.id === activity.organizationId)?.name : undefined,
  };
}

/** One line of progress for an activity card. */
export function progressLine(v: ReturnType<typeof useVerifierActivity>): string {
  if (v.eligible !== null) return `${v.verifiedPeople} of ${v.eligible} verified`;
  if (!v.counts.attempts) return 'No verifications yet';
  return `${v.counts.verified} verified · ${v.counts.attempts} ${v.counts.attempts === 1 ? 'attempt' : 'attempts'}`;
}

export type VerifierOutcomeKey = 'verified' | 'not-eligible' | 'verified-not-eligible' | 'unsuccessful' | 'pending' | 'unable' | 'cancelled';

/**
 * The result a verifier sees, from the two separate results: identity verification first, then eligibility.
 * "Identity verified, not eligible" keeps both visible instead of collapsing them into a single "Not verified".
 */
export function verifierOutcome(a: VerificationAttempt): { key: VerifierOutcomeKey; title: string; explanation: string } {
  if (a.status === 'cancelled') return { key: 'cancelled', title: 'Verification cancelled', explanation: 'The verification was cancelled before a result. No outcome is recorded for the person.' };
  const id = identityStatus(a);
  const elig = eligibilityOutcome(a);
  if (elig === 'not-eligible' && id !== 'verified' && (!a.match || a.match.status === 'not-evaluated')) return { key: 'not-eligible', title: 'Not eligible', explanation: 'This person isn’t eligible for this activity, so their identity wasn’t verified.' };
  if (id === 'verified' && elig === 'not-eligible') {
    return { key: 'verified-not-eligible', title: 'Identity verified, not eligible', explanation: `The portrait match confirmed who the person is, but they don’t meet this activity’s eligibility rules.${a.eligibilityExplanation ? ` ${a.eligibilityExplanation}` : ''}` };
  }
  // Activities that send problems for review have no final outcome until the review is done.
  if ((a.reviewDisposition?.decision ?? a.decision) === 'pending-review') {
    return { key: 'pending', title: 'Pending', explanation: `${outcomeExplanation(a)} There’s no final outcome yet: the activity sends this result for review.` };
  }
  if (id === 'verified') {
    return elig === 'unknown'
      ? { key: 'pending', title: 'Identity verified, eligibility not confirmed', explanation: 'The portrait match confirmed who the person is, but their eligibility couldn’t be confirmed, so there’s no final outcome yet.' }
      : { key: 'verified', title: 'Verified', explanation: outcomeExplanation(a) };
  }
  if (id === 'unsuccessful') return { key: 'unsuccessful', title: 'Unsuccessful', explanation: outcomeExplanation(a) };
  if (id === 'pending') return { key: 'pending', title: 'Pending', explanation: outcomeExplanation(a) };
  return { key: 'unable', title: 'Unable to complete', explanation: a.status === 'expired' ? 'The verification was started but not finished in time, so there’s no result.' : outcomeExplanation(a) };
}

const STYLE: Record<VerifierOutcomeKey, { icon: typeof CheckCircle2; cls: string }> = {
  verified: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-900 ring-emerald-200' },
  'verified-not-eligible': { icon: ShieldAlert, cls: 'bg-amber-50 text-amber-900 ring-amber-300' },
  'not-eligible': { icon: ShieldAlert, cls: 'bg-amber-50 text-amber-900 ring-amber-300' },
  unsuccessful: { icon: XCircle, cls: 'bg-red-50 text-red-900 ring-red-200' },
  pending: { icon: Clock, cls: 'bg-violet-50 text-violet-900 ring-violet-200' },
  unable: { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-900 ring-amber-300' },
  cancelled: { icon: CircleSlash, cls: 'bg-slate-100 text-slate-800 ring-slate-200' },
};

/** The person's name and masked identifier, from their FixID record or the identity source's response. Never the full identifier. */
export function useSubjectOf() {
  const { state } = useStore();
  return (a: VerificationAttempt): { name: string; identifier: string } => {
    const m = a.subject?.memberId ? state.data.members.find((x) => x.id === a.subject!.memberId) : undefined;
    if (m) return { name: m.displayName, identifier: maskIdentifier(m.identifier?.value) };
    if (a.lookup) return { name: a.lookup.displayName ?? (a.lookup.status === 'FOUND' ? 'Unnamed record' : 'No record found'), identifier: maskIdentifier(a.lookup.reference) };
    return { name: a.subject?.label ?? 'Not identified', identifier: '—' };
  };
}

/** The verifier's result headline: one clear status and a plain explanation. No images or scores. */
export function OutcomeHeadline({ attempt, name, identifier }: { attempt: VerificationAttempt; name: string; identifier: string }) {
  const o = verifierOutcome(attempt);
  const s = STYLE[o.key];
  return (
    <section aria-label="Result" className={cn('rounded-2xl px-5 py-5 ring-1 ring-inset', s.cls)}>
      <div className="flex items-start gap-3">
        <s.icon className="mt-0.5 h-8 w-8 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide opacity-80">Result</p>
          <h1 className="text-2xl font-semibold">{o.title}</h1>
          <p className="mt-1 text-sm">{o.explanation}</p>
          <p className="mt-3 text-sm font-medium">{name}<span className="ml-2 font-mono text-xs font-normal opacity-80">{identifier}</span></p>
        </div>
        {attempt.simulated && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-300"><FlaskConical className="h-3 w-3" aria-hidden="true" />Simulated</span>}
      </div>
      {o.key === 'unsuccessful' && (
        <p className="mt-3 border-t border-current/10 pt-3 text-sm">An unsuccessful match isn’t evidence of fraud. The record is kept; follow your organization’s procedure, for example checking the identifier and verifying again.</p>
      )}
    </section>
  );
}

/** One recorded verification: the person (masked identifier), the outcome, when and where. */
export function HistoryRow({ attempt: a, showActivity }: { attempt: VerificationAttempt; showActivity?: boolean }) {
  const subjectOf = useSubjectOf();
  const who = subjectOf(a);
  const o = a.status === 'in-progress' ? null : verifierOutcome(a);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-900">{who.name} <span className="font-mono text-xs font-normal text-slate-500">{who.identifier}</span></span>
        <span className="block text-xs text-slate-500">{showActivity ? `${a.activityName} · ` : ''}{formatDateTime(a.completedAt ?? a.startedAt)}</span>
      </span>
      {o ? <Badge tone={OUTCOME_TONE[o.key]}>{o.title}</Badge> : <Badge tone="info">In progress</Badge>}
      <Link to={`/verify/attempts/${a.id}`} className="font-medium text-brand-600 hover:text-brand-700">{a.status === 'in-progress' ? 'Resume' : 'View'}<span className="sr-only"> {a.id}</span></Link>
    </li>
  );
}

export const OUTCOME_TONE = { verified: 'success', 'verified-not-eligible': 'warning', 'not-eligible': 'warning', unsuccessful: 'danger', pending: 'violet', unable: 'warning', cancelled: 'neutral' } as const;


/** Where the activity takes place, from its location check or its descriptive location. */
export function activityPlace(a: ActivityConfig): string | null {
  const loc = a.locationCheck;
  if (loc?.enabled) return `${loc.label ? `${loc.label.split(',')[0]} · ` : ''}${formatCoordinate(loc.lat)}, ${formatCoordinate(loc.lng)} · within ${formatRadius(loc.radiusM)}`;
  return a.location || null;
}

/** Progress for the people eligible for an activity, from persisted verification results. */
export function useActivityProgress(activity: ActivityConfig) {
  const { state } = useStore();
  return participantProgress(participantStatuses(state.data.verificationAttempts, activity.id), eligibleParticipants(state.data, activity.organizationId, activity.participants));
}

