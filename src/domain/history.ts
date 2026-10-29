import { RESOLUTION_LABEL, type ResolutionOutcome, type VerificationException } from './exceptions';
import type { VerificationAttempt } from './types';

/**
 * Verification History reads each attempt's original result, separately from any later human review. One
 * attempt stays one record: review, approval and reopening update the linked review information only.
 */
export type OriginalResult = 'successful' | 'unsuccessful' | 'incomplete' | 'review';

export const ORIGINAL_RESULT_LABEL: Record<OriginalResult, string> = {
  successful: 'Successful', unsuccessful: 'Unsuccessful', incomplete: 'Incomplete', review: 'Referred for review',
};

/** The result the verification itself produced (never the review disposition). Undefined while in progress. */
export function originalResultOf(a: Pick<VerificationAttempt, 'status' | 'decision' | 'outcome'>): OriginalResult | undefined {
  if (a.status === 'in-progress') return undefined;
  if (a.status === 'cancelled' || a.status === 'expired' || a.status === 'error') return 'incomplete';
  const d = a.decision ?? ({ verified: 'allow', 'not-verified': 'deny', 'unable-to-verify': 'unable-to-decide', 'pending-review': 'pending-review' } as const)[a.outcome ?? 'unable-to-verify'];
  return ({ allow: 'successful', deny: 'unsuccessful', 'unable-to-decide': 'incomplete', 'pending-review': 'review' } as const)[d];
}

/** Earlier sample records kept only an allow/deny/indeterminate decision. */
export const legacyResult = (d: 'allow' | 'deny' | 'indeterminate'): OriginalResult => (d === 'allow' ? 'successful' : d === 'deny' ? 'unsuccessful' : 'incomplete');

/** The human-review outcome linked to an attempt, if there is one. */
export type ReviewKey = 'none' | 'pending-approval' | ResolutionOutcome;
export function reviewOutcomeOf(e?: VerificationException): { key: ReviewKey; label: string; detail?: string } {
  if (!e) return { key: 'none', label: 'No review' };
  if (e.resolution) return { key: e.resolution.outcome, label: RESOLUTION_LABEL[e.resolution.outcome] === 'Confirm identity' ? 'Identity confirmed' : RESOLUTION_LABEL[e.resolution.outcome], detail: e.approval ? `Approved by ${e.approval.by}` : undefined };
  if (e.status === 'pending-approval' && e.proposal) return { key: 'pending-approval', label: 'Awaiting approval', detail: `Proposed: ${RESOLUTION_LABEL[e.proposal.outcome]}` };
  return { key: 'none', label: 'No decision yet' };
}

export const REVIEW_FILTER_LABEL: Record<string, string> = {
  none: 'No review decision', 'pending-approval': 'Awaiting approval', 'verification-confirmed': 'Identity confirmed',
  'verification-not-confirmed': 'Identity could not be established', 'unable-to-resolve': 'Unable to resolve',
};
