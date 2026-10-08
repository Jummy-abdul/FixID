import type { SeedData } from '@/data/seed';
import { buildSeed } from '@/data/seed';
import type { AuditEvent, Credential, Organization } from '@/domain/types';
import { applyCredentialSetup, applyIssuance, applyWalletUpdate, type CredentialSetupInput, type IssuanceInput } from './operations';

export const STATE_VERSION = 4;
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
  | { type: 'setup/credential'; input: CredentialSetupInput }
  | { type: 'issuance/issue'; input: IssuanceInput }
  | { type: 'wallet/update'; credentialId: string; status: Credential['wallet']['status']; at: string }
  | { type: 'demo/reset'; state: AppState };

export function createInitialState(now: Date = new Date()): AppState {
  const data = buildSeed(now);
  return {
    version: STATE_VERSION,
    seededAt: now.toISOString(),
    session: { adminId: data.admin.id, currentOrganizationId: data.organizations[0].id },
    data,
  };
}

function nextAuditId(audit: AuditEvent[]): string {
  const max = audit.reduce((m, e) => Math.max(m, Number(e.id.replace(/\D/g, '')) || 0), 0);
  return `AUD-${String(max + 1).padStart(5, '0')}`;
}

export function reducer(state: AppState, action: Action): AppState {
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
    case 'setup/credential': {
      const r = applyCredentialSetup(state, action.input);
      return r.ok ? r.state : state;
    }
    case 'issuance/issue': {
      const r = applyIssuance(state, action.input);
      return r.ok ? r.state : state;
    }
    case 'wallet/update':
      return applyWalletUpdate(state, action.credentialId, action.status, action.at);
    case 'demo/reset':
      return action.state;
    default:
      return state;
  }
}
