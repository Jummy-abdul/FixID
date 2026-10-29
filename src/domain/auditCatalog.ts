import type { AuditAction, AuditEvent } from './types';

/**
 * Audit Logs presentation: each recorded action's module and a short, readable activity name. Events are
 * read-only records written by the modules themselves; this only names them.
 */
export type AuditModule =
  | 'Administrators' | 'Roles & Privileges' | 'Organizations' | 'Verification Activities' | 'Verification' | 'Exceptions'
  | 'Users' | 'Groups' | 'Credentials' | 'Integrations' | 'Settings' | 'Security' | 'Status API (simulated)';

export const AUDIT_MODULES: AuditModule[] = [
  'Administrators', 'Roles & Privileges', 'Organizations', 'Verification Activities', 'Verification', 'Exceptions',
  'Users', 'Groups', 'Credentials', 'Integrations', 'Settings', 'Security', 'Status API (simulated)',
];

export function moduleOf(action: AuditAction): AuditModule {
  const [area] = action.split('.');
  if (action === 'admin.role-assigned' || action === 'admin.roles-changed' || action === 'admin.role-removed' || area === 'role') return 'Roles & Privileges';
  if (area === 'admin') return 'Administrators';
  if (area === 'managed-organization' || action === 'organization.created' || action.startsWith('organization.sub') || action === 'organization.bulk-imported') return 'Organizations';
  if (area === 'organization' || area === 'sso') return 'Settings';
  if (area === 'verification-activity' || area === 'activity') return 'Verification Activities';
  if (area === 'verification') return 'Verification';
  if (area === 'exception') return 'Exceptions';
  if (area === 'user' || area === 'enrollment' || area === 'identity' || area === 'identifier') return 'Users';
  if (area === 'group') return 'Groups';
  if (area === 'credential' || area === 'credential-type' || area === 'credential-logo' || area === 'issuance' || area === 'wallet') return 'Credentials';
  if (area === 'integration') return 'Integrations';
  if (area === 'api') return 'Status API (simulated)';
  return 'Security';
}

const LABELS: Partial<Record<AuditAction, string>> = {
  'admin.invited': 'Administrator invited', 'admin.invitation-resent': 'Administrator invitation resent', 'admin.invitation-revoked': 'Administrator invitation revoked',
  'admin.invitation-expired': 'Administrator invitation expired', 'admin.joined': 'Administrator added', 'admin.deactivated': 'Administrator deactivated',
  'admin.reactivated': 'Administrator reactivated', 'admin.sso-linked': 'Single sign-on linked', 'admin.sso-unlinked': 'Single sign-on unlinked',
  'admin.role-assigned': 'Administrator role assigned', 'admin.roles-changed': 'Administrator role changed', 'admin.role-removed': 'Administrator role removed',
  'role.created': 'Administrative role created', 'role.updated': 'Role privileges updated', 'role.deleted': 'Administrative role deleted',
  'managed-organization.created': 'Organization created', 'managed-organization.updated': 'Organization details edited',
  'managed-organization.status-changed': 'Organization status changed', 'managed-organization.member-assigned': 'User assigned to an organization',
  'managed-organization.member-removed': 'User removed from an organization', 'managed-organization.activity-linked': 'Activity associated with an organization',
  'managed-organization.activity-unlinked': 'Activity association removed', 'organization.created': 'Organization registered', 'organization.updated': 'Organization profile updated',
  'organization.sub-created': 'Sub-organization created', 'organization.bulk-imported': 'Sub-organizations imported', 'organization.sub-invitation-resent': 'Sub-organization invitation resent',
  'verification-activity.created': 'Verification activity created', 'verification-activity.updated': 'Verification activity updated',
  'verification-activity.checks-changed': 'Verification checks changed', 'verification-activity.rules-changed': 'Verification rules changed',
  'verification-activity.providers-changed': 'Verification providers changed', 'verification-activity.verifier-assigned': 'Verifier assigned',
  'verification-activity.verifier-removed': 'Verifier unassigned', 'verification-activity.activated': 'Verification activity activated',
  'verification-activity.deactivated': 'Verification activity paused', 'verification-activity.completed': 'Verification activity ended',
  'verification-activity.duplicated': 'Verification activity duplicated', 'verification-activity.removed': 'Verification activity removed',
  'verification-activity.draft-discarded': 'Draft changes discarded', 'verification-activity.participants-changed': 'Eligible participants changed',
  'verification-activity.participants-invited': 'Organizations invited to an activity', 'verification-activity.participant-changed': 'Activity participation changed',
  'verification-activity.invitation-accepted': 'Activity invitation accepted', 'verification-activity.invitation-declined': 'Activity invitation declined',
  'activity.updated': 'Verification activity updated',
  'verification.denied': 'Verification refused', 'verification.entry-recorded': 'Entry recorded', 'verification.entry-denied': 'Entry refused',
  'exception.created': 'Exception raised', 'exception.assigned': 'Exception reviewer assigned', 'exception.review-started': 'Exception review started',
  'exception.note-added': 'Exception note added', 'exception.information-requested': 'Exception information requested', 'exception.resolved': 'Exception decision recorded',
  'exception.closed': 'Exception closed', 'exception.reverification-started': 'Reverification started', 'exception.reverification-completed': 'Reverification completed',
  'exception.proposal-submitted': 'Exception decision submitted for approval', 'exception.proposal-approved': 'Exception decision approved',
  'exception.proposal-rejected': 'Exception decision rejected', 'exception.proposal-returned': 'Exception decision returned',
  'exception.escalated': 'Exception escalated', 'exception.reopened': 'Exception reopened', 'exception.evidence-viewed': 'Exception evidence viewed',
  'exception.workflow-changed': 'Exception approval setting changed', 'access.denied': 'Access refused',
  'api.status-requested': 'Status requested', 'api.status-denied': 'Status request refused',
};

/** A short activity name, e.g. "Administrative role created". */
export function activityLabel(action: AuditAction): string {
  const known = LABELS[action];
  if (known) return known;
  const [area, verb = ''] = action.split('.');
  const text = `${area.replace(/-/g, ' ')} ${verb.replace(/-/g, ' ')}`.trim();
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * Per-attempt events from earlier versions (started, completed, cancelled). Attempts belong in Verification
 * History, so Audit Logs doesn't list them.
 */
export const isAttemptEvent = (e: Pick<AuditEvent, 'action'>) => e.action === 'verification.started' || e.action === 'verification.completed' || e.action === 'verification.cancelled';
