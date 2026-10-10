import type { AuditEvent, CheckRun, VerificationAttempt, VerificationClientRef } from '@/domain/types';
import { authorizeVerifier, checkById, evaluateOutcome, splitResults } from '@/domain/verification';
import { actorPermissions as actorPermissionsFor, actorRecord } from './adminOps';
import type { AppState } from './state';
import { LOCATION_LABEL, evaluateLocation, formatCoordinate } from '@/domain/location';
import type { DeviceLocation } from '@/services/location';
import { formatDateTime } from '@/lib/dates';

/**
 * Verification attempt records. Every operation re-checks that the signed-in administrator may perform
 * the activity and that the attempt is in a state that allows it. The overall outcome is always derived
 * here from the check results and the attempt's configuration version, never accepted from the caller.
 * Production must run this on the server.
 */

export const ATTEMPT_TTL_MS = 15 * 60_000;

type Result = { ok: true; state: AppState; attempt: VerificationAttempt } | { ok: false; error: string; code: AttemptError };

export type AttemptError =
  | 'not-authorized' | 'not-assigned' | 'inactive' | 'invalid-configuration' | 'not-found' | 'not-in-progress' | 'expired' | 'invalid-results' | 'client-not-approved';

/** Applications approved to call the verification service. The web verifier is FixID's own client. */
export const WEB_CLIENT: VerificationClientRef = { id: 'fixid-verifier-web', name: 'FixID Verifier (web)' };
const APPROVED_CLIENTS = new Set([WEB_CLIENT.id]);

/** Who is acting, and may they run this activity now? Checks the calling application too. */
export function authorizeExecution(state: AppState, organizationId: string, activityId: string, client: VerificationClientRef): { ok: true; adminId: string } | { ok: false; error: string; code: AttemptError } {
  if (!APPROVED_CLIENTS.has(client.id)) return { ok: false, error: 'This application isn’t approved to perform verifications.', code: 'client-not-approved' };
  const rec = actorRecord(state, organizationId);
  if (!rec) return { ok: false, error: 'You aren’t an administrator of this organization.', code: 'not-authorized' };
  const r = authorizeVerifier(state.data, { organizationId, activityId, administratorId: rec.id });
  if (!r.authorized) {
    const code: AttemptError = /not assigned/i.test(r.reason) ? 'not-assigned' : /isn’t active/i.test(r.reason) ? 'inactive' : 'not-authorized';
    return { ok: false, error: r.reason, code };
  }
  return { ok: true, adminId: rec.id };
}

const findAttempt = (state: AppState, id: string) => state.data.verificationAttempts.find((a) => a.id === id);

function replace(state: AppState, attempt: VerificationAttempt, audit?: AuditEvent[]): AppState {
  const exists = state.data.verificationAttempts.some((a) => a.id === attempt.id);
  return {
    ...state,
    data: {
      ...state.data,
      verificationAttempts: exists ? state.data.verificationAttempts.map((a) => (a.id === attempt.id ? attempt : a)) : [attempt, ...state.data.verificationAttempts],
      ...(audit ? { audit: [...audit, ...state.data.audit] } : {}),
    },
  };
}

export function applyStartAttempt(state: AppState, input: { organizationId: string; activityId: string; attemptId: string; at: string; client: VerificationClientRef }): Result {
  const prior = findAttempt(state, input.attemptId);
  if (prior) return { ok: true, state, attempt: prior };
  const auth = authorizeExecution(state, input.organizationId, input.activityId, input.client);
  if (!auth.ok) return auth;
  const activity = state.data.activityConfigs.find((a) => a.id === input.activityId)!;
  const version = state.data.activityVersions.find((v) => v.id === activity.activeVersionId);
  if (!version || version.checks.length === 0) return { ok: false, error: 'This activity’s configuration can’t be used right now. Ask an administrator to review it.', code: 'invalid-configuration' };
  const admin = state.data.administrators.find((a) => a.id === auth.adminId)!;
  const attempt: VerificationAttempt = {
    id: input.attemptId, organizationId: input.organizationId, activityId: activity.id, activityName: activity.name,
    versionId: version.id, versionNumber: version.number, type: version.type,
    verifierId: admin.id, verifierName: admin.name ?? admin.email, client: input.client,
    status: 'in-progress', startedAt: input.at, expiresAt: new Date(new Date(input.at).getTime() + ATTEMPT_TTL_MS).toISOString(),
    checks: version.checks.map((c) => ({ checkId: c.id, type: c.type, requirement: c.requirement, status: 'pending', explanation: 'Not run yet.', providerId: c.providerId })),
    reasons: [], simulated: false,
  };
  return { ok: true, state: replace(state, attempt), attempt };
}

/** Only the verifier who started an in-progress, unexpired attempt can change it, and only while still authorized. */
function guardInProgress(state: AppState, attemptId: string, at: string): { ok: true; attempt: VerificationAttempt } | { ok: false; error: string; code: AttemptError } {
  const attempt = findAttempt(state, attemptId);
  if (!attempt) return { ok: false, error: 'This verification wasn’t found.', code: 'not-found' };
  const rec = actorRecord(state, attempt.organizationId);
  if (!rec || rec.id !== attempt.verifierId) return { ok: false, error: 'Only the verifier who started this verification can continue it.', code: 'not-authorized' };
  if (attempt.status !== 'in-progress') return { ok: false, error: 'This verification has already finished.', code: 'not-in-progress' };
  if (new Date(at) > new Date(attempt.expiresAt)) return { ok: false, error: 'This verification expired. Start a new one.', code: 'expired' };
  return { ok: true, attempt };
}

export interface CompleteInput {
  attemptId: string;
  submissionId: string;
  at: string;
  client: VerificationClientRef;
  checks: CheckRun[];
  subject?: VerificationAttempt['subject'];
  inputs?: VerificationAttempt['inputs'];
  /** What the verifier's device reported, when the activity has a location check. Evaluated here, not trusted as a result. */
  location?: DeviceLocation;
}

export function applyCompleteAttempt(state: AppState, input: CompleteInput): Result {
  const done = findAttempt(state, input.attemptId);
  // The same submission arriving twice returns the recorded result instead of a second one.
  if (done && done.status === 'completed' && done.submissionId === input.submissionId) return { ok: true, state, attempt: done };
  const g = guardInProgress(state, input.attemptId, input.at);
  if (!g.ok) return g;
  const auth = authorizeExecution(state, g.attempt.organizationId, g.attempt.activityId, input.client);
  if (!auth.ok) return auth;
  // Evaluate against the version the attempt started with, even if the activity has changed since.
  const version = state.data.activityVersions.find((v) => v.id === g.attempt.versionId);
  if (!version) return { ok: false, error: 'The configuration this verification started with is no longer available.', code: 'invalid-configuration' };
  const expected = new Set(version.checks.map((c) => c.id));
  if (input.checks.length !== expected.size || input.checks.some((c) => !expected.has(c.checkId) || c.status === 'pending' || c.status === 'in-progress')) {
    return { ok: false, error: 'The check results don’t match this activity’s configuration.', code: 'invalid-results' };
  }
  const checks = input.checks.map((c) => {
    const cfg = version.checks.find((x) => x.id === c.checkId)!;
    return { ...c, type: cfg.type, requirement: cfg.requirement };
  });
  const { outcome, reasons } = evaluateOutcome(version, checks);
  const simulated = checks.some((c) => c.simulated && (c.status === 'passed' || c.status === 'failed'));
  const split = splitResults(version, checks);
  const access = accessDecision(state, g.attempt, outcome, input.subject?.memberId);
  // Reported alongside the result; it never changes the outcome, eligibility or access decision.
  const location = evaluateLocation(state.data.activityConfigs.find((a) => a.id === g.attempt.activityId)?.locationCheck, input.location);
  const attempt: VerificationAttempt = {
    ...g.attempt, status: 'completed', completedAt: input.at, checks, outcome, reasons, simulated, ...split, ...access, location,
    subject: input.subject, inputs: input.inputs, submissionId: input.submissionId,
    review: outcome === 'pending-review' ? { status: 'pending', referredAt: input.at, referredBy: 'Activity policy', reason: reasons[0] ?? 'Required by the activity’s review policy.' } : undefined,
  };
  return { ok: true, state: replace(state, attempt), attempt };
}

export function applyCancelAttempt(state: AppState, input: { attemptId: string; at: string }): Result {
  const g = guardInProgress(state, input.attemptId, input.at);
  if (!g.ok) return g;
  const attempt: VerificationAttempt = {
    ...g.attempt, status: 'cancelled', completedAt: input.at, reasons: ['Cancelled by the verifier before it finished.'],
    checks: g.attempt.checks.map((c) => (c.status === 'pending' || c.status === 'in-progress' ? { ...c, status: 'skipped', skipReason: 'not-run', explanation: 'Not run: the verification was cancelled.' } : c)),
  };
  return { ok: true, state: replace(state, attempt), attempt };
}

/** Marks unfinished attempts past their expiry as interrupted. Results already recorded are untouched. */
export function applyExpireAttempts(state: AppState, input: { organizationId: string; at: string }): AppState {
  const now = new Date(input.at);
  let changed = false;
  const attempts = state.data.verificationAttempts.map((a) => {
    if (a.organizationId !== input.organizationId || a.status !== 'in-progress' || new Date(a.expiresAt) >= now) return a;
    changed = true;
    return {
      ...a, status: 'expired' as const, completedAt: a.expiresAt, reasons: ['Interrupted: the verification wasn’t finished before it expired.'],
      checks: a.checks.map((c) => (c.status === 'pending' || c.status === 'in-progress' ? { ...c, status: 'skipped' as const, skipReason: 'not-run' as const, explanation: 'Not run: the verification was interrupted.' } : c)),
    };
  });
  return changed ? { ...state, data: { ...state.data, verificationAttempts: attempts } } : state;
}

/** An operational failure (e.g. the engine couldn't run) is recorded as such, never as a negative result. */
export function applyFailAttempt(state: AppState, input: { attemptId: string; at: string; reason: string }): Result {
  const g = guardInProgress(state, input.attemptId, input.at);
  if (!g.ok) return g;
  const attempt: VerificationAttempt = { ...g.attempt, status: 'error', completedAt: input.at, reasons: [input.reason] };
  return { ok: true, state: replace(state, attempt), attempt };
}

/**
 * Refers a completed, unsuccessful verification for review when the activity's policy allows review.
 * The original outcome and evidence are not changed.
 */
export function applyReferAttempt(state: AppState, input: { attemptId: string; at: string; reason: string }): Result {
  const attempt = findAttempt(state, input.attemptId);
  if (!attempt) return { ok: false, error: 'This verification wasn’t found.', code: 'not-found' };
  const rec = actorRecord(state, attempt.organizationId);
  if (!rec || rec.id !== attempt.verifierId) return { ok: false, error: 'Only the verifier who performed this verification can refer it.', code: 'not-authorized' };
  if (attempt.status !== 'completed' || attempt.outcome === 'verified') return { ok: false, error: 'Only unsuccessful, completed verifications can be referred for review.', code: 'not-in-progress' };
  if (attempt.review) return { ok: true, state, attempt };
  const version = state.data.activityVersions.find((v) => v.id === attempt.versionId);
  if (!version || (version.outcome.onRequiredFailure !== 'pending-review' && version.outcome.onInconclusive !== 'pending-review')) {
    return { ok: false, error: 'This activity doesn’t allow review referrals.', code: 'invalid-configuration' };
  }
  const reason = input.reason.trim() || 'Referred by the verifier.';
  const next: VerificationAttempt = { ...attempt, review: { status: 'pending', referredAt: input.at, referredBy: attempt.verifierName, reason } };
  return { ok: true, state: replace(state, next), attempt: next };
}

/** A refused execution request is a security event, so it goes to the Audit Log (not to verification records). */
export function applyDeniedAttempt(state: AppState, input: { organizationId: string; activityId: string; reason: string; at: string; client: VerificationClientRef }): AppState {
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const activity = state.data.activityConfigs.find((a) => a.id === input.activityId && a.organizationId === input.organizationId);
  const event: AuditEvent = {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: input.organizationId, action: 'verification.denied',
    actor: state.data.admin.name, actorType: 'admin', resourceType: 'verification-activity', resourceId: input.activityId,
    subject: activity ? { id: activity.id, name: activity.name } : undefined, result: 'failure', occurredAt: input.at,
    summary: `${state.data.admin.name} was refused permission to perform ${activity?.name ?? 'an activity'} (${input.client.name}): ${input.reason}`,
  };
  return { ...state, data: { ...state.data, audit: [event, ...state.data.audit] } };
}

export const checkName = (c: Pick<CheckRun, 'type'>) => checkById(c.type).name;

/** The person's earlier recorded entry for this activity, if any. */
function previousEntry(state: AppState, attempt: Pick<VerificationAttempt, 'id' | 'activityId'>, memberId?: string) {
  if (!memberId) return undefined;
  return state.data.verificationAttempts.find((a) => a.id !== attempt.id && a.activityId === attempt.activityId && a.subject?.memberId === memberId && a.entry?.status === 'entered');
}

/**
 * Whether the activity's conditions for access are met. Derived from the verification outcome and the
 * activity's entry policy; separate from whether the person actually enters.
 */
function accessDecision(state: AppState, attempt: VerificationAttempt, outcome: VerificationAttempt['outcome'], memberId?: string): Pick<VerificationAttempt, 'accessDecision' | 'accessReasons'> {
  if (outcome === 'not-verified') return { accessDecision: 'not-permitted', accessReasons: ['A required condition wasn’t met.'] };
  if (outcome !== 'verified') return { accessDecision: 'review-required', accessReasons: ['The verification couldn’t establish that the conditions are met.'] };
  const policy = state.data.activityConfigs.find((a) => a.id === attempt.activityId)?.entryPolicy ?? 'off';
  const prior = policy !== 'off' ? previousEntry(state, attempt, memberId) : undefined;
  if (prior) {
    const when = formatDateTime(prior.entry!.recordedAt);
    return policy === 'deny'
      ? { accessDecision: 'not-permitted', accessReasons: [`Already entered (recorded ${when}). This activity doesn’t allow multiple entries.`] }
      : { accessDecision: 'review-required', accessReasons: [`Already entered (recorded ${when}). Multiple entries are flagged for review.`] };
  }
  return { accessDecision: 'permitted', accessReasons: [] };
}

/** Why entry can't be recorded for an attempt, or null if it can. */
export function entryProblem(state: AppState, attemptId: string): string | null {
  const a = state.data.verificationAttempts.find((x) => x.id === attemptId);
  if (!a) return 'This verification wasn’t found.';
  const rec = actorRecord(state, a.organizationId);
  if (!rec || rec.status !== 'active') return 'You aren’t an administrator of this organization.';
  if (!actorPermissionsFor(state, a.organizationId).has('verification.execute')) return 'Only verifiers can record entry.';
  if (a.status !== 'completed' || a.accessDecision !== 'permitted') return 'Entry can only be recorded after access was permitted.';
  if (a.entry) return 'An entry decision has already been recorded for this verification.';
  const policy = state.data.activityConfigs.find((x) => x.id === a.activityId)?.entryPolicy ?? 'off';
  if (policy === 'deny' && previousEntry(state, a, a.subject?.memberId)) return 'This person has already entered, and this activity doesn’t allow multiple entries.';
  return null;
}

export function applyRecordEntry(state: AppState, input: { attemptId: string; at: string }): Result {
  const problem = entryProblem(state, input.attemptId);
  if (problem) return { ok: false, error: problem, code: 'not-in-progress' };
  const a = state.data.verificationAttempts.find((x) => x.id === input.attemptId)!;
  const rec = actorRecord(state, a.organizationId)!;
  const by = rec.name ?? rec.email;
  const next: VerificationAttempt = { ...a, entry: { status: 'entered', recordedAt: input.at, recordedBy: by } };
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const event: AuditEvent = {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: a.organizationId, action: 'verification.entry-recorded',
    actor: by, actorType: 'admin', resourceType: 'verification-activity', resourceId: a.activityId,
    subject: { id: a.activityId, name: a.activityName }, result: 'success', occurredAt: input.at,
    summary: `${by} allowed entry for ${a.subject?.label ?? 'a person'} at ${a.activityName} (verification ${a.id}).`,
    changes: entryChanges(a, 'Allowed'),
  };
  return { ok: true, state: replace(state, next, [event]), attempt: next };
}

/** Audit details for an entry decision, including the location check it was made alongside. */
function entryChanges(a: VerificationAttempt, decision: string): AuditEvent['changes'] {
  const loc = a.location;
  return [
    { field: 'Entry decision', from: '—', to: decision },
    { field: 'Verification outcome', from: '—', to: a.outcome ?? '—' },
    ...(loc && loc.result !== 'not-required' ? [
      { field: 'Location check', from: '—', to: LOCATION_LABEL[loc.result] },
      ...(loc.reported ? [{ field: 'Reported device location', from: '—', to: `${formatCoordinate(loc.reported.lat)}, ${formatCoordinate(loc.reported.lng)} (±${loc.reported.accuracyM} m)` }] : []),
      ...(loc.reason ? [{ field: 'Location unavailable because', from: '—', to: loc.reason }] : []),
    ] : []),
  ];
}

/** Why the officer can't record a Deny Entry decision, or null. Denying is always possible after a completed verification. */
export function denyProblem(state: AppState, attemptId: string): string | null {
  const a = state.data.verificationAttempts.find((x) => x.id === attemptId);
  if (!a) return 'This verification wasn’t found.';
  const rec = actorRecord(state, a.organizationId);
  if (!rec || rec.status !== 'active') return 'You aren’t an administrator of this organization.';
  if (!actorPermissionsFor(state, a.organizationId).has('verification.execute')) return 'Only verifiers can record entry decisions.';
  if (a.status !== 'completed') return 'An entry decision can only be recorded for a completed verification.';
  if (a.entry) return 'An entry decision has already been recorded for this verification.';
  return null;
}

export function applyDenyEntry(state: AppState, input: { attemptId: string; at: string; reason?: string }): Result {
  const problem = denyProblem(state, input.attemptId);
  if (problem) return { ok: false, error: problem, code: 'not-in-progress' };
  const a = state.data.verificationAttempts.find((x) => x.id === input.attemptId)!;
  const rec = actorRecord(state, a.organizationId)!;
  const by = rec.name ?? rec.email;
  const reason = input.reason?.trim() || undefined;
  const next: VerificationAttempt = { ...a, entry: { status: 'denied', recordedAt: input.at, recordedBy: by, ...(reason ? { reason } : {}) } };
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const event: AuditEvent = {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: a.organizationId, action: 'verification.entry-denied',
    actor: by, actorType: 'admin', resourceType: 'verification-activity', resourceId: a.activityId,
    subject: { id: a.activityId, name: a.activityName }, result: 'success', occurredAt: input.at,
    summary: `${by} denied entry for ${a.subject?.label ?? 'a person'} at ${a.activityName} (verification ${a.id})${reason ? `: ${reason}` : ''}.`,
    changes: entryChanges(a, 'Denied'),
  };
  return { ok: true, state: replace(state, next, [event]), attempt: next };
}
