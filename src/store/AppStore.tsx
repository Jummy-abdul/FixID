import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type {
  AuditEvent, CardDesign, Credential, CredentialType, IdentifierConfig, Member, Organization, Transaction, VerificationActivity,
} from '@/domain/types';
import {
  applyEnrollmentInvite, applyMemberStatus, type EnrollmentInviteInput, type MemberStatusInput,
  applyCreateUser, applyCredentialConfig, applyIdentifierConfig, applyIssuance, prepareCreateUser,
  type CreateUserInput, type CredentialConfigInput, type IdentifierConfigInput, type IssuanceInput,
} from './operations';
import { applyInvite, applyResendInvite, applyRevokeInvite, applySetAdminStatus, applySetRoles, type InviteInput } from './adminOps';
import type { RoleId } from '@/domain/roles';
import { loadState, saveState } from './persistence';
import { authorizeAction, createInitialState, reducer, type Action, type AppState, type OrganizationProfileUpdate } from './state';

interface StoreContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** Latest state, for validating an operation immediately before dispatching it. */
  getState: () => AppState;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function AppStoreProvider({ children, initialState }: { children: ReactNode; initialState?: AppState }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState ?? loadState() ?? createInitialState());

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    saveState(state);
  }, [state]);

  const getState = useCallback(() => stateRef.current, []);
  const value = useMemo(() => ({ state, dispatch, getState }), [state, getState]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside AppStoreProvider');
  return ctx;
}

/** Simulated authenticated session: current admin and the organization they are acting within. */
export function useSession() {
  const { state, dispatch } = useStore();
  const organization = state.data.organizations.find((o) => o.id === state.session.currentOrganizationId)!;
  const organizations = state.data.organizations.filter((o) => state.data.admin.organizationIds.includes(o.id));
  const switchOrganization = useCallback(
    (organizationId: string) => dispatch({ type: 'session/switchOrganization', organizationId }),
    [dispatch],
  );
  return { admin: state.data.admin, organization, organizations, switchOrganization };
}

export interface OrgData {
  organization: Organization;
  members: Member[];
  credentials: Credential[];
  credentialTypes: CredentialType[];
  cardDesigns: CardDesign[];
  identifierConfigs: IdentifierConfig[];
  activities: VerificationActivity[];
  transactions: Transaction[];
  audit: AuditEvent[];
  memberById: Map<string, Member>;
  credentialById: Map<string, Credential>;
  credentialTypeById: Map<string, CredentialType>;
  cardDesignById: Map<string, CardDesign>;
  activityById: Map<string, VerificationActivity>;
  identifierConfigById: Map<string, IdentifierConfig>;
}

export function selectOrgData(state: AppState, organizationId?: string): OrgData {
  const orgId = organizationId ?? state.session.currentOrganizationId;
  const d = state.data;
  const organization = d.organizations.find((o) => o.id === orgId)!;
  const scope = <T extends { organizationId: string }>(xs: T[]) => xs.filter((x) => x.organizationId === orgId);
  const members = scope(d.members);
  const credentials = scope(d.credentials);
  const credentialTypes = scope(d.credentialTypes);
  const cardDesigns = scope(d.cardDesigns);
  const activities = scope(d.activities);
  const identifierConfigs = scope(d.identifierConfigs);
  return {
    organization,
    members,
    credentials,
    credentialTypes,
    cardDesigns,
    identifierConfigs,
    activities,
    transactions: scope(d.transactions),
    audit: scope(d.audit),
    memberById: new Map(members.map((x) => [x.id, x])),
    credentialById: new Map(credentials.map((x) => [x.id, x])),
    credentialTypeById: new Map(credentialTypes.map((x) => [x.id, x])),
    cardDesignById: new Map(cardDesigns.map((x) => [x.id, x])),
    activityById: new Map(activities.map((x) => [x.id, x])),
    identifierConfigById: new Map(identifierConfigs.map((x) => [x.id, x])),
  };
}

/** All data scoped to the current organization, with lookup maps. */
export function useOrgData(): OrgData {
  const { state } = useStore();
  return useMemo(() => selectOrgData(state), [state]);
}

export function useActions() {
  const { dispatch, getState } = useStore();
  const run = useCallback((apply: () => { ok: true; state: AppState } | { ok: false; error: string }, action: Action) => {
    const denied = authorizeAction(getState(), action.type);
    const r = denied ? { ok: false as const, error: denied } : apply();
    if (r.ok) dispatch(action);
    return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
  }, [dispatch, getState]);
  return useMemo(
    () => ({
      /** Creates or updates a reusable identifier configuration. Returns validation errors without changing state. */
      saveIdentifierConfig: (input: IdentifierConfigInput) => {
        const denied = authorizeAction(getState(), 'config/identifier');
        if (denied) return { ok: false as const, errors: { form: denied } };
        const result = applyIdentifierConfig(getState(), input);
        if (result.ok) dispatch({ type: 'config/identifier', input });
        return result;
      },
      /** Saves a reusable credential configuration. */
      saveCredentialConfig: (input: CredentialConfigInput) => {
        const denied = authorizeAction(getState(), 'config/credential');
        if (denied) return { ok: false as const, errors: { form: denied } };
        const result = applyCredentialConfig(getState(), input);
        if (result.ok) dispatch({ type: 'config/credential', input });
        return result;
      },
      /** Creates a user and assigns their identifier, atomically. Idempotent per requestId. */
      createUser: (input: CreateUserInput) => {
        const state = getState();
        const denied = authorizeAction(state, 'users/create');
        if (denied) return { ok: false as const, errors: { form: denied } as Record<string, string> };
        const prepared = prepareCreateUser(state, input);
        if (!prepared.ok) return prepared;
        if (prepared.duplicateRequest) return { ok: true as const, memberId: prepared.duplicateRequest.memberId, identifier: prepared.prepared.assigned.value };
        const result = applyCreateUser(state, prepared.prepared);
        if (!result.ok) return result;
        dispatch({ type: 'users/create', prepared: prepared.prepared });
        return { ok: true as const, memberId: result.memberId, identifier: prepared.prepared.assigned.value };
      },
      /** Activates or deactivates a user. Credentials are not changed. */
      setMemberStatus: (input: MemberStatusInput) => {
        const denied = authorizeAction(getState(), 'users/status');
        if (denied) return { ok: false as const, errors: { form: denied } };
        const result = applyMemberStatus(getState(), input);
        if (result.ok && result.changed) dispatch({ type: 'users/status', input });
        return result;
      },
      /** Records a (simulated) portrait enrollment invitation and marks enrollment Pending. */
      recordEnrollmentInvite: (input: EnrollmentInviteInput) => {
        const denied = authorizeAction(getState(), 'users/enrollmentInvite');
        if (denied) return { ok: false as const, errors: { form: denied } };
        const result = applyEnrollmentInvite(getState(), input);
        if (result.ok) dispatch({ type: 'users/enrollmentInvite', input });
        return result;
      },
      /** Administrator management. Each re-checks the signed-in administrator's permissions. */
      inviteAdmin: (input: InviteInput) => run(() => applyInvite(getState(), input), { type: 'admins/invite', input }),
      resendAdminInvite: (organizationId: string, adminId: string) => {
        const at = new Date().toISOString();
        return run(() => applyResendInvite(getState(), { organizationId, adminId, at }), { type: 'admins/resend', organizationId, adminId, at });
      },
      revokeAdminInvite: (organizationId: string, adminId: string) => {
        const at = new Date().toISOString();
        return run(() => applyRevokeInvite(getState(), { organizationId, adminId, at }), { type: 'admins/revoke', organizationId, adminId, at });
      },
      setAdminRoles: (organizationId: string, adminId: string, roleIds: string[]) => {
        const at = new Date().toISOString();
        return run(() => applySetRoles(getState(), { organizationId, adminId, roleIds, at }), { type: 'admins/roles', organizationId, adminId, roleIds, at });
      },
      setAdminStatus: (organizationId: string, adminId: string, status: 'active' | 'deactivated') => {
        const at = new Date().toISOString();
        return run(() => applySetAdminStatus(getState(), { organizationId, adminId, status, at }), { type: 'admins/status', organizationId, adminId, status, at });
      },
      /** Issues a digital ID atomically. Idempotent per requestId; failures change nothing. */
      issueDigitalId: (input: IssuanceInput) => {
        const denied = authorizeAction(getState(), 'issuance/issue');
        if (denied) return { ok: false as const, errors: { form: denied } };
        const result = applyIssuance(getState(), input);
        if (result.ok && !result.duplicateRequest) dispatch({ type: 'issuance/issue', input });
        return result;
      },
      updateWalletStatus: (credentialId: string, status: Credential['wallet']['status']) =>
        dispatch({ type: 'wallet/update', credentialId, status, at: new Date().toISOString() }),
      /** Returns the reason when the change isn't allowed (for example during Role Preview). */
      updateOrganizationProfile: (organizationId: string, changes: OrganizationProfileUpdate) => {
        const denied = authorizeAction(getState(), 'organization/updateProfile');
        if (!denied) dispatch({ type: 'organization/updateProfile', organizationId, changes, at: new Date().toISOString() });
        return denied ? { ok: false as const, error: denied } : { ok: true as const };
      },
      resetDemoData: () => {
        const denied = authorizeAction(getState(), 'demo/reset');
        if (!denied) dispatch({ type: 'demo/reset', state: createInitialState() });
        return denied ? { ok: false as const, error: denied } : { ok: true as const };
      },
      /** Role Preview never changes stored roles or the sign-in; see Session.previewRoleId. */
      startRolePreview: (roleId: RoleId) => dispatch({ type: 'preview/start', roleId }),
      stopRolePreview: () => dispatch({ type: 'preview/stop' }),
    }),
    [dispatch, getState, run],
  );
}
