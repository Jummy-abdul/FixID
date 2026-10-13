import type { ActivityDecision } from './activitySettings';
import type { VerificationAttempt } from './types';

/**
 * Verification Exceptions: a transaction that needs authorized attention under its activity
 * policy. An exception is a separate record linked to the transaction. It never changes the transaction's
 * recorded evidence (identity match, liveness, eligibility or the original decision); a reviewer records a
 * separate determination, and the transaction's current disposition is derived from it.
 */

export type ExceptionStatus = 'open' | 'assigned' | 'in-review' | 'awaiting-information' | 'resolved' | 'closed';
export type ExceptionReason =
  | 'identity-mismatch' | 'inconclusive' | 'liveness-failed' | 'record-ambiguity' | 'disputed'
  | 'eligibility-uncertain' | 'eligibility-not-met' | 'missing-evidence' | 'service-failure' | 'other';
export type ResolutionOutcome = 'verification-confirmed' | 'verification-not-confirmed' | 'reverification-required' | 'unable-to-resolve';
/** Where the exception is reviewed: the transaction's own organization, or (shared activities) the activity owner's reviewers. */
export type ExceptionRoute = 'local' | 'owner';

export type ExceptionAction =
  | 'created' | 'assigned' | 'review-started' | 'note-added' | 'information-requested'
  | 'resolution-recorded' | 'closed' | 'reverification-started' | 'reverification-completed';

export interface ExceptionEvent {
  id: string;
  at: string;
  action: ExceptionAction;
  actorId: string;
  actorName: string;
  actorOrganizationId: string;
  fromStatus?: ExceptionStatus;
  toStatus?: ExceptionStatus;
  comment?: string;
  /** References to supporting evidence (never the evidence itself, never biometric data). */
  evidenceRefs?: string[];
  /** A linked transaction (e.g. the reverification attempt). */
  transactionId?: string;
}

export interface VerificationException {
  id: string;
  /** The organization whose transaction it is. */
  organizationId: string;
  /** Shared activities: the organization that owns the activity. */
  activityOwnerId?: string;
  transactionId: string;
  activityId: string;
  activityName: string;
  reason: ExceptionReason;
  reasonDetail: string;
  route: ExceptionRoute;
  /** The organization whose authorized reviewers may act on it. */
  reviewOrganizationId: string;
  status: ExceptionStatus;
  assignedReviewerId?: string;
  assignedReviewerName?: string;
  createdAt: string;
  updatedAt: string;
  history: ExceptionEvent[];
  resolution?: { outcome: ResolutionOutcome; reason: string; disposition: ActivityDecision | 'pending-review'; at: string; by: string };
  /** Set when a reviewer required another attempt; cleared when it completes. */
  reverificationRequested?: { at: string; by: string };
  reverificationTransactionIds: string[];
}

export const EXCEPTION_STATUS_LABEL: Record<ExceptionStatus, string> = {
  open: 'Open', assigned: 'Assigned', 'in-review': 'In Review', 'awaiting-information': 'Awaiting Information', resolved: 'Resolved', closed: 'Closed',
};
export const EXCEPTION_REASON_LABEL: Record<ExceptionReason, string> = {
  'identity-mismatch': 'Identity mismatch', inconclusive: 'Inconclusive verification', 'liveness-failed': 'Failed mandatory liveness',
  'record-ambiguity': 'Identity record ambiguity', disputed: 'Disputed verification', 'eligibility-uncertain': 'Eligibility uncertainty',
  'eligibility-not-met': 'Eligibility not met', 'missing-evidence': 'Missing required evidence', 'service-failure': 'Verification service failure', other: 'Other review condition',
};
export const RESOLUTION_LABEL: Record<ResolutionOutcome, string> = {
  'verification-confirmed': 'Verification Confirmed', 'verification-not-confirmed': 'Verification Not Confirmed',
  'reverification-required': 'Reverification Required', 'unable-to-resolve': 'Unable to Resolve',
};
export const EXCEPTION_ACTION_LABEL: Record<ExceptionAction, string> = {
  created: 'Exception created', assigned: 'Reviewer assigned', 'review-started': 'Review started', 'note-added': 'Review note added',
  'information-requested': 'Information requested', 'resolution-recorded': 'Resolution recorded', closed: 'Exception closed',
  'reverification-started': 'Reverification started', 'reverification-completed': 'Reverification completed',
};

/** Statuses in which the exception is still being worked on. */
export const OPEN_STATUSES: ExceptionStatus[] = ['open', 'assigned', 'in-review', 'awaiting-information'];
export const isUnresolved = (e: Pick<VerificationException, 'status'>) => OPEN_STATUSES.includes(e.status);

/** Why a transaction needs review, from its recorded results. */
export function reasonFor(a: VerificationAttempt, referred?: boolean): { reason: ExceptionReason; detail: string } {
  const detail = a.decisionExplanation ?? a.reasons[0] ?? 'Required by the activity’s review policy.';
  if (referred) return { reason: 'disputed', detail: a.review?.reason ?? 'Referred for review by the verifier.' };
  if (a.lookup?.status === 'MULTIPLE_MATCHES') return { reason: 'record-ambiguity', detail };
  if (a.liveness?.required && a.liveness.status === 'failed') return { reason: 'liveness-failed', detail };
  if (a.liveness?.required && (a.liveness.status === 'inconclusive' || a.liveness.status === 'unavailable' || a.liveness.status === 'not-performed')) return { reason: 'missing-evidence', detail };
  switch (a.match?.status) {
    case 'no-match': return { reason: 'identity-mismatch', detail };
    case 'inconclusive': return { reason: 'inconclusive', detail };
    case 'unavailable': case 'error': return { reason: 'service-failure', detail };
    case 'not-evaluated': return { reason: 'missing-evidence', detail };
    default:
  }
  if (a.eligibilityStatus === 'ineligible') return { reason: 'eligibility-not-met', detail };
  if (a.eligibilityStatus === 'unknown' || a.eligibilityStatus === 'not-evaluated') return { reason: 'eligibility-uncertain', detail };
  return { reason: 'other', detail };
}

/**
 * Whether the recorded identity evidence can support "Verification Confirmed". A reviewer may confirm an
 * eligibility question, but never turns a failed, missing or inconclusive biometric or liveness result into
 * a success: those need a fresh verification (a linked reverification that was allowed).
 */
export function confirmationProblem(original: VerificationAttempt, reverifications: VerificationAttempt[]): string | null {
  const latest = [...reverifications].filter((r) => r.status !== 'in-progress').sort((x, y) => (y.completedAt ?? '').localeCompare(x.completedAt ?? ''))[0];
  if (latest) {
    return latest.decision === 'allow' ? null : 'The latest reverification wasn’t successful, so verification can’t be confirmed.';
  }
  const m = original.match?.status;
  const identityOk = m === 'match' || m === 'record-confirmed' || m === 'not-required';
  if (!identityOk) return 'The identity result wasn’t a match. Confirming requires a successful reverification; the original result can’t be overridden.';
  if (original.liveness?.required && original.liveness.status !== 'passed') return 'The mandatory liveness check didn’t pass. Confirming requires a successful reverification.';
  return null;
}

/** The final disposition a resolution gives the transaction (kept separately from its original decision). */
export function dispositionFor(outcome: ResolutionOutcome): ActivityDecision | 'pending-review' {
  return { 'verification-confirmed': 'allow', 'verification-not-confirmed': 'deny', 'unable-to-resolve': 'unable-to-decide', 'reverification-required': 'pending-review' }[outcome] as ActivityDecision | 'pending-review';
}
