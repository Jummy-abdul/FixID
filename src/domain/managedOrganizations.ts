/**
 * Organizations managed within a FixID workspace: entities such as a campus, a contractor or a department
 * that the workspace's administrators manage. They aren't workspaces: they have no administrators, sign-in
 * or settings of their own, and belonging to one never grants anyone administrative access. (Sub-organization
 * workspaces, created under Organizations → Sub-organizations, are a separate, earlier model.)
 */
export type ManagedOrganizationStatus = 'active' | 'inactive';

export interface ManagedOrganizationMember {
  /** A user (person) of the same workspace. */
  memberId: string;
  assignedAt: string;
  assignedBy: string;
}

export interface ManagedOrganization {
  id: string;
  /** The workspace whose administrators manage it. */
  organizationId: string;
  /** Unique within the workspace, e.g. ORG-1001. Generated, never reused. */
  reference: string;
  name: string;
  description?: string;
  contactEmail?: string;
  status: ManagedOrganizationStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  members: ManagedOrganizationMember[];
  /** Verification activities (activity configurations) associated with it. An activity belongs to at most one. */
  activityIds: string[];
}

export const MANAGED_ORG_STATUS_LABEL: Record<ManagedOrganizationStatus, string> = { active: 'Active', inactive: 'Inactive' };

/** The next reference in a workspace: ORG-1001, ORG-1002, … */
export function nextReference(existing: readonly Pick<ManagedOrganization, 'reference'>[]): string {
  const max = existing.reduce((m, o) => Math.max(m, Number(/^ORG-(\d+)$/.exec(o.reference)?.[1] ?? 1000)), 1000);
  return `ORG-${max + 1}`;
}
