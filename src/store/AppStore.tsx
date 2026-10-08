import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type {
  AuditEvent, CardDesign, Credential, CredentialType, Member, Organization, Transaction, VerificationActivity,
} from '@/domain/types';
import { loadState, saveState } from './persistence';
import { createInitialState, reducer, type Action, type AppState, type OrganizationProfileUpdate } from './state';

interface StoreContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function AppStoreProvider({ children, initialState }: { children: ReactNode; initialState?: AppState }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState ?? loadState() ?? createInitialState());

  useEffect(() => {
    saveState(state);
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
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
  activities: VerificationActivity[];
  transactions: Transaction[];
  audit: AuditEvent[];
  memberById: Map<string, Member>;
  credentialById: Map<string, Credential>;
  credentialTypeById: Map<string, CredentialType>;
  cardDesignById: Map<string, CardDesign>;
  activityById: Map<string, VerificationActivity>;
}

export function selectOrgData(state: AppState): OrgData {
  const orgId = state.session.currentOrganizationId;
  const d = state.data;
  const organization = d.organizations.find((o) => o.id === orgId)!;
  const scope = <T extends { organizationId: string }>(xs: T[]) => xs.filter((x) => x.organizationId === orgId);
  const members = scope(d.members);
  const credentials = scope(d.credentials);
  const credentialTypes = scope(d.credentialTypes);
  const cardDesigns = scope(d.cardDesigns);
  const activities = scope(d.activities);
  return {
    organization,
    members,
    credentials,
    credentialTypes,
    cardDesigns,
    activities,
    transactions: scope(d.transactions),
    audit: scope(d.audit),
    memberById: new Map(members.map((x) => [x.id, x])),
    credentialById: new Map(credentials.map((x) => [x.id, x])),
    credentialTypeById: new Map(credentialTypes.map((x) => [x.id, x])),
    cardDesignById: new Map(cardDesigns.map((x) => [x.id, x])),
    activityById: new Map(activities.map((x) => [x.id, x])),
  };
}

/** All data scoped to the current organization, with lookup maps. */
export function useOrgData(): OrgData {
  const { state } = useStore();
  return useMemo(() => selectOrgData(state), [state]);
}

export function useActions() {
  const { dispatch } = useStore();
  return useMemo(
    () => ({
      updateOrganizationProfile: (organizationId: string, changes: OrganizationProfileUpdate) =>
        dispatch({ type: 'organization/updateProfile', organizationId, changes, at: new Date().toISOString() }),
      resetDemoData: () => dispatch({ type: 'demo/reset', state: createInitialState() }),
    }),
    [dispatch],
  );
}
