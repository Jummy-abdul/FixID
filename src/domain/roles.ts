/**
 * Administrative access as explicit permissions. Role names are for people; checks always use
 * permissions. Three protected system roles exist in every organization (Organization Admin, Verifier,
 * Auditor, per the R1 roles and permissions matrix); organizations add their own custom roles, which
 * belong to the organization that created them. Each administrator holds exactly one role.
 */

export type Permission =
  | 'users.view' | 'users.create' | 'users.import' | 'users.edit'
  | 'groups.view' | 'groups.manage' | 'groups.members'
  | 'credentials.view' | 'credentials.manage' | 'credentials.issue'
  | 'verification.activities.view' | 'verification.activities.create' | 'verification.activities.edit' | 'verification.activities.activate'
  | 'verification.verifiers.assign' | 'verification.execute'
  | 'verification.results.view'
  | 'administrators.view' | 'administrators.invite' | 'administrators.manage'
  | 'roles.assign' | 'roles.manage' | 'organization.view' | 'settings.manage' | 'audit.view';

export interface PermissionInfo {
  id: Permission;
  label: string;
  area: string;
  /**
   * Only the Organization Admin role has it; custom roles can't include it. No permission is protected in
   * R1: the roles and permissions matrix makes every permission selectable for custom roles. Nobody can
   * grant a permission they don't hold, whatever role they have.
   */
  protected?: boolean;
  /** Powerful enough to call out when it's selected. */
  sensitive?: boolean;
  /** Defined for a capability whose workflow isn't available yet. */
  planned?: boolean;
}

export const PERMISSIONS: PermissionInfo[] = [
  { id: 'users.view', label: 'View users', area: 'Users' },
  { id: 'users.create', label: 'Add users', area: 'Users' },
  { id: 'users.import', label: 'Import users from a CSV file', area: 'Users' },
  { id: 'users.edit', label: 'Activate and deactivate users, and invite them to enrol', area: 'Users' },
  { id: 'groups.view', label: 'View groups', area: 'Groups' },
  { id: 'groups.manage', label: 'Create, edit and remove groups', area: 'Groups' },
  { id: 'groups.members', label: 'Add and remove group members', area: 'Groups' },
  { id: 'credentials.view', label: 'View credentials and issued records', area: 'Credentials' },
  { id: 'credentials.manage', label: 'Set up credential configurations', area: 'Credentials' },
  { id: 'credentials.issue', label: 'Issue credentials', area: 'Credentials', sensitive: true },
  { id: 'verification.activities.view', label: 'View verification activities', area: 'Verification Activities' },
  { id: 'verification.activities.create', label: 'Create verification activities', area: 'Verification Activities' },
  { id: 'verification.activities.edit', label: 'Edit activities and their eligible participants', area: 'Verification Activities' },
  { id: 'verification.activities.activate', label: 'Activate and deactivate activities', area: 'Verification Activities' },
  { id: 'verification.verifiers.assign', label: 'Assign verifiers to activities', area: 'Verification Activities' },
  { id: 'verification.execute', label: 'Perform verifications (assigned activities only)', area: 'Verification Activities' },
  { id: 'verification.results.view', label: 'View the organization’s verification history', area: 'Verification History' },
  { id: 'administrators.view', label: 'View administrators and roles', area: 'Administration' },
  { id: 'administrators.invite', label: 'Invite administrators', area: 'Administration', sensitive: true },
  { id: 'administrators.manage', label: 'Deactivate and reactivate administrators', area: 'Administration', sensitive: true },
  { id: 'roles.assign', label: 'Change administrators’ roles', area: 'Administration', sensitive: true },
  { id: 'roles.manage', label: 'Create, edit and delete custom roles', area: 'Administration', sensitive: true },
  { id: 'organization.view', label: 'View the organization profile', area: 'Administration' },
  { id: 'settings.manage', label: 'Update the organization profile', area: 'Administration', sensitive: true },
  { id: 'audit.view', label: 'View the audit log', area: 'Administration' },
];

export const PERMISSION_AREAS = [...new Set(PERMISSIONS.map((p) => p.area))];
export const permissionInfo = (p: Permission) => PERMISSIONS.find((x) => x.id === p)!;

/** Organization Admin privileges no custom role may include. */
export const PROTECTED_PERMISSIONS = PERMISSIONS.filter((p) => p.protected).map((p) => p.id);
/** Permissions a custom role may include. */
export const CUSTOM_ROLE_PERMISSIONS = PERMISSIONS.filter((p) => !p.protected).map((p) => p.id);

/**
 * Verification rules come in three layers. Organizations can only ever change their own layer:
 * platform rules are enforced by FixID, and governing-authority rules will be set by an authorized
 * overseeing organization through permissions of its own (not part of any organization role).
 */
export type RuleLayer = 'platform' | 'governing-authority' | 'organization';

export function editableRuleLayers(perms: Set<Permission>): RuleLayer[] {
  return perms.has('verification.activities.edit') ? ['organization'] : [];
}

export type SystemRoleId = 'organization-admin' | 'verifier' | 'auditor';
/** Kept for existing imports: any role ID, system or custom. */
export type RoleId = string;

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  /** Protected system role, the same in every organization. */
  system: boolean;
  /** Set on custom roles: the only organization where the role exists. */
  organizationId?: string;
  /** Plain-language summary shown with system roles. */
  highlights?: string[];
  /** Limits that apply to the role, shown to make boundaries explicit. */
  limits?: string[];
}

export const SYSTEM_ROLES: Role[] = [
  {
    id: 'organization-admin', name: 'Organization Admin', system: true,
    description: 'Full administration of the organization’s FixID workspace.',
    // Everything an organization can control, including performing verifications, but only for the
    // activities an Organization Admin is assigned to (assignment is still required).
    permissions: PERMISSIONS.map((p) => p.id),
    highlights: [
      'Manage users, groups and credentials', 'Manage verification activities and view verification history',
      'Perform verifications for activities they’re assigned to (switch to the Verifier view)',
      'Manage administrators, roles and custom roles', 'Manage organization settings and view the audit log',
    ],
    limits: ['Only within their own organization', 'Subject to platform security controls'],
  },
  {
    id: 'verifier', name: 'Verifier', system: true,
    description: 'Verifies people’s identity and eligibility for the activities they’re assigned to.',
    permissions: ['verification.execute'],
    highlights: ['A focused workspace: their dashboard, their verification activities and their verification history', 'Start verifications for activities they’re assigned to'],
    limits: ['No user, group, credential, settings or role management', 'Can’t create or change verification activities', 'Can’t assign themselves to activities'],
  },
  {
    id: 'auditor', name: 'Auditor', system: true,
    description: 'Read-only access for review and oversight, including the audit log.',
    permissions: ['users.view', 'groups.view', 'credentials.view', 'verification.activities.view', 'verification.results.view', 'administrators.view', 'organization.view', 'audit.view'],
    highlights: ['View users, groups, credentials, verification activities and history', 'View the organization profile, administrators and roles', 'Review the audit log'],
    limits: ['Read-only: can’t create, edit, delete, issue, verify or approve anything', 'No access to raw biometric captures or templates'],
  },
];

/** System roles first, then the organization's own custom roles. */
export function rolesFor(customRoles: readonly Role[], organizationId: string): Role[] {
  return [...SYSTEM_ROLES, ...customRoles.filter((r) => r.organizationId === organizationId)];
}

/** A system role, or a custom role of the given organization. Never another organization's role. */
export function findRole(customRoles: readonly Role[], organizationId: string, id: string): Role | undefined {
  return SYSTEM_ROLES.find((r) => r.id === id) ?? customRoles.find((r) => r.id === id && r.organizationId === organizationId);
}

/** System roles only. Custom roles need their organization: use findRole. */
export const roleById = (id: string) => SYSTEM_ROLES.find((r) => r.id === id);
export const ROLES = SYSTEM_ROLES;

/** Effective permissions: the union of the roles' permissions. Unknown roles grant nothing. */
export function permissionsFor(roleIds: readonly string[], roles: readonly Role[] = SYSTEM_ROLES): Set<Permission> {
  const out = new Set<Permission>();
  for (const id of roleIds) for (const p of roles.find((r) => r.id === id)?.permissions ?? []) out.add(p);
  return out;
}

/** Any role with at least one permission opens the workspace; what's shown follows the permissions. */
export const hasPortalAccess = (roleIds: readonly string[], roles: readonly Role[] = SYSTEM_ROLES) => permissionsFor(roleIds, roles).size > 0;

/**
 * Permissions an administrator may grant: those they hold, plus performing verifications when they
 * may assign roles or verifiers (administrators set up verifiers without being verifiers themselves).
 */
export function canGrantPermission(actor: Set<Permission>, p: Permission): boolean {
  return actor.has(p) || (p === 'verification.execute' && (actor.has('roles.assign') || actor.has('verification.verifiers.assign')));
}

/** Whether the actor holds (or may grant) everything these roles allow. Nobody can act on someone with more access. */
export function coversRoles(actor: Set<Permission>, roleIds: readonly string[], roles: readonly Role[] = SYSTEM_ROLES): boolean {
  return roleIds.every((id) => roles.find((r) => r.id === id)?.permissions.every((p) => canGrantPermission(actor, p)) ?? false);
}

/** An administrator can only assign roles whose permissions they may grant. */
export function canGrantRoles(actor: Set<Permission>, roleIds: readonly string[], roles: readonly Role[] = SYSTEM_ROLES): boolean {
  return actor.has('roles.assign') && coversRoles(actor, roleIds, roles);
}

/**
 * Custom roles that replaced the earlier built-in Credential Manager and Verification Manager roles.
 * Existing assignments keep working: each organization gets them as its own, editable custom roles.
 */
export const LEGACY_ROLE_TEMPLATES: Omit<Role, 'organizationId'>[] = [
  {
    id: 'credential-manager', name: 'Credential Manager', system: false,
    description: 'Sets up credentials and issues them to users.',
    permissions: ['users.view', 'groups.view', 'credentials.view', 'credentials.manage', 'credentials.issue'],
  },
  {
    id: 'verification-manager', name: 'Verification Manager', system: false,
    description: 'Sets up verification activities and reviews verification history.',
    permissions: ['groups.view', 'verification.activities.view', 'verification.activities.create', 'verification.activities.edit', 'verification.activities.activate', 'verification.verifiers.assign', 'verification.results.view'],
  },
];

// Activity-level verifier authorization lives with Verification Activities: see authorizeVerifier in domain/verification.ts.

/** Administrator invitations expire 72 hours after they're sent. */
export const INVITATION_TTL_HOURS = 72;

/** System role IDs from earlier versions, kept so saved assignments keep working. */
export const RENAMED_ROLES: Record<string, string> = { viewer: 'auditor' };

/**
 * Each administrator holds exactly one role. Saved data from when several roles were allowed keeps
 * the Organization Admin role if held, otherwise the role granting the most permissions.
 */
export function singleRole(roleIds: readonly string[], roles: readonly Role[]): string[] {
  const ids = [...new Set(roleIds.map((id) => RENAMED_ROLES[id] ?? id))];
  if (ids.length <= 1) return ids;
  if (ids.includes('organization-admin')) return ['organization-admin'];
  const size = (id: string) => roles.find((r) => r.id === id)?.permissions.length ?? -1;
  return [ids.reduce((best, id) => (size(id) > size(best) ? id : best))];
}
