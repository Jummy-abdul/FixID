import { seedAdministrators, seedGroups, seedVerificationActivities } from '@/data/seed';
import { ensurePrimaryAdmins } from './adminOps';
import { STATE_VERSION, STORAGE_KEY, type AppState } from './state';

/** Returns persisted state if present and compatible, otherwise null. Never throws. */
export function loadState(): AppState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (parsed?.version !== STATE_VERSION || !parsed.data?.organizations?.length) return null;
    return ensurePrimaryAdmins(withVerificationActivities(withGroups(withAdministrators(parsed))));
  } catch {
    return null;
  }
}

/**
 * Saved data from before Administrators & Roles: add administrator records instead of discarding data.
 * Demo organizations get the sample administrators; organizations created through sign-up get their owner.
 */
function withAdministrators(state: AppState): AppState {
  if (Array.isArray(state.data.administrators)) return state;
  const now = new Date();
  const demo = state.data.organizations.filter((o) => !o.ownerAccountId);
  const owned = state.data.organizations.filter((o) => o.ownerAccountId).map((o) => ({
    id: `${o.id}_adm_owner`, organizationId: o.id, email: o.contactEmail, name: state.data.admin.id === o.ownerAccountId ? state.data.admin.name : undefined,
    userId: o.ownerAccountId, roleIds: ['organization-admin'], status: 'active' as const, createdAt: o.createdAt,
  }));
  return { ...state, data: { ...state.data, administrators: [...seedAdministrators(demo, now), ...owned] } };
}

/** Saved data from before Groups: demo organizations get the sample groups; other organizations start with none. */
function withGroups(state: AppState): AppState {
  if (!Array.isArray(state.data.issuanceBatches)) state = { ...state, data: { ...state.data, issuanceBatches: [] } };
  if (Array.isArray(state.data.groups) && Array.isArray(state.data.groupMemberships)) return state;
  const demo = state.data.organizations.filter((o) => !o.ownerAccountId);
  return { ...state, data: { ...state.data, ...seedGroups(demo, state.data.members, new Date()) } };
}

/** Saved data from before Verification Activities: demo organizations get the sample activities. */
function withVerificationActivities(state: AppState): AppState {
  if (Array.isArray(state.data.activityConfigs) && Array.isArray(state.data.activityVersions) && Array.isArray(state.data.verifierAssignments)) return state;
  const demo = state.data.organizations.filter((o) => !o.ownerAccountId);
  return { ...state, data: { ...state.data, ...seedVerificationActivities(demo, state.data, new Date()) } };
}

export function saveState(state: AppState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}
