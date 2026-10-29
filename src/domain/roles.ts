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
  | 'roles.assign' | 'roles.manage' | 'organization.view' | 'settings.manage' | 'sso.manage' | 'audit.view'
  | 'organizations.view' | 'organizations.manage' | 'organizations.edit' | 'organizations.members' | 'integrations.view' | 'integrations.manage'
  | 'exceptions.view' | 'exceptions.review' | 'exceptions.resolve' | 'exceptions.approve' | 'exceptions.reopen' | 'exceptions.configure' | 'reports.view';

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

/** What each privilege lets an administrator do, in plain language (shown beside its name). */
export const PERMISSION_DESCRIPTION: Record<Permission, string> = {
  'users.view': 'See the user list and each person’s profile, credentials and verifications.',
  'users.create': 'Add people one at a time.',
  'users.import': 'Add many people at once from a CSV file.',
  'users.edit': 'Activate or deactivate people and send them enrolment invitations.',
  'groups.view': 'See groups and their members.',
  'groups.manage': 'Create, rename and remove groups.',
  'groups.members': 'Add people to groups or remove them.',
  'credentials.view': 'See credential configurations and who holds them.',
  'credentials.manage': 'Set up and change credential configurations.',
  'credentials.issue': 'Issue credentials to people.',
  'verification.activities.view': 'See verification activities, their settings and results summaries.',
  'verification.activities.create': 'Create new verification activities and drafts.',
  'verification.activities.edit': 'Change activity settings and eligible participants.',
  'verification.activities.activate': 'Start, pause, resume and end activities.',
  'verification.verifiers.assign': 'Choose which administrators verify for each activity.',
  'verification.execute': 'Verify people in the Verifier view, only for activities they’re assigned to.',
  'verification.results.view': 'See Verification History: every attempt, its original result and any review outcome.',
  'exceptions.view': 'See exceptions and their history without acting on them.',
  'exceptions.review': 'Take on cases, view the simulated portrait comparison, add notes, request another attempt, escalate and propose decisions.',
  'exceptions.resolve': 'Record final decisions directly when approval isn’t required, and close resolved cases.',
  'exceptions.approve': 'Approve, reject or return another reviewer’s proposed decision.',
  'exceptions.reopen': 'Reopen a resolved or closed case, with a reason.',
  'exceptions.configure': 'Choose whether exception decisions need a second person’s approval.',
  'reports.view': 'See verification and exception reports and export aggregate figures.',
  'administrators.view': 'See administrators, their roles, and the roles and privileges.',
  'administrators.invite': 'Invite new administrators with a role they’re allowed to grant.',
  'administrators.manage': 'Deactivate and reactivate administrators.',
  'roles.assign': 'Change an administrator’s role, only to roles within their own authority.',
  'roles.manage': 'Create, edit and delete custom roles, only with privileges they hold themselves.',
  'organization.view': 'See the organization profile.',
  'settings.manage': 'Change the organization profile and branding.',
  'sso.manage': 'Configure single sign-on.',
  'audit.view': 'Read the audit log.',
  'integrations.view': 'See connected identity services (never their credentials).',
  'integrations.manage': 'Configure, test, activate and deactivate identity services.',
  'organizations.view': 'See sub-organizations and their onboarding status.',
  'organizations.manage': 'Create sub-organizations and resend their first invitation.',
  'organizations.edit': 'Edit organization details and their activity associations (Organization Management, coming soon).',
  'organizations.members': 'Assign users to organizations and manage membership (Organization Management, coming soon). Membership never grants administrator access.',
};

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
  { id: 'exceptions.view', label: 'View verification exceptions (read-only)', area: 'Exceptions' },
  { id: 'exceptions.review', label: 'Review exceptions: assign, inspect evidence, add notes, request another attempt and propose decisions', area: 'Exceptions', sensitive: true },
  { id: 'exceptions.resolve', label: 'Resolve exceptions when approval isn’t required, and close resolved exceptions', area: 'Exceptions', sensitive: true },
  { id: 'exceptions.approve', label: 'Approve, reject or return proposed exception decisions (never one’s own)', area: 'Exceptions', sensitive: true },
  { id: 'exceptions.reopen', label: 'Reopen resolved or closed exceptions', area: 'Exceptions', sensitive: true },
  { id: 'exceptions.configure', label: 'Configure whether exception decisions require approval', area: 'Exceptions', sensitive: true },
  { id: 'reports.view', label: 'View verification and exception reports, and export aggregates', area: 'Reports' },
  { id: 'administrators.view', label: 'View administrators and roles', area: 'Administration' },
  { id: 'administrators.invite', label: 'Invite administrators', area: 'Administration', sensitive: true },
  { id: 'administrators.manage', label: 'Deactivate and reactivate administrators', area: 'Administration', sensitive: true },
  { id: 'roles.assign', label: 'Change administrators’ roles', area: 'Administration', sensitive: true },
  { id: 'roles.manage', label: 'Create, edit and delete custom roles', area: 'Administration', sensitive: true },
  { id: 'organization.view', label: 'View the organization profile', area: 'Administration' },
  { id: 'settings.manage', label: 'Update the organization profile', area: 'Administration', sensitive: true },
  { id: 'sso.manage', label: 'Manage SSO configuration', area: 'Administration', sensitive: true },
  { id: 'audit.view', label: 'View the audit log', area: 'Administration' },
  { id: 'integrations.view', label: 'View custom identity services (no credentials)', area: 'Integrations' },
  { id: 'integrations.manage', label: 'Configure, test, activate and deactivate custom identity services', area: 'Integrations', sensitive: true },
  { id: 'organizations.view', label: 'View sub-organizations and their onboarding', area: 'Organizations' },
  { id: 'organizations.manage', label: 'Create sub-organizations and resend their initial invitations', area: 'Organizations', sensitive: true },
  // Prepared for Organization Management; no screen uses them yet.
  { id: 'organizations.edit', label: 'Edit organizations', area: 'Organizations', sensitive: true, planned: true },
  { id: 'organizations.members', label: 'Manage organization membership', area: 'Organizations', sensitive: true, planned: true },
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
    permissions: ['users.view', 'groups.view', 'credentials.view', 'verification.activities.view', 'verification.results.view', 'administrators.view', 'organization.view', 'audit.view', 'organizations.view', 'integrations.view', 'exceptions.view', 'reports.view'],
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
 * The earlier built-in Credential Manager and Verification Manager roles. Used only to migrate saved data
 * that still assigns them; organizations never get them by default.
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
