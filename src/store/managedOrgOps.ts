import { nextReference, type ManagedOrganization } from '@/domain/managedOrganizations';
import type { Permission } from '@/domain/roles';
import type { AuditEvent } from '@/domain/types';
import { actorPermissions, actorRecord } from './adminOps';
import { appendAudit } from './exceptionOps';
import type { AppState } from './state';

/**
 * Organizations managed inside a workspace (see domain/managedOrganizations). Every change is checked here
 * against the acting administrator's real permissions in that workspace, never against organization
 * membership: belonging to an organization grants nothing.
 */
type Result = { ok: true; state: AppState } | { ok: false; error: string; errors?: Record<string, string | undefined> };

export const managedOrgsOf = (state: AppState, organizationId: string) => (state.data.managedOrganizations ?? []).filter((o) => o.organizationId === organizationId);
export const managedOrgFor = (state: AppState, organizationId: string, id: string) => managedOrgsOf(state, organizationId).find((o) => o.id === id);
/** The organization an activity is associated with, if any. */
export const organizationOfActivity = (state: AppState, organizationId: string, activityId: string) => managedOrgsOf(state, organizationId).find((o) => o.activityIds.includes(activityId));
/** The organizations a user belongs to (a user may belong to several). */
export const organizationsOfMember = (state: AppState, organizationId: string, memberId: string) => managedOrgsOf(state, organizationId).filter((o) => o.members.some((m) => m.memberId === memberId));

const DENIED = 'Your role doesn’t allow this.';
const ci = (s: string) => s.trim().toLowerCase();

function guard(state: AppState, organizationId: string, permission: Permission): string | null {
  if (state.session.currentOrganizationId !== organizationId) return 'Switch to this organization’s workspace first.';
  return actorPermissions(state, organizationId).has(permission) ? null : DENIED;
}
const by = (state: AppState, organizationId: string) => actorRecord(state, organizationId)?.name ?? state.data.admin.name;

function write(state: AppState, next: ManagedOrganization, e: { action: AuditEvent['action']; summary: string; at: string; changes?: AuditEvent['changes']; related?: AuditEvent['related'] }): AppState {
  const others = (state.data.managedOrganizations ?? []).filter((o) => o.id !== next.id);
  const s: AppState = { ...state, data: { ...state.data, managedOrganizations: [...others, next] } };
  const rec = actorRecord(state, next.organizationId);
  return appendAudit(s, [{
    organizationId: next.organizationId, action: e.action, actor: by(state, next.organizationId), actorType: 'admin', actorId: rec?.id, actorOrganizationId: next.organizationId,
    resourceType: 'managed-organization', resourceId: next.id, subject: { id: next.id, name: `${next.name} (${next.reference})` }, result: 'success', occurredAt: e.at,
    summary: e.summary, href: `/organizations/${next.id}`, ...(e.changes ? { changes: e.changes } : {}), ...(e.related ? { related: e.related } : {}),
  }]);
}

export interface ManagedOrgInput { organizationId: string; id: string; name: string; description?: string; contactEmail?: string; at: string }
export type ManagedOrgErrors = { name?: string; contactEmail?: string };

export function managedOrgProblems(state: AppState, input: Omit<ManagedOrgInput, 'at'>): ManagedOrgErrors {
  const e: ManagedOrgErrors = {};
  const name = input.name.trim();
  if (!name) e.name = 'Enter the organization’s name.';
  else if (name.length > 100) e.name = 'Use 100 characters or fewer.';
  else if (managedOrgsOf(state, input.organizationId).some((o) => o.id !== input.id && ci(o.name) === ci(name))) e.name = 'An organization with this name already exists.';
  const email = input.contactEmail?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.contactEmail = 'Enter a valid email address, or leave it empty.';
  return e;
}

/** Creates an organization (Active, no users, no activities) or edits its details. */
export function applySaveManagedOrg(state: AppState, input: ManagedOrgInput): Result {
  const existing = managedOrgFor(state, input.organizationId, input.id);
  const denied = guard(state, input.organizationId, existing ? 'organizations.edit' : 'organizations.manage');
  if (denied) return { ok: false, error: denied };
  const errors = managedOrgProblems(state, input);
  if (Object.keys(errors).length) return { ok: false, error: 'Check the highlighted fields.', errors };
  const who = by(state, input.organizationId);
  const fields = { name: input.name.trim(), description: input.description?.trim() || undefined, contactEmail: input.contactEmail?.trim() || undefined };
  if (!existing) {
    const created: ManagedOrganization = {
      id: input.id, organizationId: input.organizationId, reference: nextReference(managedOrgsOf(state, input.organizationId)), ...fields,
      status: 'active', createdAt: input.at, createdBy: who, updatedAt: input.at, updatedBy: who, members: [], activityIds: [],
    };
    return { ok: true, state: write(state, created, { action: 'managed-organization.created', at: input.at, summary: `${who} created the organization ${created.name} (${created.reference}).` }) };
  }
  const changes = ([['Name', existing.name, fields.name], ['Description', existing.description, fields.description], ['Contact email', existing.contactEmail, fields.contactEmail]] as const)
    .filter(([, a, b]) => (a ?? '') !== (b ?? '')).map(([field, from, to]) => ({ field, from: from || '—', to: to || '—' }));
  if (!changes.length) return { ok: true, state };
  return { ok: true, state: write(state, { ...existing, ...fields, updatedAt: input.at, updatedBy: who }, { action: 'managed-organization.updated', at: input.at, changes, summary: `${who} edited ${existing.name} (${existing.reference}).` }) };
}

/** Activates or deactivates an organization. Users, activities and every record are kept; only new assignments stop. */
export function applyManagedOrgStatus(state: AppState, input: { organizationId: string; id: string; status: ManagedOrganization['status']; at: string }): Result {
  const denied = guard(state, input.organizationId, 'organizations.edit');
  if (denied) return { ok: false, error: denied };
  const o = managedOrgFor(state, input.organizationId, input.id);
  if (!o) return { ok: false, error: 'Organization not found.' };
  if (o.status === input.status) return { ok: true, state };
  const who = by(state, input.organizationId);
  return { ok: true, state: write(state, { ...o, status: input.status, updatedAt: input.at, updatedBy: who }, {
    action: 'managed-organization.status-changed', at: input.at, changes: [{ field: 'Status', from: o.status === 'active' ? 'Active' : 'Inactive', to: input.status === 'active' ? 'Active' : 'Inactive' }],
    summary: `${who} ${input.status === 'active' ? 'activated' : 'deactivated'} ${o.name} (${o.reference}).`,
  }) };
}

/** Assigns existing, non-inactive users of the workspace. Already-assigned users are refused, never duplicated. */
export function applyAssignOrgMembers(state: AppState, input: { organizationId: string; id: string; memberIds: string[]; at: string }): Result {
  const denied = guard(state, input.organizationId, 'organizations.members');
  if (denied) return { ok: false, error: denied };
  const o = managedOrgFor(state, input.organizationId, input.id);
  if (!o) return { ok: false, error: 'Organization not found.' };
  if (o.status !== 'active') return { ok: false, error: 'This organization is inactive. Activate it before assigning users.' };
  const ids = [...new Set(input.memberIds)];
  if (!ids.length) return { ok: false, error: 'Choose at least one user.' };
  const people = ids.map((id) => state.data.members.find((m) => m.id === id && m.organizationId === input.organizationId));
  if (people.some((p) => !p)) return { ok: false, error: 'Choose users from this workspace.' };
  if (people.some((p) => p!.status === 'inactive')) return { ok: false, error: 'Inactive users can’t be assigned.' };
  const dup = people.filter((p) => o.members.some((m) => m.memberId === p!.id));
  if (dup.length) return { ok: false, error: `${dup.map((p) => p!.displayName).join(', ')} ${dup.length === 1 ? 'is' : 'are'} already assigned.` };
  const who = by(state, input.organizationId);
  const next = { ...o, members: [...o.members, ...ids.map((memberId) => ({ memberId, assignedAt: input.at, assignedBy: who }))], updatedAt: input.at, updatedBy: who };
  return { ok: true, state: write(state, next, {
    action: 'managed-organization.member-assigned', at: input.at, related: people.map((p) => ({ id: p!.id, name: p!.displayName })),
    summary: `${who} assigned ${ids.length} ${ids.length === 1 ? 'user' : 'users'} to ${o.name} (${o.reference}).`,
  }) };
}

/** Removes only the association: the user's account, other memberships, permissions and records stay. */
export function applyRemoveOrgMember(state: AppState, input: { organizationId: string; id: string; memberId: string; at: string }): Result {
  const denied = guard(state, input.organizationId, 'organizations.members');
  if (denied) return { ok: false, error: denied };
  const o = managedOrgFor(state, input.organizationId, input.id);
  if (!o) return { ok: false, error: 'Organization not found.' };
  if (!o.members.some((m) => m.memberId === input.memberId)) return { ok: false, error: 'This user isn’t assigned to the organization.' };
  const person = state.data.members.find((m) => m.id === input.memberId);
  const who = by(state, input.organizationId);
  return { ok: true, state: write(state, { ...o, members: o.members.filter((m) => m.memberId !== input.memberId), updatedAt: input.at, updatedBy: who }, {
    action: 'managed-organization.member-removed', at: input.at, related: [{ id: input.memberId, name: person?.displayName ?? input.memberId }],
    summary: `${who} removed ${person?.displayName ?? 'a user'} from ${o.name} (${o.reference}).`,
  }) };
}

/**
 * Associates an existing verification activity of the workspace, or removes the association. An activity
 * belongs to at most one organization. Participants, verifiers, schedules and history are untouched.
 */
export function applyLinkOrgActivity(state: AppState, input: { organizationId: string; id: string; activityId: string; link: boolean; at: string }): Result {
  const denied = guard(state, input.organizationId, 'organizations.edit');
  if (denied) return { ok: false, error: denied };
  const o = managedOrgFor(state, input.organizationId, input.id);
  if (!o) return { ok: false, error: 'Organization not found.' };
  const activity = state.data.activityConfigs.find((a) => a.id === input.activityId && a.organizationId === input.organizationId);
  if (!activity) return { ok: false, error: 'Choose an activity of this workspace.' };
  const who = by(state, input.organizationId);
  if (input.link) {
    if (o.status !== 'active') return { ok: false, error: 'This organization is inactive. Activate it before associating activities.' };
    const current = organizationOfActivity(state, input.organizationId, input.activityId);
    if (current?.id === o.id) return { ok: false, error: `${activity.name} is already associated with this organization.` };
    if (current) return { ok: false, error: `${activity.name} is already associated with ${current.name}. Remove that association first.` };
  } else if (!o.activityIds.includes(input.activityId)) return { ok: false, error: 'This activity isn’t associated with the organization.' };
  const next = { ...o, activityIds: input.link ? [...o.activityIds, input.activityId] : o.activityIds.filter((x) => x !== input.activityId), updatedAt: input.at, updatedBy: who };
  return { ok: true, state: write(state, next, {
    action: input.link ? 'managed-organization.activity-linked' : 'managed-organization.activity-unlinked', at: input.at, related: [{ id: activity.id, name: activity.name }],
    summary: `${who} ${input.link ? 'associated' : 'removed'} the activity ${activity.name} ${input.link ? 'with' : 'from'} ${o.name} (${o.reference}).`,
  }) };
}
