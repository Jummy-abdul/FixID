import type { Industry, Organization } from '@/domain/types';

/** Example user types by industry. Examples only: organizations can name their own. */
const BY_INDUSTRY: Record<Industry, string[]> = {
  education: ['Student', 'Staff', 'Member'],
  corporate: ['Employee', 'Contractor', 'Member'],
  healthcare: ['Staff', 'Patient', 'Member'],
  events: ['Attendee', 'Speaker', 'Member'],
  membership: ['Member', 'Staff', 'Volunteer'],
};

export function userTypeSuggestions(org: Organization, existingNames: string[]): string[] {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  return BY_INDUSTRY[org.industry].filter((n) => !taken.has(n.toLowerCase()));
}

export interface CredentialDefaults {
  name: string;
  identifierLabel: string;
  identifierMode: 'generated' | 'manual';
  prefix: string;
}

/** Sensible starting values for a user type's first credential. All editable. */
export function credentialDefaults(org: Organization, userTypeName: string): CredentialDefaults {
  const name = userTypeName.trim();
  const code = name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ID';
  const short = org.shortName.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  switch (name.toLowerCase()) {
    case 'student':
      return { name: 'Student ID', identifierLabel: 'Matric number', identifierMode: 'manual', prefix: `${short}-STU-` };
    case 'staff':
      return { name: 'Staff ID', identifierLabel: 'Staff number', identifierMode: 'generated', prefix: `${short}-STF-` };
    case 'employee':
      return { name: 'Employee ID', identifierLabel: 'Employee number', identifierMode: 'generated', prefix: `${short}-EMP-` };
    case 'member':
      return { name: 'Membership ID', identifierLabel: 'Membership number', identifierMode: 'generated', prefix: `${short}-MEM-` };
    default:
      return { name: `${name} ID`, identifierLabel: `${name} number`, identifierMode: 'generated', prefix: `${short}-${code}-` };
  }
}
