import type { LookupOutcome } from './integrations';
import type { ActivityDecision, VerificationSettings } from './activitySettings';
import type { VerificationAttempt } from './types';

/**
 * Verification Transactions: one record per verification attempt, for both identity models.
 *
 * - Local: the person has a FixID record and (for face verification) an enrolled reference.
 * - External: the reference identity is held by an authorized external service; the person needs no FixID
 *   record, and nothing is enrolled or copied into FixID.
 *
 * Identity match, liveness, eligibility and the activity decision are recorded separately. The decision is
 * always derived here from the recorded results and the authoritative activity policy, never
 * accepted from a screen. The transaction is the existing `VerificationAttempt` record, extended, so local
 * verification history and its terminology keep working.
 */

/** Where a transaction is in its lifecycle. One clear current state; the final states don't overlap. */
export type TransactionStage =
  | 'initiated' | 'lookup-completed' | 'capture-pending' | 'matching' | 'eligibility-check'
  | 'pending-review' | 'completed' | 'failed' | 'cancelled' | 'unable-to-complete';

export type LivenessStatus = 'passed' | 'failed' | 'inconclusive' | 'unavailable' | 'not-performed' | 'not-required';
/**
 * Identity verification result. `record-confirmed`: a record-only method (no biometric step) where the
 * authorized source confirmed the record. `not-evaluated`: matching didn't run (for example a mandatory
 * liveness check failed first, or the lookup didn't find one identity).
 */
export type IdentityMatchStatus = 'match' | 'no-match' | 'inconclusive' | 'unavailable' | 'error' | 'record-confirmed' | 'not-required' | 'not-evaluated';
export type EligibilityStatus = 'eligible' | 'ineligible' | 'unknown' | 'not-required' | 'not-evaluated';

export const STAGE_LABEL: Record<TransactionStage, string> = {
  initiated: 'Initiated', 'lookup-completed': 'Lookup completed', 'capture-pending': 'Capture pending', matching: 'Matching',
  'eligibility-check': 'Eligibility check', 'pending-review': 'Pending review', completed: 'Completed', failed: 'Failed',
  cancelled: 'Cancelled', 'unable-to-complete': 'Unable to complete',
};
export const DECISION_LABEL: Record<ActivityDecision, string> = { allow: 'Verified', deny: 'Not verified', 'pending-review': 'Pending review', 'unable-to-decide': 'Unable to verify' };
export const MATCH_LABEL: Record<IdentityMatchStatus, string> = {
  match: 'Identity matched', 'no-match': 'No match', inconclusive: 'Inconclusive', unavailable: 'Source unavailable', error: 'Error',
  'record-confirmed': 'Record confirmed (no biometric match required)', 'not-required': 'Not required', 'not-evaluated': 'Not evaluated',
};
export const LIVENESS_STATUS_LABEL: Record<LivenessStatus, string> = {
  passed: 'Passed', failed: 'Failed', inconclusive: 'Inconclusive', unavailable: 'Unavailable', 'not-performed': 'Not performed', 'not-required': 'Not required',
};
export const ELIGIBILITY_STATUS_LABEL: Record<EligibilityStatus, string> = {
  eligible: 'Eligible', ineligible: 'Ineligible', unknown: 'Unknown', 'not-required': 'Not required', 'not-evaluated': 'Not evaluated',
};
export const LOOKUP_LABEL: Record<LookupOutcome, string> = {
  FOUND: 'Identity found', NOT_FOUND: 'Not found', MULTIPLE_MATCHES: 'Multiple matches', UNAVAILABLE: 'Service unavailable', ERROR: 'Error',
};

/** Plain-language messages for the external journey (no technical API terms). */
export const MESSAGES = {
  notFound: 'No identity record was found for the reference provided.',
  multiple: 'More than one identity record matches this reference. It can’t be resolved here, so the transaction needs review.',
  lookupUnavailable: 'The identity service is currently unavailable. Verification cannot continue.',
  lookupError: 'The identity service couldn’t process this request. Check the reference and try again. If it keeps happening, contact your administrator.',
  noMatch: 'Identity could not be confirmed.',
  inconclusive: 'Verification was inconclusive.',
  matchUnavailable: 'Verification could not be completed because the identity service is unavailable.',
  matchError: 'The identity service returned an error, so identity couldn’t be confirmed.',
} as const;

const wantsReview = (s: Pick<VerificationSettings, 'exceptions'>) => s.exceptions !== 'unsuccessful';

export interface DecisionInput {
  match: IdentityMatchStatus;
  liveness: LivenessStatus;
  livenessRequired: boolean;
  eligibility: EligibilityStatus;
  settings: Pick<VerificationSettings, 'decisionRules' | 'exceptions'>;
}

/**
 * The reusable decision evaluator. Combines identity match, liveness, eligibility and the effective policy.
 * A failed mandatory check never produces Allow; an unavailable service never
 * produces Allow; inconclusive is never a match; a match alone never allows.
 */
export function evaluateDecision(i: DecisionInput): { decision: ActivityDecision; explanation: string } {
  const review = wantsReview(i.settings);
  const rules = i.settings.decisionRules;
  // 1. Mandatory liveness comes first: matching can't succeed without it.
  if (i.livenessRequired && i.liveness !== 'passed') {
    if (i.liveness === 'failed') {
      return review
        ? { decision: 'pending-review', explanation: 'The required liveness check failed. Identity verification requires further review.' }
        : { decision: 'deny', explanation: 'The required liveness check failed, so identity couldn’t be confirmed.' };
    }
    if (i.liveness === 'inconclusive') {
      return rules.onInconclusiveMatch === 'pending-review'
        ? { decision: 'pending-review', explanation: 'The required liveness check was inconclusive. Identity verification requires further review.' }
        : { decision: 'unable-to-decide', explanation: 'The required liveness check was inconclusive. Verification could not be completed.' };
    }
    return rules.onServiceUnavailable === 'pending-review'
      ? { decision: 'pending-review', explanation: 'The required liveness check couldn’t be performed. Identity verification requires further review.' }
      : { decision: 'unable-to-decide', explanation: 'The required liveness check couldn’t be performed. Verification could not be completed.' };
  }
  // 2. Identity.
  switch (i.match) {
    case 'unavailable':
    case 'error':
      return rules.onServiceUnavailable === 'pending-review'
        ? { decision: 'pending-review', explanation: `${i.match === 'error' ? MESSAGES.matchError : MESSAGES.matchUnavailable} Identity verification requires further review.` }
        : { decision: 'unable-to-decide', explanation: i.match === 'error' ? `${MESSAGES.matchError} Verification could not be completed.` : MESSAGES.matchUnavailable };
    case 'not-evaluated':
      return { decision: 'unable-to-decide', explanation: 'Required evidence is missing. Verification could not be completed.' };
    case 'inconclusive':
      return rules.onInconclusiveMatch === 'pending-review'
        ? { decision: 'pending-review', explanation: `${MESSAGES.inconclusive} Identity verification requires further review.` }
        : { decision: 'unable-to-decide', explanation: `${MESSAGES.inconclusive} Verification could not be completed.` };
    case 'no-match':
      return review
        ? { decision: 'pending-review', explanation: `${MESSAGES.noMatch} Identity verification requires further review.` }
        : { decision: 'deny', explanation: `${MESSAGES.noMatch} The activity’s policy doesn’t allow access without a confirmed identity.` };
    default:
  }
  // 3. Identity confirmed: eligibility decides.
  switch (i.eligibility) {
    case 'eligible': return { decision: 'allow', explanation: 'Identity confirmed and eligibility requirements satisfied.' };
    case 'not-required': return { decision: 'allow', explanation: 'Identity confirmed. This activity doesn’t require an eligibility check.' };
    case 'ineligible':
      return review
        ? { decision: 'pending-review', explanation: 'Identity confirmed, but eligibility requirements were not met. The activity’s policy requires review.' }
        : { decision: 'deny', explanation: 'Identity confirmed, but eligibility requirements were not met.' };
    default:
      return { decision: 'pending-review', explanation: 'Identity confirmed, but eligibility couldn’t be determined. Review required.' };
  }
}

/** Default rule for external-source eligibility when an activity doesn't name one. */
export const DEFAULT_ELIGIBILITY_ATTRIBUTE = 'recordStatus';
export const DEFAULT_ELIGIBLE_VALUES = ['ACTIVE'];

const normRef = (v: string) => v.trim().toUpperCase();

/**
 * Eligibility for an externally referenced identity, from the activity's configured approach only:
 * - reference-list: the authorized reference (as entered, or as confirmed by the service) is on the permitted list;
 * - external-source: the configured permitted attribute returned by the lookup has an eligible value;
 * - none: Not Required (never "Eligible": no check was performed).
 * Unrelated attributes are never used.
 */
export function externalEligibility(s: Pick<VerificationSettings, 'eligibility'>, lookup: { reference: string; referenceId?: string; attributes?: Record<string, string> }): { status: EligibilityStatus; explanation: string } {
  const e = s.eligibility;
  switch (e.approach) {
    case 'none': return { status: 'not-required', explanation: 'No predefined population: eligibility isn’t required for this activity.' };
    case 'reference-list': {
      const list = new Set((e.referenceList ?? []).map(normRef));
      const hit = list.has(normRef(lookup.reference)) || (!!lookup.referenceId && list.has(normRef(lookup.referenceId)));
      return hit ? { status: 'eligible', explanation: 'The reference is on the activity’s permitted list.' } : { status: 'ineligible', explanation: 'The reference isn’t on the activity’s permitted list.' };
    }
    case 'external-source': {
      const attribute = e.attribute ?? DEFAULT_ELIGIBILITY_ATTRIBUTE;
      const allowed = (e.allowedValues?.length ? e.allowedValues : DEFAULT_ELIGIBLE_VALUES).map(normRef);
      const value = lookup.attributes?.[attribute];
      if (value === undefined || value === '') return { status: 'unknown', explanation: `The identity service didn’t return “${attribute}”, so eligibility couldn’t be determined.` };
      return allowed.includes(normRef(String(value)))
        ? { status: 'eligible', explanation: `“${attribute}” is ${value}, which is eligible for this activity.` }
        : { status: 'ineligible', explanation: `“${attribute}” is ${value}, which isn’t eligible for this activity.` };
    }
    default: return { status: 'unknown', explanation: 'This eligibility approach can’t be used with an external identity source.' };
  }
}

/** The stage a final decision leaves a transaction in. */
export function finalStage(decision: ActivityDecision, match: IdentityMatchStatus): TransactionStage {
  if (decision === 'pending-review') return 'pending-review';
  if (decision === 'unable-to-decide') return match === 'unavailable' || match === 'error' ? 'unable-to-complete' : 'failed';
  return 'completed';
}

/** The current stage of any attempt, including those recorded before transactions had one. */
export function stageOf(a: Pick<VerificationAttempt, 'status' | 'stage' | 'decision' | 'outcome'>): TransactionStage {
  if (a.status === 'cancelled') return 'cancelled';
  if (a.status === 'expired') return 'unable-to-complete';
  if (a.status === 'error') return 'failed';
  if (a.stage) return a.stage;
  if (a.status === 'in-progress') return 'initiated';
  if (a.outcome === 'pending-review') return 'pending-review';
  return a.outcome === 'unable-to-verify' ? 'unable-to-complete' : 'completed';
}

/** A short, privacy-aware label for an external reference shown to people who can see the transaction. */
export const referenceLabel = (reference: string) => reference.trim().toUpperCase();

/**
 * Whether a previous transaction's identity result may be reused for a new one under a reuse-within policy:
 * same organization, activity (purpose), identity source and reference; a completed Allow with a real match
 * that satisfied the controls required now; within the validity period. Failed, inconclusive, pending,
 * unavailable and reused results are never reused.
 */
export function reuseProblem(prior: VerificationAttempt, current: Pick<VerificationAttempt, 'organizationId' | 'activityId' | 'integrationId' | 'id'> & { referenceId?: string; livenessRequired: boolean }, policyDays: number | null, now: Date): string | null {
  if (policyDays === null) return 'This activity requires a fresh verification every time.';
  if (prior.id === current.id) return 'A transaction can’t reuse itself.';
  if (prior.organizationId !== current.organizationId || prior.activityId !== current.activityId) return 'Results from other organizations or activities can’t be reused.';
  if (prior.identitySource !== 'external' || prior.integrationId !== current.integrationId) return 'The earlier result used a different identity source.';
  if (!current.referenceId || prior.lookup?.referenceId !== current.referenceId) return 'The earlier result is for a different identity.';
  if (prior.status !== 'completed' || prior.decision !== 'allow' || prior.match?.status !== 'match') return 'Only a completed, successful verification can be reused.';
  if (prior.reusedFrom) return 'A reused result can’t be reused again.';
  if (current.livenessRequired && prior.liveness?.status !== 'passed') return 'The earlier result doesn’t satisfy the liveness check required now.';
  const at = new Date(prior.completedAt ?? prior.startedAt).getTime();
  if (now.getTime() - at > policyDays * 86_400_000) return 'The earlier result is outside the validity period.';
  return null;
}
