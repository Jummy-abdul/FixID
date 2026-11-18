/**
 * Demonstration accounts for the JAMB Identity Verification Platform. Like the Platform Administrator, they
 * open their own workspace instead of an organization workspace, so no existing account, organization or
 * permission is affected. Fictional people; demo builds only.
 */
export type ConsoleRole = 'jamb-officer' | 'clearance-officer' | 'nysc-officer';

export interface ConsolePersona {
  accountId: string;
  consoleRole: ConsoleRole;
  persona: string;
  organization: string;
  role: string;
  description: string;
  firstName: string;
  lastName: string;
  email: string;
  /** The institution a clearance officer works for. */
  institution?: string;
}

export const JAMB_PERSONAS: ConsolePersona[] = [
  {
    accountId: 'acct_demo_jamb_officer', consoleRole: 'jamb-officer', persona: 'JAMB Officer',
    organization: 'Joint Admissions and Matriculation Board', role: 'Central Administrator',
    description: 'Oversee verification events, institutions, exceptions, student identity records and delegated access.',
    firstName: 'Aisha', lastName: 'Danjuma', email: 'jamb.officer@jamb-demo.example',
  },
  {
    accountId: 'acct_demo_unilag_clearance', consoleRole: 'clearance-officer', persona: 'University Clearance Officer',
    organization: 'University of Lagos', role: 'Institutional Clearance Officer',
    description: 'Verify admitted students’ identity and complete their admission clearance.',
    firstName: 'Tolulope', lastName: 'Adebayo', email: 'clearance.officer@unilag-demo.example', institution: 'UNILAG',
  },
  {
    accountId: 'acct_demo_nysc_officer', consoleRole: 'nysc-officer', persona: 'NYSC Clearance Officer',
    organization: 'National Youth Service Corps', role: 'NYSC Verification Officer',
    description: 'Verify prospective corps members’ identity and confirm their educational and matriculation history.',
    firstName: 'Hadiza', lastName: 'Lawal', email: 'nysc.officer@nysc-demo.example',
  },
];

export const consoleHome = (role: ConsoleRole) => (role === 'jamb-officer' ? '/jamb' : role === 'nysc-officer' ? '/nysc' : '/clearance');
