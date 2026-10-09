import type { Permission } from '@/domain/roles';
import type {
  ActivityCheck, ActivityConfig, ActivityVersion, AuditEvent, OutcomePolicy, StandardRequirements, VerificationType, VerifierAssignment,
} from '@/domain/types';
import {
  CHECKS, OUTCOME_LABEL, TYPE_INFO, activeAssignments, buildChecks, checkById, eligibleVerifiers, providersFor, validateConfiguration, withPlatformPolicies,
  type ValidationContext,
} from '@/domain/verification';
import { actorPermissions } from './adminOps';
import type { AppState } from './state';

/**
 * Verification Activity management. Every change re-checks permissions from state and is recorded in
 * the Audit Log with previous and new values. Rules live in versions: an active version is never edited;
 * changes go into a draft version until it's activated. Production must enforce this on the server.
 */

export interface ActivityForm {
  name: string;
  description: string;
  purpose: string;
  type: VerificationType;
  checks: ActivityCheck[];
  outcome: OutcomePolicy;
  verifierIds: string[];
  /** Standard requirements; when set (and not customized) the store generates the checks from them. */
  requirements?: StandardRequirements;
  customized?: boolean;
  /** Activity-level settings. Left undefined, the current values are kept. */
  location?: string;
  schedule?: ActivityConfig['schedule'];
  participants?: { groupIds: string[]; memberIds: string[] };
  entryPolicy?: ActivityConfig['entryPolicy'];
  restrictVerifiers?: boolean;
}

type Fail = { ok: false; error: string; problems?: string[]; field?: 'name' };
type Result = { ok: true; state: AppState; activityId: string } | Fail;

const NAME_MAX = 80;
const DENIED = "You don't have permission to do this.";

export function validationContext(state: AppState, organizationId: string, participants?: ValidationContext['participants']): ValidationContext {
  const d = state.data;
  return {
    participants,
    organization: d.organizations.find((o) => o.id === organizationId)!,
    groups: d.groups.filter((g) => g.organizationId === organizationId),
    credentialTypes: d.credentialTypes.filter((t) => t.organizationId === organizationId),
    identifierConfigs: d.identifierConfigs.filter((c) => c.organizationId === organizationId),
  };
}

export function nameProblem(state: AppState, organizationId: string, name: string, exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Enter an activity name.';
  if (n.length < 3) return 'Use at least 3 characters.';
  if (n.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  if (state.data.activityConfigs.some((a) => a.organizationId === organizationId && a.id !== exceptId && a.name.trim().toLowerCase() === n.toLowerCase())) {
    return 'An activity with this name already exists.';
  }
  return null;
}

type NewEvent = Pick<AuditEvent, 'action' | 'summary'> & Partial<Pick<AuditEvent, 'changes' | 'related' | 'result'>>;

function withEvents(state: AppState, activity: ActivityConfig, at: string, events: NewEvent[], data: Partial<AppState['data']>): AppState {
  let max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const removed = events.some((e) => e.action === 'verification-activity.removed');
  const records: AuditEvent[] = events.map((e) => ({
    id: `AUD-${String(++max).padStart(5, '0')}`, organizationId: activity.organizationId, occurredAt: at,
    actor: state.data.admin.name, actorType: 'admin', resourceType: 'verification-activity', resourceId: activity.id,
    subject: { id: activity.id, name: activity.name }, result: 'success',
    href: removed ? undefined : `/verification-activities/${activity.id}`, ...e,
  }));
  return { ...state, data: { ...state.data, ...data, audit: [...records.reverse(), ...state.data.audit] } };
}

const checkNames = (cs: ActivityCheck[]) => cs.map((c) => checkById(c.type).name).join(', ') || '—';
const REQ: Record<string, string> = { required: 'Required', optional: 'Optional', alternative: 'Alternative' };

/** Differences between two configurations, grouped the way the Audit Log reports them. */
function configChanges(state: AppState, organizationId: string, before: Pick<ActivityVersion, 'type' | 'checks' | 'outcome'> | undefined, after: Pick<ActivityVersion, 'type' | 'checks' | 'outcome'>) {
  const prev = before ?? { type: after.type, checks: [], outcome: after.outcome };
  const providers = providersFor(state.data.organizations.find((o) => o.id === organizationId)!);
  const pname = (id?: string) => providers.find((p) => p.id === id)?.name ?? '—';
  const byType = (cs: ActivityCheck[]) => new Map(cs.map((c) => [c.type, c]));
  const a = byType(prev.checks);
  const b = byType(after.checks);
  const added = after.checks.filter((c) => !a.has(c.type));
  const removed = prev.checks.filter((c) => !b.has(c.type));
  const rules: { field: string; from: string; to: string }[] = [];
  const providerChanges: { field: string; from: string; to: string }[] = [];
  if (prev.type !== after.type) rules.push({ field: 'Verification type', from: TYPE_INFO[prev.type].name, to: TYPE_INFO[after.type].name });
  for (const c of after.checks) {
    const old = a.get(c.type);
    if (!old) continue;
    const name = checkById(c.type).name;
    if (old.requirement !== c.requirement) rules.push({ field: name, from: REQ[old.requirement], to: REQ[c.requirement] });
    if (JSON.stringify(old.params) !== JSON.stringify(c.params)) rules.push({ field: `${name} settings`, from: describeParams(state, old), to: describeParams(state, c) });
    if (old.providerId !== c.providerId) providerChanges.push({ field: `${name} provider`, from: pname(old.providerId), to: pname(c.providerId) });
    if (old.sourceId !== c.sourceId) providerChanges.push({ field: `${name} source`, from: pname(old.sourceId), to: pname(c.sourceId) });
  }
  if (prev.outcome.onRequiredFailure !== after.outcome.onRequiredFailure) rules.push({ field: 'When a required check fails', from: OUTCOME_LABEL[prev.outcome.onRequiredFailure], to: OUTCOME_LABEL[after.outcome.onRequiredFailure] });
  if (prev.outcome.onInconclusive !== after.outcome.onInconclusive) rules.push({ field: 'When a required check can’t be completed', from: OUTCOME_LABEL[prev.outcome.onInconclusive], to: OUTCOME_LABEL[after.outcome.onInconclusive] });
  return { added, removed, rules, providerChanges, checksBefore: prev.checks, checksAfter: after.checks };
}

export function describeParams(state: AppState, c: ActivityCheck): string {
  const p = c.params;
  const parts: string[] = [];
  if (p.identifierConfigId) parts.push(state.data.identifierConfigs.find((i) => i.id === p.identifierConfigId)?.name ?? 'Identifier');
  if (p.attributes?.length) parts.push(p.attributes.join(', '));
  if (p.credentialTypeIds?.length) parts.push(p.credentialTypeIds.map((id) => state.data.credentialTypes.find((t) => t.id === id)?.name ?? 'Removed credential').join(', '));
  if (p.groupIds?.length) parts.push(p.groupIds.map((id) => state.data.groups.find((g) => g.id === id)?.name ?? 'Removed group').join(', '));
  if (p.attribute) parts.push(`${p.attribute} ${p.operator === 'is-not' ? 'is not' : 'is'} ${p.value ?? ''}`.trim());
  if (p.mode) parts.push(p.mode === 'prevent-duplicate' ? `No repeat within ${p.windowDays ?? 1} day(s)` : `Previous success within ${p.windowDays ?? 30} day(s)`);
  return parts.join('; ') || 'Default';
}

/** The checks to store: generated from standard requirements, or the advanced list with platform policies applied. */
function normalizeChecks(form: ActivityForm, state: AppState, organizationId: string, versionId: string): ActivityCheck[] {
  const org = state.data.organizations.find((o) => o.id === organizationId)!;
  if (form.requirements && !form.customized) {
    let k = 0;
    return buildChecks(form.requirements, org, () => `${versionId}_chk_${++k}`).checks;
  }
  const seen = new Set<string>();
  const known = form.checks.filter((c) => CHECKS.some((d) => d.id === c.type) && !seen.has(c.type) && seen.add(c.type));
  let n = 0;
  return withPlatformPolicies(known, form.type, org, () => `${versionId}_chk_${++n}`);
}

function verifierDiff(state: AppState, organizationId: string, activityId: string, wanted: string[]) {
  const current = activeAssignments(state.data, organizationId, activityId).map((v) => v.administratorId);
  const want = [...new Set(wanted)];
  return { add: want.filter((id) => !current.includes(id)), remove: current.filter((id) => !want.includes(id)) };
}

function applyVerifierDiff(state: AppState, organizationId: string, activityId: string, diff: { add: string[]; remove: string[] }, at: string): VerifierAssignment[] {
  const by = state.data.admin.name;
  let list = state.data.verifierAssignments.map((v) => (v.organizationId === organizationId && v.activityId === activityId && v.status === 'active' && diff.remove.includes(v.administratorId)
    ? { ...v, status: 'removed' as const, removedAt: at, removedBy: by } : v));
  list = [...list, ...diff.add.map((administratorId) => ({ organizationId, activityId, administratorId, status: 'active' as const, assignedAt: at, assignedBy: by }))];
  return list;
}

const adminName = (state: AppState, id: string) => {
  const a = state.data.administrators.find((x) => x.id === id);
  return a?.name ?? a?.email ?? 'Unknown administrator';
};

/** Create an activity (as Draft) or save changes to one. Config changes on an active activity go to a draft version. */
export function applySaveActivity(state: AppState, input: { organizationId: string; activityId?: string; ids: { activityId: string; versionId: string }; form: ActivityForm; at: string }): Result {
  const { organizationId, form, at } = input;
  const perms = actorPermissions(state, organizationId);
  const need = (p: Permission) => perms.has(p);
  const by = state.data.admin.name;
  const existing = input.activityId ? state.data.activityConfigs.find((a) => a.id === input.activityId && a.organizationId === organizationId) : undefined;
  if (input.activityId && !existing) return { ok: false, error: 'This activity no longer exists.' };

  const nameErr = nameProblem(state, organizationId, form.name, existing?.id);
  if (nameErr) return { ok: false, error: nameErr, field: 'name' };
  const eligible = new Set(eligibleVerifiers(state.data, organizationId).map((a) => a.id));
  const diff = verifierDiff(state, organizationId, existing?.id ?? input.ids.activityId, form.verifierIds);
  if (diff.add.some((id) => !eligible.has(id))) return { ok: false, error: 'Only active administrators with the Verifier role can be assigned.' };
  if ((diff.add.length || diff.remove.length) && !need('verification.verifiers.assign')) return { ok: false, error: "You don't have permission to assign verifiers." };

  const details = { name: form.name.trim(), description: form.description.trim(), purpose: form.purpose.trim() };
  const org = state.data.organizations.find((o) => o.id === organizationId)!;
  const type = form.requirements && !form.customized ? buildChecks(form.requirements, org, () => 'x').type : form.type;
  const versionMeta = { requirements: form.requirements, customized: form.requirements ? !!form.customized : undefined };
  const keep = <K extends 'location' | 'schedule' | 'participants' | 'entryPolicy' | 'restrictVerifiers'>(k: K): ActivityConfig[K] => (form[k] !== undefined ? form[k] as ActivityConfig[K] : existing?.[k]);
  const settings = {
    location: keep('location')?.toString().trim() || undefined, schedule: keep('schedule'),
    participants: keep('participants') ?? { groupIds: [], memberIds: [] }, entryPolicy: keep('entryPolicy') ?? 'off', restrictVerifiers: keep('restrictVerifiers') ?? false,
  };
  const groupName = (id: string) => state.data.groups.find((g) => g.id === id)?.name ?? 'Removed group';
  const userName = (id: string) => state.data.members.find((m) => m.id === id)?.displayName ?? 'Removed user';
  const describeParticipants = (p?: { groupIds: string[]; memberIds: string[] }) => {
    if (!p || (!p.groupIds.length && !p.memberIds.length)) return 'None';
    return [p.groupIds.length ? `Groups: ${p.groupIds.map(groupName).join(', ')}` : '', p.memberIds.length ? (p.memberIds.length <= 3 ? `Users: ${p.memberIds.map(userName).join(', ')}` : `${p.memberIds.length} users`) : ''].filter(Boolean).join('; ');
  };
  const describeSchedule = (x?: ActivityConfig['schedule']) => (x?.startsAt || x?.endsAt ? `${x.startsAt ?? '…'} – ${x.endsAt ?? '…'}${x.enforced ? ' (enforced)' : ''}` : 'None');
  const ENTRY: Record<string, string> = { off: 'Allowed', flag: 'Flag for review', deny: 'Refuse' };
  const settingChanges = (prev: Partial<ActivityConfig>) => [
    ...((prev.location ?? '') !== (settings.location ?? '') ? [{ field: 'Location', from: prev.location || '—', to: settings.location || '—' }] : []),
    ...(describeSchedule(prev.schedule) !== describeSchedule(settings.schedule) ? [{ field: 'Schedule', from: describeSchedule(prev.schedule), to: describeSchedule(settings.schedule) }] : []),
    ...((prev.entryPolicy ?? 'off') !== settings.entryPolicy ? [{ field: 'Multiple entries', from: ENTRY[prev.entryPolicy ?? 'off'], to: ENTRY[settings.entryPolicy] }] : []),
    ...(!!prev.restrictVerifiers !== settings.restrictVerifiers ? [{ field: 'Who can verify', from: prev.restrictVerifiers ? 'Assigned verifiers only' : 'Any Verifier in the organization', to: settings.restrictVerifiers ? 'Assigned verifiers only' : 'Any Verifier in the organization' }] : []),
  ];
  const participantsChanged = describeParticipants(existing?.participants) !== describeParticipants(settings.participants)
    || JSON.stringify([...(existing?.participants?.memberIds ?? [])].sort()) !== JSON.stringify([...settings.participants.memberIds].sort());

  if (!existing) {
    if (!need('verification.activities.create')) return { ok: false, error: DENIED };
    if (form.checks.length && !need('verification.rules.manage')) return { ok: false, error: "You don't have permission to configure verification rules." };
    const activity: ActivityConfig = {
      id: input.ids.activityId, organizationId, ...details, ...settings, status: 'draft', draftVersionId: input.ids.versionId,
      createdAt: at, createdBy: by, updatedAt: at, updatedBy: by,
    };
    const version: ActivityVersion = {
      id: input.ids.versionId, organizationId, activityId: activity.id, number: 1, type, ...versionMeta,
      checks: normalizeChecks(form, state, organizationId, input.ids.versionId), outcome: form.outcome,
      status: 'draft', createdAt: at, createdBy: by, updatedAt: at,
    };
    const events: NewEvent[] = [{
      action: 'verification-activity.created', summary: `${by} created the ${activity.name} activity as a draft.`,
      changes: [{ field: 'Checks', from: '—', to: checkNames(version.checks) }, ...settingChanges({}),
        ...(participantsChanged ? [{ field: 'Eligible participants', from: 'None', to: describeParticipants(settings.participants) }] : [])],
    }];
    for (const id of diff.add) events.push({ action: 'verification-activity.verifier-assigned', summary: `${by} assigned ${adminName(state, id)} as a verifier for ${activity.name}.`, related: [{ id, name: adminName(state, id) }] });
    return {
      ok: true, activityId: activity.id,
      state: withEvents(state, activity, at, events, {
        activityConfigs: [...state.data.activityConfigs, activity],
        activityVersions: [...state.data.activityVersions, version],
        verifierAssignments: applyVerifierDiff(state, organizationId, activity.id, diff, at),
      }),
    };
  }

  // Existing activity.
  const draft = existing.draftVersionId ? state.data.activityVersions.find((v) => v.id === existing.draftVersionId) : undefined;
  const active = existing.activeVersionId ? state.data.activityVersions.find((v) => v.id === existing.activeVersionId) : undefined;
  const base = draft ?? active;
  const detailChanges = [
    ...(['name', 'description', 'purpose'] as const)
      .filter((k) => existing[k] !== details[k])
      .map((k) => ({ field: k[0].toUpperCase() + k.slice(1), from: existing[k] || '—', to: details[k] || '—' })),
    ...settingChanges(existing),
  ];
  const versionId = draft?.id ?? input.ids.versionId;
  const nextChecks = normalizeChecks(form, state, organizationId, versionId);
  const cfg = configChanges(state, organizationId, base, { type, checks: nextChecks, outcome: form.outcome });
  const sameChecks = (a: ActivityCheck[] = [], b: ActivityCheck[] = []) => JSON.stringify(a.map(({ id: _, ...c }) => c)) === JSON.stringify(b.map(({ id: _, ...c }) => c));
  const configChanged = !!(cfg.added.length || cfg.removed.length || cfg.rules.length || cfg.providerChanges.length)
    || !sameChecks(base?.checks, nextChecks)
    || (form.requirements !== undefined && JSON.stringify(base?.requirements ?? null) !== JSON.stringify(form.requirements));
  if (detailChanges.length && !need('verification.activities.manage')) return { ok: false, error: DENIED };
  if (participantsChanged && !need('verification.activities.manage')) return { ok: false, error: DENIED };
  if (configChanged && !need('verification.rules.manage')) return { ok: false, error: "You don't have permission to configure verification rules." };
  if (!detailChanges.length && !participantsChanged && !configChanged && !diff.add.length && !diff.remove.length) return { ok: true, state, activityId: existing.id };

  let versions = state.data.activityVersions;
  let draftVersionId = existing.draftVersionId;
  let createdVersion: ActivityVersion | undefined;
  if (configChanged) {
    if (draft) {
      versions = versions.map((v) => (v.id === draft.id ? { ...v, type, ...versionMeta, checks: nextChecks, outcome: form.outcome, updatedAt: at } : v));
    } else {
      const number = Math.max(0, ...versions.filter((v) => v.activityId === existing.id).map((v) => v.number)) + 1;
      createdVersion = {
        id: input.ids.versionId, organizationId, activityId: existing.id, number, type, ...versionMeta, checks: nextChecks, outcome: form.outcome,
        status: 'draft', createdAt: at, createdBy: by, updatedAt: at,
      };
      versions = [...versions, createdVersion];
      draftVersionId = createdVersion.id;
    }
  }
  const next: ActivityConfig = { ...existing, ...details, ...settings, draftVersionId, updatedAt: at, updatedBy: by };
  const label = next.name;
  const into = existing.status !== 'draft' && configChanged
    ? ` (saved as draft version ${createdVersion?.number ?? draft?.number}; version ${active?.number} stays in use until it’s activated)` : '';
  const events: NewEvent[] = [];
  if (detailChanges.length) events.push({ action: 'verification-activity.updated', summary: `${by} updated the details of ${label}.`, changes: detailChanges });
  if (participantsChanged) {
    events.push({
      action: 'verification-activity.participants-changed', summary: `${by} changed the eligible participants for ${label}.`,
      changes: [{ field: 'Eligible participants', from: describeParticipants(existing.participants), to: describeParticipants(settings.participants) }],
    });
  }
  if (cfg.added.length || cfg.removed.length) {
    events.push({
      action: 'verification-activity.checks-changed',
      summary: `${by} changed the checks for ${label}${cfg.added.length ? `: added ${checkNames(cfg.added)}` : ''}${cfg.removed.length ? `${cfg.added.length ? ';' : ':'} removed ${checkNames(cfg.removed)}` : ''}${into}.`,
      changes: [{ field: 'Checks', from: checkNames(cfg.checksBefore), to: checkNames(cfg.checksAfter) }],
    });
  }
  if (cfg.rules.length) events.push({ action: 'verification-activity.rules-changed', summary: `${by} changed the verification rules for ${label}${into}.`, changes: cfg.rules });
  if (cfg.providerChanges.length) events.push({ action: 'verification-activity.providers-changed', summary: `${by} changed providers or sources for ${label}${into}.`, changes: cfg.providerChanges });
  for (const id of diff.add) events.push({ action: 'verification-activity.verifier-assigned', summary: `${by} assigned ${adminName(state, id)} as a verifier for ${label}.`, related: [{ id, name: adminName(state, id) }] });
  for (const id of diff.remove) events.push({ action: 'verification-activity.verifier-removed', summary: `${by} removed ${adminName(state, id)} as a verifier for ${label}.`, related: [{ id, name: adminName(state, id) }] });

  return {
    ok: true, activityId: existing.id,
    state: withEvents(state, next, at, events, {
      activityConfigs: state.data.activityConfigs.map((a) => (a.id === existing.id ? next : a)),
      activityVersions: versions,
      verifierAssignments: applyVerifierDiff(state, organizationId, existing.id, diff, at),
    }),
  };
}

/** Everything that must be resolved before an activity (or its pending changes) can be activated. */
export function activationProblems(state: AppState, organizationId: string, activity: ActivityConfig): { blockers: string[]; warnings: string[] } {
  const version = state.data.activityVersions.find((v) => v.id === (activity.draftVersionId ?? activity.activeVersionId));
  const blockers: string[] = [];
  if (!activity.name.trim()) blockers.push('Enter an activity name.');
  if (!version) return { blockers: [...blockers, 'Configure the activity’s checks.'], warnings: [] };
  const v = validateConfiguration(version, validationContext(state, organizationId, activity.participants ?? { groupIds: [], memberIds: [] }));
  blockers.push(...v.blockers.map((b) => b.message));
  // Verifiers come from the Verifier role. Only an activity restricted to assigned verifiers needs assignments.
  const eligible = new Set(eligibleVerifiers(state.data, organizationId).map((a) => a.id));
  if (activity.restrictVerifiers && !activeAssignments(state.data, organizationId, activity.id).some((x) => eligible.has(x.administratorId))) {
    blockers.push('This activity is limited to assigned verifiers. Assign at least one, or allow any Verifier.');
  }
  const warnings = v.warnings.map((w) => w.message);
  if (!eligible.size) warnings.push('Nobody in your organization has the Verifier role yet, so nobody can perform this activity. Add one in Settings → Administrators & Roles.');
  return { blockers: [...new Set(blockers)], warnings };
}

function find(state: AppState, organizationId: string, activityId: string) {
  return state.data.activityConfigs.find((a) => a.id === activityId && a.organizationId === organizationId);
}

/** Activates a draft activity, publishes pending changes, or reactivates an inactive one, only when valid. */
export function applyActivate(state: AppState, input: { organizationId: string; activityId: string; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('verification.activities.manage')) return { ok: false, error: DENIED };
  const activity = find(state, input.organizationId, input.activityId);
  if (!activity) return { ok: false, error: 'This activity no longer exists.' };
  if (activity.status === 'active' && !activity.draftVersionId) return { ok: true, state, activityId: activity.id };
  const { blockers } = activationProblems(state, input.organizationId, activity);
  if (blockers.length) return { ok: false, error: 'This activity can’t be activated yet.', problems: blockers };
  const by = state.data.admin.name;
  const publishing = activity.draftVersionId;
  const versions = state.data.activityVersions.map((v) => {
    if (publishing && v.id === publishing) return { ...v, status: 'active' as const, activatedAt: input.at, activatedBy: by };
    if (publishing && v.id === activity.activeVersionId) return { ...v, status: 'superseded' as const };
    return v;
  });
  const versionId = publishing ?? activity.activeVersionId!;
  const number = versions.find((v) => v.id === versionId)!.number;
  const next: ActivityConfig = { ...activity, status: 'active', activeVersionId: versionId, draftVersionId: undefined, updatedAt: input.at, updatedBy: by };
  const summary = activity.status === 'active'
    ? `${by} activated version ${number} of ${activity.name}. New verifications use it; earlier results keep the version they used.`
    : `${by} activated ${activity.name} (version ${number}).`;
  return {
    ok: true, activityId: activity.id,
    state: withEvents(state, next, input.at, [{ action: 'verification-activity.activated', summary, changes: [{ field: 'Status', from: activity.status === 'draft' ? 'Draft' : activity.status === 'inactive' ? 'Inactive' : `Active (version ${state.data.activityVersions.find((v) => v.id === activity.activeVersionId)?.number})`, to: `Active (version ${number})` }] }], {
      activityConfigs: state.data.activityConfigs.map((a) => (a.id === activity.id ? next : a)),
      activityVersions: versions,
    }),
  };
}

export function applyDeactivate(state: AppState, input: { organizationId: string; activityId: string; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('verification.activities.manage')) return { ok: false, error: DENIED };
  const activity = find(state, input.organizationId, input.activityId);
  if (!activity) return { ok: false, error: 'This activity no longer exists.' };
  if (activity.status !== 'active') return { ok: false, error: 'Only active activities can be deactivated.' };
  const next: ActivityConfig = { ...activity, status: 'inactive', updatedAt: input.at, updatedBy: state.data.admin.name };
  return {
    ok: true, activityId: activity.id,
    state: withEvents(state, next, input.at, [{
      action: 'verification-activity.deactivated', summary: `${state.data.admin.name} deactivated ${activity.name}. No new verifications can start; earlier records are kept.`,
      changes: [{ field: 'Status', from: 'Active', to: 'Inactive' }],
    }], { activityConfigs: state.data.activityConfigs.map((a) => (a.id === activity.id ? next : a)) }),
  };
}

/** Throws away unpublished changes to an active or inactive activity. */
export function applyDiscardDraft(state: AppState, input: { organizationId: string; activityId: string; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('verification.rules.manage')) return { ok: false, error: DENIED };
  const activity = find(state, input.organizationId, input.activityId);
  if (!activity?.draftVersionId || !activity.activeVersionId) return { ok: false, error: 'There are no pending changes to discard.' };
  const draft = state.data.activityVersions.find((v) => v.id === activity.draftVersionId)!;
  const next: ActivityConfig = { ...activity, draftVersionId: undefined, updatedAt: input.at, updatedBy: state.data.admin.name };
  return {
    ok: true, activityId: activity.id,
    state: withEvents(state, next, input.at, [{ action: 'verification-activity.draft-discarded', summary: `${state.data.admin.name} discarded draft version ${draft.number} of ${activity.name}.` }], {
      activityConfigs: state.data.activityConfigs.map((a) => (a.id === activity.id ? next : a)),
      activityVersions: state.data.activityVersions.filter((v) => v.id !== draft.id),
    }),
  };
}

/** Copies the current configuration into a new draft activity. Verifier assignments aren't copied. */
export function applyDuplicate(state: AppState, input: { organizationId: string; activityId: string; ids: { activityId: string; versionId: string }; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('verification.activities.create')) return { ok: false, error: DENIED };
  const source = find(state, input.organizationId, input.activityId);
  const version = source ? state.data.activityVersions.find((v) => v.id === (source.draftVersionId ?? source.activeVersionId)) : undefined;
  if (!source || !version) return { ok: false, error: 'This activity no longer exists.' };
  let name = `Copy of ${source.name}`.slice(0, NAME_MAX);
  for (let i = 2; nameProblem(state, input.organizationId, name); i++) name = `Copy of ${source.name} (${i})`.slice(0, NAME_MAX);
  const by = state.data.admin.name;
  const activity: ActivityConfig = {
    id: input.ids.activityId, organizationId: input.organizationId, name, description: source.description, purpose: source.purpose,
    status: 'draft', draftVersionId: input.ids.versionId, createdAt: input.at, createdBy: by, updatedAt: input.at, updatedBy: by,
  };
  const copy: ActivityVersion = {
    ...version, id: input.ids.versionId, activityId: activity.id, number: 1, status: 'draft', createdAt: input.at, createdBy: by, updatedAt: input.at,
    activatedAt: undefined, activatedBy: undefined, checks: version.checks.map((c, i) => ({ ...c, id: `${input.ids.versionId}_chk_${i + 1}` })),
  };
  return {
    ok: true, activityId: activity.id,
    state: withEvents(state, activity, input.at, [{ action: 'verification-activity.duplicated', summary: `${by} duplicated ${source.name} as ${name} (draft).`, related: [{ id: source.id, name: source.name }] }], {
      activityConfigs: [...state.data.activityConfigs, activity],
      activityVersions: [...state.data.activityVersions, copy],
    }),
  };
}

/** Removes an activity that has never been activated, with its draft and assignments. */
export function applyRemoveDraft(state: AppState, input: { organizationId: string; activityId: string; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('verification.activities.manage')) return { ok: false, error: DENIED };
  const activity = find(state, input.organizationId, input.activityId);
  if (!activity) return { ok: false, error: 'This activity no longer exists.' };
  if (activity.status !== 'draft' || activity.activeVersionId) return { ok: false, error: 'Only draft activities that were never activated can be removed. Deactivate it instead.' };
  return {
    ok: true, activityId: activity.id,
    state: withEvents(state, activity, input.at, [{ action: 'verification-activity.removed', summary: `${state.data.admin.name} removed the draft activity ${activity.name}.` }], {
      activityConfigs: state.data.activityConfigs.filter((a) => a.id !== activity.id),
      activityVersions: state.data.activityVersions.filter((v) => v.activityId !== activity.id),
      verifierAssignments: state.data.verifierAssignments.filter((v) => v.activityId !== activity.id),
    }),
  };
}
