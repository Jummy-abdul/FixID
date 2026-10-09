import { isGroupMember } from '@/domain/groups';
import type {
  ActivityCheck, ActivityConfig, ActivityVersion, CheckRun, CheckTypeId, Credential, Member, Organization, VerificationAttempt, VerificationClientRef,
} from '@/domain/types';
import { checkById, providersFor } from '@/domain/verification';
import { actorPermissions, actorRecord } from '@/store/adminOps';
import { WEB_CLIENT, authorizeExecution, type AttemptError, type CompleteInput } from '@/store/attemptOps';
import type { Action, AppState } from '@/store/state';
import type { IdSwitchService } from '@/services/types';
import {
  simulatedFaceMatch, simulatedHolderBinding, simulatedLiveness, type FaceScenario, type HolderBindingScenario, type LivenessScenario,
} from './simulatedProviders';

/**
 * Verification Execution Service. Independent of any screen: the FixID web verifier is one client, and
 * an approved external application could call the same functions. Every request is authorized for the
 * individual verifier and the calling application. Checks run in dependency order through provider
 * adapters; the outcome is decided by the activity's rules from the recorded results.
 *
 * In this prototype the service runs in the browser, so these checks are not a security boundary.
 * Production must run it on the server with the same contracts.
 */

/** What the verifier submits. Raw values are used to run checks and are not stored with the attempt. */
export interface VerificationInputs {
  identifier?: string;
  credential?: { method: 'reference' | 'simulated-presentation'; value: string };
  attributes?: Record<string, string>;
  /** Scenarios for labelled demonstration providers only. */
  demo?: { liveness?: LivenessScenario; face?: FaceScenario; holderBinding?: HolderBindingScenario };
}

export interface RequiredSteps {
  identifier: { label: string } | null;
  credential: { methods: ('reference' | 'simulated-presentation')[] } | null;
  attributes: string[];
  biometric: { checks: ('liveness' | 'face-match')[]; available: boolean; simulated: boolean } | null;
  holderBinding: { available: boolean; simulated: boolean } | null;
  /** Plain-language list of what will be checked. No provider configuration is exposed. */
  summary: { name: string; requirement: ActivityCheck['requirement'] }[];
}

type ServiceError = { ok: false; error: string; code: AttemptError | 'missing-input' | 'operational' };

const CHECK_TIMEOUT_MS = 8000;
const ORDER: CheckTypeId[] = [
  'identity-lookup', 'credential-authenticity', 'issuer-trust', 'credential-validity', 'credential-status', 'holder-binding',
  'liveness', 'face-match', 'attribute-match', 'group-membership', 'attribute-condition', 'previous-verification', 'external-eligibility',
];

const ATTRIBUTE_FIELDS: Record<string, (i: { givenName: string; familyName: string; dateOfBirth: string; phone: string; email: string }) => string> = {
  'Full name': (i) => `${i.givenName} ${i.familyName}`,
  'Date of birth': (i) => i.dateOfBirth.slice(0, 10),
  'Phone number': (i) => i.phone,
  'Email address': (i) => i.email,
};
const norm = (v: string) => v.trim().toLowerCase().replace(/[\s+()-]/g, '');

/** Privacy-safe label: first name, last initial and the last characters of the identifier. */
export function subjectLabel(m: Member): string {
  const [first, ...rest] = m.displayName.split(' ');
  const last = rest.length ? ` ${rest[rest.length - 1][0]}.` : '';
  const id = m.identifier?.value ? ` · ••••${m.identifier.value.slice(-4)}` : '';
  return `${first}${last}${id}`;
}

export function requiredSteps(state: AppState, version: ActivityVersion): RequiredSteps {
  const org = state.data.organizations.find((o) => o.id === version.organizationId)!;
  const providers = providersFor(org);
  const has = (t: CheckTypeId) => version.checks.find((c) => c.type === t);
  const lookup = has('identity-lookup');
  const idName = lookup?.params.identifierConfigId ? state.data.identifierConfigs.find((i) => i.id === lookup.params.identifierConfigId)?.name : undefined;
  const facial = providers.find((p) => p.id === 'facial-matching')!;
  const proof = providers.find((p) => p.id === 'presentation-proof')!;
  const bio = (['liveness', 'face-match'] as const).filter((t) => has(t));
  return {
    identifier: lookup ? { label: idName ?? 'Identifier' } : null,
    credential: version.checks.some((c) => checkById(c.type).category === 'credential')
      ? { methods: org.integrations.verificationDemo?.enabled ? ['simulated-presentation', 'reference'] : ['reference'] } : null,
    attributes: has('attribute-match')?.params.attributes ?? [],
    biometric: bio.length ? { checks: bio, available: facial.status === 'available', simulated: !!facial.simulated } : null,
    holderBinding: has('holder-binding') ? { available: proof.status === 'available', simulated: !!proof.simulated } : null,
    summary: [...version.checks].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)).map((c) => ({ name: checkById(c.type).name, requirement: c.requirement })),
  };
}

function withTimeout<T>(p: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new TimeoutError()), ms))]);
}
class TimeoutError extends Error {}

interface RunContext {
  state: AppState;
  org: Organization;
  version: ActivityVersion;
  attempt: VerificationAttempt;
  inputs: VerificationInputs;
  now: Date;
  idSwitch: IdSwitchService;
  timeoutMs: number;
}

type Outcome = Pick<CheckRun, 'status' | 'explanation' | 'simulated' | 'evidenceRef' | 'skipReason'>;

/** Runs the configured checks in dependency order. Never marks a check passed unless its criteria were met. */
export async function runChecks(ctx: RunContext, onProgress?: (runs: CheckRun[]) => void) {
  const { state, org, version, inputs } = ctx;
  const providers = providersFor(org);
  const ordered = [...version.checks].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const runs: CheckRun[] = version.checks.map((c) => ({ checkId: c.id, type: c.type, requirement: c.requirement, status: 'pending', explanation: 'Waiting.', providerId: c.providerId }));
  const set = (id: string, patch: Partial<CheckRun>) => { const i = runs.findIndex((r) => r.checkId === id); runs[i] = { ...runs[i], ...patch }; onProgress?.(runs.map((r) => ({ ...r }))); };
  const statusOf = (t: CheckTypeId) => runs.find((r) => r.type === t)?.status;

  // What earlier checks established.
  let resolved: { member: Member; via: 'identity-lookup' | 'credential' } | undefined;
  let credential: Credential | undefined;
  let credentialVerified = false;

  const members = state.data.members.filter((m) => m.organizationId === org.id);

  for (const c of ordered) {
    const def = checkById(c.type);
    set(c.id, { status: 'in-progress', explanation: 'Running…' });
    const provider = providers.find((p) => p.id === c.providerId);
    const source = c.sourceId ? providers.find((p) => p.id === c.sourceId) : undefined;
    let out: Outcome;
    try {
      // 1. Provider and source must be available now (they may have changed since activation).
      if (!provider || provider.status !== 'available') {
        out = { status: 'inconclusive', explanation: `${provider?.name ?? 'The verification provider'} is unavailable, so this check couldn’t be performed.` };
      } else if (source && source.status !== 'available') {
        out = { status: 'inconclusive', explanation: `${source.name} is unavailable, so the authoritative record couldn’t be reached.` };
      } else {
        // 2. Prerequisites. If one isn't met, say whether it failed or just couldn't be completed.
        const NEED_FROM: Record<string, CheckTypeId[]> = {
          'resolved-identity': ['identity-lookup', 'credential-authenticity'], 'authorized-reference': ['identity-lookup'],
          'verified-credential': ['credential-authenticity'], liveness: ['liveness'],
        };
        const why = (need: string): CheckRun['skipReason'] => {
          const from = NEED_FROM[need].map(statusOf).filter(Boolean);
          return from.length && from.every((st) => st === 'failed' || st === 'skipped') && from.includes('failed') ? 'dependency-failed' : 'dependency-incomplete';
        };
        const needIdentity = def.needs?.includes('resolved-identity') && !resolved;
        const needCredential = def.needs?.includes('verified-credential') && !credentialVerified;
        const needReference = def.needs?.includes('authorized-reference') && resolved?.via !== 'identity-lookup';
        const needLiveness = def.needs?.includes('liveness') && statusOf('liveness') !== 'passed';
        if (needCredential) out = { status: 'skipped', explanation: 'Not run: the credential wasn’t verified as genuine.', skipReason: why('verified-credential') };
        else if (needReference) out = { status: 'skipped', explanation: 'Not run: the person wasn’t identified through an authorized record, so no reference is available.', skipReason: why('authorized-reference') };
        else if (needIdentity) out = { status: 'skipped', explanation: 'Not run: the person couldn’t be securely identified.', skipReason: why('resolved-identity') };
        else if (needLiveness) out = { status: 'skipped', explanation: 'Not run: liveness wasn’t confirmed, so a comparison wouldn’t be reliable.', skipReason: why('liveness') };
        else out = await withTimeout(execute(c), ctx.timeoutMs);
      }
    } catch (e) {
      out = e instanceof TimeoutError
        ? { status: 'error', explanation: `${provider?.name ?? 'The service'} didn’t respond in time.` }
        : { status: 'error', explanation: `${provider?.name ?? 'The service'} returned an error, so the check couldn’t be completed.` };
    }
    set(c.id, { ...out, completedAt: new Date().toISOString(), simulated: out.simulated ?? false });
  }

  async function execute(c: ActivityCheck): Promise<Outcome> {
    switch (c.type) {
      case 'identity-lookup': {
        const value = inputs.identifier?.trim();
        if (!value) return { status: 'inconclusive', explanation: 'No identifier was provided.' };
        const match = members.find((m) => m.identifier && m.identifier.value.toLowerCase() === value.toLowerCase() && (!c.params.identifierConfigId || m.identifier.configId === c.params.identifierConfigId));
        if (!match) return { status: 'failed', explanation: 'No identity record matches this identifier.' };
        // Confirm the record with the identity service (the trusted source).
        const identity = await ctx.idSwitch.getIdentity(match.idSwitchId);
        if (!identity) return { status: 'failed', explanation: 'The identity service has no record for this person.' };
        resolved = { member: match, via: 'identity-lookup' };
        return { status: 'passed', explanation: 'Identity record found in the trusted source.', evidenceRef: `record:${match.id}` };
      }
      case 'attribute-match': {
        const supplied = c.params.attributes ?? [];
        const given = supplied.filter((a) => inputs.attributes?.[a]?.trim());
        if (given.length < supplied.length) return { status: 'inconclusive', explanation: `Not all details were provided (${supplied.filter((a) => !given.includes(a)).join(', ')}).` };
        const identity = await ctx.idSwitch.getIdentity(resolved!.member.idSwitchId);
        if (!identity) return { status: 'inconclusive', explanation: 'The reference record couldn’t be retrieved.' };
        const mismatched = supplied.filter((a) => norm(ATTRIBUTE_FIELDS[a](identity)) !== norm(inputs.attributes![a]));
        return mismatched.length
          ? { status: 'failed', explanation: `Didn’t match the reference record: ${mismatched.join(', ')}.` }
          : { status: 'passed', explanation: `Matched the reference record: ${supplied.join(', ')}.` };
      }
      case 'credential-authenticity': {
        const p = inputs.credential;
        if (!p?.value.trim()) return { status: 'inconclusive', explanation: 'No credential was presented.' };
        if (p.method === 'reference') {
          return { status: 'inconclusive', explanation: 'A credential reference can locate a record but isn’t proof the credential is genuine. A secure presentation is needed.' };
        }
        if (!org.integrations.verificationDemo?.enabled) return { status: 'inconclusive', explanation: 'Secure credential presentation isn’t available.' };
        const found = state.data.credentials.find((x) => x.organizationId === org.id && x.identifier.toLowerCase() === p.value.trim().toLowerCase());
        if (!found) return { status: 'failed', explanation: 'The presented credential wasn’t recognised as one issued by this organization (simulated presentation).', simulated: true };
        credential = found;
        if (c.params.credentialTypeIds?.length && !c.params.credentialTypeIds.includes(found.credentialTypeId)) {
          return { status: 'failed', explanation: 'This kind of credential isn’t accepted for this activity.', simulated: true, evidenceRef: `credential:${found.id}` };
        }
        credentialVerified = true;
        // A FixID-issued credential from this organization identifies its holder's FixID record.
        const holder = members.find((m) => m.id === found.memberId);
        if (holder && !resolved) resolved = { member: holder, via: 'credential' };
        return { status: 'passed', explanation: 'Credential signature checked by the simulated presentation service. This confirms the credential, not who is presenting it.', simulated: true, evidenceRef: `credential:${found.id}` };
      }
      case 'issuer-trust':
        return credential!.organizationId === org.id
          ? { status: 'passed', explanation: `Issued by ${org.name}, a trusted issuer for this activity.` }
          : { status: 'failed', explanation: 'The issuer isn’t trusted for this activity.' };
      case 'credential-validity': {
        const now = ctx.now;
        if (new Date(credential!.effectiveFrom) > now) return { status: 'failed', explanation: 'The credential isn’t valid yet.' };
        if (credential!.expiresAt && new Date(credential!.expiresAt) < now) return { status: 'failed', explanation: 'The credential has expired.' };
        return { status: 'passed', explanation: 'Within its validity period.' };
      }
      case 'credential-status': {
        const s = credential!.status;
        if (s === 'active') return { status: 'passed', explanation: 'Active: not revoked or suspended.' };
        return { status: 'failed', explanation: { suspended: 'The credential is suspended.', revoked: 'The credential has been revoked.', pending: 'The credential is still awaiting approval.', expired: 'The credential has expired.' }[s] };
      }
      case 'holder-binding': {
        const r = await simulatedHolderBinding(inputs.demo?.holderBinding);
        return { ...r, simulated: true };
      }
      case 'liveness': {
        const r = await simulatedLiveness(inputs.demo?.liveness);
        return { ...r, simulated: true };
      }
      case 'face-match': {
        if (resolved!.member.faceEnrollment.status !== 'enrolled') {
          return { status: 'inconclusive', explanation: 'No authorized reference image is available for this person.' };
        }
        const r = await simulatedFaceMatch(inputs.demo?.face);
        return { ...r, simulated: true, evidenceRef: r.status === 'passed' || r.status === 'failed' ? `biometric-comparison:${ctx.attempt.id}` : undefined };
      }
      case 'group-membership': {
        const ids = (c.params.groupIds ?? []).filter((g) => state.data.groups.some((x) => x.id === g && x.organizationId === org.id));
        if (!ids.length) return { status: 'inconclusive', explanation: 'None of the permitted groups exist any more.' };
        const hit = ids.find((g) => isGroupMember(state.data, org.id, g, resolved!.member.id));
        const name = (g: string) => state.data.groups.find((x) => x.id === g)?.name;
        return hit ? { status: 'passed', explanation: `Currently a member of ${name(hit)}.` } : { status: 'failed', explanation: `Not currently a member of ${ids.map(name).join(' or ')}.` };
      }
      case 'attribute-condition': {
        const m = resolved!.member;
        const actual = c.params.attribute === 'User status' ? m.status : c.params.attribute === 'Role' ? m.relationship : c.params.attribute === 'Unit' ? m.unit : undefined;
        if (actual === undefined) return { status: 'inconclusive', explanation: 'This attribute isn’t available.' };
        const equal = norm(actual) === norm(c.params.value ?? '');
        const ok = c.params.operator === 'is-not' ? !equal : equal;
        return ok ? { status: 'passed', explanation: `${c.params.attribute} meets the condition.` } : { status: 'failed', explanation: `${c.params.attribute} doesn’t meet the condition.` };
      }
      case 'previous-verification': {
        const days = c.params.windowDays ?? (c.params.mode === 'require-previous' ? 30 : 1);
        const since = ctx.now.getTime() - days * 86_400_000;
        const earlier = state.data.verificationAttempts.find((a) => a.id !== ctx.attempt.id && a.activityId === ctx.attempt.activityId && a.status === 'completed'
          && a.outcome === 'verified' && a.subject?.memberId === resolved!.member.id && new Date(a.completedAt!).getTime() >= since);
        if (c.params.mode === 'require-previous') {
          return earlier ? { status: 'passed', explanation: 'An earlier successful verification was found.' } : { status: 'failed', explanation: `No successful verification in the last ${days} day(s).` };
        }
        return earlier ? { status: 'failed', explanation: `Already verified for this activity in the last ${days} day(s).` } : { status: 'passed', explanation: 'No earlier verification in the restricted period.' };
      }
      case 'external-eligibility':
        return { status: 'inconclusive', explanation: 'No external eligibility service is connected.' };
      default:
        return { status: 'inconclusive', explanation: 'This check isn’t supported.' };
    }
  }

  return {
    runs,
    subject: resolved ? { memberId: resolved.member.id, credentialId: credential?.id, label: subjectLabel(resolved.member) } : credential ? { credentialId: credential.id, label: `Credential ••••${credential.identifier.slice(-4)}` } : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Service contract                                                     */
/* ------------------------------------------------------------------ */

export interface ServiceDeps {
  getState: () => AppState;
  dispatch: (a: Action) => void;
  idSwitch: IdSwitchService;
  client?: VerificationClientRef;
  now?: () => Date;
  timeoutMs?: number;
}

export function createVerificationService(deps: ServiceDeps) {
  const client = deps.client ?? WEB_CLIENT;
  const now = deps.now ?? (() => new Date());
  const newAttemptId = () => {
    const d = now();
    return `VER-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  };

  const service = {
    client,
    /** Active activities the signed-in verifier is assigned to and may perform. */
    listAuthorizedActivities(organizationId: string): { activity: ActivityConfig; version: ActivityVersion }[] {
      const s = deps.getState();
      return s.data.activityConfigs
        .filter((a) => a.organizationId === organizationId && a.status === 'active')
        .filter((a) => authorizeExecution(s, organizationId, a.id, client).ok)
        .map((a) => ({ activity: a, version: s.data.activityVersions.find((v) => v.id === a.activeVersionId)! }))
        .filter((x) => x.version);
    },

    /** Starts an attempt on the active version. Refusals are recorded in the Audit Log. */
    startAttempt(organizationId: string, activityId: string): { ok: true; attempt: VerificationAttempt } | ServiceError {
      const at = now().toISOString();
      deps.dispatch({ type: 'verify/expire', organizationId, at });
      const s = deps.getState();
      const auth = authorizeExecution(s, organizationId, activityId, client);
      if (!auth.ok) {
        if (s.data.activityConfigs.some((a) => a.id === activityId && a.organizationId === organizationId)) {
          deps.dispatch({ type: 'verify/denied', organizationId, activityId, reason: auth.error, at, client });
        }
        return auth;
      }
      const attemptId = newAttemptId();
      deps.dispatch({ type: 'verify/start', organizationId, activityId, attemptId, at, client });
      const attempt = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId);
      return attempt ? { ok: true, attempt } : { ok: false, error: 'The verification couldn’t be started.', code: 'operational' };
    },

    /** Steps and inputs the attempt needs, derived from its own configuration version. */
    requiredSteps(attemptId: string): RequiredSteps | null {
      const s = deps.getState();
      const a = service.getAttempt(attemptId);
      const v = a && s.data.activityVersions.find((x) => x.id === a.versionId);
      return v ? requiredSteps(s, v) : null;
    },

    /** The attempt, if the caller performed it or may view verification results in its organization. */
    getAttempt(attemptId: string): VerificationAttempt | undefined {
      const s = deps.getState();
      const a = s.data.verificationAttempts.find((x) => x.id === attemptId);
      if (!a) return undefined;
      const rec = actorRecord(s, a.organizationId);
      return rec && (rec.id === a.verifierId || actorPermissions(s, a.organizationId).has('verification.results.view')) ? a : undefined;
    },

    /** Validates inputs, runs the checks, and records the result. Safe to call twice with the same submission ID. */
    async submitInputs(attemptId: string, inputs: VerificationInputs, opts: { submissionId: string; onProgress?: (runs: CheckRun[]) => void }): Promise<{ ok: true; attempt: VerificationAttempt } | ServiceError> {
      const s = deps.getState();
      const attempt = s.data.verificationAttempts.find((a) => a.id === attemptId);
      if (!attempt) return { ok: false, error: 'This verification wasn’t found.', code: 'not-found' };
      if (attempt.status === 'completed' && attempt.submissionId === opts.submissionId) return { ok: true, attempt };
      const version = s.data.activityVersions.find((v) => v.id === attempt.versionId)!;
      const steps = requiredSteps(s, version);
      if (steps.identifier && !inputs.identifier?.trim()) return { ok: false, error: `Enter the person’s ${steps.identifier.label.toLowerCase()}.`, code: 'missing-input' };
      if (steps.credential && !inputs.credential?.value.trim()) return { ok: false, error: 'Enter or present the credential.', code: 'missing-input' };
      const auth = authorizeExecution(s, attempt.organizationId, attempt.activityId, client);
      if (!auth.ok) return auth;
      if (attempt.status !== 'in-progress') return { ok: false, error: 'This verification has already finished.', code: 'not-in-progress' };
      if (now() > new Date(attempt.expiresAt)) {
        deps.dispatch({ type: 'verify/expire', organizationId: attempt.organizationId, at: now().toISOString() });
        return { ok: false, error: 'This verification expired. Start a new one.', code: 'expired' };
      }

      let result: Awaited<ReturnType<typeof runChecks>>;
      try {
        const org = s.data.organizations.find((o) => o.id === attempt.organizationId)!;
        result = await runChecks({ state: s, org, version, attempt, inputs, now: now(), idSwitch: deps.idSwitch, timeoutMs: deps.timeoutMs ?? CHECK_TIMEOUT_MS }, opts.onProgress);
      } catch {
        deps.dispatch({ type: 'verify/fail', attemptId, at: now().toISOString(), reason: 'The verification couldn’t be completed because of a system error.' });
        return { ok: false, error: 'Something went wrong while running the checks. Nothing was decided; start a new verification.', code: 'operational' };
      }
      const complete: CompleteInput = {
        attemptId, submissionId: opts.submissionId, at: now().toISOString(), client, checks: result.runs, subject: result.subject,
        inputs: {
          identifier: !!inputs.identifier, credential: inputs.credential?.method,
          attributes: inputs.attributes ? Object.keys(inputs.attributes).filter((k) => inputs.attributes![k]) : undefined,
          biometric: !!(inputs.demo?.face || inputs.demo?.liveness),
        },
      };
      deps.dispatch({ type: 'verify/complete', input: complete });
      const saved = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId)!;
      if (saved.status !== 'completed') return { ok: false, error: 'The result couldn’t be recorded. The verification may have expired or your access changed.', code: 'operational' };
      return { ok: true, attempt: saved };
    },

    cancelAttempt(attemptId: string): { ok: boolean } {
      deps.dispatch({ type: 'verify/cancel', attemptId, at: now().toISOString() });
      return { ok: deps.getState().data.verificationAttempts.find((a) => a.id === attemptId)?.status === 'cancelled' };
    },

    /** Refers an unsuccessful result for review. The original outcome is kept. */
    referForReview(attemptId: string, reason: string): { ok: boolean } {
      deps.dispatch({ type: 'verify/refer', attemptId, at: now().toISOString(), reason });
      return { ok: !!deps.getState().data.verificationAttempts.find((a) => a.id === attemptId)?.review };
    },
  };
  return service;
}

export type VerificationService = ReturnType<typeof createVerificationService>;
