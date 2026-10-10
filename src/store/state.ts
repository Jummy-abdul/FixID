import type { SeedData } from '@/data/seed';
import { buildSeed } from '@/data/seed';
import type { AdminUser, AuditEvent, CardDesign, Credential, Organization } from '@/domain/types';
import {
  applyCreateUser, applyImportSummary, applyCredentialConfig, applyEnrollmentInvite, applyIdentifierConfig, applyIssuance, applyMemberStatus, applyWalletUpdate, applyUploadLogo,
  type CredentialConfigInput, type LogoUploadInput, type EnrollmentInviteInput, type IdentifierConfigInput, type IssuanceInput, type MemberStatusInput, type PreparedUser, type ImportSummaryInput,
} from './operations';
import { ROLE_PREVIEW_ENABLED } from '@/auth/authCore';
import { findRole, permissionsFor, type Permission, type RoleId } from '@/domain/roles';
import {
  actorPermissions, actorRecord, applyAcceptInvite, ensurePrimaryAdmins, applyInvite, applyResendInvite, applyRevokeInvite, applySetAdminStatus, applySetRoles, applySaveRole, applyDeleteRole, ownerRecord, type InviteInput, type RoleInput,
} from './adminOps';
import {
  applyActivate, applyDeactivate, applyDiscardDraft, applyDuplicate, applyRemoveDraft, applySaveActivity, type ActivityForm,
} from './activityOps';
import {
  applyCancelAttempt, applyCompleteAttempt, applyDeniedAttempt, applyExpireAttempts, applyFailAttempt, applyRecordEntry, applyDenyEntry, applyReferAttempt, applyStartAttempt,
  type CompleteInput,
} from './attemptOps';
import type { VerificationClientRef } from '@/domain/types';
import { applyGroupIssuance, type GroupIssuanceInput } from './groupIssuance';
import { applyAddMembers, applyCreateGroup, applyRemoveGroup, applyRemoveMembers, applyUpdateGroup, type GroupInput } from './groupOps';

export const STATE_VERSION = 9;
export const STORAGE_KEY = 'fixid.prototype.state';

export interface Session {
  adminId: string;
  currentOrganizationId: string;
  /**
   * Role Preview: shows the portal as another role would see it. It narrows what the screens show
   * and makes the workspace read-only; it never changes stored role assignments or the sign-in.
   */
  previewRoleId?: RoleId;
}

export interface AppState {
  version: number;
  seededAt: string;
  session: Session;
  data: SeedData;
}

export type OrganizationProfileUpdate = Pick<
  Organization,
  'name' | 'shortName' | 'industry' | 'country' | 'timezone' | 'contactEmail' | 'memberLabel'
>;

export type Action =
  | { type: 'session/switchOrganization'; organizationId: string }
  | { type: 'organization/updateProfile'; organizationId: string; changes: OrganizationProfileUpdate; at: string }
  | { type: 'config/identifier'; input: IdentifierConfigInput }
  | { type: 'config/credential'; input: CredentialConfigInput }
  | { type: 'logos/upload'; input: LogoUploadInput }
  | { type: 'users/create'; prepared: PreparedUser }
  | { type: 'users/importSummary'; input: ImportSummaryInput }
  | { type: 'issuance/issue'; input: IssuanceInput }
  | { type: 'users/status'; input: MemberStatusInput }
  | { type: 'users/enrollmentInvite'; input: EnrollmentInviteInput }
  | { type: 'wallet/update'; credentialId: string; status: Credential['wallet']['status']; at: string }
  | { type: 'demo/reset'; state: AppState }
  | { type: 'organization/create'; organization: Organization; cardDesign: CardDesign; at: string; actor: string; owner: { userId: string; email: string } }
  | { type: 'admins/invite'; input: InviteInput }
  | { type: 'admins/resend'; organizationId: string; adminId: string; at: string }
  | { type: 'admins/revoke'; organizationId: string; adminId: string; at: string }
  | { type: 'admins/roles'; organizationId: string; adminId: string; roleIds: string[]; at: string }
  | { type: 'roles/save'; input: RoleInput }
  | { type: 'roles/delete'; organizationId: string; roleId: string; at: string }
  | { type: 'admins/status'; organizationId: string; adminId: string; status: 'active' | 'deactivated'; at: string }
  | { type: 'admins/accept'; adminId: string; userId: string; name: string; at: string }
  | { type: 'groups/create'; input: GroupInput & { id: string } }
  | { type: 'groups/update'; input: GroupInput & { groupId: string } }
  | { type: 'groups/remove'; organizationId: string; groupId: string; at: string }
  | { type: 'groups/addMembers'; organizationId: string; groupId: string; memberIds: string[]; at: string }
  | { type: 'groups/removeMembers'; organizationId: string; groupId: string; memberIds: string[]; at: string }
  | { type: 'issuance/group'; input: GroupIssuanceInput }
  | { type: 'vactivities/save'; organizationId: string; activityId?: string; ids: { activityId: string; versionId: string }; form: ActivityForm; at: string }
  | { type: 'vactivities/activate'; organizationId: string; activityId: string; at: string }
  | { type: 'vactivities/deactivate'; organizationId: string; activityId: string; at: string }
  | { type: 'vactivities/discardDraft'; organizationId: string; activityId: string; at: string }
  | { type: 'vactivities/duplicate'; organizationId: string; activityId: string; ids: { activityId: string; versionId: string }; at: string }
  | { type: 'vactivities/remove'; organizationId: string; activityId: string; at: string }
  | { type: 'verify/start'; organizationId: string; activityId: string; attemptId: string; at: string; client: VerificationClientRef }
  | { type: 'verify/complete'; input: CompleteInput }
  | { type: 'verify/cancel'; attemptId: string; at: string }
  | { type: 'verify/fail'; attemptId: string; at: string; reason: string }
  | { type: 'verify/refer'; attemptId: string; at: string; reason: string }
  | { type: 'verify/recordEntry'; attemptId: string; at: string }
  | { type: 'verify/denyEntry'; attemptId: string; at: string; reason?: string }
  | { type: 'verify/expire'; organizationId: string; at: string }
  | { type: 'verify/denied'; organizationId: string; activityId: string; reason: string; at: string; client: VerificationClientRef }
  | { type: 'organization/verificationDemo'; organizationId: string; enabled: boolean; at: string }
  | { type: 'preview/start'; roleId: RoleId }
  | { type: 'preview/stop' }
  /** Applies the signed-in administrator and their organization to the workspace. */
  | { type: 'session/signIn'; admin: AdminUser; organizationId: string };

export function createInitialState(now: Date = new Date()): AppState {
  const data = buildSeed(now);
  return {
    version: STATE_VERSION,
    seededAt: now.toISOString(),
    session: { adminId: data.admin.id, currentOrganizationId: data.organizations[0].id },
    data,
  };
}

/**
 * Permission each protected change requires (any one of them). Checked in the reducer so the
 * workspace can't be changed by someone without it, whatever the UI shows. Client-side only;
 * production must enforce this on the server.
 */
const ACTION_PERMISSIONS: Partial<Record<Action['type'], Permission[]>> = {
  'organization/updateProfile': ['settings.manage'],
  'config/identifier': ['users.create', 'users.import', 'credentials.manage'],
  'config/credential': ['credentials.manage'],
  'logos/upload': ['credentials.manage'],
  'users/create': ['users.create', 'users.import'],
  'users/importSummary': ['users.import'],
  'users/status': ['users.edit'],
  'users/enrollmentInvite': ['users.edit'],
  'issuance/issue': ['credentials.issue'],
  'issuance/group': ['credentials.issue'],
  'verify/start': ['verification.execute'],
  'verify/complete': ['verification.execute'],
  'verify/cancel': ['verification.execute'],
  'verify/fail': ['verification.execute'],
  'verify/refer': ['verification.execute'],
  'verify/recordEntry': ['verification.execute'],
  'verify/denyEntry': ['verification.execute'],
  'organization/verificationDemo': ['settings.manage'],
  'vactivities/save': ['verification.activities.create', 'verification.activities.edit'],
  'vactivities/activate': ['verification.activities.activate'],
  'vactivities/deactivate': ['verification.activities.activate'],
  'vactivities/discardDraft': ['verification.activities.edit'],
  'vactivities/duplicate': ['verification.activities.create'],
  'vactivities/remove': ['verification.activities.edit'],
  'groups/create': ['groups.manage'],
  'groups/update': ['groups.manage'],
  'groups/remove': ['groups.manage'],
  'groups/addMembers': ['groups.members'],
  'groups/removeMembers': ['groups.members'],
  'roles/save': ['roles.manage'],
  'roles/delete': ['roles.manage'],
};

/** Actions that don't change workspace data, so they remain available during Role Preview. */
const PREVIEW_SAFE = new Set<Action['type']>(['session/switchOrganization', 'session/signIn', 'preview/start', 'preview/stop', 'verify/expire']);
export const PREVIEW_READ_ONLY = 'Role preview is read-only. Exit the preview to make changes.';

/** Whether the signed-in administrator may use Role Preview: an active Organization Admin, in a demo build. */
export function canPreviewRoles(state: AppState): boolean {
  const rec = actorRecord(state, state.session.currentOrganizationId);
  return ROLE_PREVIEW_ENABLED && rec?.status === 'active' && rec.roleIds.includes('organization-admin');
}

/** The role being previewed, resolved within the current organization. */
export function previewedRole(state: AppState) {
  const id = state.session.previewRoleId;
  return id ? findRole(state.data.customRoles ?? [], state.session.currentOrganizationId, id) : undefined;
}

/**
 * Permissions the screens use to decide what to show: the real ones, or the previewed role's while
 * previewing. Preview is display only: every change is refused while previewing (see authorizeAction),
 * and the store's own checks always use the real permissions (actorPermissions), never these.
 */
export function effectivePermissions(state: AppState): Set<Permission> {
  if (!state.session.previewRoleId) return actorPermissions(state, state.session.currentOrganizationId);
  const role = previewedRole(state);
  return role ? permissionsFor([role.id], [role]) : new Set();
}

/** Null when allowed, otherwise the reason. */
export function authorizeAction(state: AppState, type: Action['type']): string | null {
  if (state.session.previewRoleId && !PREVIEW_SAFE.has(type)) return PREVIEW_READ_ONLY;
  const needed = ACTION_PERMISSIONS[type];
  if (!needed) return null;
  const perms = actorPermissions(state, state.session.currentOrganizationId);
  return needed.some((p) => perms.has(p)) ? null : "You don't have permission to do this.";
}

const orKeep = (state: AppState, r: { ok: true; state: AppState } | { ok: false }) => (r.ok ? r.state : state);

function nextAuditId(audit: AuditEvent[]): string {
  const max = audit.reduce((m, e) => Math.max(m, Number(e.id.replace(/\D/g, '')) || 0), 0);
  return `AUD-${String(max + 1).padStart(5, '0')}`;
}

/** Actions that legitimately name another organization (signing in, switching, joining, creating one). */
const CROSS_ORGANIZATION = new Set<Action['type']>(['session/switchOrganization', 'session/signIn', 'organization/create', 'demo/reset', 'admins/accept']);

/** The organization an action changes, when it names one. */
function targetOrganization(action: Action): string | undefined {
  const a = action as { organizationId?: string; input?: { organizationId?: string }; prepared?: { organizationId?: string } };
  return a.organizationId ?? a.input?.organizationId ?? a.prepared?.organizationId;
}

export function reducer(state: AppState, action: Action): AppState {
  if (authorizeAction(state, action.type)) return state;
  // Permissions are checked in the organization being worked in, so changes are only accepted there.
  const target = targetOrganization(action);
  if (target && target !== state.session.currentOrganizationId && !CROSS_ORGANIZATION.has(action.type)) return state;
  switch (action.type) {
    case 'session/switchOrganization': {
      const allowed = state.data.admin.organizationIds.includes(action.organizationId);
      if (!allowed || state.session.currentOrganizationId === action.organizationId) return state;
      // A previewed custom role belongs to the organization being left; the preview ends rather than carry over.
      const keepPreview = state.session.previewRoleId && findRole(state.data.customRoles ?? [], action.organizationId, state.session.previewRoleId);
      const { previewRoleId: _p, ...rest } = state.session;
      return { ...state, session: { ...rest, currentOrganizationId: action.organizationId, ...(keepPreview ? { previewRoleId: state.session.previewRoleId } : {}) } };
    }
    case 'organization/updateProfile': {
      const org = state.data.organizations.find((o) => o.id === action.organizationId);
      if (!org) return state;
      const changed = (Object.keys(action.changes) as (keyof OrganizationProfileUpdate)[]).filter(
        (k) => org[k] !== action.changes[k],
      );
      if (changed.length === 0) return state;
      const event: AuditEvent = {
        id: nextAuditId(state.data.audit),
        organizationId: org.id,
        action: 'organization.updated',
        actor: state.data.admin.name,
        actorType: 'admin',
        resourceType: 'organization',
        resourceId: org.id,
        result: 'success',
        occurredAt: action.at,
        summary: `Updated organization profile (${changed.join(', ')})`,
        href: '/settings',
      };
      return {
        ...state,
        data: {
          ...state.data,
          organizations: state.data.organizations.map((o) => (o.id === org.id ? { ...o, ...action.changes } : o)),
          audit: [event, ...state.data.audit],
        },
      };
    }
    case 'config/identifier': {
      const r = applyIdentifierConfig(state, action.input);
      return r.ok ? r.state : state;
    }
    case 'config/credential': {
      const r = applyCredentialConfig(state, action.input);
      return r.ok ? r.state : state;
    }
    case 'logos/upload': {
      const r = applyUploadLogo(state, action.input);
      return r.ok ? r.state : state;
    }
    case 'users/create': {
      const r = applyCreateUser(state, action.prepared);
      return r.ok ? r.state : state;
    }
    case 'users/importSummary': return orKeep(state, applyImportSummary(state, action.input));
    case 'users/status': {
      const r = applyMemberStatus(state, action.input);
      return r.ok ? r.state : state;
    }
    case 'users/enrollmentInvite': {
      const r = applyEnrollmentInvite(state, action.input);
      return r.ok ? r.state : state;
    }
    case 'issuance/issue': {
      const r = applyIssuance(state, action.input);
      return r.ok ? r.state : state;
    }
    case 'wallet/update':
      return applyWalletUpdate(state, action.credentialId, action.status, action.at);
    case 'demo/reset': {
      // Demo data is restored; organizations created through sign-up (and their records) are kept.
      const owned = new Set(state.data.organizations.filter((o) => o.ownerAccountId).map((o) => o.id));
      if (owned.size === 0) return action.state;
      const keep = <T extends { organizationId: string }>(next: T[], prev: T[]) => [...next, ...prev.filter((r) => owned.has(r.organizationId))];
      const d = state.data;
      const n = action.state.data;
      return {
        ...action.state,
        data: {
          ...n,
          organizations: [...n.organizations, ...d.organizations.filter((o) => owned.has(o.id))],
          cardDesigns: keep(n.cardDesigns, d.cardDesigns),
          credentialTypes: keep(n.credentialTypes, d.credentialTypes),
          identifierConfigs: keep(n.identifierConfigs, d.identifierConfigs),
          members: keep(n.members, d.members),
          credentials: keep(n.credentials, d.credentials),
          activities: keep(n.activities, d.activities),
          transactions: keep(n.transactions, d.transactions),
          audit: keep(n.audit, d.audit),
          administrators: keep(n.administrators, d.administrators),
          groups: keep(n.groups, d.groups),
          groupMemberships: keep(n.groupMemberships, d.groupMemberships),
          issuanceBatches: keep(n.issuanceBatches, d.issuanceBatches),
          activityConfigs: keep(n.activityConfigs, d.activityConfigs),
          activityVersions: keep(n.activityVersions, d.activityVersions),
          verifierAssignments: keep(n.verifierAssignments, d.verifierAssignments),
          verificationAttempts: keep(n.verificationAttempts, d.verificationAttempts),
          customRoles: keep(n.customRoles, d.customRoles),
          logoAssets: keep(n.logoAssets, d.logoAssets ?? []),
        },
      };
    }
    case 'organization/create': {
      if (state.data.organizations.some((o) => o.id === action.organization.id)) return state;
      const event: AuditEvent = {
        id: nextAuditId(state.data.audit), organizationId: action.organization.id, action: 'organization.created',
        actor: action.actor, actorType: 'admin', resourceType: 'organization', resourceId: action.organization.id,
        result: 'success', occurredAt: action.at, summary: `Created organization ${action.organization.name}`, href: '/settings',
      };
      return {
        ...state,
        data: {
          ...state.data,
          organizations: [...state.data.organizations, action.organization],
          cardDesigns: [...state.data.cardDesigns, action.cardDesign],
          administrators: [...state.data.administrators, ownerRecord(action.organization.id, action.owner.userId, action.owner.email, action.actor, action.at)],
          audit: [event, ...state.data.audit],
        },
      };
    }
    case 'session/signIn': {
      if (!state.data.organizations.some((o) => o.id === action.organizationId) || !action.admin.organizationIds.includes(action.organizationId)) return state;
      if (JSON.stringify(state.data.admin) === JSON.stringify(action.admin) && state.session.currentOrganizationId === action.organizationId) return state;
      const at = new Date().toISOString();
      const sameAdmin = state.data.admin.id === action.admin.id;
      return ensurePrimaryAdmins({
        ...state,
        session: {
          adminId: action.admin.id, currentOrganizationId: action.organizationId,
          ...(sameAdmin && state.session.previewRoleId ? { previewRoleId: state.session.previewRoleId } : {}),
        },
        data: {
          ...state.data,
          admin: action.admin,
          administrators: state.data.administrators.map((a) => (a.organizationId === action.organizationId && a.userId === action.admin.id ? { ...a, lastActiveAt: at } : a)),
        },
      });
    }
    case 'preview/start': {
      if (!findRole(state.data.customRoles ?? [], state.session.currentOrganizationId, action.roleId) || !canPreviewRoles(state)) return state;
      // Previewing your own full role is the same as not previewing.
      if (action.roleId === 'organization-admin') return reducer(state, { type: 'preview/stop' });
      return { ...state, session: { ...state.session, previewRoleId: action.roleId } };
    }
    case 'preview/stop': {
      if (!state.session.previewRoleId) return state;
      const { previewRoleId: _, ...session } = state.session;
      return { ...state, session };
    }
    case 'roles/save': return orKeep(state, applySaveRole(state, action.input));
    case 'roles/delete': return orKeep(state, applyDeleteRole(state, action));
    case 'admins/invite': return orKeep(state, applyInvite(state, action.input));
    case 'admins/resend': return orKeep(state, applyResendInvite(state, action));
    case 'admins/revoke': return orKeep(state, applyRevokeInvite(state, action));
    case 'admins/roles': return orKeep(state, applySetRoles(state, action));
    case 'admins/status': return orKeep(state, applySetAdminStatus(state, action));
    case 'admins/accept': return orKeep(state, applyAcceptInvite(state, action));
    case 'verify/start': return orKeep(state, applyStartAttempt(state, action));
    case 'verify/complete': return orKeep(state, applyCompleteAttempt(state, action.input));
    case 'verify/cancel': return orKeep(state, applyCancelAttempt(state, action));
    case 'verify/fail': return orKeep(state, applyFailAttempt(state, action));
    case 'verify/refer': return orKeep(state, applyReferAttempt(state, action));
    case 'verify/recordEntry': return orKeep(state, applyRecordEntry(state, action));
    case 'verify/denyEntry': return orKeep(state, applyDenyEntry(state, action));
    case 'verify/expire': return applyExpireAttempts(state, action);
    case 'verify/denied': return applyDeniedAttempt(state, action);
    case 'organization/verificationDemo': {
      const org = state.data.organizations.find((o) => o.id === action.organizationId);
      if (!org || !!org.integrations.verificationDemo?.enabled === action.enabled) return state;
      const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
      const event: AuditEvent = {
        id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: org.id, action: 'integration.demo-providers', actor: state.data.admin.name,
        actorType: 'admin', resourceType: 'organization', resourceId: org.id, result: 'success', occurredAt: action.at, href: '/settings?tab=integrations',
        summary: `${state.data.admin.name} turned ${action.enabled ? 'on' : 'off'} demonstration verification providers.`,
        changes: [{ field: 'Demonstration providers', from: action.enabled ? 'Off' : 'On', to: action.enabled ? 'On' : 'Off' }],
      };
      return {
        ...state,
        data: {
          ...state.data,
          organizations: state.data.organizations.map((o) => (o.id === org.id ? { ...o, integrations: { ...o.integrations, verificationDemo: { enabled: action.enabled } } } : o)),
          audit: [event, ...state.data.audit],
        },
      };
    }
    case 'vactivities/save': return orKeep(state, applySaveActivity(state, action));
    case 'vactivities/activate': return orKeep(state, applyActivate(state, action));
    case 'vactivities/deactivate': return orKeep(state, applyDeactivate(state, action));
    case 'vactivities/discardDraft': return orKeep(state, applyDiscardDraft(state, action));
    case 'vactivities/duplicate': return orKeep(state, applyDuplicate(state, action));
    case 'vactivities/remove': return orKeep(state, applyRemoveDraft(state, action));
    case 'issuance/group': return orKeep(state, applyGroupIssuance(state, action.input));
    case 'groups/create': return orKeep(state, applyCreateGroup(state, action.input));
    case 'groups/update': return orKeep(state, applyUpdateGroup(state, action.input));
    case 'groups/remove': return orKeep(state, applyRemoveGroup(state, action));
    case 'groups/addMembers': return orKeep(state, applyAddMembers(state, action));
    case 'groups/removeMembers': return orKeep(state, applyRemoveMembers(state, action));
    default:
      return state;
  }
}
