/**
 * Verification Activity settings and sharing.
 *
 * A Verification Activity is the one concept: an organization creates it either for its own use, or as a
 * shared activity that other organizations take part in. A shared activity is a single record owned by
 * one organization; participating organizations run that same activity from their own workspaces (with
 * their own staff) and can't change its requirements. Nobody gets access to another organization's
 * workspace through a shared activity.
 */

/** A participating organization's status in a shared activity. Invited until it accepts. */
export type ParticipationStatus = 'invited' | 'active' | 'declined' | 'suspended' | 'removed';

/** Where the reference identity is held (and, for external, which organization's integration is used). */
export type IdentitySource = { kind: 'local' } | { kind: 'external'; integrationId: string };

/** How a person proves who they are. `face` = live face matched 1:1; `record` = record found plus stated details (the existing, lower-assurance alternative). */
export type VerificationMethod = 'face' | 'record';
export type LivenessRequirement = 'required' | 'optional' | 'not-applicable';
export type ReverificationPolicy = { mode: 'every-time' } | { mode: 'reuse-within'; days: number } | { mode: 'activity-defined' };
/** What happens to a failed, disputed or inconclusive verification. Never a final access decision on its own. */
export type ExceptionHandling = 'review' | 'unsuccessful' | 'pending';
/**
 * How eligibility is determined, separately from identity. Not chosen in the activity editor: it follows
 * from the identity source (an external source's record status; FixID records: anyone registered, unless
 * the activity limits who may be verified). Kept so earlier activities keep their behaviour.
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

/** The settings an activity is verified with, stored on the activity. A shared activity's settings apply to every participant. */
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

/** A participating organization in a shared activity. */
export interface ActivityParticipant {
  organizationId: string;
  status: ParticipationStatus;
  invitedAt: string;
  invitedBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** Who an activity is for: the owning organization only, or other organizations as well. */
export type ActivityAudience = 'own' | 'shared';

/* ---------------- Labels ---------------- */

export const PARTICIPATION_LABEL: Record<ParticipationStatus, string> = { invited: 'Invited', active: 'Accepted', declined: 'Declined', suspended: 'Suspended', removed: 'Removed' };
export const AUDIENCE_LABEL: Record<ActivityAudience, string> = { own: 'For my organization', shared: 'For other organizations' };
export const METHOD_LABEL: Record<VerificationMethod, string> = { face: 'Identifier and face match', record: 'Identifier and stated details' };
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
    eligibility: { approach: 'none' }, decisionRules: DEFAULT_DECISION_RULES,
  };
}

/** Problems with an activity's settings. */
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
