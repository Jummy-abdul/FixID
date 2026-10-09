import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type {
  AuditEvent, CardDesign, Credential, CredentialType, IdentifierConfig, Member, Organization, Transaction, VerificationActivity,
} from '@/domain/types';
import {
  applyEnrollmentInvite, applyMemberStatus, type EnrollmentInviteInput, type MemberStatusInput,
  applyCreateUser, applyCredentialConfig, applyIdentifierConfig, applyIssuance, prepareCreateUser,
  type CreateUserInput, type CredentialConfigInput, type IdentifierConfigInput, type IssuanceInput,
} from './operations';
import { loadState, saveState } from './persistence';
import { createInitialState, reducer, type Action, type AppState, type OrganizationProfileUpdate } from './state';

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
  return useMemo(
    () => ({
      /** Creates or updates a reusable identifier configuration. Returns validation errors without changing state. */
      saveIdentifierConfig: (input: IdentifierConfigInput) => {
        const result = applyIdentifierConfig(getState(), input);
        if (result.ok) dispatch({ type: 'config/identifier', input });
        return result;
      },
      /** Saves a reusable credential configuration. */
      saveCredentialConfig: (input: CredentialConfigInput) => {
        const result = applyCredentialConfig(getState(), input);
        if (result.ok) dispatch({ type: 'config/credential', input });
        return result;
      },
      /** Creates a user and assigns their identifier, atomically. Idempotent per requestId. */
      createUser: (input: CreateUserInput) => {
        const state = getState();
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
        const result = applyMemberStatus(getState(), input);
        if (result.ok && result.changed) dispatch({ type: 'users/status', input });
        return result;
      },
      /** Records a (simulated) portrait enrollment invitation and marks enrollment Pending. */
      recordEnrollmentInvite: (input: EnrollmentInviteInput) => {
        const result = applyEnrollmentInvite(getState(), input);
        if (result.ok) dispatch({ type: 'users/enrollmentInvite', input });
        return result;
      },
      /** Issues a digital ID atomically. Idempotent per requestId; failures change nothing. */
      issueDigitalId: (input: IssuanceInput) => {
        const result = applyIssuance(getState(), input);
        if (result.ok && !result.duplicateRequest) dispatch({ type: 'issuance/issue', input });
        return result;
      },
      updateWalletStatus: (credentialId: string, status: Credential['wallet']['status']) =>
        dispatch({ type: 'wallet/update', credentialId, status, at: new Date().toISOString() }),
      updateOrganizationProfile: (organizationId: string, changes: OrganizationProfileUpdate) =>
        dispatch({ type: 'organization/updateProfile', organizationId, changes, at: new Date().toISOString() }),
      resetDemoData: () => dispatch({ type: 'demo/reset', state: createInitialState() }),
    }),
    [dispatch, getState],
  );
}
