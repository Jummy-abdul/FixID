/**
 * Demonstration accounts for the proposed JAMB identity assurance use case. Like the Platform Administrator,
 * they open a separate console instead of an organization workspace, so no existing account, organization
 * or permission is affected. Fictional people; demo builds only.
 */
export type ConsoleRole = 'jamb-officer' | 'clearance-officer';

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
    organization: 'Joint Admissions and Matriculation Board (JAMB)', role: 'Central Identity Assurance Administrator',
    description: 'Monitor student identity verification, institutional clearance and matriculation activities across participating universities.',
    firstName: 'Aisha', lastName: 'Danjuma', email: 'jamb.officer@jamb-demo.example',
  },
  {
    accountId: 'acct_demo_unilag_clearance', consoleRole: 'clearance-officer', persona: 'University Clearance Officer',
    organization: 'University of Lagos (UNILAG)', role: 'Institutional Clearance Officer',
    description: 'Perform biometric identity verification of admitted students before clearance and matriculation.',
    firstName: 'Tolulope', lastName: 'Adebayo', email: 'clearance.officer@unilag-demo.example', institution: 'UNILAG',
  },
];

export const consoleHome = (role: ConsoleRole) => (role === 'jamb-officer' ? '/jamb' : '/clearance');
