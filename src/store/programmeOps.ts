import type { CustomIntegration } from '@/domain/integrations';
import {
  capabilitiesFor, defaultSettings, effectiveSettings, settingsProblems, weakeningProblems,
  type ParticipationStatus, type ProgrammeRequirements, type ProgrammeStatus, type VerificationProgramme, type VerificationSettings,
} from '@/domain/programmes';
import type { ActivityConfig, ActivityVersion, AuditEvent, Organization, StandardRequirements } from '@/domain/types';
import { buildChecks } from '@/domain/verification';
import { actorPermissions } from './adminOps';
import { integrationFor } from './integrationOps';
import { subRelationships } from './orgOps';
import type { AppState } from './state';

/**
 * Programme governance. Programme enrollment grants only programme capabilities: a participating
 * sub-organization sees the programme's requirements and may use its identity service through
 * programme-linked activities; the owner sees programme-level status and its participants' programme
 * activities, never their other records. Organization relationships alone grant nothing here.
 */

type Result = { ok: true; state: AppState } | { ok: false; error: string };
const DENIED = "You don't have permission to manage verification programmes.";

const all = (state: AppState) => state.data.verificationProgrammes ?? [];

/** How an organization relates to a programme. */
export function participation(p: VerificationProgramme, organizationId: string): 'owner' | ParticipationStatus | null {
  if (p.ownerOrganizationId === organizationId) return 'owner';
  return p.participants.find((x) => x.organizationId === organizationId)?.status ?? null;
}

/** Programmes an organization can see: its own, and those it takes part in (not removed, and not drafts it hasn't been assigned to yet). */
export function programmesVisibleTo(state: AppState, organizationId: string): VerificationProgramme[] {
  return all(state).filter((p) => {
    const r = participation(p, organizationId);
    return r === 'owner' || (r !== null && r !== 'removed' && p.status !== 'draft');
  });
}

export const programmeFor = (state: AppState, organizationId: string, id: string) => programmesVisibleTo(state, organizationId).find((p) => p.id === id);

/** Whether an organization may run activities under a programme now. */
export function canRunUnder(p: VerificationProgramme, organizationId: string): string | null {
  const r = participation(p, organizationId);
  if (p.status !== 'active') return `${p.name} is ${p.status === 'draft' ? 'not active yet' : p.status}, so it can’t be used for new verification operations.`;
  if (r === 'owner') return p.scope === 'own' ? null : `${p.name} applies to selected sub-organizations, not to its owner’s own activities.`;
  if (r !== 'active') return `${r === 'suspended' ? 'Your organization’s participation is suspended' : 'Your organization doesn’t take part'} in ${p.name}.`;
  return null;
}

/** Programmes an organization can link new activities to. */
export const linkableProgrammes = (state: AppState, organizationId: string) => all(state).filter((p) => canRunUnder(p, organizationId) === null);

/**
 * The integration an organization may use for an identity source: its own, or the owner's integration of a
 * programme it actively takes part in (operational metadata only, never configuration or credentials).
 */
export function accessibleIntegration(state: AppState, organizationId: string, integrationId: string, programme?: VerificationProgramme): CustomIntegration | undefined {
  const own = integrationFor(state, organizationId, integrationId);
  if (own) return own;
  if (!programme || programme.requirements.identitySource.kind !== 'external' || programme.requirements.identitySource.integrationId !== integrationId) return undefined;
  const r = participation(programme, organizationId);
  if (!r || r === 'removed') return undefined;
  return integrationFor(state, programme.ownerOrganizationId, integrationId);
}

/** Why an external identity source can't be used for a method, or null. */
export function sourceProblem(integration: CustomIntegration | undefined, method: VerificationSettings['method']): string | null {
  if (!integration) return 'The identity service isn’t available to this organization.';
  if (integration.status !== 'active') return `${integration.name} isn’t active, so it can’t be used.`;
  const missing = capabilitiesFor(method).filter((c) => !integration.capabilities.includes(c));
  if (missing.length) return `${integration.name} doesn’t offer ${missing.map((c) => (c === 'lookup' ? 'identity record lookup' : 'biometric matching')).join(' and ')}, which ${method === 'face' ? 'face verification' : 'this method'} needs.`;
  return null;
}

/** Settings for an activity saved before verification settings existed, read from its configuration. */
export function settingsFromVersion(version: Pick<ActivityVersion, 'requirements' | 'checks' | 'outcome'> | undefined): VerificationSettings {
  const base = defaultSettings();
  const r = version?.requirements;
  const method = r?.identity === 'record' ? 'record' : 'face';
  const livenessCheck = version?.checks.find((c) => c.type === 'liveness');
  return {
    ...base, method,
    liveness: method === 'record' ? 'not-applicable' : livenessCheck?.requirement === 'optional' ? 'optional' : 'required',
    exceptions: version?.outcome.onRequiredFailure === 'pending-review' ? 'review' : 'unsuccessful',
    eligibility: { approach: r?.eligibility === 'participants' ? 'local-population' : r?.eligibility === 'external' ? 'external-source' : 'none' },
  };
}

/** Whether an activity's configuration can be expressed by verification settings (credential-based ones can't). */
export const settingsEditable = (version: Pick<ActivityVersion, 'requirements' | 'customized'> | undefined) =>
  !version || (!!version.requirements && !version.customized && !version.requirements.credential && version.requirements.identity !== 'holder');

export interface ActivityPolicy {
  programme?: VerificationProgramme;
  /** The settings the activity chose (or derived from its configuration). */
  own: VerificationSettings;
  /** What applies: programme minimums made stricter by the activity. */
  effective: VerificationSettings;
  /** The external identity service, as metadata, when the source is external. */
  integration?: CustomIntegration;
  integrationOwner?: string;
}

export function activityPolicy(state: AppState, activity: ActivityConfig): ActivityPolicy {
  const version = state.data.activityVersions.find((v) => v.id === (activity.draftVersionId ?? activity.activeVersionId));
  const programme = activity.programmeId ? all(state).find((p) => p.id === activity.programmeId) : undefined;
  const own = activity.verification ?? settingsFromVersion(version);
  const effective = effectiveSettings(own, programme?.requirements);
  const src = effective.identitySource;
  const integration = src.kind === 'external' ? accessibleIntegration(state, activity.organizationId, src.integrationId, programme) : undefined;
  return { programme, own, effective, integration, integrationOwner: integration ? state.data.organizations.find((o) => o.id === integration.organizationId)?.name : undefined };
}

/** Everything wrong with an activity's chosen settings, given its programme. Weakening is always refused. */
export function activityPolicyProblems(state: AppState, organizationId: string, programmeId: string | undefined, settings: VerificationSettings): string[] {
  const programme = programmeId ? all(state).find((p) => p.id === programmeId) : undefined;
  if (programmeId && !programme) return ['This programme doesn’t exist.'];
  if (programme) {
    const r = participation(programme, organizationId);
    if (!r || r === 'removed' || (r === 'owner' && programme.scope !== 'own')) return [`Your organization can’t create activities under ${programme.name}.`];
  }
  const effective = effectiveSettings(settings, programme?.requirements);
  const problems = [...(programme ? weakeningProblems(settings, programme.requirements) : []), ...settingsProblems(effective)];
  const src = effective.identitySource;
  if (src.kind === 'external') {
    const problem = sourceProblem(accessibleIntegration(state, organizationId, src.integrationId, programme), effective.method);
    if (problem) problems.push(problem);
  }
  return [...new Set(problems)];
}

/** Activation blockers that come from the programme and identity source. */
export function activityGovernanceBlockers(state: AppState, activity: ActivityConfig): string[] {
  const policy = activityPolicy(state, activity);
  const blockers: string[] = [];
  if (policy.programme) {
    const p = canRunUnder(policy.programme, activity.organizationId);
    if (p) blockers.push(p);
  }
  if (policy.effective.identitySource.kind === 'external') {
    const problem = sourceProblem(policy.integration, policy.effective.method);
    if (problem) blockers.push(`The mandatory identity service is unavailable: ${problem}`);
  }
  return blockers;
}

/**
 * Why a verification can't be started for an activity now, beyond verifier authorization. Programme-linked
 * activities need an active programme and participation; external verification is executed in a later phase.
 */
export function executionUnavailable(state: AppState, activity: ActivityConfig): string | null {
  const policy = activityPolicy(state, activity);
  if (policy.programme) {
    const p = canRunUnder(policy.programme, activity.organizationId);
    if (p) return p;
  }
  if (policy.effective.identitySource.kind === 'external') return 'Verification through an external identity service isn’t available in this prototype yet. The activity is configured and ready for it.';
  return null;
}

/* ---------------- Programme operations ---------------- */

export interface ProgrammeInput {
  organizationId: string;
  id: string;
  name: string;
  description: string;
  purpose: string;
  scope: 'own' | 'sub-organizations';
  participantIds: string[];
  requirements: ProgrammeRequirements;
  at: string;
}

const canManage = (state: AppState, organizationId: string) => actorPermissions(state, organizationId).has('programmes.manage');

function write(state: AppState, p: VerificationProgramme, e: Pick<AuditEvent, 'action' | 'summary'> & { changes?: AuditEvent['changes'] }, at: string): AppState {
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const event: AuditEvent = {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: p.ownerOrganizationId, actor: state.data.admin.name, actorType: 'admin', result: 'success', occurredAt: at,
    resourceType: 'programme', resourceId: p.id, subject: { id: p.id, name: p.name }, href: `/programmes/${p.id}`, ...e,
  };
  return { ...state, data: { ...state.data, verificationProgrammes: [...all(state).filter((x) => x.id !== p.id), p], audit: [event, ...state.data.audit] } };
}

/** Problems with a programme's configuration; activation needs none. */
export function programmeProblems(state: AppState, input: Pick<ProgrammeInput, 'organizationId' | 'name' | 'scope' | 'participantIds' | 'requirements'> & { id?: string }): string[] {
  const p: string[] = [];
  const name = input.name.trim();
  if (!name) p.push('Enter a programme name.');
  else if (name.length > 80) p.push('Use 80 characters or fewer for the name.');
  else if (all(state).some((x) => x.ownerOrganizationId === input.organizationId && x.id !== input.id && x.name.toLowerCase() === name.toLowerCase())) p.push('A programme with this name already exists.');
  if (input.scope === 'sub-organizations') {
    const subs = new Set(subRelationships(state, input.organizationId).filter((r) => r.status === 'active').map((r) => r.childOrganizationId));
    if (!input.participantIds.length) p.push('Select at least one participating sub-organization.');
    if (input.participantIds.some((id) => !subs.has(id))) p.push('Only your organization’s own sub-organizations can take part.');
  }
  const r = input.requirements;
  p.push(...settingsProblems({ ...r }));
  if (!r.allowedEligibility.length) p.push('Allow at least one eligibility approach.');
  if (r.eligibilityRequired && r.allowedEligibility.every((a) => a === 'none')) p.push('Allow an eligibility approach other than “no predefined population”.');
  if (r.identitySource.kind === 'local' && r.allowedEligibility.some((a) => a === 'external-source' || a === 'reference-list')) {
    p.push('External source and reference list eligibility need an external identity service.');
  }
  if (r.identitySource.kind === 'external') {
    const problem = sourceProblem(integrationFor(state, input.organizationId, r.identitySource.integrationId), r.method);
    if (problem) p.push(problem);
  }
  return [...new Set(p)];
}

/** Creates (Draft) or updates a programme. Participants are added as Invited until the programme is active. */
export function applySaveProgramme(state: AppState, input: ProgrammeInput): { ok: true; state: AppState } | { ok: false; error: string; problems?: string[] } {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const existing = all(state).find((p) => p.id === input.id);
  if (existing && existing.ownerOrganizationId !== input.organizationId) return { ok: false, error: 'Only the owning organization can change this programme.' };
  if (existing && (existing.status === 'completed' || existing.status === 'archived')) return { ok: false, error: `A ${existing.status} programme can’t be changed.` };
  // Saving a draft only needs a name; activation needs everything valid. Participants must always be the owner's sub-organizations.
  const problems = programmeProblems(state, input);
  const blocking = problems.filter((x) => /name|own sub-organizations/.test(x) && !/Select at least/.test(x));
  if (blocking.length) return { ok: false, error: blocking[0], problems };
  const by = state.data.admin.name;
  const wanted = input.scope === 'sub-organizations' ? input.participantIds : [];
  const active = existing?.status === 'active';
  const participants = [
    ...(existing?.participants ?? []).map((x) => (wanted.includes(x.organizationId) ? (x.status === 'removed' ? { ...x, status: (active ? 'active' : 'invited') as ParticipationStatus, updatedAt: input.at } : x)
      : x.status === 'removed' ? x : { ...x, status: 'removed' as const, updatedAt: input.at })),
    ...wanted.filter((id) => !existing?.participants.some((x) => x.organizationId === id)).map((organizationId) => ({ organizationId, status: (active ? 'active' : 'invited') as ParticipationStatus, addedAt: input.at, addedBy: by })),
  ];
  const programme: VerificationProgramme = {
    id: input.id, ownerOrganizationId: input.organizationId, name: input.name.trim(), description: input.description.trim(), purpose: input.purpose.trim(),
    status: existing?.status ?? 'draft', scope: input.scope, participants, requirements: input.requirements,
    createdAt: existing?.createdAt ?? input.at, createdBy: existing?.createdBy ?? by, updatedAt: input.at, updatedBy: by, activatedAt: existing?.activatedAt,
  };
  if (active) {
    const p = programmeProblems(state, input);
    if (p.length) return { ok: false, error: `An active programme must stay valid: ${p[0]}`, problems: p };
  }
  return {
    ok: true,
    state: write(state, programme, existing
      ? { action: 'programme.updated', summary: `${by} updated the programme ${programme.name}${active ? '. Requirements apply to its activities immediately.' : '.'}` }
      : { action: 'programme.created', summary: `${by} created the programme ${programme.name} (Draft).` }, input.at),
  };
}

const TRANSITIONS: Record<'activate' | 'suspend' | 'resume' | 'complete' | 'archive', { from: ProgrammeStatus[]; to: ProgrammeStatus; verb: string }> = {
  activate: { from: ['draft'], to: 'active', verb: 'activated' },
  suspend: { from: ['active'], to: 'suspended', verb: 'suspended' },
  resume: { from: ['suspended'], to: 'active', verb: 'resumed' },
  complete: { from: ['active', 'suspended'], to: 'completed', verb: 'completed' },
  archive: { from: ['completed'], to: 'archived', verb: 'archived' },
};

/** Lifecycle changes. Nothing is deleted: activities and verification history stay as recorded. */
export function applyProgrammeTransition(state: AppState, input: { organizationId: string; programmeId: string; transition: keyof typeof TRANSITIONS; at: string }): { ok: true; state: AppState } | { ok: false; error: string; problems?: string[] } {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const p = all(state).find((x) => x.id === input.programmeId && x.ownerOrganizationId === input.organizationId);
  if (!p) return { ok: false, error: 'Only the owning organization can change this programme.' };
  const t = TRANSITIONS[input.transition];
  if (!t.from.includes(p.status)) return { ok: false, error: `A ${p.status} programme can’t be ${t.verb}.` };
  if (t.to === 'active') {
    const problems = programmeProblems(state, { ...p, organizationId: p.ownerOrganizationId, participantIds: p.participants.filter((x) => x.status !== 'removed').map((x) => x.organizationId) });
    if (problems.length) return { ok: false, error: problems[0], problems };
  }
  const participants = input.transition === 'activate' ? p.participants.map((x) => (x.status === 'invited' ? { ...x, status: 'active' as const, updatedAt: input.at } : x)) : p.participants;
  const next: VerificationProgramme = { ...p, status: t.to, participants, updatedAt: input.at, updatedBy: state.data.admin.name, ...(t.to === 'active' && !p.activatedAt ? { activatedAt: input.at } : {}) };
  return { ok: true, state: write(state, next, { action: `programme.${t.verb}` as AuditEvent['action'], summary: `${state.data.admin.name} ${t.verb} the programme ${p.name}.`, changes: [{ field: 'Status', from: p.status, to: t.to }] }, input.at) };
}

/** Suspends, reactivates or removes one participating organization. Its records and history are untouched. */
export function applyParticipantStatus(state: AppState, input: { organizationId: string; programmeId: string; participantId: string; status: 'active' | 'suspended' | 'removed'; at: string }): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const p = all(state).find((x) => x.id === input.programmeId && x.ownerOrganizationId === input.organizationId);
  const part = p?.participants.find((x) => x.organizationId === input.participantId);
  if (!p || !part) return { ok: false, error: 'This organization doesn’t take part in the programme.' };
  if (part.status === 'removed') return { ok: false, error: 'A removed organization can be added again by editing the programme.' };
  const status = input.status === 'active' && p.status === 'draft' ? 'invited' : input.status;
  const name = state.data.organizations.find((o) => o.id === input.participantId)?.name ?? input.participantId;
  const next: VerificationProgramme = { ...p, participants: p.participants.map((x) => (x === part ? { ...x, status, updatedAt: input.at } : x)), updatedAt: input.at };
  return { ok: true, state: write(state, next, { action: 'programme.participant-changed', summary: `${state.data.admin.name} set ${name}’s participation in ${p.name} to ${status}.`, changes: [{ field: 'Participation', from: part.status, to: status }] }, input.at) };
}

/** Programme-linked activities an organization may see: all of them for the owner, its own for a participant. */
export function programmeActivities(state: AppState, organizationId: string, programme: VerificationProgramme): ActivityConfig[] {
  const owner = programme.ownerOrganizationId === organizationId;
  return state.data.activityConfigs.filter((a) => a.programmeId === programme.id && (owner || a.organizationId === organizationId));
}

/** Programmes and activities that use an integration (shown when deactivating it). */
export function integrationUsage(state: AppState, organizationId: string, integrationId: string): string[] {
  const programmes = all(state).filter((p) => p.ownerOrganizationId === organizationId && p.requirements.identitySource.kind === 'external' && p.requirements.identitySource.integrationId === integrationId && p.status !== 'archived');
  const activities = state.data.activityConfigs.filter((a) => a.organizationId === organizationId && a.verification?.identitySource.kind === 'external' && a.verification.identitySource.integrationId === integrationId);
  return [...programmes.map((p) => `programme ${p.name}`), ...activities.map((a) => `activity ${a.name}`)];
}

export { effectiveSettings };

/**
 * The check configuration an activity version runs with, generated from effective settings. Local
 * execution keeps using these checks unchanged; external sources record the same requirements for the
 * external verification flow added later.
 */
export function configFromSettings(s: VerificationSettings, org: Organization, makeId: () => string, identifierConfigId?: string): Pick<ActivityVersion, 'type' | 'checks' | 'outcome' | 'requirements' | 'customized'> {
  const requirements: StandardRequirements = {
    identity: s.method, credential: null,
    // External eligibility (lookup response or reference list) is determined by the external flow, not local checks.
    eligibility: s.identitySource.kind === 'local' && s.eligibility.approach === 'local-population' ? 'participants' : null,
  };
  const built = buildChecks(requirements, org, makeId, identifierConfigId);
  const checks = built.checks.map((c) => (c.type === 'liveness' && s.liveness === 'optional' ? { ...c, requirement: 'optional' as const } : c));
  const review = s.exceptions !== 'unsuccessful';
  return {
    requirements, customized: false, type: built.type, checks,
    outcome: { onRequiredFailure: review ? 'pending-review' : 'not-verified', onInconclusive: review || s.decisionRules.onInconclusiveMatch === 'pending-review' ? 'pending-review' : 'unable-to-verify' },
  };
}
