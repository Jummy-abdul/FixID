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

/**
 * The demonstration accounts offered at sign-in: the Platform Administrator, administrators of the sample
 * organization (Brightwater Collective) with full and restricted privileges, and a verifier. Exception decisions
 * there need approval, so the demo account (Tobyson TE, in authCore) is the second approver.
 */
export const DEMO_PERSONAS: DemoPersona[] = [
  {
    accountId: 'acct_demo_platform', persona: 'Platform Administrator', platform: true,
    description: 'Platform-level console: every registered organization, its status and relationships. Holds no organization role.',
    firstName: 'Priya', lastName: 'Raman', email: 'platform.admin@fixid.example',
  },
  {
    accountId: 'acct_demo_c_admin', persona: 'Administrator — full privileges (Organization Admin role)', organizationId: ORG_C,
    description: 'Manages administrators, roles and privileges, organizations, verification activities and exceptions. Exception decisions need a second approver.',
    firstName: 'Jordan', lastName: 'Blake', email: 'jordan.blake@brightwater.example',
  },
  {
    accountId: `${ORG_C}_usr_2`, persona: 'Administrator — restricted (Auditor role)', organizationId: ORG_C,
    description: 'Read-only: verification history, exceptions, organizations, reports and the audit log. Can’t change anything.',
    firstName: 'Adaora', lastName: 'Nwosu', email: 'adaora.nwosu@brightwater.example',
  },
  {
    accountId: `${ORG_C}_usr_4`, persona: 'Verifier', organizationId: ORG_C,
    description: 'Verifies people only for the activities they’re assigned to (Visitor Check-in, Restricted Lounge Access, Badge Collection). No administration.',
    firstName: 'Halima', lastName: 'Bello', email: 'halima.bello@brightwater.example',
  },
];

/**
 * Administrators of the other sample workspaces (Northbridge, Meridian and its sub-organizations). They're
 * records in the seeded data only: they aren't demonstration accounts and can't sign in to the demo. Automated
 * tests still sign in as them to cover the sub-organization and shared-activity features that remain in the code.
 */
export const SAMPLE_WORKSPACE_PERSONAS: DemoPersona[] = [
  { accountId: 'acct_demo_a_admin', persona: 'Organization Admin (Northbridge)', organizationId: ORG_A, description: 'Sample workspace record.', firstName: 'Esther', lastName: 'Lawal', email: 'esther.lawal@northbridge.example' },
  { accountId: 'acct_demo_b_admin', persona: 'Organization Admin (Meridian)', organizationId: ORG_B, description: 'Sample workspace record.', firstName: 'Victor', lastName: 'Hale', email: 'victor.hale@meridian.example' },
  { accountId: 'acct_demo_b1_admin', persona: 'Organization Admin (Meridian Harbourside)', organizationId: ORG_B1, description: 'Sample workspace record.', firstName: 'Lina', lastName: 'Ford', email: 'lina.ford@harbourside.example' },
  { accountId: 'acct_demo_b1_verifier', persona: 'Verifier (Meridian Harbourside)', organizationId: ORG_B1, description: 'Sample workspace record.', firstName: 'Tomi', lastName: 'Okon', email: 'tomi.okon@harbourside.example' },
  { accountId: `${ORG_A}_usr_2`, persona: 'Auditor (Northbridge)', organizationId: ORG_A, description: 'Sample workspace record.', firstName: 'Adaora', lastName: 'Nwosu', email: 'adaora.nwosu@northbridge.example' },
  { accountId: 'acct_demo_b2_records', persona: 'Records Officer (Meridian Eastgate)', organizationId: ORG_B2, description: 'Sample workspace record.', firstName: 'Joel', lastName: 'Park', email: 'joel.park@eastgate.example' },
  { accountId: 'acct_demo_b2_admin', persona: 'Organization Admin (Meridian Eastgate)', organizationId: ORG_B2, description: 'Sample workspace record.', firstName: 'Mira', lastName: 'Santos', email: 'mira.santos@eastgate.example' },
  { accountId: 'acct_demo_b_reviewer', persona: 'Exception Reviewer (Meridian)', organizationId: ORG_B, description: 'Sample workspace record.', firstName: 'Sam', lastName: 'Rivera', email: 'sam.rivera@meridian.example' },
];

/** Every fictional person behind an account ID (demonstration accounts and sample workspace records). */
export const ALL_PERSONAS: DemoPersona[] = [...DEMO_PERSONAS, ...SAMPLE_WORKSPACE_PERSONAS];

/**
 * The two accounts shown first in the sign-in "Demo accounts" dialog: an administrator and a verifier in the same
 * organization, whose seeded activities cover local and external verification, assignment and exceptions.
 */
export const FEATURED_DEMO_ACCOUNTS: { accountId: string; role: string }[] = [
  { accountId: 'acct_demo_c_admin', role: 'Administrator' },
  { accountId: `${ORG_C}_usr_4`, role: 'Verifier' },
];

export const personaById = (id: string) => ALL_PERSONAS.find((p) => p.accountId === id);
export const personaName = (p: DemoPersona) => `${p.firstName} ${p.lastName}`;
