import type { CustomIntegration } from '@/domain/integrations';
import {
  capabilitiesFor, defaultSettings, settingsProblems,
  type ActivityAudience, type ActivityParticipant, type ParticipationStatus, type VerificationSettings,
} from '@/domain/activitySettings';
import type { ActivityConfig, ActivityVersion, AuditEvent, Organization, StandardRequirements, VerifierAssignment } from '@/domain/types';
import { activeAssignments, buildChecks, eligibleVerifiers } from '@/domain/verification';
import { actorPermissions } from './adminOps';
import { integrationFor } from './integrationOps';
import type { AppState } from './state';

/**
 * Verification Activities and sharing. An activity is either for its owner's own use or shared with other
 * organizations. A shared activity is one record, owned and configured by one organization. Participating
 * organizations run that same activity from their own workspaces, with their own staff: they can assign
 * their staff to it, but can't change its requirements. Their transactions stay in their own workspace;
 * the owner sees only the transactions and exceptions of its shared activity, never anything else.
 */

type Result = { ok: true; state: AppState } | { ok: false; error: string };

/** Who an activity is for. */
export const audienceOf = (a: Pick<ActivityConfig, 'sharing'>): ActivityAudience => (a.sharing ? 'shared' : 'own');

/** How an organization relates to an activity. */
export function participation(activity: Pick<ActivityConfig, 'organizationId' | 'sharing'>, organizationId: string): 'owner' | ParticipationStatus | null {
  if (activity.organizationId === organizationId) return 'owner';
  return activity.sharing?.participants.find((p) => p.organizationId === organizationId)?.status ?? null;
}

/** Shared activities another organization owns that this organization has been invited to or takes part in. */
export function sharedWith(state: AppState, organizationId: string): ActivityConfig[] {
  return state.data.activityConfigs.filter((a) => a.organizationId !== organizationId && a.status !== 'draft' && ['invited', 'active', 'suspended'].includes(participation(a, organizationId) ?? ''));
}

/**
 * Activities an organization may open: its own, and shared activities it was invited to or takes part in.
 * Unrelated organizations' activities are never returned.
 */
export function activityFor(state: AppState, organizationId: string, activityId: string): ActivityConfig | undefined {
  const a = state.data.activityConfigs.find((x) => x.id === activityId);
  if (!a) return undefined;
  return a.organizationId === organizationId || sharedWith(state, organizationId).some((x) => x.id === a.id) ? a : undefined;
}

/** Why an organization can't run an activity now, or null. */
export function cannotRun(activity: ActivityConfig, organizationId: string): string | null {
  const r = participation(activity, organizationId);
  if (r === 'owner' || r === 'active') return null;
  if (r === 'invited') return 'Accept the invitation to this shared activity before verifying.';
  if (r === 'suspended') return 'Your organization’s participation in this shared activity is suspended.';
  return 'Your organization doesn’t take part in this activity.';
}

/** Why an external identity source can't be used for a method, or null. */
export function sourceProblem(integration: CustomIntegration | undefined, method: VerificationSettings['method']): string | null {
  if (!integration) return 'The identity source isn’t available to this organization.';
  if (integration.status !== 'active') return `${integration.name} isn’t active, so it can’t be used.`;
  const missing = capabilitiesFor(method).filter((c) => !integration.capabilities.includes(c));
  if (missing.length) return `${integration.name} doesn’t offer ${missing.map((c) => (c === 'lookup' ? 'identity record lookup' : 'face matching')).join(' and ')}, which ${method === 'face' ? 'a face match' : 'this activity'} needs.`;
  return null;
}

/** Identity sources an organization can choose for a new activity: FixID records (own use only) and its usable connected sources. */
export function availableSources(state: AppState, organizationId: string, audience: ActivityAudience): { id: string; label: string; detail: string; source: VerificationSettings['identitySource']; capabilities: string[] }[] {
  const external = (state.data.customIntegrations ?? [])
    .filter((i) => i.organizationId === organizationId && i.status === 'active' && i.capabilities.includes('lookup'))
    .map((i) => ({
      id: i.id, label: i.name,
      detail: `Connected identity source${i.connection.target === 'simulated' ? ' (simulated)' : ''}${i.capabilities.includes('matching') ? '' : ' · record lookup only'}`,
      source: { kind: 'external' as const, integrationId: i.id }, capabilities: i.capabilities,
    }));
  // A shared activity checks people against a connected source, so participants never see the owner's own records.
  const local = audience === 'own' ? [{ id: 'local', label: 'FixID records', detail: 'People registered in your organization', source: { kind: 'local' as const }, capabilities: ['lookup', 'matching'] }] : [];
  return [...local, ...external];
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
  /** The activity's settings: what applies to everyone who runs it. */
  effective: VerificationSettings;
  /** The external identity source, as metadata, when the source is external. */
  integration?: CustomIntegration;
  integrationOwner?: string;
}

/** The settings an activity runs with. A shared activity always uses its owner's identity source. */
export function activityPolicy(state: AppState, activity: ActivityConfig): ActivityPolicy {
  const version = state.data.activityVersions.find((v) => v.id === (activity.draftVersionId ?? activity.activeVersionId));
  const effective = activity.verification ?? settingsFromVersion(version);
  const src = effective.identitySource;
  const integration = src.kind === 'external' ? integrationFor(state, activity.organizationId, src.integrationId) : undefined;
  return { effective, integration, integrationOwner: integration ? state.data.organizations.find((o) => o.id === integration.organizationId)?.name : undefined };
}

/** Everything wrong with an activity's settings. */
export function activityPolicyProblems(state: AppState, organizationId: string, settings: VerificationSettings, audience: ActivityAudience = 'own'): string[] {
  const problems = [...settingsProblems(settings)];
  const src = settings.identitySource;
  if (audience === 'shared' && src.kind === 'local') problems.push('A shared activity needs a connected identity source, so participating organizations never see your organization’s own records.');
  if (src.kind === 'external') {
    const problem = sourceProblem(integrationFor(state, organizationId, src.integrationId), settings.method);
    if (problem) problems.push(problem);
  }
  return [...new Set(problems)];
}

/** Activation blockers that come from the identity source. */
export function activityGovernanceBlockers(state: AppState, activity: ActivityConfig): string[] {
  const policy = activityPolicy(state, activity);
  if (policy.effective.identitySource.kind !== 'external') return [];
  const problem = sourceProblem(policy.integration, policy.effective.method);
  return problem ? [`The identity source is unavailable: ${problem}`] : [];
}

/**
 * Why a verification can't be started for an activity now, beyond verifier authorization: participation in
 * a shared activity, and a usable identity source.
 */
export function executionUnavailable(state: AppState, activity: ActivityConfig, organizationId = activity.organizationId): string | null {
  const notParticipating = cannotRun(activity, organizationId);
  if (notParticipating) return notParticipating;
  const policy = activityPolicy(state, activity);
  if (policy.effective.identitySource.kind === 'external') {
    const problem = sourceProblem(policy.integration, policy.effective.method);
    if (problem) return `The identity source can’t be used right now: ${problem}`;
    // Real external services are only reachable through a secure FixID backend, which this prototype doesn't have.
    if (policy.integration!.connection.target !== 'simulated') return `${policy.integration!.name} can’t be reached from this prototype: real external requests are disabled. Verification can’t start.`;
  }
  return null;
}

/** Activities that use an integration (shown when deactivating it). */
export function integrationUsage(state: AppState, organizationId: string, integrationId: string): string[] {
  return state.data.activityConfigs
    .filter((a) => a.organizationId === organizationId && a.verification?.identitySource.kind === 'external' && a.verification.identitySource.integrationId === integrationId)
    .map((a) => `activity ${a.name}`);
}

/**
 * The check configuration an activity version runs with, generated from its settings. Local execution uses
 * these checks; external sources record the same requirements for the external verification flow.
 */
export function configFromSettings(s: VerificationSettings, org: Organization, makeId: () => string, identifierConfigId?: string): Pick<ActivityVersion, 'type' | 'checks' | 'outcome' | 'requirements' | 'customized'> {
  const requirements: StandardRequirements = {
    identity: s.method, credential: null,
    // External eligibility (the source's record status) is determined by the external flow, not local checks.
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

/* ---------------- Participation ---------------- */

/** Organizations an owner can invite: every other active organization on FixID (names only). */
export function invitableOrganizations(state: AppState, organizationId: string): Pick<Organization, 'id' | 'name'>[] {
  return state.data.organizations.filter((o) => o.id !== organizationId && o.status !== 'inactive').map((o) => ({ id: o.id, name: o.name }));
}

/** Problems with the organizations chosen for a shared activity. */
export function participantProblems(state: AppState, organizationId: string, ids: string[]): string[] {
  if (!ids.length) return ['Choose at least one organization to take part.'];
  const allowed = new Set(invitableOrganizations(state, organizationId).map((o) => o.id));
  return ids.some((id) => !allowed.has(id)) ? ['Only other active organizations on FixID can take part.'] : [];
}

/**
 * The participant list after the owner's choice: new organizations are invited; removed ones are marked
 * Removed (their history stays); an organization that declined or was removed and is chosen again is re-invited.
 */
export function nextParticipants(existing: ActivityParticipant[] | undefined, wanted: string[], at: string, by: string): ActivityParticipant[] {
  const list = (existing ?? []).map((p) => {
    if (wanted.includes(p.organizationId)) return p.status === 'removed' || p.status === 'declined' ? { ...p, status: 'invited' as const, updatedAt: at, updatedBy: by } : p;
    return p.status === 'removed' ? p : { ...p, status: 'removed' as const, updatedAt: at, updatedBy: by };
  });
  const added = wanted.filter((id) => !list.some((p) => p.organizationId === id)).map((organizationId) => ({ organizationId, status: 'invited' as const, invitedAt: at, invitedBy: by }));
  return [...list, ...added];
}

function audit(state: AppState, organizationId: string, activity: ActivityConfig, e: Pick<AuditEvent, 'action' | 'summary'> & Partial<AuditEvent>, at: string): AuditEvent {
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  return {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId, actor: state.data.admin.name, actorType: 'admin', result: 'success', occurredAt: at,
    resourceType: 'verification-activity', resourceId: activity.id, subject: { id: activity.id, name: activity.name }, href: `/verification-activities/${activity.id}`, ...e,
  };
}

const replaceActivity = (state: AppState, next: ActivityConfig, events: AuditEvent[]): AppState =>
  ({ ...state, data: { ...state.data, activityConfigs: state.data.activityConfigs.map((a) => (a.id === next.id ? next : a)), audit: [...events, ...state.data.audit] } });

/** A participating organization accepts or declines an invitation. Recorded in both organizations' audit logs. */
export function applyRespondToInvitation(state: AppState, input: { organizationId: string; activityId: string; accept: boolean; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('verification.activities.edit')) return { ok: false, error: "You don't have permission to do this." };
  const activity = state.data.activityConfigs.find((a) => a.id === input.activityId);
  const part = activity?.sharing?.participants.find((p) => p.organizationId === input.organizationId);
  if (!activity || !part || part.status !== 'invited') return { ok: false, error: 'There’s no open invitation for this activity.' };
  const status: ParticipationStatus = input.accept ? 'active' : 'declined';
  const next: ActivityConfig = { ...activity, sharing: { participants: activity.sharing!.participants.map((p) => (p === part ? { ...p, status, updatedAt: input.at, updatedBy: state.data.admin.name } : p)) } };
  const org = state.data.organizations.find((o) => o.id === input.organizationId)?.name ?? 'An organization';
  const action = input.accept ? 'verification-activity.invitation-accepted' as const : 'verification-activity.invitation-declined' as const;
  const verb = input.accept ? 'accepted' : 'declined';
  const mine = audit(state, input.organizationId, activity, { action, summary: `${state.data.admin.name} ${verb} the invitation to take part in ${activity.name}.`, targetOrganizationId: activity.organizationId }, input.at);
  const owners = { ...mine, id: `AUD-${String(Number(mine.id.replace(/\D/g, '')) + 1).padStart(5, '0')}`, organizationId: activity.organizationId, actorOrganizationId: input.organizationId, summary: `${org} ${verb} the invitation to take part in ${activity.name}.` };
  return { ok: true, state: replaceActivity(state, next, [owners, mine]) };
}

/** The owner suspends, reactivates or removes a participating organization. Its records and history are untouched. */
export function applyParticipantStatus(state: AppState, input: { organizationId: string; activityId: string; participantId: string; status: 'active' | 'suspended' | 'removed'; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('verification.activities.edit')) return { ok: false, error: "You don't have permission to do this." };
  const activity = state.data.activityConfigs.find((a) => a.id === input.activityId && a.organizationId === input.organizationId);
  const part = activity?.sharing?.participants.find((p) => p.organizationId === input.participantId);
  if (!activity || !part) return { ok: false, error: 'This organization doesn’t take part in the activity.' };
  if (part.status === 'removed' || part.status === 'declined') return { ok: false, error: 'Invite the organization again by editing the activity.' };
  if (input.status === 'active' && part.status === 'invited') return { ok: false, error: 'The organization hasn’t accepted the invitation yet.' };
  const name = state.data.organizations.find((o) => o.id === input.participantId)?.name ?? input.participantId;
  const next: ActivityConfig = { ...activity, sharing: { participants: activity.sharing!.participants.map((p) => (p === part ? { ...p, status: input.status, updatedAt: input.at, updatedBy: state.data.admin.name } : p)) } };
  return { ok: true, state: replaceActivity(state, next, [audit(state, input.organizationId, activity, { action: 'verification-activity.participant-changed', summary: `${state.data.admin.name} set ${name}’s participation in ${activity.name} to ${input.status}.`, changes: [{ field: 'Participation', from: part.status, to: input.status }] }, input.at)]) };
}

/**
 * A participating organization chooses which of its own staff verify for a shared activity. Only its own
 * active staff who can perform verifications can be assigned, and only while it takes part.
 */
export function applyAssignSharedVerifiers(state: AppState, input: { organizationId: string; activityId: string; verifierIds: string[]; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('verification.verifiers.assign')) return { ok: false, error: "You don't have permission to assign verifiers." };
  const activity = state.data.activityConfigs.find((a) => a.id === input.activityId);
  if (!activity || activity.organizationId === input.organizationId) return { ok: false, error: 'This shared activity wasn’t found.' };
  const r = participation(activity, input.organizationId);
  if (r !== 'active') return { ok: false, error: cannotRun(activity, input.organizationId) ?? 'Your organization doesn’t take part in this activity.' };
  const eligible = new Set(eligibleVerifiers(state.data, input.organizationId).map((a) => a.id));
  const want = [...new Set(input.verifierIds)];
  if (want.some((id) => !eligible.has(id))) return { ok: false, error: 'Only your organization’s active staff who can perform verifications can be assigned.' };
  const current = activeAssignments(state.data, input.organizationId, activity.id).map((v) => v.administratorId);
  const add = want.filter((id) => !current.includes(id));
  const remove = current.filter((id) => !want.includes(id));
  if (!add.length && !remove.length) return { ok: true, state };
  const by = state.data.admin.name;
  const list: VerifierAssignment[] = [
    ...state.data.verifierAssignments.map((v) => (v.organizationId === input.organizationId && v.activityId === activity.id && v.status === 'active' && remove.includes(v.administratorId) ? { ...v, status: 'removed' as const, removedAt: input.at, removedBy: by } : v)),
    ...add.map((administratorId) => ({ organizationId: input.organizationId, activityId: activity.id, administratorId, status: 'active' as const, assignedAt: input.at, assignedBy: by })),
  ];
  const name = (id: string) => { const a = state.data.administrators.find((x) => x.id === id); return a?.name ?? a?.email ?? 'an administrator'; };
  const event = audit(state, input.organizationId, activity, {
    action: add.length ? 'verification-activity.verifier-assigned' : 'verification-activity.verifier-removed',
    summary: `${by} changed who verifies for the shared activity ${activity.name}${add.length ? `: added ${add.map(name).join(', ')}` : ''}${remove.length ? `${add.length ? ';' : ':'} removed ${remove.map(name).join(', ')}` : ''}.`,
  }, input.at);
  return { ok: true, state: { ...state, data: { ...state.data, verifierAssignments: list, audit: [event, ...state.data.audit] } } };
}
