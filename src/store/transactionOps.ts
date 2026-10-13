import type { CustomIntegration } from '@/domain/integrations';
import type { VerificationSettings } from '@/domain/activitySettings';
import {
  MESSAGES, evaluateDecision, externalEligibility, finalStage, reuseProblem,
  type EligibilityStatus, type IdentityMatchStatus, type LivenessStatus,
} from '@/domain/transactions';
import type { CheckRun, VerificationAttempt } from '@/domain/types';
import { FACE_UNAVAILABLE_REASON } from '@/services/faceVerification';
import type { IdentityLookupResult } from '@/services/integrations/contract';
import { guardInProgress, replaceAttempt, type AttemptError } from './attemptOps';
import { activityPolicy, settingsFromVersion } from './sharingOps';
import type { AppState } from './state';

/**
 * Verification Transaction steps for the external identity journey, and the unified result fields for
 * local verification. Every step re-checks the transaction's state and the verifier; the eligibility result
 * and the decision are computed here from recorded results and the authoritative activity
 * policy, never accepted from the caller. Production must run this on the server.
 */

type Result = { ok: true; state: AppState; attempt: VerificationAttempt } | { ok: false; error: string; code: AttemptError | 'invalid-step' };

/** The effective policy a transaction runs under, read from the activity now. */
export function transactionPolicy(state: AppState, attempt: Pick<VerificationAttempt, 'activityId' | 'versionId'>): {
  settings: VerificationSettings; integration?: CustomIntegration; livenessRequired: boolean; livenessApplies: boolean; reuseDays: number | null;
} {
  const activity = state.data.activityConfigs.find((a) => a.id === attempt.activityId);
  if (!activity) {
    const version = state.data.activityVersions.find((v) => v.id === attempt.versionId);
    const settings = settingsFromVersion(version);
    return { settings, livenessRequired: settings.liveness === 'required', livenessApplies: settings.method === 'face', reuseDays: null };
  }
  const p = activityPolicy(state, activity);
  const s = p.effective;
  return {
    settings: s, integration: p.integration,
    livenessRequired: s.method === 'face' && s.liveness === 'required',
    livenessApplies: s.method === 'face' && s.liveness !== 'not-applicable',
    reuseDays: s.reverification.mode === 'reuse-within' ? s.reverification.days : null,
  };
}

const OUTCOME = { allow: 'verified', deny: 'not-verified', 'pending-review': 'pending-review', 'unable-to-decide': 'unable-to-verify' } as const;
const ACCESS = { allow: 'permitted', deny: 'not-permitted', 'pending-review': 'review-required', 'unable-to-decide': 'review-required' } as const;
const ELIGIBILITY_COMPAT: Record<EligibilityStatus, NonNullable<VerificationAttempt['eligibilityResult']>> = {
  eligible: 'eligible', ineligible: 'not-eligible', unknown: 'unable', 'not-required': 'not-required', 'not-evaluated': 'unable',
};

function identityCompat(match: IdentityMatchStatus, liveness: LivenessStatus, livenessRequired: boolean): NonNullable<VerificationAttempt['verificationResult']> {
  if (livenessRequired && liveness === 'failed') return 'not-verified';
  if (match === 'match' || match === 'record-confirmed') return 'verified';
  if (match === 'not-required') return 'not-required';
  return match === 'no-match' ? 'not-verified' : 'unable-to-verify';
}

/** Result rows in the existing check format, so history and detail views read external transactions too. */
function externalChecks(a: VerificationAttempt, at: string): CheckRun[] {
  const runs: CheckRun[] = [];
  const st = (s: string): CheckRun['status'] => (s === 'passed' || s === 'match' || s === 'record-confirmed' || s === 'eligible' || s === 'FOUND' ? 'passed'
    : s === 'failed' || s === 'no-match' || s === 'ineligible' || s === 'NOT_FOUND' ? 'failed'
      : s === 'not-evaluated' || s === 'not-performed' ? 'skipped' : s === 'error' || s === 'unavailable' || s === 'UNAVAILABLE' || s === 'ERROR' ? 'error' : 'inconclusive');
  if (a.lookup) {
    runs.push({ checkId: `${a.id}_lookup`, type: 'identity-lookup', requirement: 'required', status: st(a.lookup.status), simulated: a.lookup.simulated, completedAt: a.lookup.at,
      explanation: a.lookup.status === 'FOUND' ? `Identity record found by ${a.serviceName ?? 'the identity service'}.` : { NOT_FOUND: MESSAGES.notFound, MULTIPLE_MATCHES: MESSAGES.multiple, UNAVAILABLE: MESSAGES.lookupUnavailable, ERROR: MESSAGES.lookupError, FOUND: '' }[a.lookup.status],
      evidenceRef: a.lookup.referenceId ? `external:${a.lookup.referenceId}` : undefined });
  }
  if (a.liveness && a.liveness.status !== 'not-required') {
    runs.push({ checkId: `${a.id}_liveness`, type: 'liveness', requirement: a.liveness.required ? 'required' : 'optional', status: st(a.liveness.status), simulated: a.liveness.simulated, completedAt: a.liveness.at,
      explanation: a.liveness.simulated ? `Simulated liveness result: ${a.liveness.status}. No presentation-attack detection was performed.` : `Liveness ${a.liveness.status}.` });
  }
  if (a.match && a.match.status !== 'record-confirmed') {
    runs.push({ checkId: `${a.id}_match`, type: 'face-match', requirement: 'required', status: st(a.match.status), simulated: a.match.simulated, completedAt: a.match.at,
      explanation: a.reusedFrom ? `Reused the identity result of transaction ${a.reusedFrom}. No new biometric match was performed.`
        : { match: `Identity matched by ${a.serviceName}${a.match.simulated ? ' (simulated: no faces were compared)' : ''}.`, 'no-match': MESSAGES.noMatch, inconclusive: MESSAGES.inconclusive, unavailable: MESSAGES.matchUnavailable, error: MESSAGES.matchError, 'not-evaluated': 'Not run: a required earlier step didn’t succeed.', 'record-confirmed': '', 'not-required': 'Not required.' }[a.match.status],
      evidenceRef: a.match.providerTransactionId ? `provider:${a.match.providerTransactionId}` : undefined });
  }
  if (a.eligibilityStatus && a.eligibilityStatus !== 'not-required') {
    runs.push({ checkId: `${a.id}_eligibility`, type: 'external-eligibility', requirement: 'required', status: st(a.eligibilityStatus), completedAt: at, explanation: a.eligibilityExplanation ?? '' });
  }
  return runs;
}

/** Records the final results of an external transaction, deriving eligibility and the decision. */
function finalizeExternal(state: AppState, a: VerificationAttempt, at: string, r: {
  match: NonNullable<VerificationAttempt['match']>; liveness: NonNullable<VerificationAttempt['liveness']>; submissionId?: string; reusedFrom?: string; failureReason?: string;
}): VerificationAttempt {
  const policy = transactionPolicy(state, a);
  const evaluated = r.match.status === 'match' || r.match.status === 'no-match' || r.match.status === 'record-confirmed';
  const elig = evaluated && a.lookup
    ? externalEligibility(policy.settings, { reference: a.lookup.reference, referenceId: a.lookup.referenceId, attributes: a.lookup.attributes })
    : { status: 'not-evaluated' as const, explanation: 'Not evaluated: identity wasn’t established.' };
  const { decision, explanation } = evaluateDecision({ match: r.match.status, liveness: r.liveness.status, livenessRequired: policy.livenessRequired, eligibility: elig.status, settings: policy.settings });
  const next: VerificationAttempt = {
    ...a, status: 'completed', completedAt: at, stage: finalStage(decision, r.match.status), match: r.match, liveness: r.liveness,
    eligibilityStatus: elig.status, eligibilityExplanation: elig.explanation, decision, decisionExplanation: explanation,
    ...(r.reusedFrom ? { reusedFrom: r.reusedFrom } : {}), ...(r.submissionId ? { submissionId: r.submissionId } : {}),
    outcome: OUTCOME[decision], accessDecision: ACCESS[decision], accessReasons: decision === 'allow' ? [] : [explanation],
    verificationResult: identityCompat(r.match.status, r.liveness.status, policy.livenessRequired), eligibilityResult: ELIGIBILITY_COMPAT[elig.status],
    reasons: [explanation], simulated: !!(a.lookup?.simulated || r.liveness.simulated || r.match.simulated),
    review: decision === 'pending-review' ? { status: 'pending', referredAt: at, referredBy: 'Activity policy', reason: explanation } : undefined,
  };
  if (decision !== 'allow') next.failureReason = r.failureReason ?? explanation;
  return { ...next, checks: externalChecks(next, at) };
}

function guardExternal(state: AppState, attemptId: string, at: string): { ok: true; attempt: VerificationAttempt } | { ok: false; error: string; code: AttemptError | 'invalid-step' } {
  const g = guardInProgress(state, attemptId, at);
  if (!g.ok) return g;
  if (g.attempt.identitySource !== 'external') return { ok: false, error: 'This verification doesn’t use an external identity service.', code: 'invalid-step' };
  return g;
}

/**
 * Records an external identity lookup. The reference may be corrected and looked up again until an identity
 * is found. Multiple matches can't be resolved here (contract 1.0 has no disambiguation), so the transaction
 * goes to review. Nothing is written about the person outside this transaction: no FixID record, no enrollment.
 */
export function applyExternalLookup(state: AppState, input: { attemptId: string; at: string; reference: string; requestId: string; result: IdentityLookupResult }): Result {
  const g = guardExternal(state, input.attemptId, input.at);
  if (!g.ok) return g;
  const a = g.attempt;
  if (a.lookup?.status === 'FOUND') return { ok: false, error: 'An identity was already found for this verification.', code: 'invalid-step' };
  const reference = input.reference.trim();
  if (!reference || reference.length > 100) return { ok: false, error: 'Enter the reference provided for this verification.', code: 'invalid-step' };
  const r = input.result;
  // Only permitted attributes ever arrive here (minimized by the integration service); kept as plain strings.
  const attributes = r.permittedAttributes ? Object.fromEntries(Object.entries(r.permittedAttributes).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])) : undefined;
  const lookup: NonNullable<VerificationAttempt['lookup']> = {
    status: r.status, reference, requestId: input.requestId, at: input.at, count: (a.lookup?.count ?? 0) + 1, simulated: r.simulated,
    ...(r.status === 'FOUND' ? { referenceId: r.referenceId, displayName: r.displayName, attributes } : {}),
  };
  const diagnostics = (r.status === 'ERROR' || r.status === 'UNAVAILABLE') && r.message ? [...(a.diagnostics ?? []), { at: input.at, step: 'lookup' as const, message: r.message.slice(0, 300) }] : a.diagnostics;
  const policy = transactionPolicy(state, a);
  let next: VerificationAttempt = {
    ...a, lookup, diagnostics,
    stage: r.status === 'FOUND' ? (policy.settings.method === 'face' ? 'capture-pending' : 'lookup-completed') : 'initiated',
    subject: r.status === 'FOUND' ? { label: r.displayName ? `${r.displayName} · ${reference.toUpperCase()}` : reference.toUpperCase() } : a.subject,
  };
  if (r.status === 'MULTIPLE_MATCHES') {
    next = {
      ...next, status: 'completed', completedAt: input.at, stage: 'pending-review', decision: 'pending-review', decisionExplanation: MESSAGES.multiple, failureReason: MESSAGES.multiple,
      match: { status: 'not-evaluated', simulated: r.simulated }, liveness: { status: 'not-performed', required: policy.livenessRequired, simulated: false },
      eligibilityStatus: 'not-evaluated', outcome: 'pending-review', verificationResult: 'unable-to-verify', eligibilityResult: 'unable', accessDecision: 'review-required',
      accessReasons: [MESSAGES.multiple], reasons: [MESSAGES.multiple], simulated: r.simulated,
      review: { status: 'pending', referredAt: input.at, referredBy: 'Activity policy', reason: MESSAGES.multiple },
    };
    next = { ...next, checks: externalChecks(next, input.at) };
  }
  return { ok: true, state: replaceAttempt(state, next), attempt: next };
}

/**
 * Records liveness and matching for an external transaction and decides. Mandatory liveness that didn't pass
 * means matching is never counted; a record-only method never claims a biometric match. Same submission twice
 * returns the recorded result.
 */
export function applyExternalComplete(state: AppState, input: {
  attemptId: string; submissionId: string; at: string;
  liveness: { status: LivenessStatus; simulated: boolean };
  match: Omit<NonNullable<VerificationAttempt['match']>, 'at'>;
  /** Protected technical detail from the matching service (never a payload or secret). */
  diagnostic?: string;
}): Result {
  const done = state.data.verificationAttempts.find((x) => x.id === input.attemptId);
  if (done && done.status === 'completed' && done.submissionId === input.submissionId) return { ok: true, state, attempt: done };
  const g = guardExternal(state, input.attemptId, input.at);
  if (!g.ok) return g;
  const a = g.attempt;
  if (a.lookup?.status !== 'FOUND') return { ok: false, error: 'Find the identity before continuing.', code: 'invalid-step' };
  const policy = transactionPolicy(state, a);
  const liveness = { status: policy.livenessApplies ? input.liveness.status : 'not-required' as LivenessStatus, required: policy.livenessRequired, simulated: policy.livenessApplies && input.liveness.simulated, at: input.at };
  let match: NonNullable<VerificationAttempt['match']> = { ...input.match, at: input.at };
  if (policy.settings.method === 'record') match = { status: 'record-confirmed', simulated: a.lookup.simulated, service: a.serviceName, at: input.at };
  else if (policy.livenessRequired && liveness.status !== 'passed') match = { status: 'not-evaluated', simulated: false, service: a.serviceName };
  else if (match.status === 'record-confirmed' || match.status === 'not-required') return { ok: false, error: 'This activity requires a biometric match.', code: 'invalid-step' };
  const withDiag = input.diagnostic ? { ...a, diagnostics: [...(a.diagnostics ?? []), { at: input.at, step: 'matching' as const, message: input.diagnostic.slice(0, 300) }] } : a;
  const next = finalizeExternal(state, withDiag, input.at, { match, liveness, submissionId: input.submissionId });
  return { ok: true, state: replaceAttempt(state, next), attempt: next };
}

/** Ends an external transaction whose lookup didn't find one identity. Recorded, never deleted. */
export function applyEndExternal(state: AppState, input: { attemptId: string; at: string }): Result {
  const g = guardExternal(state, input.attemptId, input.at);
  if (!g.ok) return g;
  const a = g.attempt;
  const s = a.lookup?.status;
  if (s !== 'NOT_FOUND' && s !== 'UNAVAILABLE' && s !== 'ERROR') return { ok: false, error: 'Use Cancel to stop this verification.', code: 'invalid-step' };
  const reason = s === 'NOT_FOUND' ? MESSAGES.notFound : s === 'UNAVAILABLE' ? MESSAGES.lookupUnavailable : MESSAGES.lookupError;
  const policy = transactionPolicy(state, a);
  let next: VerificationAttempt = {
    ...a, status: 'completed', completedAt: input.at, stage: s === 'NOT_FOUND' ? 'failed' : 'unable-to-complete',
    match: { status: 'not-evaluated', simulated: false }, liveness: { status: 'not-performed', required: policy.livenessRequired, simulated: false },
    // No record found means the person isn't verified. An unavailable source is a technical issue: no decision is made.
    ...(s === 'NOT_FOUND'
      ? { eligibilityStatus: 'not-evaluated' as const, decision: 'deny' as const, decisionExplanation: `${reason} The person was not verified.`, failureReason: reason,
        outcome: 'not-verified' as const, verificationResult: 'not-verified' as const, eligibilityResult: 'unable' as const, accessDecision: 'not-permitted' as const, accessReasons: [reason] }
      : { eligibilityStatus: 'not-evaluated' as const, decision: 'unable-to-decide' as const, decisionExplanation: `${reason} Verification could not be completed.`, failureReason: reason,
        outcome: 'unable-to-verify' as const, verificationResult: 'unable-to-verify' as const, eligibilityResult: 'unable' as const, accessDecision: 'review-required' as const, accessReasons: [reason] }),
    reasons: [reason], simulated: !!a.lookup?.simulated,
  };
  next = { ...next, checks: externalChecks(next, input.at) };
  return { ok: true, state: replaceAttempt(state, next), attempt: next };
}

/** Earlier transactions whose identity result this one may reuse under the activity's policy, newest first. */
export function reusableFor(state: AppState, attempt: VerificationAttempt, now: Date): VerificationAttempt[] {
  if (attempt.identitySource !== 'external' || attempt.lookup?.status !== 'FOUND') return [];
  const policy = transactionPolicy(state, attempt);
  return state.data.verificationAttempts
    .filter((p) => reuseProblem(p, { ...attempt, referenceId: attempt.lookup!.referenceId, livenessRequired: policy.livenessRequired }, policy.reuseDays, now) === null)
    .sort((x, y) => (y.completedAt ?? '').localeCompare(x.completedAt ?? ''));
}

/**
 * Completes a transaction by reusing a permitted earlier identity result. Eligibility is evaluated afresh
 * from this transaction's own lookup; the reuse is recorded and linked, never shown as a new match.
 */
export function applyReuseResult(state: AppState, input: { attemptId: string; fromId: string; submissionId: string; at: string }): Result {
  const done = state.data.verificationAttempts.find((x) => x.id === input.attemptId);
  if (done && done.status === 'completed' && done.submissionId === input.submissionId) return { ok: true, state, attempt: done };
  const g = guardExternal(state, input.attemptId, input.at);
  if (!g.ok) return g;
  const a = g.attempt;
  if (a.lookup?.status !== 'FOUND') return { ok: false, error: 'Find the identity before continuing.', code: 'invalid-step' };
  const prior = state.data.verificationAttempts.find((p) => p.id === input.fromId);
  const policy = transactionPolicy(state, a);
  const problem = prior ? reuseProblem(prior, { ...a, referenceId: a.lookup.referenceId, livenessRequired: policy.livenessRequired }, policy.reuseDays, new Date(input.at)) : 'The earlier verification wasn’t found.';
  if (problem || !prior) return { ok: false, error: problem ?? 'The earlier verification can’t be reused.', code: 'invalid-step' };
  const next = finalizeExternal(state, a, input.at, {
    match: { ...prior.match!, requestId: undefined }, liveness: { ...prior.liveness!, required: policy.livenessRequired }, submissionId: input.submissionId, reusedFrom: prior.id,
  });
  return { ok: true, state: replaceAttempt(state, next), attempt: next };
}

/* ---------------- Local transactions ---------------- */

/**
 * Unified transaction fields for a completed local verification, from its check results. Keeps the existing
 * local outcome, access and entry fields; adds identity match, liveness, eligibility and the decision.
 */
export function localTransactionFields(state: AppState, attempt: VerificationAttempt, checks: CheckRun[], ids: { verificationResult?: VerificationAttempt['verificationResult']; eligibilityResult?: VerificationAttempt['eligibilityResult'] }, at: string): Partial<VerificationAttempt> {
  const policy = transactionPolicy(state, attempt);
  const face = checks.find((c) => c.type === 'face-match');
  const live = checks.find((c) => c.type === 'liveness');
  const unavailable = (c: CheckRun) => c.status === 'error' || c.explanation === FACE_UNAVAILABLE_REASON;
  const match: IdentityMatchStatus = face
    ? face.status === 'passed' ? 'match' : face.status === 'failed' ? 'no-match' : face.status === 'skipped' ? 'not-evaluated' : unavailable(face) ? 'unavailable' : 'inconclusive'
    : ids.verificationResult === 'verified' ? 'record-confirmed' : ids.verificationResult === 'not-verified' ? 'no-match' : ids.verificationResult === 'not-required' ? 'not-required' : 'inconclusive';
  const liveness: LivenessStatus = !live ? 'not-required'
    : live.status === 'passed' ? 'passed' : live.status === 'failed' ? 'failed' : live.status === 'skipped' ? 'not-performed' : unavailable(live) ? 'unavailable' : 'inconclusive';
  const livenessRequired = !!live && live.requirement === 'required';
  const eligibility: EligibilityStatus = { eligible: 'eligible', 'not-eligible': 'ineligible', 'not-required': 'not-required', unable: 'unknown', review: 'unknown' }[ids.eligibilityResult ?? 'not-required'] as EligibilityStatus;
  const { decision, explanation } = evaluateDecision({ match, liveness, livenessRequired, eligibility, settings: policy.settings });
  const simulatedFace = !!(face?.simulated || live?.simulated);
  return {
    identitySource: 'local', stage: finalStage(decision, match),
    match: { status: match, simulated: !!face?.simulated, service: face ? 'FixID facial verification' : undefined, at, ...(face?.evidenceRef ? { providerTransactionId: face.evidenceRef.replace(/^biometric:/, '') } : {}) },
    liveness: { status: liveness, required: livenessRequired, simulated: simulatedFace && !!live, at },
    eligibilityStatus: eligibility, decision, decisionExplanation: explanation, ...(decision !== 'allow' ? { failureReason: explanation } : {}),
  };
}
