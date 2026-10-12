import { DEMO_ADMIN } from '@/data/seed';
import { invitationToken } from '@/lib/tokens';
import {
  CUSTOM_ROLE_PERMISSIONS, INVITATION_TTL_HOURS, PERMISSIONS, RENAMED_ROLES, canGrantPermission, coversRoles, findRole, permissionInfo, permissionsFor, rolesFor, singleRole, type Permission, type Role,
} from '@/domain/roles';
import type { AuditEvent, CustomRole, OrgAdministrator } from '@/domain/types';
import type { AppState } from './state';

/**
 * Administrator management. Every operation re-checks the actor's permissions from state, so a
 * hidden button is never the only protection in the prototype. Production must enforce the same
 * rules on the server.
 */

type Result = { ok: true; state: AppState } | { ok: false; error: string };

const HOUR = 3_600_000;
const ci = (v: string) => v.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ORG_ADMIN = 'organization-admin';

export const invitationExpired = (a: OrgAdministrator, now = new Date()) =>
  a.status === 'invited' && !!a.invitation && new Date(a.invitation.expiresAt) <= now;

/** When an invitation sent at `at` stops working. */
export const invitationExpiry = (at: string) => new Date(new Date(at).getTime() + INVITATION_TTL_HOURS * HOUR).toISOString();

/** Invitation link tokens are created outside the reducer, which stays pure. */
export { invitationToken };

/** The path of an invitation's link. In production the link would be emailed; here delivery is simulated. */
export const invitationPath = (token: string) => `/invite/${token}`;

/** The invitation a link belongs to, whatever its state. Only the current link of a record matches. */
export function invitationByToken(state: AppState, token: string): OrgAdministrator | undefined {
  return token ? state.data.administrators.find((a) => a.invitation?.token === token) : undefined;
}

export const adminsOf = (state: AppState, organizationId: string) => state.data.administrators.filter((a) => a.organizationId === organizationId);

/** The current administrator's record in an organization. */
export function actorRecord(state: AppState, organizationId: string, userId = state.data.admin.id) {
  return state.data.administrators.find((a) => a.organizationId === organizationId && a.userId === userId);
}

/** The roles that exist in an organization: the system roles and its own custom roles. */
export const orgRoles = (state: AppState, organizationId: string): Role[] => rolesFor(state.data.customRoles ?? [], organizationId);

/** An administrator's effective permissions: the union of their roles, resolved within their organization. */
export const adminPermissions = (state: AppState, a: Pick<OrgAdministrator, 'organizationId' | 'roleIds'>) => permissionsFor(a.roleIds, orgRoles(state, a.organizationId));

/** Real permissions from the stored role assignment: only active administrators have any. Role preview never changes these. */
export function actorPermissions(state: AppState, organizationId: string, userId = state.data.admin.id): Set<Permission> {
  const rec = actorRecord(state, organizationId, userId);
  return rec && rec.status === 'active' ? adminPermissions(state, rec) : new Set();
}

const activeOrgAdmins = (list: OrgAdministrator[]) => list.filter((a) => a.status === 'active' && a.roleIds.includes(ORG_ADMIN));
const LAST_ADMIN = 'Your organization needs at least one active Organization Admin.';

/** Role names for audit text, from the organization's roles. */
const roleNamesIn = (state: AppState, organizationId: string, ids: readonly string[]) => ids.map((id) => orgRoles(state, organizationId).find((r) => r.id === id)?.name ?? id).join(', ');
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
    // Exactly one role per administrator.
    if (roleIds.length !== 1) return 'Choose one role.';
    // Only this organization's roles: another organization's custom role doesn't exist here.
    if (roleIds.some((id) => !findRole(state.data.customRoles ?? [], organizationId, id))) return 'Choose a valid role.';
    if (!coversRoles(perms, roleIds, orgRoles(state, organizationId))) return "You can't grant permissions you don't have yourself.";
  }
  return null;
}

/** Nobody can act on an administrator with access they don't have themselves. */
const outranked = (state: AppState, organizationId: string, target: OrgAdministrator) =>
  !coversRoles(actorPermissions(state, organizationId), target.roleIds, orgRoles(state, organizationId)) ? "You can't change an administrator who has permissions you don't have." : null;

export interface InviteInput { organizationId: string; id: string; name: string; email: string; roleIds: string[]; token: string; at: string }
export type InviteErrors = { name?: string; email?: string; role?: string };

const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

/**
 * Problems with an invitation's details. Prevents duplicates: an email can't be invited while it already
 * has an administrator account or a pending invitation, here or in another organization, because each
 * administrator account belongs to one organization only.
 */
export function inviteProblems(state: AppState, input: Pick<InviteInput, 'organizationId' | 'name' | 'email' | 'roleIds'>, now = new Date()): InviteErrors {
  const e: InviteErrors = {};
  const name = input.name.trim();
  if (!name) e.name = 'Enter their full name.';
  else if (name.length < 2 || name.length > 80) e.name = 'Use between 2 and 80 characters.';
  else if (!NAME.test(name)) e.name = 'Use letters only.';
  if (input.roleIds.length !== 1) e.role = 'Choose a role.';
  if (!input.email.trim()) e.email = 'Enter an email address.';
  else if (!EMAIL.test(input.email.trim())) e.email = 'Enter a valid email address.';
  else {
    const same = state.data.administrators.filter((a) => ci(a.email) === ci(input.email));
    const here = same.find((a) => a.organizationId === input.organizationId);
    const elsewhere = same.find((a) => a.organizationId !== input.organizationId && (a.status !== 'invited' || !invitationExpired(a, now)));
    if (here?.status === 'active') e.email = 'This person is already an administrator.';
    else if (here?.status === 'deactivated') e.email = 'This person’s account is inactive. Reactivate it instead.';
    else if (here?.status === 'invited') e.email = invitationExpired(here, now) ? 'This person’s invitation has expired. Resend it instead.' : 'This person already has a pending invitation. Resend it instead.';
    else if (elsewhere) e.email = 'This email already has an administrator account or invitation in another organization. Each administrator account belongs to one organization.';
  }
  return e;
}

export function inviteProblem(state: AppState, input: Pick<InviteInput, 'organizationId' | 'name' | 'email' | 'roleIds'>, now = new Date()): string | null {
  const e = inviteProblems(state, input, now);
  return e.name ?? e.email ?? e.role ?? null;
}

/** Creates an invitation in the organization, listed as Invited. Its link expires after 72 hours. */
export function applyInvite(state: AppState, input: InviteInput): Result {
  const blocked = guard(state, input.organizationId, ['administrators.invite'], input.roleIds) ?? inviteProblem(state, input, new Date(input.at));
  if (blocked) return { ok: false, error: blocked };
  if (!input.token || invitationByToken(state, input.token)) return { ok: false, error: 'The invitation couldn’t be created. Try again.' };
  const roleNames = (ids: readonly string[]) => roleNamesIn(state, input.organizationId, ids);
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().replace(/\s+/g, ' ');
  const record: OrgAdministrator = {
    id: input.id, organizationId: input.organizationId, email, name, roleIds: input.roleIds, status: 'invited', createdAt: input.at,
    invitation: { sentAt: input.at, expiresAt: invitationExpiry(input.at), sendCount: 1, invitedBy: state.data.admin.name, token: input.token },
  };
  return {
    ok: true,
    state: withEvent(state, [...state.data.administrators, record], {
      organizationId: input.organizationId, action: 'admin.invited', target: record, occurredAt: input.at,
      summary: (actor) => `${actor} invited ${name} (${email}) as ${roleNames(input.roleIds)}.`,
      changes: [{ field: 'Status', from: '—', to: 'Invited' }, { field: 'Role', from: '—', to: roleNames(input.roleIds) }],
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

/**
 * Resends an invitation, pending or expired: a new link valid for 72 hours replaces the old one, which
 * stops working immediately.
 */
export function applyResendInvite(state: AppState, input: { organizationId: string; adminId: string; token: string; at: string }): Result {
  const blocked = guard(state, input.organizationId, ['administrators.invite']);
  if (blocked) return { ok: false, error: blocked };
  const target = find(state, input.organizationId, input.adminId);
  if (!target || target.status !== 'invited') return { ok: false, error: 'There is no pending invitation to resend.' };
  const rank = outranked(state, input.organizationId, target);
  if (rank) return { ok: false, error: rank };
  if (!input.token || invitationByToken(state, input.token)) return { ok: false, error: 'The invitation couldn’t be resent. Try again.' };
  const expiresAt = invitationExpiry(input.at);
  const wasExpired = invitationExpired(target, new Date(input.at));
  return {
    ok: true,
    state: withEvent(state, update(state, input.organizationId, target.id, (a) => ({
      ...a, invitation: { sentAt: input.at, expiresAt, sendCount: (a.invitation?.sendCount ?? 0) + 1, invitedBy: state.data.admin.name, token: input.token },
    })), {
      organizationId: input.organizationId, action: 'admin.invitation-resent', target, occurredAt: input.at,
      summary: (actor) => `${actor} resent the ${wasExpired ? 'expired ' : ''}invitation to ${target.email}. The previous link no longer works.`,
      changes: [{ field: 'Invitation expires', from: target.invitation?.expiresAt.slice(0, 16).replace('T', ' ') ?? '—', to: expiresAt.slice(0, 16).replace('T', ' ') }],
    }),
  };
}

/**
 * Prototype only: makes a pending invitation expire now, to show what happens after 72 hours. Production
 * expiry is a server-side time check; this action doesn't exist there.
 */
export function applyExpireInvite(state: AppState, input: { organizationId: string; adminId: string; at: string }): Result {
  const blocked = guard(state, input.organizationId, ['administrators.invite']);
  if (blocked) return { ok: false, error: blocked };
  const target = find(state, input.organizationId, input.adminId);
  if (!target || target.status !== 'invited' || !target.invitation) return { ok: false, error: 'There is no pending invitation.' };
  if (invitationExpired(target, new Date(input.at))) return { ok: true, state };
  return {
    ok: true,
    state: withEvent(state, update(state, input.organizationId, target.id, (a) => ({ ...a, invitation: { ...a.invitation!, expiresAt: input.at } })), {
      organizationId: input.organizationId, action: 'admin.invitation-expired', target, occurredAt: input.at,
      summary: (actor) => `${actor} simulated the expiry of the invitation to ${target.email} (prototype).`,
      changes: [{ field: 'Invitation', from: 'Pending', to: 'Expired' }],
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
  if (target.status === 'deactivated') return { ok: false, error: 'Reactivate this administrator before changing their role.' };
  if ([...target.roleIds].sort().join() === [...input.roleIds].sort().join()) return { ok: true, state };
  const next = update(state, input.organizationId, target.id, (a) => ({ ...a, roleIds: input.roleIds }));
  // Checked before the self-change rule, so the last Organization Admin always gets this explanation.
  if (activeOrgAdmins(next.filter((a) => a.organizationId === input.organizationId)).length === 0) {
    return { ok: false, error: `${LAST_ADMIN} ${label(target)} is the only one, so their role can’t be changed.` };
  }
  if (target.userId === state.data.admin.id && target.roleIds.includes(ORG_ADMIN) && !input.roleIds.includes(ORG_ADMIN)) {
    return { ok: false, error: "You can't remove your own Organization Admin role. Ask another Organization Admin to do it." };
  }
  const roleNames = (ids: readonly string[]) => roleNamesIn(state, input.organizationId, ids);
  const name = label(target);
  return {
    ok: true,
    state: withEvent(state, next, {
      organizationId: input.organizationId, action: 'admin.roles-changed', target, occurredAt: input.at,
      summary: (actor) => `${actor} changed ${name}'s role from ${roleNames(target.roleIds)} to ${roleNames(input.roleIds)}.`,
      changes: [{ field: 'Role', from: roleNames(target.roleIds), to: roleNames(input.roleIds) }],
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
  if (activeOrgAdmins(next.filter((a) => a.organizationId === input.organizationId)).length === 0) {
    return { ok: false, error: `${LAST_ADMIN} ${label(target)} is the only one, so they can’t be deactivated.` };
  }
  const on = input.status === 'active';
  return {
    ok: true,
    state: withEvent(state, next, {
      organizationId: input.organizationId, action: on ? 'admin.reactivated' : 'admin.deactivated', target, occurredAt: input.at,
      summary: (actor) => `${actor} ${on ? 'reactivated' : 'deactivated'} ${label(target)}'s administrator account.`,
      changes: [{ field: 'Status', from: on ? 'Inactive' : 'Active', to: on ? 'Active' : 'Inactive' }],
    }),
  };
}

/** A pending, unexpired invitation for an email, in any organization. */
export function pendingInvitation(state: AppState, email: string, now = new Date()) {
  return state.data.administrators.find((a) => a.status === 'invited' && ci(a.email) === ci(email) && !invitationExpired(a, now));
}

/** Why an invitation can't be accepted, or null. Expired, already used and replaced links all fail. */
export function acceptProblem(target: OrgAdministrator | undefined, at: string): string | null {
  if (!target || target.status !== 'invited') return 'This invitation link is no longer valid. It may have been used already or replaced by a newer invitation.';
  if (invitationExpired(target, new Date(at))) return 'This invitation has expired. Ask an Organization Admin to resend it.';
  return null;
}

/**
 * The invited person sets up their account and accepts: they become an active administrator of the
 * inviting organization with the invited role. With a token (the invitation link), only the current
 * link works, and only once.
 */
export function applyAcceptInvite(state: AppState, input: { adminId: string; userId: string; name: string; at: string; token?: string }): Result {
  const target = state.data.administrators.find((a) => a.id === input.adminId);
  if (input.token !== undefined && target?.invitation?.token !== input.token) return { ok: false, error: acceptProblem(undefined, input.at)! };
  const problem = acceptProblem(target, input.at);
  if (problem || !target) return { ok: false, error: problem! };
  // One organization per administrator account.
  if (state.data.administrators.some((a) => a.userId === input.userId && a.organizationId !== target.organizationId)) {
    return { ok: false, error: 'This account already belongs to another organization. Each administrator account belongs to one organization.' };
  }
  const roleNames = (ids: readonly string[]) => roleNamesIn(state, target.organizationId, ids);
  const joined: OrgAdministrator = {
    ...target, status: 'active', userId: input.userId, name: input.name.trim() || target.name, lastActiveAt: input.at,
    invitation: target.invitation ? { ...target.invitation, token: undefined, acceptedAt: input.at } : undefined,
  };
  // The event is by the new administrator, not whoever was last signed in.
  // A sub-organization's onboarding completes when an Organization Admin accepts.
  const onboarded = target.roleIds.includes(ORG_ADMIN)
    ? state.data.organizations.map((o) => (o.id === target.organizationId && o.onboarding === 'awaiting-administrator' ? { ...o, onboarding: 'complete' as const } : o))
    : state.data.organizations;
  const next = withEvent(state, state.data.administrators.map((a) => (a.id === target.id ? joined : a)), {
    organizationId: target.organizationId, action: 'admin.joined', target: joined, occurredAt: input.at, actor: joined.name,
    summary: (actor) => `${actor} accepted the invitation and joined as ${roleNames(target.roleIds)}.`,
    changes: [{ field: 'Status', from: 'Invited', to: 'Active' }],
  });
  return { ok: true, state: { ...next, data: { ...next.data, organizations: onboarded } } };
}

/**
 * Saved data from before one-role-per-administrator: the Viewer role is now Auditor, each administrator
 * keeps exactly one role (Organization Admin if held, otherwise the role with the most permissions), and
 * pending invitations get a link token. Idempotent; runs when saved data loads.
 */
export function normalizeAdministrators(state: AppState, makeToken = invitationToken): AppState {
  let changed = false;
  const administrators = state.data.administrators.map((a) => {
    const roleIds = singleRole(a.roleIds, orgRoles(state, a.organizationId));
    const needsToken = a.status === 'invited' && a.invitation && !a.invitation.token;
    if (roleIds.join() === a.roleIds.join() && !needsToken) return a;
    changed = true;
    return { ...a, roleIds, ...(needsToken ? { invitation: { ...a.invitation!, token: makeToken() } } : {}) };
  });
  const preview = state.session.previewRoleId;
  const renamed = preview ? RENAMED_ROLES[preview] : undefined;
  if (!changed && !renamed) return state;
  return {
    ...state,
    session: renamed ? { ...state.session, previewRoleId: renamed } : state.session,
    data: changed ? { ...state.data, administrators } : state.data,
  };
}

/** Owner record for an organization created through sign-up. */
export function ownerRecord(organizationId: string, userId: string, email: string, name: string, at: string): OrgAdministrator {
  return { id: `${organizationId}_adm_owner`, organizationId, email, name, userId, roleIds: [ORG_ADMIN], status: 'active', createdAt: at, lastActiveAt: at };
}

/**
 * The prototype's primary account in an organization stays an active Organization Admin: the owner of an
 * organization created through sign-up, or the demo account in the sample organizations it belongs to.
 * Restores that assignment in saved data where it has drifted; other administrators are untouched. It never
 * makes anyone a member of an organization they don't already belong to (so a parent's administrators don't
 * become administrators of its sub-organizations). Production would do this server-side at provisioning.
 */
export function ensurePrimaryAdmins(state: AppState): AppState {
  let admins = state.data.administrators;
  let changed = false;
  for (const org of state.data.organizations) {
    const userId = org.ownerAccountId ?? DEMO_ADMIN.id;
    const rec = admins.find((a) => a.organizationId === org.id && a.userId === userId);
    if (rec && rec.status === 'active' && rec.roleIds.includes(ORG_ADMIN)) continue;
    if (rec) {
      changed = true;
      admins = admins.map((a) => (a === rec ? { ...a, status: 'active', roleIds: [ORG_ADMIN] } : a));
    } else if (org.ownerAccountId) {
      changed = true;
      const self = state.data.admin.id === userId ? state.data.admin : undefined;
      admins = [...admins, { ...ownerRecord(org.id, userId, self?.email ?? org.contactEmail, self?.name ?? org.contactEmail, org.createdAt), lastActiveAt: undefined }];
    }
  }
  return changed ? { ...state, data: { ...state.data, administrators: admins } } : state;
}

/* ------------------------------------------------------------------ */
/* Custom roles                                                        */
/* ------------------------------------------------------------------ */

export interface RoleInput { organizationId: string; id: string; name: string; description: string; permissions: Permission[]; at: string }
export type RoleErrors = { name?: string; permissions?: string; form?: string };

/** Administrators (active, invited or deactivated) who hold a role in an organization. */
export const roleHolders = (state: AppState, organizationId: string, roleId: string) =>
  adminsOf(state, organizationId).filter((a) => a.roleIds.includes(roleId));

/** Validation for a custom role. Protected Organization Admin privileges can never be included. */
export function roleProblems(state: AppState, input: Omit<RoleInput, 'at'>): RoleErrors {
  const e: RoleErrors = {};
  const name = input.name.trim();
  if (!name) e.name = 'Enter a role name.';
  else if (name.length > 60) e.name = 'Use 60 characters or fewer.';
  else if (orgRoles(state, input.organizationId).some((r) => r.id !== input.id && ci(r.name) === ci(name))) e.name = 'A role with this name already exists.';
  const perms = [...new Set(input.permissions)];
  if (!perms.length) e.permissions = 'Choose at least one permission.';
  else if (perms.some((p) => !PERMISSIONS.some((x) => x.id === p))) e.permissions = 'Choose valid permissions.';
  else if (perms.some((p) => !CUSTOM_ROLE_PERMISSIONS.includes(p))) e.permissions = `${perms.filter((p) => !CUSTOM_ROLE_PERMISSIONS.includes(p)).map((p) => permissionInfo(p).label).join(', ')} can only be granted by the Organization Admin role.`;
  else {
    const actor = actorPermissions(state, input.organizationId);
    if (perms.some((p) => !canGrantPermission(actor, p))) e.permissions = "You can't grant permissions you don't have yourself.";
  }
  return e;
}

function roleEvent(state: AppState, roles: CustomRole[], e: { organizationId: string; action: 'role.created' | 'role.updated' | 'role.deleted'; role: Role; at: string; summary: string; changes?: AuditEvent['changes'] }): AppState {
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const event: AuditEvent = {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: e.organizationId, action: e.action, occurredAt: e.at,
    actor: state.data.admin.name, actorType: 'admin', resourceType: 'role', resourceId: e.role.id, subject: { id: e.role.id, name: e.role.name },
    result: 'success', summary: e.summary, changes: e.changes, href: '/settings?tab=admins&view=roles',
  };
  return { ...state, data: { ...state.data, customRoles: roles, audit: [event, ...state.data.audit] } };
}

const permissionLabels = (ps: Permission[]) => ps.map((p) => permissionInfo(p).label).join('; ') || '—';

/** Creates or updates a custom role. Changes apply immediately to everyone who holds the role. */
export function applySaveRole(state: AppState, input: RoleInput): { ok: true; state: AppState; roleId: string } | { ok: false; error: string; errors?: RoleErrors } {
  if (!actorPermissions(state, input.organizationId).has('roles.manage')) return { ok: false, error: DENIED };
  if (findRole([], input.organizationId, input.id)) return { ok: false, error: 'System roles can’t be changed.' };
  const roles = state.data.customRoles ?? [];
  const existing = roles.find((r) => r.id === input.id);
  if (existing && existing.organizationId !== input.organizationId) return { ok: false, error: 'This role doesn’t exist in this organization.' };
  const errors = roleProblems(state, input);
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, errors };
  const by = state.data.admin.name;
  const ordered = PERMISSIONS.map((p) => p.id).filter((p) => input.permissions.includes(p));
  const role: CustomRole = {
    id: input.id, organizationId: input.organizationId, name: input.name.trim(), description: input.description.trim(), permissions: ordered, system: false,
    createdAt: existing?.createdAt ?? input.at, createdBy: existing?.createdBy ?? by, updatedAt: input.at, updatedBy: by,
  };
  if (!existing) {
    return {
      ok: true, roleId: role.id,
      state: roleEvent(state, [...roles, role], {
        organizationId: input.organizationId, action: 'role.created', role, at: input.at,
        summary: `${by} created the custom role ${role.name}.`, changes: [{ field: 'Permissions', from: '—', to: permissionLabels(ordered) }],
      }),
    };
  }
  const added = ordered.filter((p) => !existing.permissions.includes(p));
  const removed = existing.permissions.filter((p) => !ordered.includes(p));
  const changes: NonNullable<AuditEvent['changes']> = [
    ...(existing.name !== role.name ? [{ field: 'Name', from: existing.name, to: role.name }] : []),
    ...(existing.description !== role.description ? [{ field: 'Description', from: existing.description || '—', to: role.description || '—' }] : []),
    ...(added.length ? [{ field: 'Permissions added', from: '—', to: permissionLabels(added) }] : []),
    ...(removed.length ? [{ field: 'Permissions removed', from: permissionLabels(removed), to: '—' }] : []),
  ];
  if (!changes.length) return { ok: true, state, roleId: role.id };
  const holders = roleHolders(state, input.organizationId, role.id).length;
  return {
    ok: true, roleId: role.id,
    state: roleEvent(state, roles.map((r) => (r.id === role.id ? role : r)), {
      organizationId: input.organizationId, action: 'role.updated', role, at: input.at, changes,
      summary: `${by} updated the custom role ${role.name}${holders ? ` (applies to ${holders} ${holders === 1 ? 'administrator' : 'administrators'})` : ''}.`,
    }),
  };
}

/** Deletes a custom role that nobody holds. System roles and assigned roles can't be deleted. */
export function applyDeleteRole(state: AppState, input: { organizationId: string; roleId: string; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('roles.manage')) return { ok: false, error: DENIED };
  if (findRole([], input.organizationId, input.roleId)) return { ok: false, error: 'System roles can’t be deleted.' };
  const roles = state.data.customRoles ?? [];
  const role = roles.find((r) => r.id === input.roleId && r.organizationId === input.organizationId);
  if (!role) return { ok: false, error: 'This role doesn’t exist in this organization.' };
  const holders = roleHolders(state, input.organizationId, role.id);
  if (holders.length) {
    return { ok: false, error: `${role.name} is assigned to ${holders.length} ${holders.length === 1 ? 'administrator' : 'administrators'} (${holders.map(label).join(', ')}). Change their role first.` };
  }
  return {
    ok: true,
    state: roleEvent(state, roles.filter((r) => r.id !== role.id), {
      organizationId: input.organizationId, action: 'role.deleted', role, at: input.at,
      summary: `${state.data.admin.name} deleted the custom role ${role.name}.`, changes: [{ field: 'Permissions', from: permissionLabels(role.permissions), to: '—' }],
    }),
  };
}
