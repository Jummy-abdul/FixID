/**
 * Fictional demonstration organizations and accounts for testing each kind of user (prototype only).
 * Every name, email and identifier here is invented. The accounts sign in through the normal email and
 * password sign-in (no bypass) and exist only in demo builds; see DEMO_AUTH_ENABLED in auth/authCore.
 */

/** Organization A: independent (no sub-organizations). */
export const ORG_A = 'org_northbridge';
/** Organization B: has two sub-organizations. */
export const ORG_B = 'org_meridian';
/** Organization B1 and B2: sub-organizations of B, each its own workspace. */
export const ORG_B1 = 'org_meridian_harbourside';
export const ORG_B2 = 'org_meridian_eastgate';

/** Seeded sub-organizations and their parent. */
export const SEEDED_SUB_ORGANIZATIONS: Record<string, string> = { [ORG_B1]: ORG_B, [ORG_B2]: ORG_B };

/** The custom role behind the "custom role" demonstration account (exists in Organization B2 only). */
export const B2_RECORDS_ROLE = `${ORG_B2}_role_records`;

export interface DemoPersona {
  /** The account ID; also the administrator records' `userId`. */
  accountId: string;
  persona: string;
  description: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Home organization; none for the Platform Administrator. */
  organizationId?: string;
  platform?: boolean;
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    accountId: 'acct_demo_platform', persona: 'Platform Administrator', platform: true,
    description: 'FixID platform operations: registered organizations, statuses and relationships. No organization workspace.',
    firstName: 'Priya', lastName: 'Raman', email: 'platform.admin@fixid.example',
  },
  {
    accountId: 'acct_demo_a_admin', persona: 'Organization Admin — independent organization', organizationId: ORG_A,
    description: 'Runs Organization A, which has no sub-organizations.',
    firstName: 'Esther', lastName: 'Lawal', email: 'esther.lawal@northbridge.example',
  },
  {
    accountId: 'acct_demo_b_admin', persona: 'Organization Admin — organization with sub-organizations', organizationId: ORG_B,
    description: 'Runs Organization B and oversees its two sub-organizations’ relationships, not their records.',
    firstName: 'Victor', lastName: 'Hale', email: 'victor.hale@meridian.example',
  },
  {
    accountId: 'acct_demo_b1_admin', persona: 'Sub-organization Admin', organizationId: ORG_B1,
    description: 'Runs sub-organization B1 (its own administrators, people and activities).',
    firstName: 'Lina', lastName: 'Ford', email: 'lina.ford@harbourside.example',
  },
  {
    accountId: 'acct_demo_b1_verifier', persona: 'Verifier', organizationId: ORG_B1,
    description: 'Verifies people for the B1 activities they’re assigned to.',
    firstName: 'Tomi', lastName: 'Okon', email: 'tomi.okon@harbourside.example',
  },
  {
    accountId: `${ORG_A}_usr_2`, persona: 'Auditor', organizationId: ORG_A,
    description: 'Read-only access to Organization A’s records, history and audit log.',
    firstName: 'Adaora', lastName: 'Nwosu', email: 'adaora.nwosu@northbridge.edu.ng',
  },
  {
    accountId: 'acct_demo_b2_records', persona: 'Custom role (Records Officer)', organizationId: ORG_B2,
    description: 'Holds a custom role in sub-organization B2: manages users and views groups, nothing else.',
    firstName: 'Joel', lastName: 'Park', email: 'joel.park@eastgate.example',
  },
  {
    accountId: 'acct_demo_b2_admin', persona: 'Sub-organization Admin (B2)', organizationId: ORG_B2,
    description: 'Runs sub-organization B2. Can’t see anything in B1.',
    firstName: 'Mira', lastName: 'Santos', email: 'mira.santos@eastgate.example',
  },
];

export const personaById = (id: string) => DEMO_PERSONAS.find((p) => p.accountId === id);
export const personaName = (p: DemoPersona) => `${p.firstName} ${p.lastName}`;
