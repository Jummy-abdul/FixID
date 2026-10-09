import type { ActivityConfig, ActivityVersion, Group, GroupMembership, VerificationActivity } from './types';

/**
 * Group membership queries. This is the one place screens and future features (such as a
 * verification eligibility check) read membership from, always by stable IDs and always within
 * one organization. Production would back these with a server-side, authorized data service.
 */

export interface GroupData {
  groups: Group[];
  groupMemberships: GroupMembership[];
  activities?: VerificationActivity[];
  activityConfigs?: ActivityConfig[];
  activityVersions?: ActivityVersion[];
}

export const groupsOf = (d: GroupData, organizationId: string) => d.groups.filter((g) => g.organizationId === organizationId);

export const findGroup = (d: GroupData, organizationId: string, groupId: string) =>
  d.groups.find((g) => g.id === groupId && g.organizationId === organizationId);

/** Memberships of a group, scoped to the organization. */
export const membershipsOfGroup = (d: GroupData, organizationId: string, groupId: string) =>
  d.groupMemberships.filter((m) => m.organizationId === organizationId && m.groupId === groupId);

/** Groups a user currently belongs to, in name order. */
export function groupsForMember(d: GroupData, organizationId: string, memberId: string): { group: Group; membership: GroupMembership }[] {
  return d.groupMemberships
    .filter((m) => m.organizationId === organizationId && m.memberId === memberId)
    .flatMap((membership) => {
      const group = findGroup(d, organizationId, membership.groupId);
      return group ? [{ group, membership }] : [];
    })
    .sort((a, b) => a.group.name.localeCompare(b.group.name));
}

/**
 * Is this user currently a member of the group? Evaluated from current membership data, within the
 * organization, by group ID. A future eligibility check can call this; membership is never proof of identity.
 */
export function isGroupMember(d: GroupData, organizationId: string, groupId: string, memberId: string): boolean {
  return !!findGroup(d, organizationId, groupId)
    && d.groupMemberships.some((m) => m.organizationId === organizationId && m.groupId === groupId && m.memberId === memberId);
}

/** Member counts per group ID for an organization. */
export function memberCounts(d: GroupData, organizationId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of d.groupMemberships) if (m.organizationId === organizationId) out.set(m.groupId, (out.get(m.groupId) ?? 0) + 1);
  return out;
}

/**
 * Features that rely on a group: verification activities whose active or draft configuration checks
 * membership of it. Removal is blocked while any do.
 */
export function groupDependencies(d: GroupData, organizationId: string, groupId: string): { kind: 'verification-activity'; id: string; name: string }[] {
  const legacy = (d.activities ?? [])
    .filter((a) => a.organizationId === organizationId && a.eligibility.groupIds?.includes(groupId))
    .map((a) => ({ kind: 'verification-activity' as const, id: a.id, name: a.name }));
  const configured = (d.activityConfigs ?? [])
    .filter((a) => a.organizationId === organizationId)
    .filter((a) => (d.activityVersions ?? []).some((v) => (v.id === a.activeVersionId || v.id === a.draftVersionId)
      && v.checks.some((c) => c.type === 'group-membership' && c.params.groupIds?.includes(groupId))))
    .map((a) => ({ kind: 'verification-activity' as const, id: a.id, name: a.name }));
  return [...legacy, ...configured];
}

export const GROUP_NAME_MAX = 80;
export const GROUP_DESCRIPTION_MAX = 300;

/** Validation shared by the form and the store. */
export function groupProblems(d: GroupData, organizationId: string, input: { name: string; description: string }, exceptId?: string) {
  const errors: { name?: string; description?: string } = {};
  const name = input.name.trim();
  if (!name) errors.name = 'Enter a group name.';
  else if (name.length < 2) errors.name = 'Use at least 2 characters.';
  else if (name.length > GROUP_NAME_MAX) errors.name = `Keep the name under ${GROUP_NAME_MAX} characters.`;
  else if (groupsOf(d, organizationId).some((g) => g.id !== exceptId && g.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = 'A group with this name already exists.';
  }
  if (input.description.trim().length > GROUP_DESCRIPTION_MAX) errors.description = `Keep the description under ${GROUP_DESCRIPTION_MAX} characters.`;
  return errors;
}
