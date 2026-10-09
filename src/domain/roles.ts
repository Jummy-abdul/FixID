/**
 * Administrative roles as structured capabilities. Role names are for people; checks always use
 * permissions. Built-in roles are fixed for now; the shape allows custom roles later.
 */

export type Permission =
  | 'administrators.view' | 'administrators.invite' | 'administrators.manage'
  | 'roles.view' | 'roles.assign'
  | 'users.view' | 'users.manage' | 'groups.view' | 'groups.manage'
  | 'credentials.view' | 'credentials.manage' | 'credentials.issue'
  | 'verification.activities.view' | 'verification.activities.create' | 'verification.activities.manage'
  | 'verification.rules.manage' | 'verification.verifiers.assign' | 'verification.execute'
  | 'verification.results.view' | 'verification.exceptions.review'
  | 'settings.manage' | 'audit.view';

export interface PermissionInfo { id: Permission; label: string; area: string }

export const PERMISSIONS: PermissionInfo[] = [
  { id: 'administrators.view', label: 'View administrators', area: 'Administration' },
  { id: 'administrators.invite', label: 'Invite administrators', area: 'Administration' },
  { id: 'administrators.manage', label: 'Deactivate and reactivate administrators', area: 'Administration' },
  { id: 'roles.view', label: 'View roles and permissions', area: 'Administration' },
  { id: 'roles.assign', label: 'Assign roles', area: 'Administration' },
  { id: 'settings.manage', label: 'Manage organization settings', area: 'Administration' },
  { id: 'audit.view', label: 'View the audit log', area: 'Administration' },
  { id: 'users.view', label: 'View users', area: 'Users & groups' },
  { id: 'users.manage', label: 'Add and manage users', area: 'Users & groups' },
  { id: 'groups.view', label: 'View groups', area: 'Users & groups' },
  { id: 'groups.manage', label: 'Manage groups', area: 'Users & groups' },
  { id: 'credentials.view', label: 'View credentials and issued records', area: 'Credentials' },
  { id: 'credentials.manage', label: 'Create and edit credential configurations', area: 'Credentials' },
  { id: 'credentials.issue', label: 'Issue and manage issued credentials', area: 'Credentials' },
  { id: 'verification.activities.view', label: 'View verification activities', area: 'Verification' },
  { id: 'verification.activities.create', label: 'Create verification activities', area: 'Verification' },
  { id: 'verification.activities.manage', label: 'Manage verification activities', area: 'Verification' },
  { id: 'verification.rules.manage', label: 'Configure organization verification rules', area: 'Verification' },
  { id: 'verification.verifiers.assign', label: 'Assign verifiers to activities', area: 'Verification' },
  { id: 'verification.execute', label: 'Perform verifications', area: 'Verification' },
  { id: 'verification.results.view', label: 'View verification results and history', area: 'Verification' },
  { id: 'verification.exceptions.review', label: 'Review verification exceptions', area: 'Verification' },
];

/**
 * Where a role's permission applies. Most apply across the organization; a Verifier's apply only to
 * the activities they are assigned to. Activity-level checks use `canPerformVerification`.
 */
export type PermissionScope = 'organization' | 'assigned-activities';

/**
 * Verification rules come in three layers. Organizations can only ever change their own layer:
 * platform rules are enforced by FixID, and governing-authority rules will be set by an authorized
 * overseeing organization through permissions of its own (not part of any organization role).
 */
export type RuleLayer = 'platform' | 'governing-authority' | 'organization';

export function editableRuleLayers(perms: Set<Permission>): RuleLayer[] {
  return perms.has('verification.rules.manage') ? ['organization'] : [];
}

export type RoleId = 'organization-admin' | 'credential-manager' | 'verification-manager' | 'verifier' | 'viewer';

export interface Role {
  id: RoleId;
  name: string;
  description: string;
  permissions: Permission[];
  /** Permissions narrower than the whole organization. */
  scopes?: Partial<Record<Permission, PermissionScope>>;
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
    // Everything an organization can control. Performing verifications is the Verifier's job.
    permissions: PERMISSIONS.map((p) => p.id).filter((p) => p !== 'verification.execute'),
    highlights: [
      'Manage administrators and role assignments', 'Manage users and groups', 'Manage credential configurations and issuance',
      'Manage verification activities, organization rules and verifier assignments', 'View verification results and history',
      'Manage organization settings', 'View audit records',
    ],
    limits: ['Subject to platform security controls and any mandatory requirements of an authorized governing authority'],
  },
  {
    id: 'credential-manager', name: 'Credential Manager', builtIn: true, portalAccess: true,
    description: 'Configures credentials and issues them to users.',
    permissions: ['users.view', 'groups.view', 'credentials.view', 'credentials.manage', 'credentials.issue'],
    highlights: ['Manage credential configurations', 'Issue and manage credentials', 'View relevant user, group and credential information'],
    limits: ['Cannot manage administrators or verification rules'],
  },
  {
    id: 'verification-manager', name: 'Verification Manager', builtIn: true, portalAccess: true,
    description: 'Sets up verification activities and who may verify.',
    permissions: [
      'groups.view', 'verification.activities.view', 'verification.activities.create', 'verification.activities.manage', 'verification.rules.manage',
      'verification.verifiers.assign', 'verification.results.view', 'verification.exceptions.review',
    ],
    highlights: ['Create and manage verification activities', 'Configure permitted verification checks and rules', 'View groups for eligibility', 'Assign verifiers to activities', 'Review verification results and exceptions'],
    limits: ['Cannot change platform rules or requirements set by a governing authority', 'Cannot manage administrators or credentials'],
  },
  {
    id: 'verifier', name: 'Verifier', builtIn: true, portalAccess: false,
    description: 'Performs assigned verifications through an approved verifier application.',
    permissions: ['verification.execute', 'verification.results.view'],
    scopes: { 'verification.execute': 'assigned-activities', 'verification.results.view': 'assigned-activities' },
    highlights: ['Perform the verification activities they are assigned to', 'View results within their assigned activities'],
    limits: [
      'No access to the administration portal', 'Cannot create or change verification rules', 'Cannot assign themselves to activities',
      'Cannot manage administrators or issue credentials unless separately authorized',
    ],
  },
  {
    id: 'viewer', name: 'Viewer / Auditor', builtIn: true, portalAccess: true,
    description: 'Read-only access to records, reports and audit information.',
    permissions: [
      'administrators.view', 'roles.view', 'users.view', 'groups.view', 'credentials.view',
      'verification.activities.view', 'verification.results.view', 'audit.view',
    ],
    highlights: ['View authorized records and reports', 'Review audit records'],
    limits: ['Cannot create, edit, delete or change configurations'],
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
  return actor.has(p) || (p === 'verification.execute' && actor.has('verification.verifiers.assign'));
}

/** Whether the actor holds (or may grant) everything these roles allow. Nobody can act on someone with more access. */
export function coversRoles(actor: Set<Permission>, roleIds: readonly string[]): boolean {
  return roleIds.every((id) => roleById(id)?.permissions.every((p) => canGrantPermission(actor, p)) ?? false);
}

/** An administrator can only assign roles whose permissions they may grant. */
export function canGrantRoles(actor: Set<Permission>, roleIds: readonly string[]): boolean {
  return actor.has('roles.assign') && coversRoles(actor, roleIds);
}

// Activity-level verifier authorization lives with Verification Activities: see authorizeVerifier in domain/verification.ts.

export const INVITATION_TTL_DAYS = 7;
