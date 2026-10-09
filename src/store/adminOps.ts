import { INVITATION_TTL_DAYS, canGrantRoles, permissionsFor, roleById, type Permission } from '@/domain/roles';
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

export const invitationExpired = (a: OrgAdministrator, now = new Date()) =>
  a.status === 'invited' && !!a.invitation && new Date(a.invitation.expiresAt) <= now;

export const adminsOf = (state: AppState, organizationId: string) => state.data.administrators.filter((a) => a.organizationId === organizationId);

/** The current administrator's record in an organization. */
export function actorRecord(state: AppState, organizationId: string, userId = state.data.admin.id) {
  return state.data.administrators.find((a) => a.organizationId === organizationId && a.userId === userId);
}

/** Effective permissions: only active administrators have any. */
export function actorPermissions(state: AppState, organizationId: string, userId = state.data.admin.id): Set<Permission> {
  const rec = actorRecord(state, organizationId, userId);
  return rec && rec.status === 'active' ? permissionsFor(rec.roleIds) : new Set();
}

const fullAdmins = (list: OrgAdministrator[]) => list.filter((a) => a.status === 'active' && permissionsFor(a.roleIds).has('admins.manage'));

const roleNames = (ids: string[]) => ids.map((id) => roleById(id)?.name ?? id).join(', ');

function withEvent(state: AppState, admins: OrgAdministrator[], e: Omit<AuditEvent, 'id' | 'actor' | 'actorType' | 'resourceType' | 'result' | 'href'>): AppState {
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const event: AuditEvent = {
    ...e, id: `AUD-${String(max + 1).padStart(5, '0')}`, actor: state.data.admin.name, actorType: 'admin', resourceType: 'administrator',
    result: 'success', href: '/settings?tab=admins',
  };
  return { ...state, data: { ...state.data, administrators: admins, audit: [event, ...state.data.audit] } };
}

function guard(state: AppState, organizationId: string, roleIds?: string[]): string | null {
  const perms = actorPermissions(state, organizationId);
  if (!perms.has('admins.manage')) return "You don't have permission to manage administrators.";
  if (roleIds) {
    if (roleIds.length === 0) return 'Choose at least one role.';
    if (roleIds.some((id) => !roleById(id))) return 'Choose a valid role.';
    if (!canGrantRoles(perms, roleIds)) return "You can't grant permissions you don't have yourself.";
  }
  return null;
}

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
  const blocked = guard(state, input.organizationId, input.roleIds) ?? inviteProblem(state, input, new Date(input.at));
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
      organizationId: input.organizationId, action: 'admin.invited', resourceId: record.id, occurredAt: input.at,
      summary: `Invited ${email} as ${roleNames(input.roleIds)}`,
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
  const blocked = guard(state, input.organizationId);
  if (blocked) return { ok: false, error: blocked };
  const target = find(state, input.organizationId, input.adminId);
  if (!target || target.status !== 'invited') return { ok: false, error: 'There is no pending invitation to resend.' };
  const at = new Date(input.at);
  return {
    ok: true,
    state: withEvent(state, update(state, input.organizationId, target.id, (a) => ({
      ...a, invitation: { sentAt: input.at, expiresAt: new Date(at.getTime() + INVITATION_TTL_DAYS * DAY).toISOString(), sendCount: (a.invitation?.sendCount ?? 0) + 1, invitedBy: state.data.admin.name },
    })), {
      organizationId: input.organizationId, action: 'admin.invitation-resent', resourceId: target.id, occurredAt: input.at,
      summary: `Resent invitation to ${target.email}`,
    }),
  };
}

export function applyRevokeInvite(state: AppState, input: { organizationId: string; adminId: string; at: string }): Result {
  const blocked = guard(state, input.organizationId);
  if (blocked) return { ok: false, error: blocked };
  const target = find(state, input.organizationId, input.adminId);
  if (!target || target.status !== 'invited') return { ok: false, error: 'There is no pending invitation to revoke.' };
  return {
    ok: true,
    state: withEvent(state, update(state, input.organizationId, target.id, () => null), {
      organizationId: input.organizationId, action: 'admin.invitation-revoked', resourceId: target.id, occurredAt: input.at,
      summary: `Revoked the invitation for ${target.email}`,
    }),
  };
}

export function applySetRoles(state: AppState, input: { organizationId: string; adminId: string; roleIds: string[]; at: string }): Result {
  const target = find(state, input.organizationId, input.adminId);
  if (!target) return { ok: false, error: 'This administrator no longer exists.' };
  const blocked = guard(state, input.organizationId, input.roleIds);
  if (blocked) return { ok: false, error: blocked };
  // Changing someone who holds permissions you lack would let you remove them; not allowed either.
  if (!canGrantRoles(actorPermissions(state, input.organizationId), target.roleIds)) return { ok: false, error: "You can't change the roles of an administrator with permissions you don't have." };
  if ([...target.roleIds].sort().join() === [...input.roleIds].sort().join()) return { ok: true, state };
  const next = update(state, input.organizationId, target.id, (a) => ({ ...a, roleIds: input.roleIds }));
  if (fullAdmins(next.filter((a) => a.organizationId === input.organizationId)).length === 0) {
    return { ok: false, error: 'Your organization needs at least one active Organization Admin.' };
  }
  return {
    ok: true,
    state: withEvent(state, next, {
      organizationId: input.organizationId, action: 'admin.roles-changed', resourceId: target.id, occurredAt: input.at,
      summary: `Changed roles for ${target.name ?? target.email}: ${roleNames(target.roleIds)} → ${roleNames(input.roleIds)}`,
    }),
  };
}

export function applySetAdminStatus(state: AppState, input: { organizationId: string; adminId: string; status: 'active' | 'deactivated'; at: string }): Result {
  const blocked = guard(state, input.organizationId);
  if (blocked) return { ok: false, error: blocked };
  const target = find(state, input.organizationId, input.adminId);
  if (!target || target.status === 'invited') return { ok: false, error: 'Only accepted administrators can be activated or deactivated.' };
  if (target.status === input.status) return { ok: true, state };
  if (target.userId === state.data.admin.id && input.status === 'deactivated') return { ok: false, error: "You can't deactivate your own access." };
  if (!canGrantRoles(actorPermissions(state, input.organizationId), target.roleIds)) return { ok: false, error: "You can't change the access of an administrator with permissions you don't have." };
  const next = update(state, input.organizationId, target.id, (a) => ({ ...a, status: input.status }));
  if (fullAdmins(next.filter((a) => a.organizationId === input.organizationId)).length === 0) {
    return { ok: false, error: 'Your organization needs at least one active Organization Admin.' };
  }
  return {
    ok: true,
    state: withEvent(state, next, {
      organizationId: input.organizationId, action: input.status === 'active' ? 'admin.reactivated' : 'admin.deactivated', resourceId: target.id,
      occurredAt: input.at, summary: `${input.status === 'active' ? 'Reactivated' : 'Deactivated'} administrative access for ${target.name ?? target.email}`,
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
  const next = state.data.administrators.map((a) => (a.id === target.id
    ? { ...a, status: 'active' as const, userId: input.userId, name: input.name, lastActiveAt: input.at } : a));
  const s = withEvent(state, next, {
    organizationId: target.organizationId, action: 'admin.joined', resourceId: target.id, occurredAt: input.at,
    summary: `${input.name} accepted the invitation as ${roleNames(target.roleIds)}`,
  });
  // The event is by the new administrator, not whoever was last signed in.
  s.data.audit[0] = { ...s.data.audit[0], actor: input.name };
  return { ok: true, state: s };
}

/** Owner record for an organization created through sign-up. */
export function ownerRecord(organizationId: string, userId: string, email: string, name: string, at: string): OrgAdministrator {
  return { id: `${organizationId}_adm_owner`, organizationId, email, name, userId, roleIds: ['organization-admin'], status: 'active', createdAt: at, lastActiveAt: at };
}
