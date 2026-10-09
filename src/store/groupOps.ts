import { findGroup, groupDependencies, groupProblems, membershipsOfGroup } from '@/domain/groups';
import type { AuditEvent, Group, GroupMembership, Member } from '@/domain/types';
import { actorPermissions } from './adminOps';
import type { AppState } from './state';

/**
 * Group management. Each operation re-checks `groups.manage` from state and validates against current
 * data, so a hidden button is never the only protection. Membership is a relationship only: it never
 * creates users, issues credentials or grants administrative access. Production must enforce the same
 * rules on the server.
 */

type Fail = { ok: false; error: string; errors?: { name?: string; description?: string } };
type Result = { ok: true; state: AppState } | Fail;

const DENIED = "You don't have permission to manage groups.";

function guard(state: AppState, organizationId: string): string | null {
  return actorPermissions(state, organizationId).has('groups.manage') ? null : DENIED;
}

function withEvent(
  state: AppState,
  data: Partial<Pick<AppState['data'], 'groups' | 'groupMemberships'>>,
  e: Pick<AuditEvent, 'organizationId' | 'action' | 'occurredAt' | 'changes' | 'related'> & { group: Group; summary: (actor: string) => string },
): AppState {
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const actor = state.data.admin.name;
  const removed = e.action === 'group.removed';
  const event: AuditEvent = {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: e.organizationId, action: e.action, occurredAt: e.occurredAt,
    actor, actorType: 'admin', resourceType: 'group', resourceId: e.group.id, subject: { id: e.group.id, name: e.group.name },
    related: e.related, changes: e.changes, result: 'success', summary: e.summary(actor),
    href: removed ? undefined : `/groups/${e.group.id}`,
  };
  return { ...state, data: { ...state.data, ...data, audit: [event, ...state.data.audit] } };
}

export interface GroupInput { organizationId: string; name: string; description: string; at: string }

export function applyCreateGroup(state: AppState, input: GroupInput & { id: string }): Result {
  const denied = guard(state, input.organizationId);
  if (denied) return { ok: false, error: denied };
  const errors = groupProblems(state.data, input.organizationId, input);
  if (errors.name || errors.description) return { ok: false, error: errors.name ?? errors.description!, errors };
  if (state.data.groups.some((g) => g.id === input.id)) return { ok: false, error: 'This group already exists.' };
  const by = state.data.admin.name;
  const group: Group = {
    id: input.id, organizationId: input.organizationId, name: input.name.trim(), description: input.description.trim(),
    createdAt: input.at, createdBy: by, updatedAt: input.at, updatedBy: by,
  };
  return {
    ok: true,
    state: withEvent(state, { groups: [...state.data.groups, group] }, {
      organizationId: input.organizationId, action: 'group.created', occurredAt: input.at, group,
      summary: (actor) => `${actor} created the ${group.name} group.`,
      changes: [{ field: 'Name', from: '—', to: group.name }, ...(group.description ? [{ field: 'Description', from: '—', to: group.description }] : [])],
    }),
  };
}

/** Renames or re-describes a group. The ID and memberships are unchanged, so every reference stays valid. */
export function applyUpdateGroup(state: AppState, input: GroupInput & { groupId: string }): Result {
  const denied = guard(state, input.organizationId);
  if (denied) return { ok: false, error: denied };
  const group = findGroup(state.data, input.organizationId, input.groupId);
  if (!group) return { ok: false, error: 'This group no longer exists.' };
  const errors = groupProblems(state.data, input.organizationId, input, group.id);
  if (errors.name || errors.description) return { ok: false, error: errors.name ?? errors.description!, errors };
  const name = input.name.trim();
  const description = input.description.trim();
  const changes = [
    ...(name !== group.name ? [{ field: 'Name', from: group.name, to: name }] : []),
    ...(description !== group.description ? [{ field: 'Description', from: group.description || '—', to: description || '—' }] : []),
  ];
  if (changes.length === 0) return { ok: true, state };
  const next: Group = { ...group, name, description, updatedAt: input.at, updatedBy: state.data.admin.name };
  return {
    ok: true,
    state: withEvent(state, { groups: state.data.groups.map((g) => (g.id === group.id ? next : g)) }, {
      organizationId: input.organizationId, action: 'group.updated', occurredAt: input.at, group: next, changes,
      summary: (actor) => (name !== group.name ? `${actor} renamed the ${group.name} group to ${name}.` : `${actor} updated the ${name} group.`),
    }),
  };
}

/** Removes the group and its memberships. Users and their credentials are untouched. */
export function applyRemoveGroup(state: AppState, input: { organizationId: string; groupId: string; at: string }): Result {
  const denied = guard(state, input.organizationId);
  if (denied) return { ok: false, error: denied };
  const group = findGroup(state.data, input.organizationId, input.groupId);
  if (!group) return { ok: false, error: 'This group no longer exists.' };
  const deps = groupDependencies(state.data, input.organizationId, group.id);
  if (deps.length) {
    return { ok: false, error: `This group is used by ${deps.map((d) => d.name).join(', ')}. Remove it from ${deps.length === 1 ? 'that verification activity' : 'those verification activities'} first.` };
  }
  const count = membershipsOfGroup(state.data, input.organizationId, group.id).length;
  return {
    ok: true,
    state: withEvent(state, {
      groups: state.data.groups.filter((g) => g.id !== group.id),
      groupMemberships: state.data.groupMemberships.filter((m) => !(m.organizationId === input.organizationId && m.groupId === group.id)),
    }, {
      organizationId: input.organizationId, action: 'group.removed', occurredAt: input.at, group,
      summary: (actor) => `${actor} removed the ${group.name} group${count ? ` and its ${count} ${count === 1 ? 'membership' : 'memberships'}` : ''}.`,
      changes: [{ field: 'Members', from: String(count), to: '0' }],
    }),
  };
}

const people = (n: number) => (n === 1 ? '1 user' : `${n} users`);
const related = (members: Member[]) => members.map((m) => ({ id: m.id, name: m.displayName }));

/**
 * Adds existing users of the organization. Users already in the group, or from another organization,
 * are skipped, so a membership is never duplicated and no user record is created.
 */
export function applyAddMembers(state: AppState, input: { organizationId: string; groupId: string; memberIds: string[]; at: string }): Result & { added?: number; skipped?: number } {
  const denied = guard(state, input.organizationId);
  if (denied) return { ok: false, error: denied };
  const group = findGroup(state.data, input.organizationId, input.groupId);
  if (!group) return { ok: false, error: 'This group no longer exists.' };
  const existing = new Set(membershipsOfGroup(state.data, input.organizationId, group.id).map((m) => m.memberId));
  const ids = [...new Set(input.memberIds)];
  const toAdd = ids
    .map((id) => state.data.members.find((m) => m.id === id && m.organizationId === input.organizationId))
    .filter((m): m is Member => !!m && !existing.has(m.id));
  if (toAdd.length === 0) return { ok: false, error: ids.length ? 'The selected users are already in this group.' : 'Select at least one user.' };
  const by = state.data.admin.name;
  const added: GroupMembership[] = toAdd.map((m) => ({ organizationId: input.organizationId, groupId: group.id, memberId: m.id, addedAt: input.at, addedBy: by }));
  const before = existing.size;
  return {
    ok: true, added: toAdd.length, skipped: ids.length - toAdd.length,
    state: withEvent(state, { groupMemberships: [...state.data.groupMemberships, ...added] }, {
      organizationId: input.organizationId, action: 'group.members-added', occurredAt: input.at, group, related: related(toAdd),
      summary: (actor) => (toAdd.length === 1 ? `${actor} added ${toAdd[0].displayName} to the ${group.name} group.` : `${actor} added ${people(toAdd.length)} to the ${group.name} group.`),
      changes: [{ field: 'Members', from: String(before), to: String(before + toAdd.length) }],
    }),
  };
}

/** Removes memberships only. The users stay in FixID and keep their credentials. */
export function applyRemoveMembers(state: AppState, input: { organizationId: string; groupId: string; memberIds: string[]; at: string }): Result & { removed?: number } {
  const denied = guard(state, input.organizationId);
  if (denied) return { ok: false, error: denied };
  const group = findGroup(state.data, input.organizationId, input.groupId);
  if (!group) return { ok: false, error: 'This group no longer exists.' };
  const current = membershipsOfGroup(state.data, input.organizationId, group.id);
  const ids = new Set(input.memberIds);
  const removing = current.filter((m) => ids.has(m.memberId));
  if (removing.length === 0) return { ok: false, error: 'The selected users are no longer in this group.' };
  const gone = new Set(removing.map((m) => m.memberId));
  const members = state.data.members.filter((m) => gone.has(m.id));
  return {
    ok: true, removed: removing.length,
    state: withEvent(state, {
      groupMemberships: state.data.groupMemberships.filter((m) => !(m.organizationId === input.organizationId && m.groupId === group.id && gone.has(m.memberId))),
    }, {
      organizationId: input.organizationId, action: 'group.members-removed', occurredAt: input.at, group, related: related(members),
      summary: (actor) => (members.length === 1 ? `${actor} removed ${members[0].displayName} from the ${group.name} group.` : `${actor} removed ${people(members.length)} from the ${group.name} group.`),
      changes: [{ field: 'Members', from: String(current.length), to: String(current.length - removing.length) }],
    }),
  };
}
