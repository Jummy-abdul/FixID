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

/** Organization C: has a custom identity service in Draft. Organization D (sub-organization B1): its service failed its connection test. */
export const ORG_C = 'org_lts';
export const ORG_D = ORG_B1;

/** Seeded sub-organizations and their parent. */
export const SEEDED_SUB_ORGANIZATIONS: Record<string, string> = { [ORG_B1]: ORG_B, [ORG_B2]: ORG_B };

/** The custom role behind the "custom role" demonstration account (exists in Organization B2 only). */
export const B2_RECORDS_ROLE = `${ORG_B2}_role_records`;
/** The custom role behind the exception reviewer account (exists in Organization B only). */
export const B_REVIEWER_ROLE = `${ORG_B}_role_exception_reviewer`;

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
    accountId: 'acct_demo_b_admin', persona: 'Organization Admin — owns a shared activity', organizationId: ORG_B,
    description: 'Runs Organization B and owns a shared activity its two sub-organizations take part in. Sees that activity’s results and exceptions, not their other records.',
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
    firstName: 'Adaora', lastName: 'Nwosu', email: 'adaora.nwosu@northbridge.example',
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
  {
    accountId: 'acct_demo_b_reviewer', persona: 'Custom role (Exception Reviewer)', organizationId: ORG_B,
    description: 'Holds a custom role in Organization B: reviews exceptions, including those from its shared activity, and views reports. No configuration access.',
    firstName: 'Sam', lastName: 'Rivera', email: 'sam.rivera@meridian.example',
  },
  {
    accountId: 'acct_demo_c_admin', persona: 'Organization Admin — independent organization with an external identity service', organizationId: ORG_C,
    description: 'Runs Organization C: its activities, its simulated identity source and its exception reviews. Has an invitation to Organization B’s shared activity.',
    firstName: 'Jordan', lastName: 'Blake', email: 'jordan.blake@brightwater.example',
  },
  {
    accountId: `${ORG_C}_usr_4`, persona: 'Verifier (Organization C)', organizationId: ORG_C,
    description: 'Verifies people for Organization C’s local and external activities they’re assigned to.',
    firstName: 'Halima', lastName: 'Bello', email: 'halima.bello@brightwater.example',
  },
  {
    accountId: `${ORG_C}_usr_2`, persona: 'Auditor (Organization C)', organizationId: ORG_C,
    description: 'Read-only access to Organization C’s history, exceptions, reports and audit log.',
    firstName: 'Adaora', lastName: 'Nwosu', email: 'adaora.nwosu@brightwater.example',
  },
];

export const personaById = (id: string) => DEMO_PERSONAS.find((p) => p.accountId === id);
export const personaName = (p: DemoPersona) => `${p.firstName} ${p.lastName}`;
