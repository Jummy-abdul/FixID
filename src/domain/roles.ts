/**
 * Administrative roles as structured capabilities. Role names are for people; checks always use
 * permissions. Built-in roles are fixed for now; the shape allows custom roles later.
 */

export type Permission =
  | 'admins.view' | 'admins.manage'
  | 'settings.manage'
  | 'users.view' | 'users.manage' | 'groups.manage'
  | 'credentials.view' | 'credentials.configure' | 'credentials.issue'
  | 'verification.view' | 'verification.manage' | 'verification.assign-verifiers' | 'verification.perform'
  | 'audit.view';

export interface PermissionInfo { id: Permission; label: string; area: string }

export const PERMISSIONS: PermissionInfo[] = [
  { id: 'admins.view', label: 'View administrators and roles', area: 'Administration' },
  { id: 'admins.manage', label: 'Invite administrators and assign roles', area: 'Administration' },
  { id: 'settings.manage', label: 'Manage organization settings', area: 'Administration' },
  { id: 'audit.view', label: 'View the audit log', area: 'Administration' },
  { id: 'users.view', label: 'View users', area: 'Users' },
  { id: 'users.manage', label: 'Add and manage users', area: 'Users' },
  { id: 'groups.manage', label: 'Manage groups', area: 'Users' },
  { id: 'credentials.view', label: 'View credentials and issued records', area: 'Credentials' },
  { id: 'credentials.configure', label: 'Create and edit credential configurations', area: 'Credentials' },
  { id: 'credentials.issue', label: 'Issue credentials', area: 'Credentials' },
  { id: 'verification.view', label: 'View verification outcomes', area: 'Verification' },
  { id: 'verification.manage', label: 'Create and manage verification activities and checks', area: 'Verification' },
  { id: 'verification.assign-verifiers', label: 'Assign verifiers to activities', area: 'Verification' },
  { id: 'verification.perform', label: 'Perform assigned verifications', area: 'Verification' },
];

export type RoleId = 'organization-admin' | 'credential-manager' | 'verification-manager' | 'verifier' | 'viewer';

export interface Role {
  id: RoleId;
  name: string;
  description: string;
  permissions: Permission[];
  /** Whether the role grants access to the administration portal. Verifiers work through approved verifier interfaces instead. */
  portalAccess: boolean;
  /** Plain-language summary shown with the role. */
  highlights: string[];
  /** Limits that apply to the role, shown to make boundaries explicit. */
  limits?: string[];
  builtIn: true;
}

export const ROLES: Role[] = [
  {
    id: 'organization-admin', name: 'Organization Admin', builtIn: true, portalAccess: true,
    description: 'Full administration of the organization.',
    permissions: PERMISSIONS.map((p) => p.id).filter((p) => p !== 'verification.perform'),
    highlights: [
      'Manage organization administrators and roles', 'Manage organization settings', 'Manage users and groups',
      'Manage credentials', 'Manage verification activities', 'Access verification records and audit information',
    ],
  },
  {
    id: 'credential-manager', name: 'Credential Manager', builtIn: true, portalAccess: true,
    description: 'Configures credentials and issues them to users.',
    permissions: ['users.view', 'credentials.view', 'credentials.configure', 'credentials.issue'],
    highlights: ['Manage credential configurations', 'Issue and manage credentials', 'View relevant credential records'],
  },
  {
    id: 'verification-manager', name: 'Verification Manager', builtIn: true, portalAccess: true,
    description: 'Sets up verification activities and who may verify.',
    permissions: ['verification.view', 'verification.manage', 'verification.assign-verifiers'],
    highlights: ['Create and manage verification activities', 'Configure supported verification checks', 'Assign authorized verifiers', 'View verification outcomes and exceptions'],
  },
  {
    id: 'verifier', name: 'Verifier', builtIn: true, portalAccess: false,
    description: 'Performs assigned verifications through an approved verifier interface.',
    permissions: ['verification.perform', 'verification.view'],
    highlights: ['Perform assigned verification activities through authorized interfaces', 'View results of their permitted activities'],
    limits: ['No access to the administration portal', 'Cannot change verification policies or issue credentials unless separately authorized'],
  },
  {
    id: 'viewer', name: 'Viewer / Auditor', builtIn: true, portalAccess: true,
    description: 'Read-only access to records, reports and audit information.',
    permissions: ['admins.view', 'users.view', 'credentials.view', 'verification.view', 'audit.view'],
    highlights: ['View authorized records, reports and audit information'],
    limits: ['Cannot modify administrative or operational configurations'],
  },
];

export const roleById = (id: string) => ROLES.find((r) => r.id === id);

export function permissionsFor(roleIds: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const id of roleIds) for (const p of roleById(id)?.permissions ?? []) out.add(p);
  return out;
}

export const hasPortalAccess = (roleIds: readonly string[]) => roleIds.some((id) => roleById(id)?.portalAccess);

/**
 * Permissions an administrator may grant: those they hold, plus performing verifications when they
 * may assign verifiers (administrators set up verifiers without being verifiers themselves).
 */
export function canGrantPermission(actor: Set<Permission>, p: Permission): boolean {
  return actor.has(p) || (p === 'verification.perform' && actor.has('verification.assign-verifiers'));
}

/** An administrator can only grant roles whose permissions they may grant. */
export function canGrantRoles(actor: Set<Permission>, roleIds: readonly string[]): boolean {
  return actor.has('admins.manage') && roleIds.every((id) => roleById(id)?.permissions.every((p) => canGrantPermission(actor, p)) ?? false);
}

export const INVITATION_TTL_DAYS = 7;
