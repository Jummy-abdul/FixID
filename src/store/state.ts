import type { SeedData } from '@/data/seed';
import { buildSeed } from '@/data/seed';
import type { AdminUser, AuditEvent, CardDesign, Credential, Organization } from '@/domain/types';
import {
  applyCreateUser, applyCredentialConfig, applyEnrollmentInvite, applyIdentifierConfig, applyIssuance, applyMemberStatus, applyWalletUpdate,
  type CredentialConfigInput, type EnrollmentInviteInput, type IdentifierConfigInput, type IssuanceInput, type MemberStatusInput, type PreparedUser,
} from './operations';
import type { Permission } from '@/domain/roles';
import {
  actorPermissions, applyAcceptInvite, applyInvite, applyResendInvite, applyRevokeInvite, applySetAdminStatus, applySetRoles, ownerRecord, type InviteInput,
} from './adminOps';

export const STATE_VERSION = 9;
export const STORAGE_KEY = 'fixid.prototype.state';

export interface Session {
  adminId: string;
  currentOrganizationId: string;
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
  | { type: 'users/create'; prepared: PreparedUser }
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
  | { type: 'admins/status'; organizationId: string; adminId: string; status: 'active' | 'deactivated'; at: string }
  | { type: 'admins/accept'; adminId: string; userId: string; name: string; at: string }
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
  'config/identifier': ['users.manage', 'credentials.configure'],
  'config/credential': ['credentials.configure'],
  'users/create': ['users.manage'],
  'users/status': ['users.manage'],
  'users/enrollmentInvite': ['users.manage'],
  'issuance/issue': ['credentials.issue'],
};

/** Null when allowed, otherwise the reason. */
export function authorizeAction(state: AppState, type: Action['type']): string | null {
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

export function reducer(state: AppState, action: Action): AppState {
  if (authorizeAction(state, action.type)) return state;
  switch (action.type) {
    case 'session/switchOrganization': {
      const allowed = state.data.admin.organizationIds.includes(action.organizationId);
      if (!allowed || state.session.currentOrganizationId === action.organizationId) return state;
      return { ...state, session: { ...state.session, currentOrganizationId: action.organizationId } };
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
    case 'users/create': {
      const r = applyCreateUser(state, action.prepared);
      return r.ok ? r.state : state;
    }
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
      return {
        ...state,
        session: { adminId: action.admin.id, currentOrganizationId: action.organizationId },
        data: {
          ...state.data,
          admin: action.admin,
          administrators: state.data.administrators.map((a) => (a.organizationId === action.organizationId && a.userId === action.admin.id ? { ...a, lastActiveAt: at } : a)),
        },
      };
    }
    case 'admins/invite': return orKeep(state, applyInvite(state, action.input));
    case 'admins/resend': return orKeep(state, applyResendInvite(state, action));
    case 'admins/revoke': return orKeep(state, applyRevokeInvite(state, action));
    case 'admins/roles': return orKeep(state, applySetRoles(state, action));
    case 'admins/status': return orKeep(state, applySetAdminStatus(state, action));
    case 'admins/accept': return orKeep(state, applyAcceptInvite(state, action));
    default:
      return state;
  }
}
