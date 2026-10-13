import { isGroupMember } from '@/domain/groups';
import type {
  ActivityCheck, ActivityConfig, ActivityVersion, CheckRun, CheckTypeId, Credential, Member, Organization, VerificationAttempt, VerificationClientRef,
} from '@/domain/types';
import { checkById, eligibleParticipants, providersFor } from '@/domain/verification';
import { actorPermissions, actorRecord } from '@/store/adminOps';
import { executionUnavailable } from '@/store/sharingOps';
import { WEB_CLIENT, authorizeExecution, denyProblem, entryProblem, type AttemptError, type CompleteInput } from '@/store/attemptOps';
import type { DeviceLocation } from '@/services/location';
import { effectivePermissions, type Action, type AppState } from '@/store/state';
import type { IdSwitchService } from '@/services/types';
import { FACE_UNAVAILABLE_REASON, NO_FACE_VERIFICATION, type FaceVerificationResponse, type FaceVerificationService } from '@/services/faceVerification';
import type { CustomIntegration } from '@/domain/integrations';
import { MESSAGES, type LivenessStatus } from '@/domain/transactions';
import type { IdentityLookupResult } from '@/services/integrations/contract';
import { lookupIdentity, matchBiometric } from '@/services/integrations/integrationService';
import { reusableFor, transactionPolicy } from '@/store/transactionOps';
import { reverificationProblem } from '@/store/exceptionOps';
import { simulatedHolderBinding, type HolderBindingScenario } from './simulatedProviders';
import { simulatedFaceVerification, type SimulatedFaceOutcome, type SimulatedLivenessOutcome } from '@/services/simulatedFaceVerification';

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
  /** Scenario for the labelled demonstration holder-binding provider only. */
  demo?: { holderBinding?: HolderBindingScenario; face?: { match?: SimulatedFaceOutcome; liveness?: SimulatedLivenessOutcome } };
  /** One live capture from the verifier's camera (JPEG data URL). Sent to the facial verification provider; never stored. */
  face?: { image: string; capturedAt: string };
  /** The verifier device's location, captured only when the activity has a location check. */
  location?: DeviceLocation;
}

export interface RequiredSteps {
  identifier: { label: string } | null;
  credential: { methods: ('reference' | 'simulated-presentation')[] } | null;
  attributes: string[];
  /** Facial verification: whether a provider is connected and whether it checks liveness. */
  biometric: { checks: ('liveness' | 'face-match')[]; available: boolean; liveness: boolean; providerName: string; simulated: boolean } | null;
  holderBinding: { available: boolean; simulated: boolean } | null;
  /** Plain-language list of what will be checked. No provider configuration is exposed. */
  summary: { name: string; requirement: ActivityCheck['requirement'] }[];
}

type ServiceError = { ok: false; error: string; code: AttemptError | 'missing-input' | 'operational' };

export type ParticipantEligibility = 'eligible' | 'not-eligible' | 'not-required';

/** What Find Participant shows the officer. Minimal: only what's needed to confirm and proceed. */
export type ParticipantLookup =
  | {
    ok: true;
    participant: { memberId: string; name: string; identifierLabel: string; identifier: string; relationship: string; unit: string; status: Member['status'] };
    eligibility: ParticipantEligibility;
    /** Whether an enrolled reference exists for 1:1 facial verification. */
    portrait: 'enrolled' | 'missing';
    /** Enrollment state of the local biometric reference. Never changed by verification. */
    enrollment: 'enrolled' | 'not-enrolled' | 'incomplete' | 'unavailable';
    /** Whether this activity verifies identity by face. */
    faceRequired: boolean;
    history: { verifiedAt?: string; entered?: { at: string; by: string; attemptId: string }; denied?: { at: string; by: string; reason?: string } };
  }
  | { ok: false; error: string; code: AttemptError | 'missing-input' | 'identifier-not-found' | 'lookup-unavailable' };

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

/**
 * The identifier label when an activity doesn't name one: the identifier its eligible participants all
 * share (or the organization's only identifier), else a generic label. Never assumed.
 */
function commonIdentifierName(state: AppState, version: ActivityVersion): string | undefined {
  const activity = state.data.activityConfigs.find((a) => a.id === version.activityId);
  const ids = eligibleParticipants(state.data, version.organizationId, activity?.participants);
  const configs = new Set(state.data.members.filter((m) => ids.has(m.id) && m.identifier).map((m) => m.identifier!.configId));
  const orgConfigs = state.data.identifierConfigs.filter((i) => i.organizationId === version.organizationId);
  const id = configs.size === 1 ? [...configs][0] : configs.size === 0 && orgConfigs.length === 1 ? orgConfigs[0].id : undefined;
  return id ? orgConfigs.find((i) => i.id === id)?.name : undefined;
}

/**
 * The facial verification provider for an organization: the configured one, or (demonstration
 * organizations only, when none is configured) the labelled simulated provider. Never silently simulated.
 */
export function faceFor(org: Organization, face: FaceVerificationService, choice?: NonNullable<VerificationInputs['demo']>['face']): { service: FaceVerificationService; simulated: boolean } {
  if (face.available || !org.integrations.simulatedBiometrics?.enabled) return { service: face, simulated: false };
  return { service: simulatedFaceVerification(choice), simulated: true };
}

export function requiredSteps(state: AppState, version: ActivityVersion, configured: FaceVerificationService = NO_FACE_VERIFICATION): RequiredSteps {
  const org = state.data.organizations.find((o) => o.id === version.organizationId)!;
  const { service: face, simulated: faceSimulated } = faceFor(org, configured);
  const providers = providersFor(org);
  const has = (t: CheckTypeId) => version.checks.find((c) => c.type === t);
  const lookup = has('identity-lookup');
  const idName = lookup?.params.identifierConfigId ? state.data.identifierConfigs.find((i) => i.id === lookup.params.identifierConfigId)?.name : commonIdentifierName(state, version);
  const proof = providers.find((p) => p.id === 'presentation-proof')!;
  const bio = (['liveness', 'face-match'] as const).filter((t) => has(t));
  return {
    identifier: lookup ? { label: idName ?? 'Identifier' } : null,
    credential: version.checks.some((c) => checkById(c.type).category === 'credential')
      ? { methods: org.integrations.verificationDemo?.enabled ? ['simulated-presentation', 'reference'] : ['reference'] } : null,
    attributes: has('attribute-match')?.params.attributes ?? [],
    biometric: bio.length ? { checks: bio, available: face.available, liveness: face.supportsLiveness, providerName: face.providerName, simulated: faceSimulated } : null,
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
  face: FaceVerificationService;
  /** The face provider is the labelled simulated one: results are marked simulated and no image is sent. */
  faceSimulated?: boolean;
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
  // One provider request covers liveness and the 1:1 comparison.
  let faceCall: Promise<FaceVerificationResponse> | undefined;
  const callFace = () => faceCall ??= ctx.face.verify({
    requestId: ctx.attempt.id, organizationId: org.id, subjectRef: resolved!.member.idSwitchId, probe: ctx.faceSimulated ? '' : inputs.face!.image,
    checkLiveness: version.checks.some((c) => c.type === 'liveness') && ctx.face.supportsLiveness,
  });
  const faceProblem = (): Outcome | null => {
    if (!resolved) return { status: 'inconclusive', explanation: 'Not run: the person wasn’t identified, so there’s no enrolled reference to compare with.' };
    if (resolved.member.faceEnrollment.status !== 'enrolled') return { status: 'inconclusive', explanation: 'No enrolled portrait is available for this person, so biometric verification isn’t possible.' };
    if (!inputs.face?.image) return { status: 'inconclusive', explanation: 'No live capture was taken.' };
    return null;
  };
  const providerFailure = (r: Exclude<FaceVerificationResponse, { status: 'completed' }>): Outcome => ({ status: 'error', explanation: r.reason });

  for (const c of ordered) {
    const def = checkById(c.type);
    set(c.id, { status: 'in-progress', explanation: 'Running…' });
    // Facial checks use the connected facial verification service, not configuration flags.
    const provider = c.providerId === 'facial-matching'
      ? { name: ctx.face.providerName, status: ctx.face.available ? 'available' as const : 'not-configured' as const }
      : providers.find((p) => p.id === c.providerId);
    const source = c.sourceId ? providers.find((p) => p.id === c.sourceId) : undefined;
    let out: Outcome;
    try {
      // 1. Provider and source must be available now (they may have changed since activation).
      if (c.providerId === 'facial-matching' && !ctx.face.available) {
        out = { status: 'inconclusive', explanation: FACE_UNAVAILABLE_REASON };
      } else if (!provider || provider.status !== 'available') {
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
    const simulatedFace = ctx.faceSimulated && (c.type === 'liveness' || c.type === 'face-match') && out.status !== 'skipped';
    // A simulated provider compared nothing and detected nothing: say so instead of the provider wording.
    if (simulatedFace) {
      const what = c.type === 'liveness' ? 'liveness result' : 'matching result';
      const value = c.type === 'liveness'
        ? { passed: 'passed', failed: 'failed', inconclusive: 'inconclusive', error: 'unavailable' }[out.status as 'passed']
        : { passed: 'match', failed: 'no match', inconclusive: 'inconclusive', error: 'unavailable' }[out.status as 'passed'];
      out = { ...out, explanation: `Simulated ${what}: ${value ?? out.status}. ${c.type === 'liveness' ? 'No real liveness or presentation-attack detection took place.' : 'No faces were compared.'}` };
    }
    set(c.id, { ...out, completedAt: new Date().toISOString(), simulated: out.simulated ?? simulatedFace ?? false });
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
        const problem = faceProblem();
        if (problem) return problem;
        if (!ctx.face.supportsLiveness) return { status: 'inconclusive', explanation: `${ctx.face.providerName} doesn’t check liveness, so a live person couldn’t be confirmed.` };
        const r = await callFace();
        if (r.status !== 'completed') return providerFailure(r);
        return {
          live: { status: 'passed' as const, explanation: 'Liveness confirmed by the facial verification provider.' },
          'not-live': { status: 'failed' as const, explanation: r.reason ?? 'The capture didn’t come from a live person (possible presentation attack).' },
          inconclusive: { status: 'inconclusive' as const, explanation: r.reason ?? 'The provider couldn’t judge liveness from this capture.' },
          'not-checked': { status: 'inconclusive' as const, explanation: 'The provider didn’t check liveness.' },
        }[r.liveness];
      }
      case 'face-match': {
        const problem = faceProblem();
        if (problem) return problem;
        const r = await callFace();
        if (r.status !== 'completed') return providerFailure(r);
        const evidenceRef = `biometric:${r.reference}`;
        if (r.decision === 'match') return { status: 'passed', explanation: 'The live capture matched the enrolled reference (1:1 verification).', evidenceRef };
        if (r.decision === 'no-match') return { status: 'failed', explanation: r.reason ?? 'The live capture didn’t match the enrolled reference.', evidenceRef };
        return { status: 'inconclusive', explanation: r.reason ?? 'The provider couldn’t compare this capture reliably (e.g. poor quality).', evidenceRef };
      }
      case 'group-membership': {
        if (c.params.useParticipants) {
          // The activity's participant list, read now: selected users and current members of selected groups.
          const activity = state.data.activityConfigs.find((a) => a.id === ctx.attempt.activityId);
          const p = activity?.participants ?? { groupIds: [], memberIds: [] };
          const m = resolved!.member;
          if (p.memberIds.includes(m.id)) return { status: 'passed', explanation: 'On this activity’s participant list.' };
          const hit = p.groupIds.find((g) => isGroupMember(state.data, org.id, g, m.id));
          if (hit) return { status: 'passed', explanation: `Eligible as a current member of ${state.data.groups.find((x) => x.id === hit)?.name}.` };
          return { status: 'failed', explanation: 'Not an eligible participant for this activity.' };
        }
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
  /** Facial verification provider. Defaults to none: biometric verification unavailable. */
  faceVerification?: FaceVerificationService;
  client?: VerificationClientRef;
  now?: () => Date;
  timeoutMs?: number;
}

export function createVerificationService(deps: ServiceDeps) {
  const client = deps.client ?? WEB_CLIENT;
  const face = deps.faceVerification ?? NO_FACE_VERIFICATION;
  const now = deps.now ?? (() => new Date());
  const newAttemptId = () => {
    const d = now();
    return `VER-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  };

  /** Transactions with a request in flight: a double click or repeated request can't run a step twice. */
  const busy = new Set<string>();

  /** The external transaction, its service and policy, if the caller may continue it now. */
  function externalGuard(attemptId: string): { ok: true; attempt: VerificationAttempt; integration: CustomIntegration; policy: ReturnType<typeof transactionPolicy> } | ServiceError {
    const s = deps.getState();
    const attempt = s.data.verificationAttempts.find((a) => a.id === attemptId);
    if (!attempt) return { ok: false, error: 'This verification wasn’t found.', code: 'not-found' };
    const auth = authorizeExecution(s, attempt.organizationId, attempt.activityId, client);
    if (!auth.ok) return auth;
    if (attempt.identitySource !== 'external') return { ok: false, error: 'This verification doesn’t use an external identity service.', code: 'operational' };
    if (attempt.status !== 'in-progress') return { ok: false, error: 'This verification has already finished.', code: 'not-in-progress' };
    if (now() > new Date(attempt.expiresAt)) {
      deps.dispatch({ type: 'verify/expire', organizationId: attempt.organizationId, at: now().toISOString() });
      return { ok: false, error: 'This verification expired. Start a new one.', code: 'expired' };
    }
    const policy = transactionPolicy(s, attempt);
    // The service is the one the activity requires now, and the one this transaction started with.
    if (!policy.integration || policy.integration.id !== attempt.integrationId || policy.integration.status !== 'active') {
      return { ok: false, error: MESSAGES.lookupUnavailable, code: 'operational' };
    }
    return { ok: true, attempt, integration: policy.integration, policy };
  }

  const service = {
    client,
    /** Active activities the signed-in verifier may perform: all of the organization’s, unless an activity is restricted. */
    listAuthorizedActivities(organizationId: string): { activity: ActivityConfig; version: ActivityVersion }[] {
      const s = deps.getState();
      return s.data.activityConfigs
        // Its own activities, and shared activities it takes part in.
        .filter((a) => (a.organizationId === organizationId || a.sharing?.participants.some((p) => p.organizationId === organizationId && p.status === 'active')) && a.status === 'active')
        .filter((a) => authorizeExecution(s, organizationId, a.id, client).ok)
        .map((a) => ({ activity: a, version: s.data.activityVersions.find((v) => v.id === a.activeVersionId)! }))
        .filter((x) => x.version);
    },

    /** Whether the signed-in administrator may perform verifications for this activity right now. */
    authorize(organizationId: string, activityId: string) {
      return authorizeExecution(deps.getState(), organizationId, activityId, client);
    },

    /** Whether facial verification is connected for this service. */
    faceVerificationAvailable: face.available,

    /** How local face verification runs for an organization: a configured provider, the labelled simulation, or not at all. */
    faceMode(organizationId: string): 'configured' | 'simulated' | 'unavailable' {
      const org = deps.getState().data.organizations.find((o) => o.id === organizationId);
      if (face.available) return 'configured';
      return org?.integrations.simulatedBiometrics?.enabled ? 'simulated' : 'unavailable';
    },

    /** Starts an attempt on the active version. Refusals are recorded in the Audit Log. */
    startAttempt(organizationId: string, activityId: string, opts: { retryOf?: string; reverificationOf?: string } = {}): { ok: true; attempt: VerificationAttempt } | ServiceError {
      const at = now().toISOString();
      deps.dispatch({ type: 'verify/expire', organizationId, at });
      const s = deps.getState();
      const auth = authorizeExecution(s, organizationId, activityId, client);
      if (!auth.ok) {
        if (s.data.activityConfigs.some((a) => a.id === activityId && (a.organizationId === organizationId || a.sharing?.participants.some((p) => p.organizationId === organizationId)))) {
          deps.dispatch({ type: 'verify/denied', organizationId, activityId, reason: auth.error, at, client });
        }
        return auth;
      }
      // Participation (shared activities) and external identity sources are checked before anything starts.
      const activity = s.data.activityConfigs.find((a) => a.id === activityId);
      const unavailable = activity ? executionUnavailable(s, activity, organizationId) : null;
      if (unavailable) return { ok: false, error: unavailable, code: 'inactive' };
      const attemptId = newAttemptId();
      deps.dispatch({ type: 'verify/start', organizationId, activityId, attemptId, at, client, ...(opts.retryOf ? { retryOf: opts.retryOf } : {}), ...(opts.reverificationOf ? { reverificationOf: opts.reverificationOf } : {}) });
      const attempt = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId);
      if (!attempt && opts.reverificationOf) return { ok: false, error: reverificationProblem(s, opts.reverificationOf, activityId) ?? 'The reverification couldn’t be started.', code: 'operational' };
      return attempt ? { ok: true, attempt } : { ok: false, error: 'The verification couldn’t be started.', code: 'operational' };
    },

    /** Steps and inputs the attempt needs, derived from its own configuration version. */
    requiredSteps(attemptId: string): RequiredSteps | null {
      const s = deps.getState();
      const a = service.getAttempt(attemptId);
      const v = a && s.data.activityVersions.find((x) => x.id === a.versionId);
      return v ? requiredSteps(s, v, face) : null;
    },

    /** The attempt, if the caller performed it or may view verification results in its organization. */
    getAttempt(attemptId: string): VerificationAttempt | undefined {
      const s = deps.getState();
      const a = s.data.verificationAttempts.find((x) => x.id === attemptId);
      if (!a) return undefined;
      const rec = actorRecord(s, a.organizationId);
      // Other people's verifications need organization-wide results access in the current view: the Verifier view sees only its own.
      const viewing = s.session.currentOrganizationId === a.organizationId ? effectivePermissions(s) : new Set();
      return rec && (rec.id === a.verifierId || (actorPermissions(s, a.organizationId).has('verification.results.view') && viewing.has('verification.results.view'))) ? a : undefined;
    },

    /**
     * Step 1 of a verification: find the person for the identifier the officer entered, within this
     * organization, and say whether they're an eligible participant, whether an enrolled portrait exists,
     * and what's already recorded for them here. A preview for the officer only: it proves nothing about
     * who is present, and the recorded result comes from the checks run on submission.
     */
    async lookupParticipant(attemptId: string, identifier: string): Promise<ParticipantLookup> {
      const s = deps.getState();
      const attempt = s.data.verificationAttempts.find((a) => a.id === attemptId);
      if (!attempt) return { ok: false, error: 'This verification wasn’t found.', code: 'not-found' };
      const auth = authorizeExecution(s, attempt.organizationId, attempt.activityId, client);
      if (!auth.ok) return auth;
      if (attempt.status !== 'in-progress') return { ok: false, error: 'This verification has already finished.', code: 'not-in-progress' };
      if (now() > new Date(attempt.expiresAt)) return { ok: false, error: 'This verification expired. Start a new one.', code: 'expired' };
      const version = s.data.activityVersions.find((v) => v.id === attempt.versionId)!;
      const steps = requiredSteps(s, version, face);
      const value = identifier.trim();
      if (!value) return { ok: false, error: `Enter the person’s ${(steps.identifier?.label ?? 'identifier').toLowerCase()}.`, code: 'missing-input' };
      const configId = version.checks.find((c) => c.type === 'identity-lookup')?.params.identifierConfigId;
      const member = s.data.members.find((m) => m.organizationId === attempt.organizationId && m.identifier
        && m.identifier.value.toLowerCase() === value.toLowerCase() && (!configId || m.identifier.configId === configId));
      if (!member) return { ok: false, error: `No one in ${s.data.organizations.find((o) => o.id === attempt.organizationId)?.name ?? 'this organization'} has this ${(steps.identifier?.label ?? 'identifier').toLowerCase()}. Check it and try again.`, code: 'identifier-not-found' };
      try {
        if (!(await deps.idSwitch.getIdentity(member.idSwitchId))) return { ok: false, error: 'The identity service has no record for this person, so they can’t be verified.', code: 'identifier-not-found' };
      } catch {
        return { ok: false, error: 'The identity lookup service is unavailable right now. Nothing was recorded; try again shortly.', code: 'lookup-unavailable' };
      }
      // Re-read: access may have changed while the identity service answered.
      const after = deps.getState();
      const reauth = authorizeExecution(after, attempt.organizationId, attempt.activityId, client);
      if (!reauth.ok) return reauth;
      const activity = after.data.activityConfigs.find((a) => a.id === attempt.activityId)!;
      const eligibilityCheck = version.checks.find((c) => c.type === 'group-membership');
      const eligibility: ParticipantEligibility = !eligibilityCheck ? 'not-required'
        : eligibilityCheck.params.useParticipants ? (eligibleParticipants(after.data, attempt.organizationId, activity.participants).has(member.id) ? 'eligible' : 'not-eligible')
          : ((eligibilityCheck.params.groupIds ?? []).some((g) => isGroupMember(after.data, attempt.organizationId, g, member.id)) ? 'eligible' : 'not-eligible');
      const earlier = after.data.verificationAttempts
        .filter((a) => a.id !== attempt.id && a.activityId === attempt.activityId && a.status === 'completed' && a.subject?.memberId === member.id)
        .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
      const entered = earlier.find((a) => a.entry?.status === 'entered');
      const latestDecision = earlier.find((a) => a.entry);
      const verified = earlier.find((a) => a.verificationResult === 'verified');
      return {
        ok: true,
        participant: {
          memberId: member.id, name: member.displayName, identifierLabel: steps.identifier?.label ?? 'Identifier', identifier: member.identifier!.value,
          relationship: member.relationship, unit: member.unit, status: member.status,
        },
        eligibility,
        portrait: member.faceEnrollment.status === 'enrolled' ? 'enrolled' : 'missing',
        enrollment: service.faceMode(attempt.organizationId) === 'unavailable' ? 'unavailable'
          : member.faceEnrollment.status === 'enrolled' ? 'enrolled' : member.faceEnrollment.status === 'not-enrolled' ? 'not-enrolled' : 'incomplete',
        faceRequired: !!steps.biometric,
        history: {
          ...(verified ? { verifiedAt: verified.completedAt! } : {}),
          ...(entered ? { entered: { at: entered.entry!.recordedAt, by: entered.entry!.recordedBy, attemptId: entered.id } } : {}),
          ...(latestDecision?.entry?.status === 'denied' ? { denied: { at: latestDecision.entry.recordedAt, by: latestDecision.entry.recordedBy, reason: latestDecision.entry.reason } } : {}),
        },
      };
    },

    /** Validates inputs, runs the checks, and records the result. Safe to call twice with the same submission ID. */
    async submitInputs(attemptId: string, inputs: VerificationInputs, opts: { submissionId: string; onProgress?: (runs: CheckRun[]) => void }): Promise<{ ok: true; attempt: VerificationAttempt } | ServiceError> {
      const s = deps.getState();
      const attempt = s.data.verificationAttempts.find((a) => a.id === attemptId);
      if (!attempt) return { ok: false, error: 'This verification wasn’t found.', code: 'not-found' };
      if (attempt.status === 'completed' && attempt.submissionId === opts.submissionId) return { ok: true, attempt };
      const version = s.data.activityVersions.find((v) => v.id === attempt.versionId)!;
      const steps = requiredSteps(s, version, face);
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
        const f = faceFor(org, face, inputs.demo?.face);
        result = await runChecks({ state: s, org, version, attempt, inputs, now: now(), idSwitch: deps.idSwitch, face: f.service, faceSimulated: f.simulated, timeoutMs: deps.timeoutMs ?? CHECK_TIMEOUT_MS }, opts.onProgress);
      } catch {
        deps.dispatch({ type: 'verify/fail', attemptId, at: now().toISOString(), reason: 'The verification couldn’t be completed because of a system error.' });
        return { ok: false, error: 'Something went wrong while running the checks. Nothing was decided; start a new verification.', code: 'operational' };
      }
      const complete: CompleteInput = {
        attemptId, submissionId: opts.submissionId, at: now().toISOString(), client, checks: result.runs, subject: result.subject,
        inputs: {
          identifier: !!inputs.identifier, credential: inputs.credential?.method,
          attributes: inputs.attributes ? Object.keys(inputs.attributes).filter((k) => inputs.attributes![k]) : undefined,
          biometric: !!inputs.face?.image,
        },
        location: inputs.location,
      };
      deps.dispatch({ type: 'verify/complete', input: complete });
      const saved = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId)!;
      if (saved.status !== 'completed') return { ok: false, error: 'The result couldn’t be recorded. The verification may have expired or your access changed.', code: 'operational' };
      return { ok: true, attempt: saved };
    },

    /** Records that the person physically entered, after access was permitted. Never automatic. */
    recordEntry(attemptId: string): { ok: true } | { ok: false; error: string } {
      const before = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId);
      if (!before) return { ok: false, error: 'This verification wasn’t found.' };
      if (before.entry?.status === 'entered') return { ok: true };
      deps.dispatch({ type: 'verify/recordEntry', attemptId, at: now().toISOString() });
      const after = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId);
      if (after?.entry?.status === 'entered') return { ok: true };
      return { ok: false, error: entryProblem(deps.getState(), attemptId) ?? 'Entry couldn’t be recorded.' };
    },

    /** The officer's explicit Deny Entry decision. Never automatic; possible after any completed verification. */
    denyEntry(attemptId: string, reason?: string): { ok: true } | { ok: false; error: string } {
      const before = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId);
      if (!before) return { ok: false, error: 'This verification wasn’t found.' };
      if (before.entry?.status === 'denied') return { ok: true };
      deps.dispatch({ type: 'verify/denyEntry', attemptId, at: now().toISOString(), reason });
      const after = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId);
      if (after?.entry?.status === 'denied') return { ok: true };
      return { ok: false, error: denyProblem(deps.getState(), attemptId) ?? 'The decision couldn’t be recorded.' };
    },

    /* ---------------- External identity journey ---------------- */

    /**
     * Identify Person: looks the reference up through the activity's configured identity service (the
     * owner's, for a shared activity). The verifier never chooses the service. Credentials stay
     * with the integration; only validated, permitted attributes come back. One request at a time per transaction.
     */
    async lookupExternal(attemptId: string, reference: string): Promise<{ ok: true; attempt: VerificationAttempt; result: IdentityLookupResult } | ServiceError> {
      const pre = externalGuard(attemptId);
      if (!pre.ok) return pre;
      if (!reference.trim()) return { ok: false, error: 'Enter the reference provided for this verification.', code: 'missing-input' };
      if (pre.attempt.lookup?.status === 'FOUND') return { ok: false, error: 'An identity was already found for this verification.', code: 'missing-input' };
      if (busy.has(attemptId)) return { ok: false, error: 'A request for this verification is already in progress.', code: 'operational' };
      busy.add(attemptId);
      try {
        const id = `${attemptId}-L${(pre.attempt.lookup?.count ?? 0) + 1}`;
        const result = await lookupIdentity(pre.integration, reference.trim(), undefined, id);
        deps.dispatch({ type: 'verify/lookup', attemptId, at: now().toISOString(), reference: reference.trim(), requestId: id, result });
        const saved = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId)!;
        if (saved.lookup?.requestId !== id) return { ok: false, error: 'The lookup couldn’t be recorded. The verification may have expired or your access changed.', code: 'operational' };
        return { ok: true, attempt: saved, result };
      } finally { busy.delete(attemptId); }
    },

    /**
     * Capture / Verify: liveness (when the activity requires or offers it) and then matching against the
     * reference the external service holds. No image is ever sent to a simulated service, and none is stored:
     * for the Simulated Identity Service the verifier picks labelled outcome fixtures. A mandatory liveness
     * check that doesn't pass stops matching. Duplicate submissions return the recorded result.
     */
    async completeExternal(attemptId: string, input: { captured: boolean; demo?: { liveness?: SimulatedLivenessOutcome; match?: string } }, opts: { submissionId: string }): Promise<{ ok: true; attempt: VerificationAttempt } | ServiceError> {
      const existing = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId);
      if (existing?.status === 'completed' && existing.submissionId === opts.submissionId) return { ok: true, attempt: existing };
      const pre = externalGuard(attemptId);
      if (!pre.ok) return pre;
      const { attempt, integration, policy } = pre;
      if (attempt.lookup?.status !== 'FOUND' || !attempt.lookup.referenceId) return { ok: false, error: 'Find the identity before continuing.', code: 'missing-input' };
      const simulated = integration.connection.target === 'simulated';
      const face = policy.settings.method === 'face';
      if (face && !input.captured) return { ok: false, error: 'Capture the person’s face first.', code: 'missing-input' };
      if (face && simulated && policy.livenessApplies && !input.demo?.liveness) return { ok: false, error: 'Choose the simulated liveness result.', code: 'missing-input' };
      if (face && simulated && !input.demo?.match) return { ok: false, error: 'Choose the simulated matching outcome.', code: 'missing-input' };
      if (busy.has(attemptId)) return { ok: false, error: 'A request for this verification is already in progress.', code: 'operational' };
      busy.add(attemptId);
      try {
        // Liveness: simulated for the Simulated Identity Service; a real service would need secure liveness evidence transfer, which this prototype doesn't have.
        const liveness: { status: LivenessStatus; simulated: boolean } = !policy.livenessApplies ? { status: 'not-required', simulated: false }
          : simulated ? { status: input.demo!.liveness!, simulated: true } : { status: 'unavailable', simulated: false };
        let match: Omit<NonNullable<VerificationAttempt['match']>, 'at'> = { status: 'record-confirmed', simulated, service: integration.name };
        let diagnostic: string | undefined;
        if (face && !(policy.livenessRequired && liveness.status !== 'passed')) {
          const id = `${attemptId}-M1`;
          const r = await matchBiometric(integration, {
            referenceId: attempt.lookup.referenceId,
            // Only a fixture reference goes to the simulated service; a real capture would travel over an authorized secure interface.
            captureReference: simulated ? input.demo!.match! : `CAPTURE-${attemptId}`,
            ...(liveness.status === 'passed' ? { livenessEvidenceReference: `LIVENESS-${attemptId}` } : {}),
          }, undefined, id);
          const status = ({ MATCH: 'match', NO_MATCH: 'no-match', INCONCLUSIVE: 'inconclusive', UNAVAILABLE: 'unavailable', ERROR: 'error' } as const)[r.status];
          match = {
            status, simulated: r.simulated, service: integration.name, requestId: id,
            ...(r.providerTransactionId ? { providerTransactionId: r.providerTransactionId } : {}),
            // Scores only when the service genuinely supplied them, with its own scale.
            ...(typeof r.score === 'number' && r.scoreScale ? { score: r.score, scoreScale: r.scoreScale, ...(typeof r.threshold === 'number' ? { threshold: r.threshold } : {}) } : {}),
          };
          if ((r.status === 'ERROR' || r.status === 'UNAVAILABLE') && r.message) diagnostic = r.message;
        } else if (face) match = { status: 'not-evaluated', simulated: false, service: integration.name };
        deps.dispatch({ type: 'verify/externalComplete', input: { attemptId, submissionId: opts.submissionId, at: now().toISOString(), liveness, match, ...(diagnostic ? { diagnostic } : {}) } });
        const saved = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId)!;
        if (saved.status !== 'completed') return { ok: false, error: 'The result couldn’t be recorded. The verification may have expired or your access changed.', code: 'operational' };
        return { ok: true, attempt: saved };
      } finally { busy.delete(attemptId); }
    },

    /** Ends a transaction whose lookup didn't find one identity, recording why. */
    endExternal(attemptId: string): { ok: true; attempt: VerificationAttempt } | ServiceError {
      const pre = externalGuard(attemptId);
      if (!pre.ok) return pre;
      deps.dispatch({ type: 'verify/end', attemptId, at: now().toISOString() });
      const saved = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId)!;
      return saved.status === 'completed' ? { ok: true, attempt: saved } : { ok: false, error: 'The verification couldn’t be ended this way.', code: 'operational' };
    },

    /** Earlier results this transaction may reuse under the activity's reverification policy. */
    reusableResults(attemptId: string): VerificationAttempt[] {
      const s = deps.getState();
      const a = s.data.verificationAttempts.find((x) => x.id === attemptId);
      return a && authorizeExecution(s, a.organizationId, a.activityId, client).ok ? reusableFor(s, a, now()) : [];
    },

    reuseResult(attemptId: string, fromId: string, opts: { submissionId: string }): { ok: true; attempt: VerificationAttempt } | ServiceError {
      const pre = externalGuard(attemptId);
      if (!pre.ok) return pre;
      deps.dispatch({ type: 'verify/reuse', attemptId, fromId, submissionId: opts.submissionId, at: now().toISOString() });
      const saved = deps.getState().data.verificationAttempts.find((a) => a.id === attemptId)!;
      return saved.status === 'completed' ? { ok: true, attempt: saved } : { ok: false, error: 'The earlier result can’t be reused for this verification.', code: 'operational' };
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
