import type { ActivityDecision } from './activitySettings';
import type { VerificationAttempt } from './types';

/**
 * Verification Exceptions: a transaction that needs authorized attention under its activity
 * policy. An exception is a separate record linked to the transaction. It never changes the transaction's
 * recorded evidence (identity match, liveness, eligibility or the original decision); a reviewer records a
 * separate determination, and the transaction's current disposition is derived from it.
 */

export type ExceptionStatus = 'open' | 'assigned' | 'in-review' | 'awaiting-information' | 'pending-approval' | 'returned' | 'resolved' | 'closed' | 'reopened';
export type ExceptionReason =
  | 'identity-mismatch' | 'inconclusive' | 'liveness-failed' | 'record-ambiguity' | 'disputed'
  | 'eligibility-uncertain' | 'eligibility-not-met' | 'missing-evidence' | 'service-failure' | 'other';
/**
 * Review outcomes. Final: identity confirmed, identity could not be established, or (technical cases) unable to
 * resolve. Not final: another verification attempt, or escalation for further assessment.
 */
export type ResolutionOutcome = 'verification-confirmed' | 'verification-not-confirmed' | 'reverification-required' | 'escalated' | 'unable-to-resolve';
/** Where the exception is reviewed: the transaction's own organization, or (shared activities) the activity owner's reviewers. */
export type ExceptionRoute = 'local' | 'owner';

export type ExceptionAction =
  | 'created' | 'assigned' | 'review-started' | 'note-added' | 'information-requested'
  | 'resolution-recorded' | 'closed' | 'reverification-started' | 'reverification-completed'
  | 'proposal-submitted' | 'proposal-approved' | 'proposal-rejected' | 'proposal-returned' | 'escalated' | 'reopened' | 'evidence-viewed';

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
  /** A final decision submitted for approval (when the reviewing organization requires approval). */
  proposal?: { outcome: ResolutionOutcome; reason: string; at: string; byId: string; by: string };
  /** Who approved the resolution, when approval was required. */
  approval?: { at: string; byId: string; by: string; reason?: string };
  /** Set while the case is escalated for further assessment. */
  escalation?: { at: string; by: string; reason: string };
  /** Earlier resolutions, kept when a case is reopened. */
  previousResolutions?: NonNullable<VerificationException['resolution']>[];
  /** Set when a reviewer required another attempt; cleared when it completes. */
  reverificationRequested?: { at: string; by: string };
  reverificationTransactionIds: string[];
}

export const EXCEPTION_STATUS_LABEL: Record<ExceptionStatus, string> = {
  open: 'Open', assigned: 'Assigned', 'in-review': 'Under Review', 'awaiting-information': 'Awaiting Information', 'pending-approval': 'Pending Approval',
  returned: 'Returned for Review', resolved: 'Resolved', closed: 'Closed', reopened: 'Reopened',
};
export const EXCEPTION_REASON_LABEL: Record<ExceptionReason, string> = {
  'identity-mismatch': 'Identity mismatch', inconclusive: 'Inconclusive verification', 'liveness-failed': 'Failed mandatory liveness',
  'record-ambiguity': 'Identity record ambiguity', disputed: 'Disputed verification', 'eligibility-uncertain': 'Eligibility uncertainty',
  'eligibility-not-met': 'Eligibility not met', 'missing-evidence': 'Missing required evidence', 'service-failure': 'Verification service failure', other: 'Other review condition',
};
export const RESOLUTION_LABEL: Record<ResolutionOutcome, string> = {
  'verification-confirmed': 'Confirm identity', 'verification-not-confirmed': 'Identity could not be established',
  'reverification-required': 'Request another verification attempt', escalated: 'Escalate for further assessment', 'unable-to-resolve': 'Unable to resolve',
};
/** Outcomes that end the review (and need approval when the organization requires it). */
export const FINAL_OUTCOMES: ResolutionOutcome[] = ['verification-confirmed', 'verification-not-confirmed', 'unable-to-resolve'];
export const isFinalOutcome = (o: ResolutionOutcome) => FINAL_OUTCOMES.includes(o);
export const EXCEPTION_ACTION_LABEL: Record<ExceptionAction, string> = {
  created: 'Exception created', assigned: 'Reviewer assigned', 'review-started': 'Review started', 'note-added': 'Review note added',
  'information-requested': 'Information requested', 'resolution-recorded': 'Resolution recorded', closed: 'Exception closed',
  'reverification-started': 'Reverification started', 'reverification-completed': 'Reverification completed',
  'proposal-submitted': 'Submitted for approval', 'proposal-approved': 'Proposal approved', 'proposal-rejected': 'Proposal rejected',
  'proposal-returned': 'Returned for further review', escalated: 'Escalated for further assessment', reopened: 'Exception reopened', 'evidence-viewed': 'Evidence viewed',
};

/** Statuses in which the exception is still being worked on. */
export const OPEN_STATUSES: ExceptionStatus[] = ['open', 'assigned', 'in-review', 'awaiting-information', 'pending-approval', 'returned', 'reopened'];
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

/**
 * The final disposition a resolution gives the transaction (kept separately from its original decision).
 * Confirming identity never makes anyone eligible: the activity's eligibility result still applies.
 */
export function dispositionFor(outcome: ResolutionOutcome, attempt?: Pick<VerificationAttempt, 'eligibilityStatus' | 'eligibilityResult'>): ActivityDecision | 'pending-review' {
  if (outcome === 'verification-confirmed') {
    const e = attempt?.eligibilityStatus;
    if (e === 'ineligible' || attempt?.eligibilityResult === 'not-eligible') return 'deny';
    if (e === 'unknown' || e === 'not-evaluated') return 'unable-to-decide';
    return 'allow';
  }
  return ({ 'verification-not-confirmed': 'deny', 'unable-to-resolve': 'unable-to-decide', 'reverification-required': 'pending-review', escalated: 'pending-review' } as const)[outcome];
}

/**
 * What kind of case it is. Technical failures (an unavailable source or service) are recorded as technical
 * issues: they can be retried or escalated, but they're never an identity adjudication.
 */
export type ExceptionCategory = 'identity' | 'eligibility' | 'technical';
export function categoryOf(reason: ExceptionReason): ExceptionCategory {
  if (reason === 'service-failure') return 'technical';
  if (reason === 'eligibility-uncertain' || reason === 'eligibility-not-met') return 'eligibility';
  return 'identity';
}
export const CATEGORY_LABEL: Record<ExceptionCategory, string> = { identity: 'Identity review', eligibility: 'Eligibility review', technical: 'Technical issue' };
/** Outcomes a reviewer can choose for a category. */
export function outcomesFor(category: ExceptionCategory): ResolutionOutcome[] {
  return category === 'technical' ? ['reverification-required', 'escalated', 'unable-to-resolve']
    : ['verification-confirmed', 'verification-not-confirmed', 'reverification-required', 'escalated'];
}
