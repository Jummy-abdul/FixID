import { seedAdministrators, seedCustomRoles, seedGroups, seedVerificationActivities } from '@/data/seed';
import { LEGACY_ROLE_TEMPLATES } from '@/domain/roles';
import { ensurePrimaryAdmins, normalizeAdministrators } from './adminOps';
import { STATE_VERSION, STORAGE_KEY, type AppState } from './state';

/** Returns persisted state if present and compatible, otherwise null. Never throws. */
export function loadState(): AppState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (parsed?.version !== STATE_VERSION || !parsed.data?.organizations?.length) return null;
    return ensurePrimaryAdmins(normalizeAdministrators(withoutSampleCustomRoles(withLogoAssets(withCustomRoles(withVerificationActivities(withGroups(withAdministrators(parsed))))))));
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
  if (!Array.isArray(state.data.verificationAttempts)) state = { ...state, data: { ...state.data, verificationAttempts: [] } };
  if (Array.isArray(state.data.groups) && Array.isArray(state.data.groupMemberships)) return state;
  const demo = state.data.organizations.filter((o) => !o.ownerAccountId);
  return { ...state, data: { ...state.data, ...seedGroups(demo, state.data.members, new Date()) } };
}

/**
 * Saved data from before custom roles: the former built-in Credential Manager and Verification Manager
 * roles become each organization's own custom roles with the same IDs, so assignments keep their access.
 */
function withCustomRoles(state: AppState): AppState {
  if (Array.isArray(state.data.customRoles)) return state;
  return { ...state, data: { ...state.data, customRoles: seedCustomRoles(state.data.organizations, new Date()) } };
}

const LEGACY_IDS = new Set(LEGACY_ROLE_TEMPLATES.map((t) => t.id));
/** The sample administrators who held the former example roles, and the system roles they have now. */
const SAMPLE_HOLDERS: Record<string, [suffix: string, roleId: string]> = { 'credential-manager': ['_adm_2', 'auditor'], 'verification-manager': ['_adm_3', 'verifier'] };

/**
 * Saved data from when sample organizations came with example custom roles (Credential Manager and
 * Verification Manager): the sample administrators who held them move to the system roles they have in the
 * current sample data, and the untouched examples are removed. A role an administrator edited, or assigned
 * to anyone else, is theirs and is kept.
 */
function withoutSampleCustomRoles(state: AppState): AppState {
  const roles = state.data.customRoles ?? [];
  const untouched = (r: (typeof roles)[number]) => LEGACY_IDS.has(r.id) && r.createdBy === 'FixID' && r.updatedBy === 'FixID';
  if (!roles.some(untouched)) return state;
  const administrators = state.data.administrators.map((a) => {
    const role = roles.find((r) => untouched(r) && r.organizationId === a.organizationId && a.roleIds.includes(r.id));
    const sample = role && SAMPLE_HOLDERS[role.id];
    return sample && a.id === `${a.organizationId}${sample[0]}` ? { ...a, roleIds: [sample[1]] } : a;
  });
  const held = (r: (typeof roles)[number]) => administrators.some((a) => a.organizationId === r.organizationId && a.roleIds.includes(r.id));
  const customRoles = roles.filter((r) => !untouched(r) || held(r));
  return { ...state, data: { ...state.data, administrators, customRoles } };
}

/** Saved data from before credential logos: no logos yet. */
function withLogoAssets(state: AppState): AppState {
  if (!Array.isArray(state.data.ssoConnections)) state = { ...state, data: { ...state.data, ssoConnections: [] } };
  if (!Array.isArray(state.data.organizationRelationships)) state = { ...state, data: { ...state.data, organizationRelationships: [] } };
  return Array.isArray(state.data.logoAssets) ? state : { ...state, data: { ...state.data, logoAssets: [] } };
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
