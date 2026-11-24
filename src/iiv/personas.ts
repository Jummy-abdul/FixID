import type { ConsolePersona } from '@/jamb/personas';

/**
 * Accounts of the JAMB Institutional Identity Verification experience: a JAMB administrator who manages
 * participating institutions, events and identity records, and an institution clearance officer who verifies
 * candidates. Separate from the JAMB, university clearance and NYSC console accounts and their data.
 */
export const IIV_PERSONAS: ConsolePersona[] = [
  {
    accountId: 'acct_demo_iiv_admin', consoleRole: 'iiv-admin', persona: 'JAMB Administrator',
    organization: 'Joint Admissions and Matriculation Board', role: 'Identity Verification Administrator',
    description: 'Manage participating institutions, publish admission verification events, maintain identity records and review verification results.',
    firstName: 'Halima', lastName: 'Abubakar', email: 'jamb.admin@jamb-demo.example',
  },
  {
    accountId: 'acct_demo_iiv_officer', consoleRole: 'iiv-officer', persona: 'Institution Clearance Officer',
    organization: 'University of Ibadan', role: 'Admissions Clearance Officer',
    description: 'Verify candidates’ identity against their JAMB and NIN records during admission clearance.',
    firstName: 'Adebola', lastName: 'Ogunyemi', email: 'clearance.officer@ui-demo.example', institution: 'UI',
  },
];
export const iivPersonaFor = (email: string | undefined) => IIV_PERSONAS.find((p) => p.email.toLowerCase() === (email ?? '').toLowerCase());
