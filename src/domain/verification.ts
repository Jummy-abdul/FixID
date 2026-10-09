import type {
  ActivityCheck, ActivityConfig, ActivityVersion, CheckTypeId, CredentialType, Group, IdentifierConfig, Organization, OrgAdministrator,
  OutcomePolicy, VerificationOutcome, VerificationType, VerifierAssignment,
} from './types';
import { permissionsFor } from './roles';

/**
 * Verification Activities: a reusable catalog of checks, the services that can run them, and the
 * rules that decide whether an activity's configuration can be activated. Nothing here executes a
 * verification; execution arrives in a later phase and reads `executionPlan`.
 */

export type CheckCategory = 'identity' | 'credential' | 'eligibility';

/** What a check needs from other checks before it can produce a reliable result. */
export type Needs = 'resolved-identity' | 'authorized-reference' | 'verified-credential' | 'liveness';

export interface CheckDefinition {
  id: CheckTypeId;
  name: string;
  category: CheckCategory;
  /** Plain-language explanation for administrators. */
  description: string;
  /** Services that can run the check (first is the default). */
  providers: string[];
  /** Systems that can supply the authoritative record or reference, when the check uses one. */
  sources?: string[];
  needs?: Needs[];
  /** What the check establishes for other checks. */
  provides?: Needs[];
  /** Configuration fields shown for this check. */
  fields?: ('identifier' | 'attributes' | 'credentialTypes' | 'groups' | 'condition' | 'previous')[];
  note?: string;
}

export const CHECKS: CheckDefinition[] = [
  {
    id: 'identity-lookup', name: 'Identity Record Lookup', category: 'identity',
    description: 'Find the person’s identity record using an authorized identifier and a trusted identity source.',
    providers: ['identity-service', 'external-registry'], sources: ['identity-service', 'external-registry'],
    provides: ['resolved-identity', 'authorized-reference'], fields: ['identifier'],
  },
  {
    id: 'attribute-match', name: 'Identity Attribute Matching', category: 'identity',
    description: 'Compare details the person gives (such as name or date of birth) with the authorized record.',
    providers: ['identity-service', 'external-registry'], sources: ['identity-service', 'workforce-directory', 'external-registry'],
    needs: ['resolved-identity'], fields: ['attributes'],
  },
  {
    id: 'face-match', name: 'Facial Identity Matching', category: 'identity',
    description: 'Compare a live facial capture with the authorized reference image for this person.',
    providers: ['facial-matching', 'external-registry'], sources: ['identity-service', 'external-registry'],
    needs: ['authorized-reference', 'liveness'],
    note: 'FixID never stores the live capture. The reference is used only for this comparison.',
  },
  {
    id: 'liveness', name: 'Liveness Verification', category: 'identity',
    description: 'Confirm the facial capture comes from a live person present at the time of verification.',
    providers: ['facial-matching'], provides: ['liveness'],
  },
  {
    id: 'credential-authenticity', name: 'Credential Authenticity', category: 'credential',
    description: 'Check the presented credential is genuine and unaltered, using its format’s trust mechanism.',
    providers: ['credential-service'], provides: ['verified-credential', 'resolved-identity'], fields: ['credentialTypes'],
    note: 'A genuine credential doesn’t prove the presenter is its holder. Add holder binding or facial matching for that.',
  },
  {
    id: 'issuer-trust', name: 'Issuer Trust', category: 'credential',
    description: 'Accept only credentials from issuers trusted for this activity.',
    providers: ['credential-service'], needs: ['verified-credential'],
  },
  {
    id: 'credential-validity', name: 'Credential Validity', category: 'credential',
    description: 'Check the credential is within its effective and expiry dates.',
    providers: ['credential-service'], needs: ['verified-credential'],
  },
  {
    id: 'credential-status', name: 'Credential Status', category: 'credential',
    description: 'Check the credential hasn’t been revoked or suspended, using its status information.',
    providers: ['credential-service'], needs: ['verified-credential'],
  },
  {
    id: 'holder-binding', name: 'Holder Binding', category: 'credential',
    description: 'Check a cryptographic proof that the presenter is allowed to present this credential.',
    providers: ['presentation-proof'], needs: ['verified-credential'],
    note: 'Holder binding proves control of the credential, not who is physically present. It isn’t facial matching.',
  },
  {
    id: 'group-membership', name: 'Group Membership', category: 'eligibility',
    description: 'Check the resolved person currently belongs to one of the permitted groups.',
    providers: ['fixid-records'], needs: ['resolved-identity'], fields: ['groups'],
  },
  {
    id: 'attribute-condition', name: 'Attribute Condition', category: 'eligibility',
    description: 'Check a permitted attribute of the person against a condition you set.',
    providers: ['fixid-records'], needs: ['resolved-identity'], fields: ['condition'],
  },
  {
    id: 'external-eligibility', name: 'External Eligibility Check', category: 'eligibility',
    description: 'Ask an authorized external system whether the person is eligible.',
    providers: ['external-eligibility'], needs: ['resolved-identity'],
  },
  {
    id: 'previous-verification', name: 'Previous Verification Check', category: 'eligibility',
    description: 'Prevent repeat use, or require an earlier successful verification for this activity.',
    providers: ['fixid-records'], needs: ['resolved-identity'], fields: ['previous'],
  },
];

export const checkById = (id: CheckTypeId) => CHECKS.find((c) => c.id === id)!;

export const CATEGORY_LABEL: Record<CheckCategory, string> = { identity: 'Identity checks', credential: 'Credential checks', eligibility: 'Eligibility checks' };

export const TYPE_INFO: Record<VerificationType, { name: string; description: string; categories: CheckCategory[] }> = {
  identity: {
    name: 'Identity', categories: ['identity', 'eligibility'],
    description: 'Verify a person against an authorized identity record or trusted source. No digital credential is needed.',
  },
  credential: {
    name: 'Credential', categories: ['credential', 'eligibility'],
    description: 'Verify a presented digital credential. This doesn’t on its own confirm who is presenting it.',
  },
  'identity-credential': {
    name: 'Identity and Credential', categories: ['identity', 'credential', 'eligibility'],
    description: 'Verify a presented credential and the person presenting it, for example that they are its holder.',
  },
};

export const ATTRIBUTES = ['Full name', 'Date of birth', 'Phone number', 'Email address'];
export const CONDITION_ATTRIBUTES = ['User status', 'Role', 'Unit'];

/* ------------------------------------------------------------------ */
/* Trusted identity sources and verification providers                 */
/* ------------------------------------------------------------------ */

export type ProviderStatus = 'available' | 'not-configured' | 'unavailable';

export interface ProviderInfo {
  id: string;
  name: string;
  /** Holds authoritative records, runs checks, or both. */
  role: 'source' | 'provider' | 'both';
  description: string;
  status: ProviderStatus;
  /** Why it has this status, and how to change it. */
  statusNote: string;
  internal: boolean;
  /** A labelled demonstration stand-in. Its results are never real verification. */
  simulated?: boolean;
}

/**
 * Providers and sources for an organization, with status taken from its integration settings. External
 * services aren't integrated yet, so they always show as Not configured; none is presented as working.
 */
export function providersFor(org: Organization): ProviderInfo[] {
  const ids = org.integrations.idSwitch.connected;
  const fixiam = org.integrations.fixiam.connected;
  const demo = !!org.integrations.verificationDemo?.enabled;
  const simulated = (name: string) => ({
    name: `${name} (simulated)`, status: 'available' as const, simulated: true,
    statusNote: 'Demonstration provider, turned on in Settings → Integrations. Results are simulated and aren’t real verification.',
  });
  return [
    {
      id: 'identity-service', name: 'Identity service', role: 'both', internal: true,
      description: 'The organization’s identity records, connected in Settings → Integrations.',
      status: ids ? 'available' : 'unavailable', statusNote: ids ? 'Connected.' : 'Not connected. Connect it in Settings → Integrations.',
    },
    {
      id: 'credential-service', name: 'FixID credential service', role: 'provider', internal: true,
      description: 'Checks credentials issued by this organization through FixID: authenticity, issuer, validity and status.',
      status: 'available', statusNote: 'Built in.',
    },
    {
      id: 'fixid-records', name: 'FixID organization records', role: 'both', internal: true,
      description: 'Users, groups and previous verifications held in FixID for this organization.',
      status: 'available', statusNote: 'Built in.',
    },
    {
      id: 'workforce-directory', name: 'Workforce directory (Fixiam)', role: 'source', internal: false,
      description: 'Permitted workforce attributes from Fixiam.',
      status: fixiam ? 'available' : 'not-configured', statusNote: fixiam ? 'Connected.' : 'Fixiam isn’t connected for this organization.',
    },
    {
      id: 'facial-matching', name: 'Facial matching service', role: 'provider', internal: false,
      description: 'Compares facial captures with authorized references and checks liveness.',
      status: 'not-configured', statusNote: 'No facial matching service is configured yet.',
      ...(demo ? simulated('Facial matching service') : {}),
    },
    {
      id: 'presentation-proof', name: 'Credential presentation proof', role: 'provider', internal: false,
      description: 'Validates holder-binding proofs from compatible wallets.',
      status: 'not-configured', statusNote: 'No presentation proof service is configured yet.',
      ...(demo ? simulated('Credential presentation proof') : {}),
    },
    {
      id: 'external-registry', name: 'External identity registry', role: 'both', internal: false,
      description: 'An authorized external identity authority that holds records and may run matching itself.',
      status: 'not-configured', statusNote: 'No external identity registry is configured yet.',
    },
    {
      id: 'external-eligibility', name: 'External eligibility service', role: 'provider', internal: false,
      description: 'An authorized external system that decides eligibility.',
      status: 'not-configured', statusNote: 'No external eligibility service is configured yet.',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Policies, defaults and validation                                   */
/* ------------------------------------------------------------------ */

export const includesCredential = (t: VerificationType) => t !== 'identity';
export const includesIdentity = (t: VerificationType) => t !== 'credential';

/**
 * Platform policy: any activity that accepts credentials must check their authenticity. Added as a
 * locked, required check; future governing-authority policies would be added the same way.
 */
export const PLATFORM_POLICIES = [
  { id: 'credential-authenticity', text: 'Activities that accept credentials must check credential authenticity.' },
  { id: 'liveness-with-face', text: 'Facial identity matching must be paired with liveness verification.' },
  { id: 'no-failure-to-verified', text: 'A failed or inconclusive required check can never produce a Verified outcome.' },
];

export function newCheck(type: CheckTypeId, id: string, org: Organization, overrides: Partial<ActivityCheck> = {}): ActivityCheck {
  const def = checkById(type);
  const providers = providersFor(org);
  const firstAvailable = (ids: string[] | undefined) => ids?.find((p) => providers.find((x) => x.id === p)?.status === 'available') ?? ids?.[0];
  return {
    id, type, requirement: 'required', policySource: 'organization', params: {},
    providerId: firstAvailable(def.providers), sourceId: def.sources ? firstAvailable(def.sources) : undefined,
    ...overrides,
  };
}

/** Apply mandatory platform policies to a configuration (idempotent). */
export function withPlatformPolicies(checks: ActivityCheck[], type: VerificationType, org: Organization, makeId: () => string): ActivityCheck[] {
  let out = checks.filter((c) => TYPE_INFO[type].categories.includes(checkById(c.type).category));
  if (includesCredential(type)) {
    const existing = out.find((c) => c.type === 'credential-authenticity');
    out = existing
      ? out.map((c) => (c === existing ? { ...c, requirement: 'required', policySource: 'platform', locked: true } : c))
      : [newCheck('credential-authenticity', makeId(), org, { policySource: 'platform', locked: true }), ...out];
  } else {
    out = out.map((c) => (c.type === 'credential-authenticity' ? { ...c, locked: false, policySource: 'organization' } : c));
  }
  return out;
}

export const DEFAULT_OUTCOME: OutcomePolicy = { onRequiredFailure: 'not-verified', onInconclusive: 'unable-to-verify' };

export interface ValidationContext {
  organization: Organization;
  groups: Group[];
  credentialTypes: CredentialType[];
  identifierConfigs: IdentifierConfig[];
}

export interface CheckIssue { checkId?: string; message: string }

/** Problems that block activation, and warnings worth knowing. Drafts may be saved with either. */
export function validateConfiguration(version: Pick<ActivityVersion, 'type' | 'checks' | 'outcome'>, ctx: ValidationContext): { blockers: CheckIssue[]; warnings: CheckIssue[] } {
  const blockers: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];
  const providers = providersFor(ctx.organization);
  const statusOf = (id?: string) => providers.find((p) => p.id === id);
  const checks = version.checks;
  const allowed = TYPE_INFO[version.type].categories;

  if (checks.length === 0) blockers.push({ message: 'Add at least one verification check.' });
  for (const c of checks) {
    const def = checkById(c.type);
    if (!allowed.includes(def.category)) blockers.push({ checkId: c.id, message: `${def.name} isn’t part of ${TYPE_INFO[version.type].name} verification.` });
  }
  if (checks.length && !checks.some((c) => c.requirement === 'required')) {
    blockers.push({ message: 'At least one check must be required. Optional checks alone can’t verify anyone.' });
  }
  const eligibilityOnly = checks.filter((c) => c.requirement === 'required').every((c) => checkById(c.type).category === 'eligibility');
  if (checks.some((c) => c.requirement === 'required') && eligibilityOnly) {
    blockers.push({ message: 'Add a required identity or credential check. Eligibility checks need a person or credential to evaluate.' });
  }

  // Platform policies.
  if (includesCredential(version.type)) {
    const auth = checks.find((c) => c.type === 'credential-authenticity');
    if (!auth || auth.requirement !== 'required') blockers.push({ message: 'Credential authenticity must be a required check (platform policy).' });
  }
  for (const c of checks.filter((x) => x.locked && x.requirement !== 'required')) {
    blockers.push({ checkId: c.id, message: `${checkById(c.type).name} is required by a mandatory policy and can’t be optional or an alternative.` });
  }

  // Alternatives: one limited group where at least one must pass.
  const alternatives = checks.filter((c) => c.requirement === 'alternative');
  if (alternatives.length === 1) blockers.push({ checkId: alternatives[0].id, message: 'Approved alternatives need at least two checks, or make this check required.' });

  // Dependencies: what each check needs must be provided by a check that will definitely run and pass.
  const providedBy = (need: string, strength: 'required' | 'any') => checks.some((x) => {
    if (!checkById(x.type).provides?.includes(need as never)) return false;
    return strength === 'any' ? true : x.requirement === 'required';
  });
  const NEED_TEXT: Record<string, string> = {
    'resolved-identity': 'a check that resolves the person (Identity Record Lookup or Credential Authenticity)',
    'authorized-reference': 'Identity Record Lookup, to get the authorized reference',
    'verified-credential': 'Credential Authenticity',
    liveness: 'Liveness Verification',
  };
  for (const c of checks) {
    const def = checkById(c.type);
    for (const need of def.needs ?? []) {
      if (!providedBy(need, 'any')) blockers.push({ checkId: c.id, message: `${def.name} needs ${NEED_TEXT[need]}.` });
      else if (c.requirement === 'required' && !providedBy(need, 'required')) {
        blockers.push({ checkId: c.id, message: `${def.name} is required, so ${NEED_TEXT[need]} must be required too.` });
      }
    }
  }

  // Providers, sources and parameters.
  for (const c of checks) {
    const def = checkById(c.type);
    const p = statusOf(c.providerId);
    if (!p || !def.providers.includes(p.id)) blockers.push({ checkId: c.id, message: `Choose a verification provider for ${def.name}.` });
    else if (p.status !== 'available') blockers.push({ checkId: c.id, message: `${def.name} uses ${p.name}, which is ${p.status === 'unavailable' ? 'unavailable' : 'not configured'}. ${p.statusNote}` });
    if (def.sources) {
      const src = statusOf(c.sourceId);
      if (!src || !def.sources.includes(src.id)) blockers.push({ checkId: c.id, message: `Choose a trusted source for ${def.name}.` });
      else if (src.status !== 'available') blockers.push({ checkId: c.id, message: `${def.name} relies on ${src.name}, which is ${src.status === 'unavailable' ? 'unavailable' : 'not configured'}.` });
    }
    const f = def.fields ?? [];
    if (f.includes('identifier') && c.params.identifierConfigId && !ctx.identifierConfigs.some((i) => i.id === c.params.identifierConfigId)) {
      blockers.push({ checkId: c.id, message: 'The identifier chosen for Identity Record Lookup no longer exists.' });
    }
    if (f.includes('attributes') && !c.params.attributes?.length) blockers.push({ checkId: c.id, message: 'Choose at least one attribute to match.' });
    if (f.includes('credentialTypes')) {
      const accepted = (c.params.credentialTypeIds ?? []).filter((id) => ctx.credentialTypes.some((t) => t.id === id && t.status === 'active'));
      if (!accepted.length) blockers.push({ checkId: c.id, message: 'Choose at least one active credential this activity accepts.' });
    }
    if (f.includes('groups')) {
      const groups = (c.params.groupIds ?? []).filter((id) => ctx.groups.some((g) => g.id === id));
      if (!groups.length) blockers.push({ checkId: c.id, message: 'Choose at least one permitted group.' });
      else if (groups.length < (c.params.groupIds ?? []).length) warnings.push({ checkId: c.id, message: 'Some permitted groups no longer exist and will be ignored.' });
    }
    if (f.includes('condition') && (!c.params.attribute || !c.params.value?.trim())) blockers.push({ checkId: c.id, message: 'Complete the attribute condition.' });
  }

  // Helpful warnings.
  if (includesCredential(version.type) && !checks.some((c) => c.type === 'credential-status')) {
    warnings.push({ message: 'Revoked or suspended credentials won’t be detected without Credential Status.' });
  }
  if (version.type === 'identity-credential' && !checks.some((c) => ['holder-binding', 'face-match'].includes(c.type))) {
    warnings.push({ message: 'Nothing confirms the presenter is the credential holder. Consider Holder Binding or Facial Identity Matching.' });
  }
  return { blockers, warnings };
}

/** Human-readable rules for the configured checks. */
export function rulesSummary(version: Pick<ActivityVersion, 'checks' | 'outcome'>): string[] {
  const required = version.checks.filter((c) => c.requirement === 'required');
  const alternatives = version.checks.filter((c) => c.requirement === 'alternative');
  const optional = version.checks.filter((c) => c.requirement === 'optional');
  const names = (cs: ActivityCheck[]) => cs.map((c) => checkById(c.type).name).join(', ');
  const lines: string[] = [];
  if (required.length) lines.push(`All required checks must pass: ${names(required)}.`);
  if (alternatives.length) lines.push(`At least one approved alternative must pass: ${names(alternatives)}.`);
  if (optional.length) lines.push(`Optional checks are recorded but don’t decide the outcome on their own: ${names(optional)}.`);
  lines.push(version.outcome.onRequiredFailure === 'not-verified'
    ? 'If a required check fails, the outcome is Not Verified.'
    : 'If a required check fails, the outcome is Pending Review, and a reviewer decides. The original result is kept.');
  lines.push(version.outcome.onInconclusive === 'unable-to-verify'
    ? 'If a required check can’t be completed (missing data or a service is unavailable), the outcome is Unable to Verify.'
    : 'If a required check can’t be completed, the outcome is Pending Review. The original result is kept.');
  lines.push('Verified is only possible when every required check and, where configured, at least one alternative passes.');
  return lines;
}

export const OUTCOME_LABEL: Record<string, string> = {
  verified: 'Verified', 'not-verified': 'Not Verified', 'unable-to-verify': 'Unable to Verify', 'pending-review': 'Pending Review',
};

/* ------------------------------------------------------------------ */
/* Verifier authorization and execution plan                           */
/* ------------------------------------------------------------------ */

export interface VerificationData {
  activityConfigs: ActivityConfig[];
  activityVersions: ActivityVersion[];
  verifierAssignments: VerifierAssignment[];
  administrators: OrgAdministrator[];
}

/** Administrators who can be assigned: active, in this organization, with permission to perform verifications. */
export function eligibleVerifiers(d: Pick<VerificationData, 'administrators'>, organizationId: string): OrgAdministrator[] {
  return d.administrators.filter((a) => a.organizationId === organizationId && a.status === 'active' && permissionsFor(a.roleIds).has('verification.execute'));
}

export const activeAssignments = (d: Pick<VerificationData, 'verifierAssignments'>, organizationId: string, activityId: string) =>
  d.verifierAssignments.filter((v) => v.organizationId === organizationId && v.activityId === activityId && v.status === 'active');

/**
 * Can this administrator perform this activity now? The check an external verifier application would
 * ask FixID: active administrator in the same organization, with the permission, assigned to an active
 * activity. Removing the role, the assignment or the activity stops it immediately.
 */
export function authorizeVerifier(d: VerificationData, input: { organizationId: string; activityId: string; administratorId: string }): { authorized: true } | { authorized: false; reason: string } {
  const activity = d.activityConfigs.find((a) => a.id === input.activityId && a.organizationId === input.organizationId);
  if (!activity) return { authorized: false, reason: 'Activity not found in this organization.' };
  if (activity.status !== 'active' || !activity.activeVersionId) return { authorized: false, reason: 'The activity isn’t active.' };
  const admin = d.administrators.find((a) => a.id === input.administratorId && a.organizationId === input.organizationId);
  if (!admin || admin.status !== 'active') return { authorized: false, reason: 'Not an active administrator of this organization.' };
  if (!permissionsFor(admin.roleIds).has('verification.execute')) return { authorized: false, reason: 'Their role doesn’t allow performing verifications.' };
  if (!activeAssignments(d, input.organizationId, activity.id).some((v) => v.administratorId === admin.id)) return { authorized: false, reason: 'Not assigned to this activity.' };
  return { authorized: true };
}

/** What a verifier application needs to run an activity: the active version and its checks. */
export function executionPlan(d: VerificationData, organizationId: string, activityId: string) {
  const activity = d.activityConfigs.find((a) => a.id === activityId && a.organizationId === organizationId);
  if (!activity || activity.status !== 'active') return null;
  const version = d.activityVersions.find((v) => v.id === activity.activeVersionId);
  if (!version) return null;
  return {
    activityId: activity.id, versionId: version.id, versionNumber: version.number, type: version.type, outcome: version.outcome,
    required: version.checks.filter((c) => c.requirement === 'required'),
    alternatives: version.checks.filter((c) => c.requirement === 'alternative'),
    optional: version.checks.filter((c) => c.requirement === 'optional'),
  };
}

/** The version being edited (draft) or, if none, the one in use. */
export function currentVersion(d: Pick<VerificationData, 'activityVersions'>, a: ActivityConfig): ActivityVersion | undefined {
  return d.activityVersions.find((v) => v.id === (a.draftVersionId ?? a.activeVersionId));
}

/* ------------------------------------------------------------------ */
/* Outcome evaluation (shared by the execution engine and the store)   */
/* ------------------------------------------------------------------ */

type RunLike = { checkId: string; requirement: ActivityCheck['requirement']; status: string; explanation: string; type: CheckTypeId; skipReason?: string };

/**
 * Turns check results into an outcome using the activity's rules: every required check must pass, and
 * at least one approved alternative (when configured). A definite failure takes precedence over an
 * incomplete check. Optional checks never decide the outcome. A failure can never become Verified.
 */
export function evaluateOutcome(version: Pick<ActivityVersion, 'outcome' | 'checks'>, runs: RunLike[]): { outcome: VerificationOutcome; reasons: string[] } {
  const configured = new Set(version.checks.map((c) => c.id));
  // A check skipped because its prerequisite failed is a failure for evaluation; any other skip is incomplete.
  const relevant = runs.filter((r) => configured.has(r.checkId))
    .map((r) => (r.status === 'skipped' && r.skipReason === 'dependency-failed' ? { ...r, status: 'failed' } : r));
  const missing = version.checks.filter((c) => c.requirement !== 'optional' && !relevant.some((r) => r.checkId === c.id));
  const required = relevant.filter((r) => r.requirement === 'required');
  const alternatives = relevant.filter((r) => r.requirement === 'alternative');
  const failed = required.filter((r) => r.status === 'failed');
  const incomplete = [...required.filter((r) => r.status !== 'passed' && r.status !== 'failed'), ...missing.map((c) => ({ explanation: `${checkById(c.type).name} wasn’t run.` }))];
  const altPassed = alternatives.some((r) => r.status === 'passed');
  const altIncomplete = alternatives.length > 0 && !altPassed && alternatives.some((r) => r.status !== 'failed');
  const altFailed = alternatives.length > 0 && !altPassed && !altIncomplete;
  const name = (r: { type?: CheckTypeId; explanation: string }) => (r.type ? `${checkById(r.type).name}: ${r.explanation}` : r.explanation);

  if (failed.length || altFailed) {
    const reasons = [...failed.map(name), ...(altFailed ? ['None of the approved alternatives passed.'] : [])];
    return { outcome: version.outcome.onRequiredFailure === 'pending-review' ? 'pending-review' : 'not-verified', reasons };
  }
  if (incomplete.length || altIncomplete) {
    const reasons = [...incomplete.map(name), ...(altIncomplete ? ['No approved alternative could be completed.'] : [])];
    return { outcome: version.outcome.onInconclusive === 'pending-review' ? 'pending-review' : 'unable-to-verify', reasons };
  }
  return { outcome: 'verified', reasons: [] };
}
