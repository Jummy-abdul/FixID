import { DEMO_ADMIN } from '@/data/seed';
import { INVITATION_TTL_DAYS, canGrantRoles, coversRoles, permissionsFor, roleById, type Permission } from '@/domain/roles';
import type { AuditEvent, OrgAdministrator } from '@/domain/types';
import type { AppState } from './state';

/**
 * Administrator management. Every operation re-checks the actor's permissions from state, so a
 * hidden button is never the only protection in the prototype. Production must enforce the same
 * rules on the server.
 */

type Result = { ok: true; state: AppState } | { ok: false; error: string };

const DAY = 86_400_000;
const ci = (v: string) => v.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ORG_ADMIN = 'organization-admin';

export const invitationExpired = (a: OrgAdministrator, now = new Date()) =>
  a.status === 'invited' && !!a.invitation && new Date(a.invitation.expiresAt) <= now;

export const adminsOf = (state: AppState, organizationId: string) => state.data.administrators.filter((a) => a.organizationId === organizationId);

/** The current administrator's record in an organization. */
export function actorRecord(state: AppState, organizationId: string, userId = state.data.admin.id) {
  return state.data.administrators.find((a) => a.organizationId === organizationId && a.userId === userId);
}

/** Real permissions from the stored role assignment: only active administrators have any. Role preview never changes these. */
export function actorPermissions(state: AppState, organizationId: string, userId = state.data.admin.id): Set<Permission> {
  const rec = actorRecord(state, organizationId, userId);
  return rec && rec.status === 'active' ? permissionsFor(rec.roleIds) : new Set();
}

const activeOrgAdmins = (list: OrgAdministrator[]) => list.filter((a) => a.status === 'active' && a.roleIds.includes(ORG_ADMIN));
const LAST_ADMIN = 'Your organization needs at least one active Organization Admin.';

const roleNames = (ids: readonly string[]) => ids.map((id) => roleById(id)?.name ?? id).join(', ');
const label = (a: OrgAdministrator) => a.name ?? a.email;

type EventInput = Pick<AuditEvent, 'organizationId' | 'action' | 'occurredAt'> & {
  target: OrgAdministrator;
  summary: (actor: string) => string;
  changes?: AuditEvent['changes'];
  actor?: string;
};

function withEvent(state: AppState, admins: OrgAdministrator[], e: EventInput): AppState {
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const actor = e.actor ?? state.data.admin.name;
  const event: AuditEvent = {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: e.organizationId, action: e.action, occurredAt: e.occurredAt,
    actor, actorType: 'admin', resourceType: 'administrator', resourceId: e.target.id, subject: { id: e.target.id, name: label(e.target) },
    result: 'success', summary: e.summary(actor), changes: e.changes, href: '/settings?tab=admins',
  };
  return { ...state, data: { ...state.data, administrators: admins, audit: [event, ...state.data.audit] } };
}

const DENIED = "You don't have permission to do this.";

function guard(state: AppState, organizationId: string, needs: Permission[], roleIds?: string[]): string | null {
  const perms = actorPermissions(state, organizationId);
  if (!needs.every((p) => perms.has(p))) return DENIED;
  if (roleIds) {
    if (roleIds.length === 0) return 'Choose at least one role.';
    if (roleIds.some((id) => !roleById(id))) return 'Choose a valid role.';
    if (!canGrantRoles(perms, roleIds)) return "You can't grant permissions you don't have yourself.";
  }
  return null;
}

/** Nobody can act on an administrator with access they don't have themselves. */
const outranked = (state: AppState, organizationId: string, target: OrgAdministrator) =>
  !coversRoles(actorPermissions(state, organizationId), target.roleIds) ? "You can't change an administrator who has permissions you don't have." : null;

export interface InviteInput { organizationId: string; id: string; email: string; roleIds: string[]; at: string }

export function inviteProblem(state: AppState, input: Omit<InviteInput, 'id' | 'at'>, now = new Date()): string | null {
  if (!input.email.trim()) return 'Enter an email address.';
  if (!EMAIL.test(input.email.trim())) return 'Enter a valid email address.';
  const existing = adminsOf(state, input.organizationId).find((a) => ci(a.email) === ci(input.email));
  if (existing?.status === 'active') return 'This person is already an administrator.';
  if (existing?.status === 'deactivated') return "This person's access was deactivated. Reactivate it instead.";
  if (existing?.status === 'invited' && !invitationExpired(existing, now)) return 'This person already has a pending invitation. Resend it instead.';
  return null;
}

export function applyInvite(state: AppState, input: InviteInput): Result {
  const blocked = guard(state, input.organizationId, ['administrators.invite', 'roles.assign'], input.roleIds) ?? inviteProblem(state, input, new Date(input.at));
  if (blocked) return { ok: false, error: blocked };
  const email = input.email.trim().toLowerCase();
  const at = new Date(input.at);
  // An expired invitation for the same email is replaced rather than duplicated.
  const others = state.data.administrators.filter((a) => !(a.organizationId === input.organizationId && ci(a.email) === email && a.status === 'invited'));
  const record: OrgAdministrator = {
    id: input.id, organizationId: input.organizationId, email, roleIds: input.roleIds, status: 'invited', createdAt: input.at,
    invitation: { sentAt: input.at, expiresAt: new Date(at.getTime() + INVITATION_TTL_DAYS * DAY).toISOString(), sendCount: 1, invitedBy: state.data.admin.name },
  };
  return {
    ok: true,
    state: withEvent(state, [...others, record], {
      organizationId: input.organizationId, action: 'admin.invited', target: record, occurredAt: input.at,
      summary: (actor) => `${actor} invited ${email} as ${roleNames(input.roleIds)}.`,
      changes: [{ field: 'Status', from: '—', to: 'Invited' }, { field: 'Roles', from: '—', to: roleNames(input.roleIds) }],
    }),
  };
}

function update(state: AppState, organizationId: string, id: string, fn: (a: OrgAdministrator) => OrgAdministrator | null) {
  return state.data.administrators.flatMap((a) => {
    if (a.id !== id || a.organizationId !== organizationId) return [a];
    const next = fn(a);
    return next ? [next] : [];
  });
}

const find = (state: AppState, organizationId: string, id: string) => adminsOf(state, organizationId).find((a) => a.id === id);

export function applyResendInvite(state: AppState, input: { organizationId: string; adminId: string; at: string }): Result {
  const blocked = guard(state, input.organizationId, ['administrators.invite']);
  if (blocked) return { ok: false, error: blocked };
  const target = find(state, input.organizationId, input.adminId);
  if (!target || target.status !== 'invited') return { ok: false, error: 'There is no pending invitation to resend.' };
  const rank = outranked(state, input.organizationId, target);
  if (rank) return { ok: false, error: rank };
  const at = new Date(input.at);
  const expiresAt = new Date(at.getTime() + INVITATION_TTL_DAYS * DAY).toISOString();
  return {
    ok: true,
    state: withEvent(state, update(state, input.organizationId, target.id, (a) => ({
      ...a, invitation: { sentAt: input.at, expiresAt, sendCount: (a.invitation?.sendCount ?? 0) + 1, invitedBy: state.data.admin.name },
    })), {
      organizationId: input.organizationId, action: 'admin.invitation-resent', target, occurredAt: input.at,
      summary: (actor) => `${actor} resent the invitation to ${target.email}.`,
      changes: [{ field: 'Invitation expires', from: target.invitation?.expiresAt.slice(0, 10) ?? '—', to: expiresAt.slice(0, 10) }],
    }),
  };
}

export function applyRevokeInvite(state: AppState, input: { organizationId: string; adminId: string; at: string }): Result {
  const blocked = guard(state, input.organizationId, ['administrators.invite']);
  if (blocked) return { ok: false, error: blocked };
  const target = find(state, input.organizationId, input.adminId);
  if (!target || target.status !== 'invited') return { ok: false, error: 'There is no pending invitation to revoke.' };
  const rank = outranked(state, input.organizationId, target);
  if (rank) return { ok: false, error: rank };
  return {
    ok: true,
    state: withEvent(state, update(state, input.organizationId, target.id, () => null), {
      organizationId: input.organizationId, action: 'admin.invitation-revoked', target, occurredAt: input.at,
      summary: (actor) => `${actor} revoked the invitation for ${target.email}.`,
      changes: [{ field: 'Status', from: 'Invited', to: 'Invitation revoked' }],
    }),
  };
}

export function applySetRoles(state: AppState, input: { organizationId: string; adminId: string; roleIds: string[]; at: string }): Result {
  const target = find(state, input.organizationId, input.adminId);
  if (!target) return { ok: false, error: 'This administrator no longer exists.' };
  const blocked = guard(state, input.organizationId, ['roles.assign'], input.roleIds) ?? outranked(state, input.organizationId, target);
  if (blocked) return { ok: false, error: blocked };
  if (target.status === 'deactivated') return { ok: false, error: 'Reactivate this administrator before changing their roles.' };
  if ([...target.roleIds].sort().join() === [...input.roleIds].sort().join()) return { ok: true, state };
  if (target.userId === state.data.admin.id && target.roleIds.includes(ORG_ADMIN) && !input.roleIds.includes(ORG_ADMIN)) {
    return { ok: false, error: "You can't remove your own Organization Admin role. Ask another Organization Admin to do it." };
  }
  const next = update(state, input.organizationId, target.id, (a) => ({ ...a, roleIds: input.roleIds }));
  if (activeOrgAdmins(next.filter((a) => a.organizationId === input.organizationId)).length === 0) return { ok: false, error: LAST_ADMIN };
  const added = input.roleIds.filter((id) => !target.roleIds.includes(id));
  const removed = target.roleIds.filter((id) => !input.roleIds.includes(id));
  const name = label(target);
  const [action, summary] = removed.length === 0
    ? ['admin.role-assigned' as const, (actor: string) => `${actor} assigned ${roleNames(added)} to ${name}.`]
    : added.length === 0
      ? ['admin.role-removed' as const, (actor: string) => `${actor} removed ${roleNames(removed)} from ${name}.`]
      : ['admin.roles-changed' as const, (actor: string) => `${actor} changed ${name}'s role from ${roleNames(target.roleIds)} to ${roleNames(input.roleIds)}.`];
  return {
    ok: true,
    state: withEvent(state, next, {
      organizationId: input.organizationId, action, target, occurredAt: input.at, summary,
      changes: [{ field: 'Roles', from: roleNames(target.roleIds), to: roleNames(input.roleIds) }],
    }),
  };
}

export function applySetAdminStatus(state: AppState, input: { organizationId: string; adminId: string; status: 'active' | 'deactivated'; at: string }): Result {
  const blocked = guard(state, input.organizationId, ['administrators.manage']);
  if (blocked) return { ok: false, error: blocked };
  const target = find(state, input.organizationId, input.adminId);
  if (!target || target.status === 'invited') return { ok: false, error: 'Only accepted administrators can be activated or deactivated.' };
  if (target.status === input.status) return { ok: true, state };
  if (target.userId === state.data.admin.id && input.status === 'deactivated') return { ok: false, error: "You can't deactivate your own access." };
  const rank = outranked(state, input.organizationId, target);
  if (rank) return { ok: false, error: rank };
  const next = update(state, input.organizationId, target.id, (a) => ({ ...a, status: input.status }));
  if (activeOrgAdmins(next.filter((a) => a.organizationId === input.organizationId)).length === 0) return { ok: false, error: LAST_ADMIN };
  const on = input.status === 'active';
  return {
    ok: true,
    state: withEvent(state, next, {
      organizationId: input.organizationId, action: on ? 'admin.reactivated' : 'admin.deactivated', target, occurredAt: input.at,
      summary: (actor) => `${actor} ${on ? 'reactivated' : 'deactivated'} ${label(target)}'s administrative access.`,
      changes: [{ field: 'Status', from: on ? 'Deactivated' : 'Active', to: on ? 'Active' : 'Deactivated' }],
    }),
  };
}

/** A pending, unexpired invitation for an email, in any organization. */
export function pendingInvitation(state: AppState, email: string, now = new Date()) {
  return state.data.administrators.find((a) => a.status === 'invited' && ci(a.email) === ci(email) && !invitationExpired(a, now));
}

/** The invited person signs up and accepts: they become an active administrator with the invited roles. */
export function applyAcceptInvite(state: AppState, input: { adminId: string; userId: string; name: string; at: string }): Result {
  const target = state.data.administrators.find((a) => a.id === input.adminId);
  if (!target || target.status !== 'invited') return { ok: false, error: 'This invitation is no longer available.' };
  if (invitationExpired(target, new Date(input.at))) return { ok: false, error: 'This invitation has expired. Ask an administrator to resend it.' };
  const joined = { ...target, status: 'active' as const, userId: input.userId, name: input.name, lastActiveAt: input.at };
  // The event is by the new administrator, not whoever was last signed in.
  return {
    ok: true,
    state: withEvent(state, state.data.administrators.map((a) => (a.id === target.id ? joined : a)), {
      organizationId: target.organizationId, action: 'admin.joined', target: joined, occurredAt: input.at, actor: input.name,
      summary: (actor) => `${actor} accepted the invitation and joined as ${roleNames(target.roleIds)}.`,
      changes: [{ field: 'Status', from: 'Invited', to: 'Active' }],
    }),
  };
}

/** Owner record for an organization created through sign-up. */
export function ownerRecord(organizationId: string, userId: string, email: string, name: string, at: string): OrgAdministrator {
  return { id: `${organizationId}_adm_owner`, organizationId, email, name, userId, roleIds: [ORG_ADMIN], status: 'active', createdAt: at, lastActiveAt: at };
}

/**
 * The prototype's primary account in each organization (the demo administrator in sample
 * organizations, the owner in organizations created through sign-up) is an active Organization Admin.
 * Restores that assignment in saved data where it has drifted; other administrators are untouched.
 * Production would make this a provisioning step on the server, not a client-side repair.
 */
export function ensurePrimaryAdmins(state: AppState): AppState {
  let admins = state.data.administrators;
  let changed = false;
  for (const org of state.data.organizations) {
    const userId = org.ownerAccountId ?? DEMO_ADMIN.id;
    const rec = admins.find((a) => a.organizationId === org.id && a.userId === userId);
    if (rec && rec.status === 'active' && rec.roleIds.includes(ORG_ADMIN)) continue;
    changed = true;
    if (rec) {
      admins = admins.map((a) => (a === rec ? { ...a, status: 'active', roleIds: [ORG_ADMIN, ...a.roleIds.filter((r) => r !== ORG_ADMIN)] } : a));
    } else {
      const self = state.data.admin.id === userId ? state.data.admin : undefined;
      const name = self?.name ?? (userId === DEMO_ADMIN.id ? DEMO_ADMIN.name : undefined);
      const email = self?.email ?? (userId === DEMO_ADMIN.id ? DEMO_ADMIN.email : org.contactEmail);
      admins = [...admins, { ...ownerRecord(org.id, userId, email, name ?? email, org.createdAt), lastActiveAt: undefined }];
    }
  }
  return changed ? { ...state, data: { ...state.data, administrators: admins } } : state;
}
