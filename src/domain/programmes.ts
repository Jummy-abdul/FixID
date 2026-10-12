/**
 * Verification Programmes and activity verification settings.
 *
 * A programme is governance: an owning organization defines minimum verification requirements and which
 * of its sub-organizations take part. An activity is an operational context. Activities don't need a
 * programme; a programme-linked activity inherits the programme's mandatory requirements and may only make
 * them stricter. The effective settings are always computed (programme minimum + activity choices), so a
 * programme's rules are never copied into its activities and can't drift out of step.
 */

export type ProgrammeStatus = 'draft' | 'active' | 'suspended' | 'completed' | 'archived';
export type ParticipationStatus = 'invited' | 'active' | 'suspended' | 'removed';

/** Where the reference identity is held (and, for external, which organization's integration is used). */
export type IdentitySource = { kind: 'local' } | { kind: 'external'; integrationId: string };

/** How a person proves who they are. `face` = live face matched 1:1; `record` = record found plus stated details (the existing, lower-assurance alternative). */
export type VerificationMethod = 'face' | 'record';
export type LivenessRequirement = 'required' | 'optional' | 'not-applicable';
export type ReverificationPolicy = { mode: 'every-time' } | { mode: 'reuse-within'; days: number } | { mode: 'activity-defined' };
/** What happens to a failed, disputed or inconclusive verification. Never a final access decision on its own. */
export type ExceptionHandling = 'review' | 'unsuccessful' | 'pending';
/**
 * How eligibility is determined, separately from identity:
 * - local-population: the activity's eligible population of locally registered people (groups and users);
 * - external-source: an authorized external lookup response (or approved external eligibility service);
 * - reference-list: a permitted list of external reference identifiers for the activity;
 * - none: no predefined population (identity verification only, when the activity permits it).
 */
export type EligibilityApproach = 'local-population' | 'external-source' | 'reference-list' | 'none';

export interface DecisionRules {
  /** Identity match inconclusive: send for review, or decide that it can't be decided. */
  onInconclusiveMatch: 'pending-review' | 'unable-to-decide';
  /** Identity service unavailable: no decision is made (never Allow). */
  onServiceUnavailable: 'unable-to-decide' | 'pending-review';
}

/** The settings an activity is verified with. Stored on the activity; programme minimums are applied on top. */
export interface VerificationSettings {
  identitySource: IdentitySource;
  method: VerificationMethod;
  liveness: LivenessRequirement;
  reverification: ReverificationPolicy;
  exceptions: ExceptionHandling;
  /**
   * `attribute`/`allowedValues`: for external-source eligibility, the permitted lookup attribute and the values
   * that make someone eligible (default recordStatus = ACTIVE). Unrelated attributes are never used.
   */
  eligibility: { approach: EligibilityApproach; referenceList?: string[]; attribute?: string; allowedValues?: string[] };
  decisionRules: DecisionRules;
}

/** A programme's mandatory minimum. Participating organizations can't weaken any of it. */
export interface ProgrammeRequirements {
  identitySource: IdentitySource;
  method: VerificationMethod;
  liveness: LivenessRequirement;
  reverification: ReverificationPolicy;
  exceptions: ExceptionHandling;
  /** Escalate exceptions to an authorized programme reviewer in the owning organization. */
  escalateToProgramme: boolean;
  /** Eligibility must be determined (activities can't use "no predefined population"). */
  eligibilityRequired: boolean;
  /** Eligibility approaches activities may use. */
  allowedEligibility: EligibilityApproach[];
  /** Placeholder for a future assurance policy. No assurance level is claimed until one is defined. */
  assurancePolicyId?: string;
}

export interface ProgrammeParticipant {
  organizationId: string;
  status: ParticipationStatus;
  addedAt: string;
  addedBy: string;
  updatedAt?: string;
}

export interface VerificationProgramme {
  id: string;
  ownerOrganizationId: string;
  name: string;
  description: string;
  purpose: string;
  status: ProgrammeStatus;
  /** `own`: only the owning organization; `sub-organizations`: explicitly selected sub-organizations. */
  scope: 'own' | 'sub-organizations';
  participants: ProgrammeParticipant[];
  requirements: ProgrammeRequirements;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  activatedAt?: string;
}

/* ---------------- Labels ---------------- */

export const PROGRAMME_STATUS_LABEL: Record<ProgrammeStatus, string> = { draft: 'Draft', active: 'Active', suspended: 'Suspended', completed: 'Completed', archived: 'Archived' };
export const PARTICIPATION_LABEL: Record<ParticipationStatus, string> = { invited: 'Invited', active: 'Active', suspended: 'Suspended', removed: 'Removed' };
export const METHOD_LABEL: Record<VerificationMethod, string> = { face: 'Face verification (live face matched 1:1)', record: 'Identity record and stated details' };
export const LIVENESS_LABEL: Record<LivenessRequirement, string> = { required: 'Required', optional: 'Optional', 'not-applicable': 'Not applicable' };
export const EXCEPTION_LABEL: Record<ExceptionHandling, string> = { review: 'Require review', unsuccessful: 'Mark unsuccessful', pending: 'Remain pending until resolved' };
export const ELIGIBILITY_LABEL: Record<EligibilityApproach, string> = {
  'local-population': 'Local eligible population', 'external-source': 'External source eligibility', 'reference-list': 'Reference list eligibility', none: 'No predefined population',
};
export const ELIGIBILITY_DESCRIPTION: Record<EligibilityApproach, string> = {
  'local-population': 'Locally registered people, chosen by group or individually.',
  'external-source': 'Eligibility comes from the authorized external lookup response.',
  'reference-list': 'Eligible if their external reference is on the activity’s permitted list.',
  none: 'Identity verification only; nobody needs to be on a list.',
};
export const ASSURANCE_NOT_DEFINED = 'Assurance policy not yet defined.';

export function reverificationLabel(r: ReverificationPolicy): string {
  return r.mode === 'every-time' ? 'Verify every time' : r.mode === 'reuse-within' ? `Accept a previous valid verification within ${r.days} ${r.days === 1 ? 'day' : 'days'}` : 'Fresh verification when the activity requires it';
}

export const DEFAULT_DECISION_RULES: DecisionRules = { onInconclusiveMatch: 'pending-review', onServiceUnavailable: 'unable-to-decide' };

export function defaultSettings(): VerificationSettings {
  return {
    identitySource: { kind: 'local' }, method: 'face', liveness: 'required', reverification: { mode: 'every-time' }, exceptions: 'unsuccessful',
    eligibility: { approach: 'local-population' }, decisionRules: DEFAULT_DECISION_RULES,
  };
}

export function defaultProgrammeRequirements(): ProgrammeRequirements {
  return {
    identitySource: { kind: 'local' }, method: 'face', liveness: 'required', reverification: { mode: 'every-time' }, exceptions: 'review',
    escalateToProgramme: false, eligibilityRequired: true, allowedEligibility: ['local-population', 'external-source', 'reference-list'],
  };
}

/* ---------------- Strictness and inheritance ---------------- */

const LIVENESS_RANK: Record<LivenessRequirement, number> = { 'not-applicable': 0, optional: 1, required: 2 };
const METHOD_RANK: Record<VerificationMethod, number> = { record: 0, face: 1 };
/** Smaller is stricter. */
const reuseWindow = (r: ReverificationPolicy) => (r.mode === 'every-time' ? 0 : r.mode === 'reuse-within' ? r.days : 0);

/** The settings that actually apply: the programme's minimum, made stricter by the activity where it chose to. */
export function effectiveSettings(activity: VerificationSettings, programme?: ProgrammeRequirements): VerificationSettings {
  if (!programme) return activity;
  const method = METHOD_RANK[activity.method] >= METHOD_RANK[programme.method] ? activity.method : programme.method;
  // The stricter of the two; face verification always has a liveness setting.
  const liveness: LivenessRequirement = method === 'record' ? 'not-applicable'
    : ([activity.liveness, programme.liveness].filter((l) => l !== 'not-applicable').sort((x, y) => LIVENESS_RANK[y] - LIVENESS_RANK[x])[0] ?? 'required');
  const reverification = reuseWindow(activity.reverification) <= reuseWindow(programme.reverification) ? activity.reverification : programme.reverification;
  const approach = programme.allowedEligibility.includes(activity.eligibility.approach) && !(programme.eligibilityRequired && activity.eligibility.approach === 'none')
    ? activity.eligibility.approach : programme.allowedEligibility.find((a) => a !== 'none') ?? 'local-population';
  return {
    ...activity,
    identitySource: programme.identitySource,
    method, liveness, reverification,
    exceptions: programme.exceptions,
    eligibility: { ...activity.eligibility, approach },
  };
}

/**
 * Why an activity's chosen settings would weaken a programme's mandatory requirements, one line each.
 * Participating organizations can only keep or tighten them.
 */
export function weakeningProblems(activity: VerificationSettings, programme: ProgrammeRequirements): string[] {
  const p: string[] = [];
  const src = programme.identitySource;
  const a = activity.identitySource;
  if (src.kind !== a.kind || (src.kind === 'external' && a.kind === 'external' && src.integrationId !== a.integrationId)) p.push('The identity source is set by the programme and can’t be replaced.');
  if (METHOD_RANK[activity.method] < METHOD_RANK[programme.method]) p.push('The programme requires face verification.');
  if (programme.liveness === 'required' && activity.liveness !== 'required') p.push('Liveness is required by the programme and can’t be disabled.');
  if (reuseWindow(activity.reverification) > reuseWindow(programme.reverification)) p.push('The programme’s reverification rule can’t be relaxed.');
  if (activity.exceptions !== programme.exceptions) p.push('Exception handling is set by the programme.');
  if (!programme.allowedEligibility.includes(activity.eligibility.approach)) p.push(`The programme doesn’t allow ${ELIGIBILITY_LABEL[activity.eligibility.approach].toLowerCase()}.`);
  else if (programme.eligibilityRequired && activity.eligibility.approach === 'none') p.push('The programme requires eligibility to be determined.');
  return p;
}

/** Problems with settings on their own (independent activities, and programme requirements). */
export function settingsProblems(s: Pick<VerificationSettings, 'identitySource' | 'method' | 'liveness' | 'reverification'> & { eligibility?: VerificationSettings['eligibility'] }): string[] {
  const p: string[] = [];
  if (s.method === 'record' && s.liveness !== 'not-applicable') p.push('Liveness only applies to face verification.');
  if (s.method === 'face' && s.liveness === 'not-applicable') p.push('Choose whether liveness is required or optional for face verification.');
  if (s.reverification.mode === 'reuse-within' && (!Number.isInteger(s.reverification.days) || s.reverification.days < 1 || s.reverification.days > 365)) p.push('Choose a reuse period between 1 and 365 days.');
  if ((s.eligibility?.approach === 'external-source' || s.eligibility?.approach === 'reference-list') && s.identitySource.kind !== 'external') p.push('External source and reference list eligibility need an external identity service.');
  if (s.eligibility?.approach === 'reference-list') {
    const list = s.eligibility.referenceList ?? [];
    if (!list.length) p.push('Add at least one external reference to the eligibility list.');
    else if (list.some((r) => !/^[A-Za-z0-9-]{2,40}$/.test(r))) p.push('References use letters, numbers and hyphens (up to 40 characters).');
  }
  return p;
}

/** Capabilities an identity source needs for a method. */
export const capabilitiesFor = (method: VerificationMethod) => (method === 'face' ? (['lookup', 'matching'] as const) : (['lookup'] as const));

/* ---------------- Decision model (configuration for Prompt 4's execution) ---------------- */

export type IdentityMatchResult = 'match' | 'no-match' | 'inconclusive' | 'unavailable';
export type EligibilityResult = 'eligible' | 'ineligible' | 'unknown' | 'not-required';
export type ActivityDecision = 'allow' | 'deny' | 'pending-review' | 'unable-to-decide';

/**
 * The activity decision from the two separate results. Allow only when identity matches and eligibility is
 * confirmed (or not required); a match never implies eligibility, and eligibility never implies a match.
 */
export function decide(match: IdentityMatchResult, eligibility: EligibilityResult, s: Pick<VerificationSettings, 'decisionRules' | 'exceptions'>): ActivityDecision {
  if (match === 'unavailable') return s.decisionRules.onServiceUnavailable;
  if (match === 'inconclusive') return s.decisionRules.onInconclusiveMatch;
  if (match === 'no-match') return s.exceptions === 'unsuccessful' ? 'deny' : 'pending-review';
  if (eligibility === 'eligible' || eligibility === 'not-required') return 'allow';
  if (eligibility === 'unknown') return 'pending-review';
  return s.exceptions === 'unsuccessful' ? 'deny' : 'pending-review';
}
