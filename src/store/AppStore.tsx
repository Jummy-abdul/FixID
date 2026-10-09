import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type {
  AuditEvent, CardDesign, Credential, CredentialType, Group, GroupMembership, IdentifierConfig, IssuanceBatch, ActivityConfig, ActivityVersion, VerifierAssignment, Member, Organization, Transaction, VerificationActivity,
} from '@/domain/types';
import {
  applyEnrollmentInvite, applyMemberStatus, type EnrollmentInviteInput, type MemberStatusInput,
  applyCreateUser, applyCredentialConfig, applyIdentifierConfig, applyIssuance, prepareCreateUser,
  type CreateUserInput, type CredentialConfigInput, type IdentifierConfigInput, type IssuanceInput,
} from './operations';
import {
  applyActivate, applyDeactivate, applyDiscardDraft, applyDuplicate, applyRemoveDraft, applySaveActivity, type ActivityForm,
} from './activityOps';
import { applyGroupIssuance, type GroupIssuanceInput } from './groupIssuance';
import { applyAddMembers, applyCreateGroup, applyRemoveGroup, applyRemoveMembers, applyUpdateGroup } from './groupOps';
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

const newEntityId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const StoreContext = createContext<StoreContextValue | null>(null);

export function AppStoreProvider({ children, initialState }: { children: ReactNode; initialState?: AppState }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, () => initialState ?? loadState() ?? createInitialState());

  const stateRef = useRef(state);
  stateRef.current = state;
  // Apply each action to the latest state right away too, so an operation that follows another in the
  // same handler (e.g. save, then activate) validates against the result of the first. The reducer is
  // pure and deterministic, so React computes the same state when it renders.
  const dispatch = useCallback((action: Action) => {
    stateRef.current = reducer(stateRef.current, action);
    rawDispatch(action);
  }, []);

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
  groups: Group[];
  groupMemberships: GroupMembership[];
  issuanceBatches: IssuanceBatch[];
  activityConfigs: ActivityConfig[];
  activityVersions: ActivityVersion[];
  verifierAssignments: VerifierAssignment[];
  memberById: Map<string, Member>;
  groupById: Map<string, Group>;
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
    groups: scope(d.groups),
    groupMemberships: scope(d.groupMemberships),
    issuanceBatches: scope(d.issuanceBatches),
    activityConfigs: scope(d.activityConfigs),
    activityVersions: scope(d.activityVersions),
    verifierAssignments: scope(d.verifierAssignments),
    memberById: new Map(members.map((x) => [x.id, x])),
    groupById: new Map(scope(d.groups).map((x) => [x.id, x])),
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
  const run = useCallback((apply: () => { ok: true; state: AppState } | { ok: false; error: string; errors?: Record<string, string | undefined>; problems?: string[]; field?: string }, action: Action) => {
    const denied = authorizeAction(getState(), action.type);
    const r = denied ? { ok: false as const, error: denied } : apply();
    if (r.ok) dispatch(action);
    return r.ok ? { ok: true as const } : {
      ok: false as const, error: r.error, errors: 'errors' in r ? r.errors : undefined,
      problems: 'problems' in r ? r.problems : undefined, field: 'field' in r ? r.field : undefined,
    };
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
      /** Group management. Each re-checks groups.manage and validates against current data. */
      createGroup: (organizationId: string, name: string, description: string) => {
        const id = `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const input = { organizationId, id, name, description, at: new Date().toISOString() };
        const r = run(() => applyCreateGroup(getState(), input), { type: 'groups/create', input });
        return r.ok ? { ...r, groupId: id } : r;
      },
      updateGroup: (organizationId: string, groupId: string, name: string, description: string) => {
        const input = { organizationId, groupId, name, description, at: new Date().toISOString() };
        return run(() => applyUpdateGroup(getState(), input), { type: 'groups/update', input });
      },
      removeGroup: (organizationId: string, groupId: string) => {
        const at = new Date().toISOString();
        return run(() => applyRemoveGroup(getState(), { organizationId, groupId, at }), { type: 'groups/remove', organizationId, groupId, at });
      },
      addGroupMembers: (organizationId: string, groupId: string, memberIds: string[]) => {
        const at = new Date().toISOString();
        return run(() => applyAddMembers(getState(), { organizationId, groupId, memberIds, at }), { type: 'groups/addMembers', organizationId, groupId, memberIds, at });
      },
      removeGroupMembers: (organizationId: string, groupId: string, memberIds: string[]) => {
        const at = new Date().toISOString();
        return run(() => applyRemoveMembers(getState(), { organizationId, groupId, memberIds, at }), { type: 'groups/removeMembers', organizationId, groupId, memberIds, at });
      },
      /** Verification Activities. Each re-checks permissions; rules changes on active activities go to a draft version. */
      saveActivity: (organizationId: string, activityId: string | undefined, form: ActivityForm) => {
        const ids = { activityId: activityId ?? newEntityId('va'), versionId: newEntityId('vv') };
        const action = { type: 'vactivities/save' as const, organizationId, activityId, ids, form, at: new Date().toISOString() };
        const r = run(() => applySaveActivity(getState(), action), action);
        return r.ok ? { ...r, activityId: ids.activityId } : r;
      },
      activateActivity: (organizationId: string, activityId: string) => {
        const action = { type: 'vactivities/activate' as const, organizationId, activityId, at: new Date().toISOString() };
        return run(() => applyActivate(getState(), action), action);
      },
      deactivateActivity: (organizationId: string, activityId: string) => {
        const action = { type: 'vactivities/deactivate' as const, organizationId, activityId, at: new Date().toISOString() };
        return run(() => applyDeactivate(getState(), action), action);
      },
      discardActivityDraft: (organizationId: string, activityId: string) => {
        const action = { type: 'vactivities/discardDraft' as const, organizationId, activityId, at: new Date().toISOString() };
        return run(() => applyDiscardDraft(getState(), action), action);
      },
      duplicateActivity: (organizationId: string, activityId: string) => {
        const ids = { activityId: newEntityId('va'), versionId: newEntityId('vv') };
        const action = { type: 'vactivities/duplicate' as const, organizationId, activityId, ids, at: new Date().toISOString() };
        const r = run(() => applyDuplicate(getState(), action), action);
        return r.ok ? { ...r, activityId: ids.activityId } : r;
      },
      removeDraftActivity: (organizationId: string, activityId: string) => {
        const action = { type: 'vactivities/remove' as const, organizationId, activityId, at: new Date().toISOString() };
        return run(() => applyRemoveDraft(getState(), action), action);
      },
      /**
       * Issues a credential configuration to selected group members through the ordinary issuance
       * operation, skipping anyone who isn't eligible. Returns the recorded run.
       */
      issueToGroup: (input: Omit<GroupIssuanceInput, 'at'>) => {
        const full = { ...input, at: new Date().toISOString() };
        const denied = authorizeAction(getState(), 'issuance/group');
        if (denied) return { ok: false as const, error: denied };
        const r = applyGroupIssuance(getState(), full);
        if (!r.ok) return r;
        dispatch({ type: 'issuance/group', input: full });
        return { ok: true as const, batch: r.batch, state: r.state };
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
