import { METHOD_ASSURANCE, meetsAssurance } from '@/domain/rules';
import type {
  OrganizationRelationship,
  SsoConnection,
  CustomRole, LogoAsset,
  AdminUser,
  AuditEvent,
  CardDesign,
  Credential,
  CredentialStatus,
  CredentialType,
  Decision,
  Member,
  OrgAdministrator,
  Group,
  GroupMembership,
  IssuanceBatch,
  StandardRequirements,
  ActivityConfig,
  ActivityVersion,
  VerifierAssignment,
  VerificationAttempt,
  Organization,
  Transaction,
  IdentifierConfig,
  VerificationActivity,
  VerificationResult,
  WalletDeliveryStatus,
} from '@/domain/types';
import { addDays, addMonths, startOfDay } from '@/lib/dates';
import { formatIdentifier } from '@/lib/identifiers';
import { templateForDesign } from '@/domain/templates';
import { buildChecks } from '@/domain/verification';
import { LEGACY_ROLE_TEMPLATES } from '@/domain/roles';
import { invitationToken } from '@/lib/tokens';
import type { VerificationException } from '@/domain/exceptions';
import { DEFAULT_DECISION_RULES, type VerificationSettings } from '@/domain/activitySettings';
import { CONTRACT_VERSION, SIMULATED_BASE_URL, type CustomIntegration, type IntegrationCheck } from '@/domain/integrations';
import { B2_RECORDS_ROLE, B_REVIEWER_ROLE, ORG_A, ORG_B, ORG_B1, ORG_B2, ORG_C, ORG_D, SEEDED_SUB_ORGANIZATIONS } from './demoPersonas';
import { buildIdSwitchRegistry } from './idSwitchRegistry';
import { createRng, type Rng } from './random';

export interface SeedData {
  organizations: Organization[];
  admin: AdminUser;
  cardDesigns: CardDesign[];
  credentialTypes: CredentialType[];
  identifierConfigs: IdentifierConfig[];
  members: Member[];
  credentials: Credential[];
  activities: VerificationActivity[];
  transactions: Transaction[];
  audit: AuditEvent[];
  /** Administrative users per organization (Settings → Administrators & Roles). */
  administrators: OrgAdministrator[];
  /** User groups per organization (User Management → Groups) and their memberships. */
  groups: Group[];
  groupMemberships: GroupMembership[];
  /** Issuance runs started from groups. */
  issuanceBatches: IssuanceBatch[];
  /** Configured verification activities, their versions, and verifier assignments. */
  activityConfigs: ActivityConfig[];
  activityVersions: ActivityVersion[];
  verifierAssignments: VerifierAssignment[];
  /** Verification attempts performed through the verification service (Verifier Interface or approved apps). */
  verificationAttempts: VerificationAttempt[];
  /** Custom roles, each owned by one organization. */
  customRoles: CustomRole[];
  /** Credential logos uploaded by each organization. */
  logoAssets: LogoAsset[];
  /** Each organization's single sign-on (OIDC) connection, when configured. */
  ssoConnections: SsoConnection[];
  /** Parent and sub-organization relationships. */
  organizationRelationships: OrganizationRelationship[];
  /** Custom identity services, each owned by one organization. */
  customIntegrations: CustomIntegration[];
  verificationExceptions: VerificationException[];
  /** Organizations managed inside a workspace (no workspace, sign-in or administrators of their own). */
  managedOrganizations?: import('@/domain/managedOrganizations').ManagedOrganization[];
}

const DAY = 86_400_000;

/**
 * Sample administrators. Every demo organization has the demo administrator as Organization Admin;
 * established organizations also show the other roles and statuses. Crestfield (brand new) has only its owner.
 */
export function seedAdministrators(organizations: Pick<Organization, 'id' | 'contactEmail' | 'createdAt'>[], today: Date): OrgAdministrator[] {
  const iso = (d: Date) => d.toISOString();
  const ago = (days: number) => iso(new Date(today.getTime() - days * DAY));
  const out: OrgAdministrator[] = [];
  const record = (orgId: string, key: string, name: string, email: string, userId: string, roleId: string, createdDaysAgo: number): OrgAdministrator => ({
    id: `${orgId}_adm_${key}`, organizationId: orgId, email, name, userId, roleIds: [roleId], status: 'active', createdAt: ago(createdDaysAgo), lastActiveAt: ago(1),
  });
  for (const org of organizations) {
    const domain = org.contactEmail.split('@')[1] ?? 'example.org';
    // Sub-organizations have their own administrators only: the parent's administrators aren't members.
    if (SEEDED_SUB_ORGANIZATIONS[org.id]) {
      if (org.id === ORG_B1) {
        out.push(
          record(org.id, 'owner', 'Lina Ford', 'lina.ford@harbourside.example', 'acct_demo_b1_admin', 'organization-admin', 200),
          record(org.id, 'verifier', 'Tomi Okon', 'tomi.okon@harbourside.example', 'acct_demo_b1_verifier', 'verifier', 150),
        );
      } else if (org.id === ORG_B2) {
        out.push(
          record(org.id, 'owner', 'Mira Santos', 'mira.santos@eastgate.example', 'acct_demo_b2_admin', 'organization-admin', 190),
          record(org.id, 'records', 'Joel Park', 'joel.park@eastgate.example', 'acct_demo_b2_records', B2_RECORDS_ROLE, 120),
        );
      }
      continue;
    }
    out.push({
      id: `${org.id}_adm_owner`, organizationId: org.id, email: 'tobyson.te@fixid.demo', name: 'Tobyson TE', userId: 'usr_tobyson',
      roleIds: ['organization-admin'], status: 'active', createdAt: org.createdAt, lastActiveAt: iso(today),
    });
    if (org.id === NEW_ORGANIZATION_ID) continue;
    // Demonstration accounts' own Organization Admin records (Organization A and B).
    if (org.id === ORG_A) out.push(record(org.id, 'lead', 'Esther Lawal', 'esther.lawal@northbridge.example', 'acct_demo_a_admin', 'organization-admin', 330));
    if (org.id === ORG_B) out.push(record(org.id, 'lead', 'Victor Hale', 'victor.hale@meridian.example', 'acct_demo_b_admin', 'organization-admin', 330));
    if (org.id === ORG_B) out.push(record(org.id, 'reviewer', 'Sam Rivera', 'sam.rivera@meridian.example', 'acct_demo_b_reviewer', B_REVIEWER_ROLE, 90));
    if (org.id === ORG_C) out.push(record(org.id, 'lead', 'Jordan Blake', 'jordan.blake@brightwater.example', 'acct_demo_c_admin', 'organization-admin', 300));
    // Invitations last 72 hours: the first is pending, the second has expired. Link tokens are random.
    const invite = (sentDaysAgo: number) => ({ sentAt: ago(sentDaysAgo), expiresAt: ago(sentDaysAgo - 3), sendCount: 1, invitedBy: 'Tobyson TE', token: invitationToken() });
    out.push(
      { id: `${org.id}_adm_2`, organizationId: org.id, email: `adaora.nwosu@${domain}`, name: 'Adaora Nwosu', userId: `${org.id}_usr_2`, roleIds: ['auditor'], status: 'active', createdAt: ago(300), lastActiveAt: ago(1) },
      { id: `${org.id}_adm_3`, organizationId: org.id, email: `kwame.mensah@${domain}`, name: 'Kwame Mensah', userId: `${org.id}_usr_3`, roleIds: ['verifier'], status: 'active', createdAt: ago(240), lastActiveAt: ago(3) },
      { id: `${org.id}_adm_4`, organizationId: org.id, email: `halima.bello@${domain}`, name: 'Halima Bello', userId: `${org.id}_usr_4`, roleIds: ['verifier'], status: 'active', createdAt: ago(200), lastActiveAt: ago(2) },
      { id: `${org.id}_adm_5`, organizationId: org.id, email: `grace.okafor@${domain}`, name: 'Grace Okafor', userId: `${org.id}_usr_5`, roleIds: ['auditor'], status: 'deactivated', createdAt: ago(380), lastActiveAt: ago(40) },
      { id: `${org.id}_adm_6`, organizationId: org.id, email: `chidi.eze@${domain}`, name: 'Chidi Eze', roleIds: ['verifier'], status: 'invited', createdAt: ago(1), invitation: invite(1) },
      { id: `${org.id}_adm_7`, organizationId: org.id, email: `funmi.adeyemi@${domain}`, name: 'Funmi Adeyemi', roleIds: ['auditor'], status: 'invited', createdAt: ago(5), invitation: invite(5) },
    );
  }
  return out;
}

/**
 * Sample groups for established organizations: one per main unit, a volunteers group that overlaps
 * them (so people belong to several groups), and an empty group. The new organization has none.
 */
export function seedGroups(organizations: Pick<Organization, 'id' | 'createdAt'>[], members: Member[], today: Date): { groups: Group[]; groupMemberships: GroupMembership[] } {
  const iso = (d: Date) => d.toISOString();
  const ago = (days: number) => iso(new Date(today.getTime() - days * DAY));
  const groups: Group[] = [];
  const groupMemberships: GroupMembership[] = [];
  const by = 'Tobyson TE';
  for (const org of organizations) {
    if (org.id === NEW_ORGANIZATION_ID) continue;
    const people = members.filter((m) => m.organizationId === org.id && m.status !== 'pending').sort((a, b) => a.id.localeCompare(b.id));
    if (people.length === 0) continue;
    const counts = new Map<string, number>();
    for (const m of people) counts.set(m.unit, (counts.get(m.unit) ?? 0) + 1);
    const units = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([u]) => u);
    const add = (id: string, name: string, description: string, createdDaysAgo: number, updatedDaysAgo: number, who: typeof people) => {
      groups.push({ id, organizationId: org.id, name, description, createdAt: ago(createdDaysAgo), createdBy: by, updatedAt: ago(updatedDaysAgo), updatedBy: by });
      for (const m of who) {
        const joined = new Date(m.joinedAt).getTime();
        const created = today.getTime() - createdDaysAgo * DAY;
        groupMemberships.push({ organizationId: org.id, groupId: id, memberId: m.id, addedAt: iso(new Date(Math.max(joined, created))), addedBy: by });
      }
    };
    units.forEach((unit, i) => add(`${org.id}_grp_${i + 1}`, unit, `Users in ${unit}.`, 120 - i * 10, 20 - i * 5, people.filter((m) => m.unit === unit)));
    add(`${org.id}_grp_volunteers`, 'Volunteers', 'People who help run organization events.', 60, 6, people.filter((_, i) => i % 7 === 0));
    add(`${org.id}_grp_onboarding`, 'Onboarding Cohort', 'New users taking part in onboarding. Add members when the cohort is confirmed.', 5, 5, []);
  }
  return { groups, groupMemberships };
}

/**
 * Sample verification activities for established organizations, configured with the standard
 * requirements: an event with a participant list, an identity check, a credential check on its second
 * version, a draft that needs services not configured yet, and an inactive one. Configuration only:
 * no verification results are created.
 */
export function seedVerificationActivities(
  organizations: Pick<Organization, 'id' | 'integrations'>[],
  d: Pick<SeedData, 'credentialTypes' | 'identifierConfigs' | 'groups' | 'administrators' | 'members'>,
  today: Date,
): Pick<SeedData, 'activityConfigs' | 'activityVersions' | 'verifierAssignments'> {
  const iso = (x: Date) => x.toISOString();
  const ago = (days: number) => iso(new Date(today.getTime() - days * DAY));
  const ahead = (days: number, hour: number) => { const x = new Date(today.getTime() + days * DAY); x.setHours(hour, 0, 0, 0); return iso(x); };
  const out = { activityConfigs: [] as ActivityConfig[], activityVersions: [] as ActivityVersion[], verifierAssignments: [] as VerifierAssignment[] };
  const outcome = { onRequiredFailure: 'not-verified' as const, onInconclusive: 'unable-to-verify' as const };
  for (const org of organizations) {
    if (org.id === NEW_ORGANIZATION_ID || !org.integrations.idSwitch.connected) continue;
    const by = ({ [ORG_B1]: 'Lina Ford', [ORG_B2]: 'Mira Santos' } as Record<string, string>)[org.id] ?? 'Tobyson TE';
    const types = d.credentialTypes.filter((t) => t.organizationId === org.id && t.status === 'active');
    const volunteers = d.groups.find((g) => g.id === `${org.id}_grp_volunteers`);
    const firstGroup = d.groups.find((g) => g.organizationId === org.id && g.id !== volunteers?.id);
    const someone = d.members.filter((m) => m.organizationId === org.id && m.status === 'active').slice(0, 2).map((m) => m.id);
    if (!types.length) continue;
    const orgLike = org as Organization;
    const add = (key: string, a: Partial<ActivityConfig> & { name: string; description: string; purpose: string; status: ActivityConfig['status']; createdDaysAgo: number },
      versions: { requirements: StandardRequirements; status: ActivityVersion['status']; daysAgo: number; outcome?: ActivityVersion['outcome']; identifierConfigId?: string }[]) => {
      const id = `${org.id}_va_${key}`;
      const vs: ActivityVersion[] = versions.map((v, i) => {
        const vid = `${id}_v${i + 1}`;
        let n = 0;
        const built = buildChecks(v.requirements, orgLike, () => `${vid}_chk_${++n}`, v.identifierConfigId);
        return {
          id: vid, organizationId: org.id, activityId: id, number: i + 1, type: built.type, checks: built.checks, requirements: v.requirements, customized: false,
          outcome: v.outcome ?? outcome, status: v.status, createdAt: ago(v.daysAgo), createdBy: by, updatedAt: ago(v.daysAgo),
          ...(v.status !== 'draft' ? { activatedAt: ago(v.daysAgo), activatedBy: by } : {}),
        };
      });
      const live = vs.find((v) => v.status === 'active') ?? (a.status === 'inactive' ? vs[vs.length - 1] : undefined);
      const draft = vs.find((v) => v.status === 'draft');
      const { createdDaysAgo, ...rest } = a;
      out.activityConfigs.push({
        id, organizationId: org.id, entryPolicy: 'off', participants: { groupIds: [], memberIds: [] }, restrictVerifiers: false, ...rest,
        activeVersionId: live?.id, draftVersionId: draft?.id, createdAt: ago(createdDaysAgo), createdBy: by,
        updatedAt: ago(Math.min(...versions.map((v) => v.daysAgo))), updatedBy: by,
      });
      out.activityVersions.push(...vs);
    };
    add('conference', {
      name: 'Annual Staff Conference', description: 'Verify the identity and eligibility of participants before granting entry.', purpose: 'Verify the identity and eligibility of participants before granting entry.',
      status: 'active', createdDaysAgo: 20, location: 'Main Auditorium', schedule: { startsAt: ahead(7, 8), endsAt: ahead(8, 18), enforced: false },
      participants: { groupIds: [volunteers?.id, firstGroup?.id].filter(Boolean) as string[], memberIds: someone }, entryPolicy: 'deny',
    }, [{ requirements: { identity: 'record', credential: null, eligibility: 'participants' }, status: 'active', daysAgo: 18 }]);
    add('visitor', { name: 'Visitor Identity Check', description: 'Confirm who a visitor is before they are let in.', purpose: 'Confirm the identity of people visiting our premises.', status: 'active', createdDaysAgo: 90 }, [
      { requirements: { identity: 'record', credential: null, eligibility: null }, status: 'active', daysAgo: 88 },
    ]);
    add('membership', {
      name: 'Membership Verification', description: 'Check a member’s credential is genuine and current.', purpose: 'Confirm a person holds a valid membership credential.', status: 'active', createdDaysAgo: 70,
      participants: { groupIds: volunteers ? [volunteers.id] : [], memberIds: [] },
    }, [
      { requirements: { identity: null, credential: { credentialTypeIds: [types[0].id] }, eligibility: null }, status: 'superseded', daysAgo: 68 },
      { requirements: { identity: null, credential: { credentialTypeIds: [types[0].id] }, eligibility: volunteers ? 'participants' : null }, status: 'active', daysAgo: 14 },
    ]);
    add('event', { name: 'Event Access Verification', description: 'Verify the person is the credential holder before entry.', purpose: 'Control access to organization events.', status: 'draft', createdDaysAgo: 6, location: 'Conference Centre, Hall B' }, [
      { requirements: { identity: 'face', credential: { credentialTypeIds: types.map((t) => t.id) }, eligibility: null }, status: 'draft', daysAgo: 5 },
    ]);
    // Officer-led session clearance: member number, then a live face verified 1:1 against the enrolled
    // portrait, then eligibility. Nobody is assigned as a verifier; an administrator assigns them.
    const matric = d.identifierConfigs.find((i) => i.organizationId === org.id && i.name === 'Member number');
    if (matric) {
      const candidates = d.members.filter((m) => m.organizationId === org.id && m.status === 'active' && m.identifier?.configId === matric.id).slice(0, 24).map((m) => m.id);
      add('exam', {
        name: '2026 Restricted Session Clearance', description: 'Confirm each participant’s identity and eligibility before they enter the restricted session.', purpose: 'Clear registered participants into the 2026 restricted sessions.',
        status: 'active', createdDaysAgo: 3, participants: { groupIds: [], memberIds: candidates },
      }, [{ requirements: { identity: 'face', credential: null, eligibility: 'participants' }, status: 'active', daysAgo: 2, identifierConfigId: matric.id }]);
    }
    add('employee', { name: 'Employee Credential Validation', description: 'Validate staff credentials at service points.', purpose: 'Check staff credentials before granting access to internal services.', status: 'inactive', createdDaysAgo: 150 }, [
      { requirements: { identity: null, credential: { credentialTypeIds: [types[types.length - 1].id] }, eligibility: null }, status: 'active', daysAgo: 148, outcome: { onRequiredFailure: 'pending-review', onInconclusive: 'pending-review' } },
    ]);
  }
  return out;
}

/** A newly created organization with no users, credentials or activities: the first-time journey starts here. */
export const NEW_ORGANIZATION_ID = 'org_crestfield';
/** Established sample organization used by the "Active dashboard" preview. */
export const SAMPLE_ORGANIZATION_ID = 'org_northbridge';

type TypeBlueprint = Omit<CredentialType, 'id' | 'organizationId' | 'cardDesignId' | 'templateId' | 'createdAt' | 'identifier'> & {
  key: string;
  prefix: string;
  digits: number;
  /** Relationship values that typically hold this credential. */
  holders: string[];
};

type ActivityBlueprint = Omit<VerificationActivity, 'id' | 'organizationId' | 'eligibility' | 'schedule' | 'createdAt'> & {
  key: string;
  eligibleTypes: string[];
  relationships: string[];
  /** Build a roster from members in these units, for restricted sessions. */
  rosterUnit?: string;
  window?: [number, number];
  verifiers: string[];
  /** Relative daily volume. */
  volume: number;
};

interface OrgBlueprint {
  org: Omit<Organization, 'defaultCardDesignId' | 'createdAt'>;
  design: Omit<CardDesign, 'id' | 'organizationId' | 'isDefault' | 'name'>;
  extraDesign?: Omit<CardDesign, 'id' | 'organizationId' | 'isDefault'> & { forTypeKey: string };
  types: TypeBlueprint[];
  relationships: { value: string; weight: number }[];
  units: string[];
  /** Organizational reference for each person, from a source system (e.g. a member number). */
  externalRef?: (relationship: string, rng: Rng) => { label: string; value: string; source: string };
  activities: ActivityBlueprint[];
  registrySlice: number[];
  dailyTransactions: [number, number];
  /** Who set the organization up in the sample data (defaults to the demo administrator). */
  author?: string;
}

const BLUEPRINTS: OrgBlueprint[] = [
  {
    org: {
      id: 'org_northbridge',
      name: 'Northbridge Group',
      shortName: 'NBG',
      industry: 'corporate',
      country: 'Not specified',
      timezone: 'UTC',
      contactEmail: 'identity.office@northbridge.example',
      memberLabel: 'Member',
      integrations: {
        idSwitch: { connected: true, tenantRef: 'ids-tenant-nbg-01' },
        seamfixWallet: { connected: true, issuerDid: 'did:sfx:issuer:northbridge' },
        fixiam: { connected: false },
      },
    },
    design: {
      primaryColor: '#1d2d8b', accentColor: '#f5b301', textColor: '#ffffff', layout: 'horizontal',
      showPhoto: true, showQr: true, fields: ['name', 'identifier', 'relationship', 'unit', 'expiry'],
    },
    extraDesign: {
      name: 'Staff card', forTypeKey: 'staff', primaryColor: '#0f172a', accentColor: '#38bdf8', textColor: '#ffffff',
      layout: 'vertical', showPhoto: true, showQr: true, fields: ['name', 'identifier', 'unit', 'expiry'],
    },
    types: [
      {
        key: 'student', name: 'Member ID', description: 'Primary identity credential for registered members.',
        prefix: 'NBG-STU-', digits: 6, effectiveDate: 'start-of-term', validity: { kind: 'duration', months: 12 },
        renewal: { allowed: true, windowDays: 30 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Member'],
      },
      {
        key: 'staff', name: 'Staff ID', description: 'Identity credential for employees.',
        prefix: 'NBG-STF-', digits: 5, effectiveDate: 'on-issue', validity: { kind: 'duration', months: 24 },
        renewal: { allowed: true, windowDays: 45 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Staff'],
      },
      {
        key: 'library', name: 'Resource Centre Pass', description: 'Grants access to the resource centre.',
        prefix: 'NBG-LIB-', digits: 6, effectiveDate: 'on-issue', validity: { kind: 'no-expiry' },
        renewal: { allowed: false, windowDays: 0 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: false },
        status: 'active', holders: ['Member', 'Staff'],
      },
      {
        key: 'alumni', name: 'Associate Card', description: 'Long-term credential for former members. Not yet published.',
        prefix: 'NBG-ALU-', digits: 6, effectiveDate: 'on-issue', validity: { kind: 'no-expiry' },
        renewal: { allowed: false, windowDays: 0 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: false },
        status: 'draft', holders: [],
      },
    ],
    relationships: [{ value: 'Member', weight: 0.78 }, { value: 'Staff', weight: 0.22 }],
    units: ['Engineering', 'Legal', 'Operations', 'Communications', 'Finance', 'Research'],
    externalRef: (rel, rng) => rel === 'Member'
      ? { label: 'Member number', value: `NBG/${2021 + rng.int(0, 4)}/${rng.int(10000, 99999)}`, source: 'Member records system' }
      : { label: 'Staff number', value: `SN-${rng.int(1000, 9999)}`, source: 'HR system' },
    activities: [
      {
        key: 'campus', name: 'Site Entry', purpose: 'entry', description: 'Verify members and staff at site entrances.',
        location: 'Main Gate, North entrance', eligibleTypes: ['student', 'staff'], relationships: ['Member', 'Staff'],
        primaryMethod: 'qr', fallback: { permitted: true, methods: ['nfc'] }, assuranceLevel: 'low', outcome: 'Grant entry',
        status: 'active', verifiers: ['Gate A turnstile', 'Gate B turnstile', 'Security desk tablet'], volume: 5,
      },
      {
        key: 'library', name: 'Resource Centre Access', purpose: 'entry', description: 'Admit pass holders into the resource centre.',
        location: 'Resource Centre', eligibleTypes: ['library'], relationships: ['Member', 'Staff'],
        primaryMethod: 'nfc', fallback: { permitted: true, methods: ['qr'] }, assuranceLevel: 'low', outcome: 'Grant entry',
        status: 'active', verifiers: ['Resource centre reader'], volume: 2,
      },
      {
        key: 'csc401', name: 'Restricted Session 401', purpose: 'attendance',
        description: 'Admit only members registered for session 401.',
        location: 'Session Room A', eligibleTypes: ['student'], relationships: ['Member'], rosterUnit: 'Research',
        primaryMethod: 'face', fallback: { permitted: true, methods: ['nfc'] }, assuranceLevel: 'substantial', outcome: 'Admit to session',
        status: 'active', window: [-2, 5], verifiers: ['Session tablet 1', 'Session tablet 2'], volume: 4,
      },
      {
        key: 'staff-attendance', name: 'Staff Attendance', purpose: 'attendance', description: 'Record daily attendance for staff.',
        location: 'Main building lobby', eligibleTypes: ['staff'], relationships: ['Staff'],
        primaryMethod: 'nfc', fallback: { permitted: true, methods: ['face'] }, assuranceLevel: 'substantial', outcome: 'Record attendance',
        status: 'active', verifiers: ['Lobby kiosk'], volume: 1.2,
      },
      {
        key: 'convocation', name: 'Annual Assembly 2026', purpose: 'entry', description: 'Annual assembly entry. Configuration in progress.',
        location: 'Main Auditorium', eligibleTypes: ['student'], relationships: ['Member'],
        primaryMethod: 'qr', fallback: { permitted: false, methods: [] }, assuranceLevel: 'low', outcome: 'Grant entry',
        status: 'draft', window: [40, 41], verifiers: [], volume: 0,
      },
    ],
    registrySlice: range(0, 64),
    dailyTransactions: [30, 52],
  },
  {
    org: {
      id: 'org_meridian',
      name: 'Meridian Group',
      shortName: 'MHG',
      industry: 'corporate',
      country: 'Not specified',
      timezone: 'UTC',
      contactEmail: 'security@meridian.example',
      memberLabel: 'Member',
      integrations: {
        idSwitch: { connected: true, tenantRef: 'ids-tenant-mhg-04' },
        seamfixWallet: { connected: true, issuerDid: 'did:sfx:issuer:meridian' },
        fixiam: { connected: true },
      },
    },
    design: {
      primaryColor: '#0f766e', accentColor: '#99f6e4', textColor: '#ffffff', layout: 'vertical',
      showPhoto: true, showQr: true, fields: ['name', 'identifier', 'relationship', 'unit', 'expiry'],
    },
    types: [
      {
        key: 'clinical', name: 'Operations Staff Badge', description: 'Identity and access badge for operations staff.',
        prefix: 'MHG-CS-', digits: 5, effectiveDate: 'on-issue', validity: { kind: 'duration', months: 12 },
        renewal: { allowed: true, windowDays: 30 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Specialist', 'Technician'],
      },
      {
        key: 'admin', name: 'Administrative Staff Badge', description: 'Badge for administrative employees.',
        prefix: 'MHG-AS-', digits: 5, effectiveDate: 'on-issue', validity: { kind: 'duration', months: 12 },
        renewal: { allowed: true, windowDays: 30 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Administrator'],
      },
      {
        key: 'locum', name: 'Visiting Specialist Pass', description: 'Time-bound pass for visiting specialists.',
        prefix: 'MHG-VC-', digits: 4, effectiveDate: 'custom-date', validity: { kind: 'duration', months: 3 },
        renewal: { allowed: true, windowDays: 7 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Visiting Specialist'],
      },
    ],
    relationships: [
      { value: 'Specialist', weight: 0.35 }, { value: 'Technician', weight: 0.35 },
      { value: 'Administrator', weight: 0.2 }, { value: 'Visiting Specialist', weight: 0.1 },
    ],
    units: ['Harbourside Site', 'Eastgate Site', 'Northfield Site', 'Central Store'],
    externalRef: (rel, rng) => rel === 'Visiting Specialist'
      ? { label: 'Contractor reference', value: `PL/${rng.int(30000, 89999)}`, source: 'Provided at onboarding' }
      : { label: 'Employee ID', value: `MHG-E${rng.int(1000, 9999)}`, source: 'Fixiam' },
    activities: [
      {
        key: 'theatre', name: 'Secure Wing Access', purpose: 'entry', description: 'High-assurance access to the secure wing.',
        location: 'Harbourside Site, Level 2', eligibleTypes: ['clinical', 'locum'], relationships: ['Specialist', 'Technician', 'Visiting Specialist'],
        primaryMethod: 'face', fallback: { permitted: true, methods: ['fingerprint'] }, assuranceLevel: 'high', outcome: 'Grant entry',
        status: 'active', verifiers: ['Secure wing terminal'], volume: 2,
      },
      {
        key: 'pharmacy', name: 'Controlled Store Access', purpose: 'entry', description: 'Controlled store access. No fallback permitted.',
        location: 'Central Store', eligibleTypes: ['clinical'], relationships: ['Specialist', 'Technician'],
        primaryMethod: 'nfc', fallback: { permitted: false, methods: [] }, assuranceLevel: 'substantial', outcome: 'Unlock store',
        status: 'active', verifiers: ['Store reader'], volume: 1,
      },
      {
        key: 'attendance', name: 'Shift Attendance', purpose: 'attendance', description: 'Record clock-in for all staff shifts.',
        location: 'All sites', eligibleTypes: ['clinical', 'admin', 'locum'], relationships: ['Specialist', 'Technician', 'Administrator', 'Visiting Specialist'],
        primaryMethod: 'nfc', fallback: { permitted: true, methods: ['face'] }, assuranceLevel: 'substantial', outcome: 'Record attendance',
        status: 'active', verifiers: ['Harbourside staff entrance', 'Eastgate staff entrance', 'Northfield staff entrance'], volume: 3,
      },
    ],
    registrySlice: range(52, 92),
    dailyTransactions: [18, 34],
  },
  {
    org: {
      id: 'org_lts',
      name: 'Brightwater Collective',
      shortName: 'LTS',
      industry: 'membership',
      country: 'Not specified',
      timezone: 'UTC',
      contactEmail: 'admin@brightwater.example',
      memberLabel: 'Participant',
      integrations: {
        idSwitch: { connected: true, tenantRef: 'ids-tenant-lts-26' },
        seamfixWallet: { connected: false, issuerDid: '' },
        fixiam: { connected: false },
      },
    },
    design: {
      primaryColor: '#7c3aed', accentColor: '#fde047', textColor: '#ffffff', layout: 'vertical',
      showPhoto: false, showQr: true, fields: ['name', 'identifier', 'relationship', 'expiry'],
    },
    types: [
      {
        key: 'attendee', name: 'Participant Badge', description: 'General admission for registered participants.',
        prefix: 'LTS26-A-', digits: 5, effectiveDate: 'custom-date', validity: { kind: 'duration', months: 1 },
        renewal: { allowed: false, windowDays: 0 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Participant'],
      },
      {
        key: 'guest', name: 'Guest Badge', description: 'Guest access including the restricted lounge.',
        prefix: 'LTS26-S-', digits: 4, effectiveDate: 'custom-date', validity: { kind: 'duration', months: 1 },
        renewal: { allowed: false, windowDays: 0 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Guest'],
      },
    ],
    relationships: [{ value: 'Participant', weight: 0.85 }, { value: 'Guest', weight: 0.15 }],
    units: ['Day access', 'Full access', 'Track A', 'Track B'],
    externalRef: (_rel, rng) => ({ label: 'Participant number', value: `PN-${rng.int(100000, 999999)}`, source: 'Registration system' }),
    activities: [
      {
        key: 'hall', name: 'Hall 1 Entry', purpose: 'entry', description: 'Main hall admission for all badge holders.',
        location: 'Brightwater Centre', eligibleTypes: ['attendee', 'guest'], relationships: ['Participant', 'Guest'],
        primaryMethod: 'qr', fallback: { permitted: true, methods: ['manual'] }, assuranceLevel: 'low', outcome: 'Grant entry',
        status: 'active', window: [-3, 1], verifiers: ['Hall 1 scanner A', 'Hall 1 scanner B'], volume: 5,
      },
      {
        key: 'vip', name: 'Restricted Lounge', purpose: 'entry', description: 'Guests only.',
        location: 'Brightwater Centre, Mezzanine', eligibleTypes: ['guest'], relationships: ['Guest'],
        primaryMethod: 'qr', fallback: { permitted: false, methods: [] }, assuranceLevel: 'low', outcome: 'Grant entry',
        status: 'active', window: [-3, 1], verifiers: ['Lounge host phone'], volume: 1,
      },
    ],
    registrySlice: [...range(40, 52), ...range(92, 122)],
    dailyTransactions: [20, 60],
  },
  // Organization B1 and B2: sub-organizations of Meridian Group (Organization B). Fictional.
  {
    org: {
      id: ORG_B1,
      name: 'Meridian Harbourside',
      shortName: 'MHH',
      industry: 'corporate',
      country: 'Not specified',
      timezone: 'UTC',
      contactEmail: 'admin@harbourside.example',
      memberLabel: 'Staff member',
      integrations: {
        idSwitch: { connected: true, tenantRef: 'ids-tenant-mhh-01' },
        seamfixWallet: { connected: true, issuerDid: 'did:sfx:issuer:harbourside' },
        fixiam: { connected: false },
      },
    },
    design: {
      primaryColor: '#0e7490', accentColor: '#a5f3fc', textColor: '#ffffff', layout: 'horizontal',
      showPhoto: true, showQr: true, fields: ['name', 'identifier', 'relationship', 'unit', 'expiry'],
    },
    types: [
      {
        key: 'staff', name: 'Harbourside Staff Badge', description: 'Identity badge for Harbourside staff.',
        prefix: 'MHH-S-', digits: 5, effectiveDate: 'on-issue', validity: { kind: 'duration', months: 12 },
        renewal: { allowed: true, windowDays: 30 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Specialist', 'Technician'],
      },
    ],
    relationships: [{ value: 'Specialist', weight: 0.5 }, { value: 'Technician', weight: 0.5 }],
    units: ['Front office', 'Operations', 'Secure wing'],
    externalRef: (_rel, rng) => ({ label: 'Employee ID', value: `MHH-E${rng.int(1000, 9999)}`, source: 'HR system' }),
    activities: [
      {
        key: 'ward', name: 'Restricted Area Access', purpose: 'entry', description: 'Access to restricted areas.',
        location: 'Harbourside Site, Restricted areas', eligibleTypes: ['staff'], relationships: ['Specialist', 'Technician'],
        primaryMethod: 'nfc', fallback: { permitted: true, methods: ['face'] }, assuranceLevel: 'substantial', outcome: 'Grant entry',
        status: 'active', verifiers: ['Area door reader'], volume: 1,
      },
    ],
    registrySlice: range(122, 131),
    dailyTransactions: [3, 8],
    author: 'Lina Ford',
  },
  {
    org: {
      id: ORG_B2,
      name: 'Meridian Eastgate',
      shortName: 'MEC',
      industry: 'corporate',
      country: 'Not specified',
      timezone: 'UTC',
      contactEmail: 'admin@eastgate.example',
      memberLabel: 'Staff member',
      integrations: {
        idSwitch: { connected: true, tenantRef: 'ids-tenant-mec-01' },
        seamfixWallet: { connected: false, issuerDid: '' },
        fixiam: { connected: false },
      },
    },
    design: {
      primaryColor: '#4d7c0f', accentColor: '#d9f99d', textColor: '#ffffff', layout: 'horizontal',
      showPhoto: true, showQr: true, fields: ['name', 'identifier', 'relationship', 'expiry'],
    },
    types: [
      {
        key: 'staff', name: 'Eastgate Staff Badge', description: 'Identity badge for Eastgate staff.',
        prefix: 'MEC-S-', digits: 5, effectiveDate: 'on-issue', validity: { kind: 'duration', months: 12 },
        renewal: { allowed: true, windowDays: 30 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Specialist', 'Administrator'],
      },
    ],
    relationships: [{ value: 'Specialist', weight: 0.6 }, { value: 'Administrator', weight: 0.4 }],
    units: ['Reception', 'Meeting rooms'],
    externalRef: (_rel, rng) => ({ label: 'Employee ID', value: `MEC-E${rng.int(1000, 9999)}`, source: 'HR system' }),
    activities: [
      {
        key: 'records', name: 'Records Room Access', purpose: 'entry', description: 'Access to the records room.',
        location: 'Eastgate Site, Records room', eligibleTypes: ['staff'], relationships: ['Specialist', 'Administrator'],
        primaryMethod: 'nfc', fallback: { permitted: false, methods: [] }, assuranceLevel: 'substantial', outcome: 'Unlock door',
        status: 'active', verifiers: ['Records room reader'], volume: 1,
      },
    ],
    registrySlice: range(131, 140),
    dailyTransactions: [2, 6],
    author: 'Mira Santos',
  },
];

const ADMIN_NAME = 'Tobyson TE';
/** The sample organizations' administrator, used by the demo account. */
export const DEMO_ADMIN = { id: 'usr_tobyson', name: ADMIN_NAME, initials: 'TE', email: 'tobyson.te@fixid.demo', role: 'Owner' as const };
/** Optional demo image. Place a licensed photo at public/samples/portrait-sample.jpg; initials show when it's absent. */
export const SAMPLE_PORTRAIT_URL = '/samples/portrait-sample.jpg';

function range(from: number, to: number) {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

function weighted<T extends { weight: number }>(rng: Rng, items: T[]): T {
  const roll = rng.next();
  let acc = 0;
  for (const item of items) {
    acc += item.weight;
    if (roll <= acc) return item;
  }
  return items[items.length - 1];
}

/**
 * Builds the full connected demo dataset relative to `now`, so activity always looks recent.
 * Deterministic for a given `now`.
 */
export function buildSeed(now: Date = new Date()): SeedData {
  const registry = buildIdSwitchRegistry();
  const rng = createRng(4242);
  const today = startOfDay(now);
  const iso = (d: Date) => d.toISOString();
  const usedRegistryIndexes = new Set<number>();

  const organizations: Organization[] = [];
  const cardDesigns: CardDesign[] = [];
  const credentialTypes: CredentialType[] = [];
  const identifierConfigs: IdentifierConfig[] = [];
  const members: Member[] = [];
  const credentials: Credential[] = [];
  const activities: VerificationActivity[] = [];
  const transactions: Transaction[] = [];
  const audit: AuditEvent[] = [];

  for (const bp of BLUEPRINTS) {
    const orgId = bp.org.id;
    const defaultDesignId = `${orgId}_design_default`;
    organizations.push({ ...bp.org, defaultCardDesignId: defaultDesignId, createdAt: iso(addMonths(today, -14)) });
    cardDesigns.push({ ...bp.design, id: defaultDesignId, organizationId: orgId, isDefault: true, name: 'Default digital ID' });
    let extraDesignId: string | null = null;
    if (bp.extraDesign) {
      const { forTypeKey, ...design } = bp.extraDesign;
      extraDesignId = `${orgId}_design_${forTypeKey}`;
      cardDesigns.push({ ...design, id: extraDesignId, organizationId: orgId, isDefault: false });
    }

    // Credential types
    const typeIdByKey = new Map<string, string>();
    const typesForOrg: { type: CredentialType; holders: string[] }[] = [];
    for (const t of bp.types) {
      const { key, prefix, digits, holders, ...rest } = t;
      const type: CredentialType = {
        ...rest,
        id: `${orgId}_ct_${key}`,
        organizationId: orgId,
        identifier: { label: 'ID number', mode: 'generated', prefix, digits, nextSequence: 1 },
        cardDesignId: bp.extraDesign?.forTypeKey === key && extraDesignId ? extraDesignId : defaultDesignId,
        templateId: templateForDesign(bp.extraDesign?.forTypeKey === key ? bp.extraDesign : bp.design),
        createdAt: iso(addMonths(today, -12)),
      };
      typeIdByKey.set(key, type.id);
      credentialTypes.push(type);
      typesForOrg.push({ type, holders });
    }

    // Identifier configurations: one per reference kind the organization already uses (entered manually).
    const identifierConfigIdByLabel = new Map<string, string>();
    const identifierFor = (label: string) => {
      let id = identifierConfigIdByLabel.get(label);
      if (!id) {
        id = `${orgId}_idc_${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        identifierConfigIdByLabel.set(label, id);
        identifierConfigs.push({
          id, organizationId: orgId, name: label, mode: 'manual', segments: [], nextSequence: 1,
          createdAt: iso(addMonths(today, -12)), updatedAt: iso(addMonths(today, -12)),
        });
      }
      return id;
    };

    // Members: FixID context referencing ID Switch identities.
    const orgMembers: Member[] = [];
    bp.registrySlice.forEach((regIndex, i) => {
      const identity = registry[regIndex];
      const relationship = weighted(rng, bp.relationships).value;
      const status = rng.chance(0.06) ? 'pending' : rng.chance(0.05) ? 'inactive' : 'active';
      const existed = usedRegistryIndexes.has(regIndex) || identity.linkedProducts.length > 0 || rng.chance(0.3);
      usedRegistryIndexes.add(regIndex);
      orgMembers.push({
        id: `${orgId}_m_${String(i + 1).padStart(3, '0')}`,
        organizationId: orgId,
        idSwitchId: identity.idSwitchId,
        displayName: `${identity.givenName} ${identity.familyName}`,
        relationship,
        unit: rng.pick(bp.units),
        identifier: (() => {
          const ref = bp.externalRef?.(relationship, rng);
          return ref ? { configId: identifierFor(ref.label), value: ref.value, source: ref.source } : undefined;
        })(),
        status,
        resolution: existed ? 'linked-existing' : 'created-new',
        ...(() => {
          const face = status !== 'pending' && rng.chance(0.72);
          // A few deterministic non-enrolled variations for realism (no extra random draws).
          const other = status === 'pending' ? 'pending' : i % 17 === 5 ? 'expired' : i % 23 === 7 ? 'failed' : 'not-enrolled';
          return { faceEnrollment: { status: face ? 'enrolled' as const : other } };
        })(),
        factors: { fingerprint: rng.chance(0.3) },
        joinedAt: iso(addDays(today, -(bp.org.industry === 'events' ? rng.int(4, 45) : rng.int(5, 400)))),
        createdBy: (bp.author ?? ADMIN_NAME),
      });
    });
    // One enrolled sample user shows how an approved portrait is presented. Decorative demo image, not a capture.
    if (orgId === SAMPLE_ORGANIZATION_ID) {
      const showcase = orgMembers.find((m) => m.status === 'active' && m.faceEnrollment.status === 'enrolled'
        && registry.find((r) => r.idSwitchId === m.idSwitchId)?.gender === 'Female');
      if (showcase) showcase.faceEnrollment = { ...showcase.faceEnrollment, portraitUrl: SAMPLE_PORTRAIT_URL, portraitIsSample: true };
    }
    members.push(...orgMembers);

    // Credentials
    const orgCredentials: Credential[] = [];
    for (const member of orgMembers) {
      if (member.status === 'pending') continue;
      const joinedAt = new Date(member.joinedAt);
      const eligible = typesForOrg.filter((t) => t.type.status === 'active' && t.holders.includes(member.relationship));
      eligible.forEach(({ type: ct }, idx) => {
        if (idx > 0 && !rng.chance(0.6)) return;
        const issuedAt = addDays(joinedAt, rng.int(0, 3));
        // Time-bound credentials are mostly current: re-issued on schedule or issued recently.
        const months = ct.validity.kind === 'duration' ? ct.validity.months : 0;
        const freshIssue = months > 0 && rng.chance(0.9) ? addDays(today, -rng.int(1, Math.max(2, months * 30 - 10))) : issuedAt;
        const effective = months > 0 && months < 12 ? freshIssue : freshIssue < issuedAt ? issuedAt : freshIssue;
        const expiresAt = ct.validity.kind === 'duration' ? addMonths(effective, ct.validity.months)
          : ct.validity.kind === 'fixed-date' ? new Date(ct.validity.date) : null;
        let status: CredentialStatus = 'active';
        if (expiresAt && expiresAt < today) status = 'expired';
        else if (member.status === 'inactive') status = 'suspended';
        else if (rng.chance(0.03)) status = 'revoked';
        else if (rng.chance(0.04)) status = 'suspended';
        else if (ct.lifecycle.requiresApproval && rng.chance(0.08)) status = 'pending';
        const walletConnected = bp.org.integrations.seamfixWallet.connected;
        const wallet: WalletDeliveryStatus = !walletConnected || status === 'pending' ? 'not-sent'
          : rng.chance(0.06) ? 'failed' : rng.chance(0.07) ? 'pending' : 'delivered';
        orgCredentials.push({
          id: `cr_${orgId.replace('org_', '')}_${String(orgCredentials.length + 1).padStart(4, '0')}`,
          organizationId: orgId,
          memberId: member.id,
          credentialTypeId: ct.id,
          identifier: formatIdentifier(ct.identifier.prefix, ct.identifier.digits, ct.identifier.nextSequence++),
          status,
          issuedAt: iso(effective),
          effectiveFrom: iso(effective),
          expiresAt: expiresAt ? iso(expiresAt) : null,
          wallet: { status: wallet, updatedAt: iso(new Date(effective.getTime() + rng.int(9 * 60, 17 * 60) * 60_000)) },
          snapshot: { credentialName: ct.name, templateId: ct.templateId, identifierLabel: ct.identifier.label },
        });
      });
    }
    credentials.push(...orgCredentials);

    // Verification activities
    const orgActivities: (VerificationActivity & { bp: ActivityBlueprint })[] = [];
    for (const a of bp.activities) {
      const { key, eligibleTypes, relationships, rosterUnit, window, verifiers: _v, volume: _vol, ...rest } = a;
      const roster = rosterUnit
        ? orgMembers.filter((m) => m.unit === rosterUnit && m.relationship === 'Member' && m.status !== 'pending').map((m) => m.id)
        : undefined;
      const activity: VerificationActivity = {
        ...rest,
        id: `${orgId}_va_${key}`,
        organizationId: orgId,
        eligibility: {
          credentialTypeIds: eligibleTypes.map((k) => typeIdByKey.get(k)!).filter(Boolean),
          relationships,
          rosterMemberIds: roster,
          requireActiveMember: true,
        },
        schedule: window
          ? { kind: 'window', startsAt: iso(addDays(today, window[0])), endsAt: iso(addDays(today, window[1] + 1)) }
          : { kind: 'always' },
        createdAt: iso(addMonths(today, -6)),
      };
      activities.push(activity);
      orgActivities.push({ ...activity, bp: a });
    }

    // Transactions over the last 30 days.
    const memberById = new Map(orgMembers.map((m) => [m.id, m]));
    const live = orgActivities.filter((a) => a.status === 'active' && a.bp.volume > 0);
    const totalVolume = live.reduce((s, a) => s + a.bp.volume, 0);
    for (let d = 29; d >= 0; d--) {
      const day = addDays(today, -d);
      const weekend = day.getDay() === 0 || day.getDay() === 6;
      for (const activity of live) {
        if (activity.schedule.kind === 'window') {
          if (day < startOfDay(new Date(activity.schedule.startsAt)) || day >= new Date(activity.schedule.endsAt)) continue;
        }
        const base = rng.int(bp.dailyTransactions[0], bp.dailyTransactions[1]) * (activity.bp.volume / totalVolume);
        const count = Math.round(base * (weekend && bp.org.industry !== 'events' ? 0.3 : 1));
        const roster = activity.eligibility.rosterMemberIds;
        const eligiblePool = orgCredentials.filter(
          (c) => activity.eligibility.credentialTypeIds.includes(c.credentialTypeId) && (!roster || roster.includes(c.memberId)),
        );
        for (let k = 0; k < count; k++) {
          const occurredAt = new Date(day.getTime() + rng.int(7 * 60, 19 * 60) * 60_000);
          if (occurredAt > now) continue;
          // Most people present an appropriate credential; a few present the wrong one.
          const pool = eligiblePool.length > 0 && rng.chance(0.93) ? eligiblePool : orgCredentials;
          transactions.push(simulateTransaction(rng, activity, pool, memberById, occurredAt, activity.bp.verifiers));
        }
      }
    }

    // Audit trail from onboarding, issuance and lifecycle events.
    const recentMembers = [...orgMembers].sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)).slice(0, 8);
    for (const m of recentMembers) {
      audit.push({
        id: '', organizationId: orgId, action: 'user.created', actor: (bp.author ?? ADMIN_NAME), actorType: 'admin',
        resourceType: 'member', resourceId: m.id, result: 'success', occurredAt: m.joinedAt, href: `/users/${m.id}`,
        summary: `Added ${m.displayName}`,
      });
    }
    const recentCredentials = [...orgCredentials].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).slice(0, 14);
    const typeById = new Map(credentialTypes.map((t) => [t.id, t]));
    for (const c of recentCredentials) {
      const m = memberById.get(c.memberId)!;
      audit.push({
        id: '', organizationId: orgId, action: 'credential.issued', actor: (bp.author ?? ADMIN_NAME), actorType: 'admin',
        resourceType: 'credential', resourceId: c.id, result: 'success', occurredAt: c.issuedAt, href: `/credentials/${c.id}`,
        summary: `Issued ${typeById.get(c.credentialTypeId)!.name} ${c.identifier} to ${m.displayName}`,
      });
      if (c.wallet.status === 'failed') {
        audit.push({
          id: '', organizationId: orgId, action: 'wallet.failed', actor: 'Seamfix Wallet', actorType: 'integration',
          resourceType: 'credential', resourceId: c.id, result: 'failure', occurredAt: c.wallet.updatedAt, href: `/credentials/${c.id}`,
          summary: `Wallet delivery failed for ${c.identifier}`,
        });
      }
    }
    for (const c of orgCredentials.filter((x) => x.status === 'suspended' || x.status === 'revoked').slice(0, 5)) {
      const m = memberById.get(c.memberId)!;
      audit.push({
        id: '', organizationId: orgId, action: c.status === 'revoked' ? 'credential.revoked' : 'credential.suspended',
        actor: (bp.author ?? ADMIN_NAME), actorType: 'admin', resourceType: 'credential', resourceId: c.id, result: 'success',
        occurredAt: iso(addDays(today, -rng.int(1, 20))), href: `/credentials/${c.id}`,
        summary: `${c.status === 'revoked' ? 'Revoked' : 'Suspended'} ${c.identifier} (${m.displayName})`,
      });
    }
  }

  // A brand-new organization: only the default digital ID design every organization receives.
  organizations.unshift({
    id: NEW_ORGANIZATION_ID,
    name: 'Crestfield Organization',
    shortName: 'CFO',
    industry: 'other',
    country: 'Not specified',
    timezone: 'UTC',
    contactEmail: 'admin@crestfield.example',
    memberLabel: 'Member',
    defaultCardDesignId: `${NEW_ORGANIZATION_ID}_design_default`,
    integrations: {
      idSwitch: { connected: true, tenantRef: 'ids-tenant-cfa-01' },
      seamfixWallet: { connected: true, issuerDid: 'did:sfx:issuer:crestfield' },
      fixiam: { connected: false },
    },
    createdAt: iso(today),
  });
  cardDesigns.unshift({
    id: `${NEW_ORGANIZATION_ID}_design_default`, organizationId: NEW_ORGANIZATION_ID, name: 'Default digital ID', isDefault: true,
    primaryColor: '#1d2d8b', accentColor: '#f5b301', textColor: '#ffffff', layout: 'horizontal',
    showPhoto: true, showQr: true, fields: ['name', 'identifier', 'relationship', 'expiry'],
  });

  transactions.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  transactions.forEach((t, i) => { t.id = `TXN-${String(transactions.length - i).padStart(6, '0')}`; });
  audit.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  audit.forEach((a, i) => { a.id = `AUD-${String(audit.length - i).padStart(5, '0')}`; });

  // Prompt 4 demonstration people in Brightwater, pinned so the scenarios are reproducible (all fictional).
  for (const [i, face] of (['enrolled', 'enrolled', 'not-enrolled'] as const).entries()) {
    const m = members.find((x) => x.id === `${ORG_C}_m_00${i + 1}`);
    if (m?.identifier) {
      m.identifier = { ...m.identifier, value: DEMO_LOCAL_PEOPLE[i] };
      m.status = 'active';
      m.faceEnrollment = face === 'enrolled' ? { ...m.faceEnrollment, status: 'enrolled', updatedAt: iso(addDays(today, -30)) } : { status: 'not-enrolled' };
    }
  }
  const administrators = seedAdministrators(organizations, today);
  const seededGroups = seedGroups(organizations, members, today);
  const activitiesSeed = seedVerificationActivities(organizations, { credentialTypes, identifierConfigs, groups: seededGroups.groups, administrators, members }, today);
  // The B1 Verifier is assigned to two of B1's activities, so the Verifier experience has work to show.
  for (const key of ['visitor', 'conference']) {
    if (activitiesSeed.activityConfigs.some((a) => a.id === `${ORG_B1}_va_${key}`)) {
      activitiesSeed.verifierAssignments.push({ organizationId: ORG_B1, activityId: `${ORG_B1}_va_${key}`, administratorId: `${ORG_B1}_adm_verifier`, status: 'active', assignedAt: iso(addDays(today, -10)), assignedBy: 'Lina Ford' });
    }
  }
  // Brightwater demonstrates local face verification with the labelled simulated provider (no real provider is configured).
  const demoOrg = organizations.find((o) => o.id === ORG_C);
  if (demoOrg) demoOrg.integrations = { ...demoOrg.integrations, simulatedBiometrics: { enabled: true } };
  // Brightwater demonstrates exception decisions that need a second person's approval; other organizations don't require it.
  if (demoOrg) demoOrg.exceptionWorkflow = { approvalRequired: true, updatedAt: iso(addDays(today, -20)), updatedBy: 'Jordan Blake' };
  const scenarios = seedActivityScenarios(organizations, today);
  activitiesSeed.activityConfigs.push(...scenarios.activityConfigs);
  activitiesSeed.activityVersions.push(...scenarios.activityVersions);
  activitiesSeed.verifierAssignments.push(...scenarios.verifierAssignments);
  return {
    organizations,
    // The demo account (Tobyson) belongs to every top-level sample organization, but to no sub-organization.
    admin: { ...DEMO_ADMIN, organizationIds: organizations.filter((o) => !SEEDED_SUB_ORGANIZATIONS[o.id]).map((o) => o.id) },
    cardDesigns,
    credentialTypes,
    identifierConfigs,
    members,
    credentials,
    activities,
    transactions,
    audit,
    administrators,
    ...seededGroups,
    issuanceBatches: [],
    ...activitiesSeed,
    verificationAttempts: [],
    // Organizations never start with custom roles. The one exception is demonstration data: B2's administrator
    // created "Records Officer" for the custom-role demonstration account. New organizations get none.
    customRoles: [{
      id: B2_RECORDS_ROLE, organizationId: ORG_B2, name: 'Records Officer', description: 'Keeps user records up to date. No access to credentials, verification or settings.',
      permissions: ['users.view', 'users.create', 'users.import', 'groups.view'], system: false,
      createdAt: iso(addDays(today, -130)), createdBy: 'Mira Santos', updatedAt: iso(addDays(today, -130)), updatedBy: 'Mira Santos',
    }, {
      // Demonstration only: a restricted exception reviewer in Organization B (no configuration access).
      id: B_REVIEWER_ROLE, organizationId: ORG_B, name: 'Exception Reviewer', description: 'Reviews exceptions (including those from organizations taking part in shared activities) and views reports. Can’t configure anything.',
      permissions: ['verification.activities.view', 'exceptions.view', 'exceptions.review', 'exceptions.resolve', 'reports.view'], system: false,
      createdAt: iso(addDays(today, -95)), createdBy: 'Victor Hale', updatedAt: iso(addDays(today, -95)), updatedBy: 'Victor Hale',
    }],
    logoAssets: [],
    ssoConnections: [],
    customIntegrations: seedIntegrations(today),
    verificationExceptions: [],
    managedOrganizations: seedManagedOrganizations(today),
    organizationRelationships: Object.entries(SEEDED_SUB_ORGANIZATIONS).map(([child, parent]) => ({
      id: `rel_${child}`, parentOrganizationId: parent, childOrganizationId: child, type: 'sub-organization' as const, origin: 'created-by-parent' as const,
      status: 'active' as const, initialAdministratorId: `${child}_adm_owner`, createdAt: iso(addMonths(today, -14)), createdBy: 'Victor Hale',
    })),
  };
}

/**
 * Fictional organizations managed inside two workspaces. Brightwater: two active organizations with users
 * and activities (one user belongs to both), one with nobody yet, and an inactive one whose records are kept.
 * Meridian: one with users and its staff activity, one empty. Most users belong to none.
 */
function seedManagedOrganizations(today: Date): import('@/domain/managedOrganizations').ManagedOrganization[] {
  const at = (d: number) => addDays(today, -d).toISOString();
  const m = (org: string, n: number, d: number, by: string) => ({ memberId: `${org}_m_${String(n).padStart(3, '0')}`, assignedAt: at(d), assignedBy: by });
  const C = 'org_lts';
  const B = ORG_B;
  const org = (o: Omit<import('@/domain/managedOrganizations').ManagedOrganization, 'updatedAt' | 'updatedBy'> & { updated?: number }) => {
    const { updated, ...rest } = o;
    return { ...rest, updatedAt: updated !== undefined ? at(updated) : rest.createdAt, updatedBy: rest.createdBy };
  };
  return [
    org({ id: 'morg_bw_riverside', organizationId: C, reference: 'ORG-1001', name: 'Riverside Campus', description: 'Main campus: staff and visitors at the Riverside site.', contactEmail: 'riverside.office@brightwater.example',
      status: 'active', createdAt: at(60), createdBy: 'Jordan Blake', updated: 12, members: [1, 2, 3, 4, 5].map((n) => m(C, n, 50, 'Jordan Blake')), activityIds: [`${C}_va_visitor_checkin`, `${C}_va_restricted_lounge`] }),
    org({ id: 'morg_bw_northgate', organizationId: C, reference: 'ORG-1002', name: 'Northgate Contractors', description: 'Contracted maintenance and security staff.',
      status: 'active', createdAt: at(45), createdBy: 'Jordan Blake', members: [m(C, 1, 40, 'Jordan Blake'), m(C, 6, 40, 'Jordan Blake'), m(C, 7, 20, 'Tobyson TE')], activityIds: [`${C}_va_badge_collection`] }),
    org({ id: 'morg_bw_alumni', organizationId: C, reference: 'ORG-1003', name: 'Alumni Relations Office', status: 'active', createdAt: at(8), createdBy: 'Tobyson TE', members: [], activityIds: [] }),
    org({ id: 'morg_bw_facilities', organizationId: C, reference: 'ORG-1004', name: 'Former Facilities Unit', description: 'Merged into Riverside Campus; kept for its records.',
      status: 'inactive', createdAt: at(120), createdBy: 'Jordan Blake', updated: 30, members: [m(C, 8, 110, 'Jordan Blake')], activityIds: [`${C}_va_open_day`] }),
    org({ id: 'morg_mg_operations', organizationId: B, reference: 'ORG-1001', name: 'Group Operations', description: 'Operations staff across Meridian sites.',
      status: 'active', createdAt: at(90), createdBy: 'Victor Hale', members: [m(B, 2, 80, 'Victor Hale'), m(B, 4, 80, 'Victor Hale'), m(B, 6, 30, 'Victor Hale')], activityIds: [`${B}_va_staff_entry`] }),
    org({ id: 'morg_mg_academy', organizationId: B, reference: 'ORG-1002', name: 'Training Academy', status: 'active', createdAt: at(15), createdBy: 'Victor Hale', members: [], activityIds: [] }),
  ];
}

/**
 * Fictional custom identity services. Organization A has none (local verification only); B's is tested and
 * active; C has a Draft and an active simulated service (activity scenario C); D's points at an external
 * service, so its test fails (external requests are
 * disabled in the prototype) and it can't be activated.
 */
export function seedIntegrations(today: Date): CustomIntegration[] {
  const at = (days: number) => new Date(today.getTime() - days * DAY).toISOString();
  const passed = (id: IntegrationCheck['id'], label: string, detail: string): IntegrationCheck => ({ id, label, outcome: 'passed', detail });
  return [
    {
      id: 'int_b_identity', organizationId: ORG_B, name: 'Group Identity Service', description: 'Looks up staff identity records and matches faces against the group’s reference images.',
      capabilities: ['lookup', 'matching'], referenceLabel: 'External Reference ID', permittedAttributes: ['displayName', 'recordStatus'],
      connection: { target: 'simulated', baseUrl: SIMULATED_BASE_URL, authMethod: 'oauth2-client-credentials', oauth: { tokenEndpoint: `${SIMULATED_BASE_URL}/oauth/token`, clientId: 'simulated-client' }, credential: 'simulated', timeoutSeconds: 10 },
      contractVersion: CONTRACT_VERSION, configVersion: 1, validatedConfigVersion: 1, status: 'active', lastSuccessfulTestAt: at(20),
      tests: [{
        id: 'test_b_1', at: at(20), by: 'Victor Hale', configVersion: 1, ok: true, summary: 'Connection successful.', simulated: true, scenario: 'healthy',
        checks: [
          passed('configuration', 'Connection configuration', 'Contract 1.0, oauth2-client-credentials authentication, 10s timeout.'),
          passed('authentication', 'Authentication', 'Simulated credential accepted (no real secret is used).'),
          passed('lookup', 'Lookup endpoint compatibility', 'FOUND and NOT_FOUND responses follow contract 1.0.'),
          passed('matching', 'Matching endpoint compatibility', 'MATCH response follows contract 1.0 (score 0.96 on scale 0_TO_1, provider threshold 0.85). Simulated: no faces were compared.'),
          passed('schema', 'Response schema validity', 'All responses validated against contract 1.0.'),
          passed('errors', 'Error handling', 'An invalid request returned a well-formed ERROR.'),
        ],
      }],
      createdAt: at(22), createdBy: 'Victor Hale', updatedAt: at(20), updatedBy: 'Victor Hale',
    },
    {
      id: 'int_c_records', organizationId: ORG_C, name: 'Attendee Records Service', description: 'Looks up registered attendees by their booking reference.',
      capabilities: ['lookup'], referenceLabel: 'Booking Reference', permittedAttributes: ['displayName', 'recordStatus'],
      connection: { target: 'simulated', baseUrl: SIMULATED_BASE_URL, authMethod: 'api-key', apiKey: { headerName: 'X-API-Key' }, credential: 'simulated', timeoutSeconds: 8 },
      contractVersion: CONTRACT_VERSION, configVersion: 1, status: 'draft', tests: [],
      createdAt: at(3), createdBy: 'Tobyson TE', updatedAt: at(3), updatedBy: 'Tobyson TE',
    },
    {
      id: 'int_c_delegates', organizationId: ORG_C, name: 'Brightwater Identity Service', description: 'Simulated service that looks up registered participants and matches their faces. Used by Brightwater’s independent activities.',
      capabilities: ['lookup', 'matching'], referenceLabel: 'External Reference ID', permittedAttributes: ['displayName', 'recordStatus'],
      connection: { target: 'simulated', baseUrl: SIMULATED_BASE_URL, authMethod: 'api-key', apiKey: { headerName: 'X-API-Key' }, credential: 'simulated', timeoutSeconds: 8 },
      contractVersion: CONTRACT_VERSION, configVersion: 1, validatedConfigVersion: 1, status: 'active', lastSuccessfulTestAt: at(9),
      tests: [{
        id: 'test_c_1', at: at(9), by: 'Tobyson TE', configVersion: 1, ok: true, summary: 'Connection successful.', simulated: true, scenario: 'healthy',
        checks: [
          passed('configuration', 'Connection configuration', 'Contract 1.0, api-key authentication, 8s timeout.'),
          passed('authentication', 'Authentication', 'Simulated credential accepted (no real secret is used).'),
          passed('lookup', 'Lookup endpoint compatibility', 'FOUND and NOT_FOUND responses follow contract 1.0.'),
          passed('matching', 'Matching endpoint compatibility', 'MATCH response follows contract 1.0. Simulated: no faces were compared.'),
          passed('schema', 'Response schema validity', 'All responses validated against contract 1.0.'),
          passed('errors', 'Error handling', 'An invalid request returned a well-formed ERROR.'),
        ],
      }],
      createdAt: at(10), createdBy: 'Tobyson TE', updatedAt: at(9), updatedBy: 'Tobyson TE',
    },
    {
      id: 'int_d_harbourside', organizationId: ORG_D, name: 'Harbourside Identity Service', description: 'Harbourside’s own identity service for staff records and face matching.',
      capabilities: ['lookup', 'matching'], referenceLabel: 'Staff Reference', permittedAttributes: ['displayName', 'recordStatus'],
      connection: { target: 'external', baseUrl: 'https://identity.harbourside.example/api', authMethod: 'oauth2-client-credentials', oauth: { tokenEndpoint: 'https://identity.harbourside.example/oauth/token', clientId: 'fixid-harbourside' }, credential: 'missing', timeoutSeconds: 15 },
      contractVersion: CONTRACT_VERSION, configVersion: 1, status: 'error', lastFailedTestAt: at(1),
      tests: [{
        id: 'test_d_1', at: at(1), by: 'Lina Ford', configVersion: 1, ok: false, summary: 'Authentication failed.', simulated: false,
        checks: [
          passed('configuration', 'Connection configuration', 'Contract 1.0, oauth2-client-credentials authentication, 15s timeout.'),
          { id: 'authentication', label: 'Authentication', outcome: 'failed', detail: 'No credential is held by the FixID secret manager. The secure integration backend isn’t available in this prototype, so real external requests are disabled.' },
          ...(['lookup', 'matching', 'schema', 'errors'] as const).map((id) => ({ id, label: { lookup: 'Lookup endpoint compatibility', matching: 'Matching endpoint compatibility', schema: 'Response schema validity', errors: 'Error handling' }[id], outcome: 'skipped' as const, detail: 'Not run.' })),
        ],
      }],
      createdAt: at(4), createdBy: 'Lina Ford', updatedAt: at(1), updatedBy: 'Lina Ford',
    },
  ];
}

/**
 * Brightwater people for the local verification scenarios: eligible and enrolled; enrolled but not on the
 * activity's eligible population; not enrolled.
 */
export const DEMO_LOCAL_PEOPLE = ['PN-100001', 'PN-100002', 'PN-100003'] as const;

/** The shared activity in demonstration scenario B: owned by Organization B, run by B1 and B2. */
export const DEMO_SHARED_ACTIVITY = `${ORG_B}_va_staff_entry`;

/**
 * Demonstration activities (all fictional):
 * A — Northbridge: an activity for its own use, checked against its FixID records.
 * B — Meridian: one shared activity using its connected identity source. Its two sub-organizations take
 *     part (each runs it from its own workspace with its own staff); Brightwater has been invited.
 * C — Brightwater: activities for its own use with its own connected identity source.
 */
export function seedActivityScenarios(organizations: Pick<Organization, 'id' | 'integrations'>[], today: Date):
  Pick<SeedData, 'activityConfigs' | 'activityVersions' | 'verifierAssignments'> {
  const at = (days: number) => new Date(today.getTime() - days * DAY).toISOString();
  const out = { activityConfigs: [] as ActivityConfig[], activityVersions: [] as ActivityVersion[], verifierAssignments: [] as VerifierAssignment[] };
  const has = (id: string) => organizations.some((o) => o.id === id);
  const settings = (x: Partial<VerificationSettings>): VerificationSettings => ({
    identitySource: { kind: 'local' }, method: 'face', liveness: 'required', reverification: { mode: 'every-time' }, exceptions: 'review',
    eligibility: { approach: 'local-population' }, decisionRules: DEFAULT_DECISION_RULES, ...x,
  });
  const assign = (orgId: string, activityId: string, administratorId: string, by: string) =>
    out.verifierAssignments.push({ organizationId: orgId, activityId, administratorId, status: 'active', assignedAt: at(8), assignedBy: by });
  const add = (orgId: string, key: string, by: string, a: Pick<ActivityConfig, 'name' | 'description'> & Partial<ActivityConfig>, v: VerificationSettings, verifierIds: string | string[] = [], identifierConfigId?: string) => {
    const org = organizations.find((o) => o.id === orgId) as Organization;
    const id = `${orgId}_va_${key}`;
    const vid = `${id}_v1`;
    // Matches configFromSettings: external eligibility is decided by the external flow, not local checks.
    const requirements: StandardRequirements = { identity: v.method, credential: null, eligibility: v.identitySource.kind === 'local' && v.eligibility.approach === 'local-population' ? 'participants' : null };
    let n = 0;
    const built = buildChecks(requirements, org, () => `${vid}_chk_${++n}`, identifierConfigId);
    const review = v.exceptions !== 'unsuccessful';
    out.activityVersions.push({
      id: vid, organizationId: orgId, activityId: id, number: 1, type: built.type, checks: built.checks, requirements, customized: false,
      outcome: { onRequiredFailure: review ? 'pending-review' : 'not-verified', onInconclusive: 'pending-review' },
      status: 'active', createdAt: at(8), createdBy: by, updatedAt: at(8), activatedAt: at(8), activatedBy: by,
    });
    out.activityConfigs.push({
      id, organizationId: orgId, entryPolicy: 'off', participants: { groupIds: [], memberIds: [] }, restrictVerifiers: false, purpose: a.description,
      status: 'active', activeVersionId: vid, createdAt: at(9), createdBy: by, updatedAt: at(8), updatedBy: by, verification: v, ...a,
    });
    for (const administratorId of [verifierIds].flat()) assign(orgId, id, administratorId, by);
  };

  if (has(ORG_A)) {
    add(ORG_A, 'site_access', 'Esther Lawal', { name: 'Site Access Check', description: 'Registered staff checked against FixID records before entering the site.', participants: { groupIds: [`${ORG_A}_grp_volunteers`], memberIds: [] } },
      settings({}), `${ORG_A}_adm_4`);
  }
  if (has(ORG_B) && has(ORG_B1) && has(ORG_B2)) {
    const participants = [
      ...[ORG_B1, ORG_B2].map((organizationId) => ({ organizationId, status: 'active' as const, invitedAt: at(12), invitedBy: 'Victor Hale', updatedAt: at(11), updatedBy: organizationId === ORG_B1 ? 'Lina Ford' : 'Mira Santos' })),
      ...(has(ORG_C) ? [{ organizationId: ORG_C, status: 'invited' as const, invitedAt: at(1), invitedBy: 'Victor Hale' }] : []),
    ];
    add(ORG_B, 'staff_entry', 'Victor Hale', {
      name: 'Group Staff Entry', description: 'Shared activity: each participating organization checks its staff against the group’s connected identity source.',
      sharing: { participants },
    }, settings({ identitySource: { kind: 'external', integrationId: 'int_b_identity' }, eligibility: { approach: 'external-source', attribute: 'recordStatus', allowedValues: ['ACTIVE'] } }));
    // Each participating organization assigns its own staff to the shared activity.
    assign(ORG_B1, DEMO_SHARED_ACTIVITY, `${ORG_B1}_adm_verifier`, 'Lina Ford');
    assign(ORG_B2, DEMO_SHARED_ACTIVITY, `${ORG_B2}_adm_owner`, 'Mira Santos');
  }
  if (has(ORG_C)) {
    const verifiers = [`${ORG_C}_adm_owner`, `${ORG_C}_adm_4`];
    const external = { identitySource: { kind: 'external' as const, integrationId: 'int_c_delegates' } };
    // Prompt 4 scenarios 3, 4, 6, 7, 9 and 11: an external identity, nobody enrolled in FixID; a result may be reused for a day.
    const dayAt = (days: number, hour: number) => { const x = new Date(today.getTime() + days * DAY); x.setHours(hour, 0, 0, 0); return x.toISOString(); };
    add(ORG_C, 'visitor_checkin', 'Tobyson TE', {
      name: 'Visitor Check-in', description: 'Visitors checked against the organization’s connected identity source.',
      location: 'Main Reception', schedule: { kind: 'recurring', startsAt: dayAt(-30, 0), enforced: true, recurrence: { frequency: 'weekly', days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '18:00' } },
    },
      settings({ ...external, eligibility: { approach: 'external-source', attribute: 'recordStatus', allowedValues: ['ACTIVE'] }, exceptions: 'unsuccessful', reverification: { mode: 'reuse-within', days: 1 } }), verifiers);
    add(ORG_C, 'restricted_lounge', 'Tobyson TE', { name: 'Restricted Lounge Access', description: 'Guests checked against the connected identity source; only listed guests are admitted. Problems go to review.' },
      settings({ ...external, eligibility: { approach: 'reference-list', referenceList: ['DEMO-10001', 'GST-2001', 'GST-2002', 'GST-2003'] } }), verifiers);
    // Prompt 4 scenarios 1 and 2: local identity verification with enrolled faces and an eligible population.
    add(ORG_C, 'badge_collection', 'Tobyson TE', {
      name: 'Badge Collection', description: 'Registered participants checked against their FixID records before collecting a badge.',
      participants: { groupIds: [], memberIds: [`${ORG_C}_m_001`, `${ORG_C}_m_003`] }, eligibilityMode: 'selected',
      location: 'Registration Desk', schedule: { kind: 'open-ended', startsAt: dayAt(-9, 8), enforced: true },
    }, settings({ exceptions: 'unsuccessful' }), verifiers, `${ORG_C}_idc_participant-number`);
    // Verification Activities module: a scheduled activity that hasn't started, and a completed one with its records.
    add(ORG_C, 'graduation', 'Tobyson TE', {
      name: 'Graduation Ceremony Check-in', description: 'Selected graduates confirm their identity before collecting their seat allocation.',
      participants: { groupIds: [`${ORG_C}_grp_volunteers`], memberIds: [] }, eligibilityMode: 'selected', location: 'Great Hall', locationAddress: '1 College Road',
      schedule: { kind: 'one-time', startsAt: dayAt(12, 9), endsAt: dayAt(12, 17), enforced: true },
    }, settings({ exceptions: 'unsuccessful', decisionRules: { onInconclusiveMatch: 'unable-to-decide', onServiceUnavailable: 'unable-to-decide' } }), [`${ORG_C}_adm_owner`], `${ORG_C}_idc_participant-number`);
    add(ORG_C, 'open_day', 'Tobyson TE', {
      name: 'Spring Open Day Check-in', description: 'Open-day visitors confirmed their identity on arrival.', eligibilityMode: 'open', location: 'Visitor Centre',
      // Not enforced while the demonstration history is recorded; it is then marked completed.
      schedule: { kind: 'one-time', startsAt: dayAt(-9, 8), endsAt: dayAt(-2, 18), enforced: false },
    }, settings({ ...external, eligibility: { approach: 'external-source', attribute: 'recordStatus', allowedValues: ['ACTIVE'] }, exceptions: 'unsuccessful', decisionRules: { onInconclusiveMatch: 'unable-to-decide', onServiceUnavailable: 'unable-to-decide' } }), [`${ORG_C}_adm_owner`]);
  }
  return out;
}

/**
 * Migration only (saved data from before custom roles existed): each organization's copies of the roles that
 * used to be built in, so those assignments keep working. Never part of new or default organization data.
 */
export function seedCustomRoles(organizations: Pick<Organization, 'id'>[], today: Date): CustomRole[] {
  const at = today.toISOString();
  return organizations.flatMap((o) => LEGACY_ROLE_TEMPLATES.map((t) => ({ ...t, system: false as const, organizationId: o.id, createdAt: at, createdBy: 'FixID', updatedAt: at, updatedBy: 'FixID' })));
}

/**
 * Simulates one verification attempt through the PRD trust model:
 * credential validation → identity match (with policy-controlled fallback) → authorization → decision.
 */
function simulateTransaction(
  rng: Rng,
  activity: VerificationActivity,
  pool: Credential[],
  memberById: Map<string, Member>,
  occurredAt: Date,
  verifiers: string[],
): Transaction {
  const base = {
    id: '', organizationId: activity.organizationId, activityId: activity.id,
    verifier: rng.pick(verifiers), occurredAt: occurredAt.toISOString(),
  };
  const deny = (result: VerificationResult, reason: string, extra: Partial<Transaction> = {}): Transaction => ({
    ...base, credentialId: null, memberId: null, method: activity.primaryMethod, fallbackUsed: false,
    result, decision: 'deny', assuranceAchieved: null, reason, ...extra,
  });

  if (rng.chance(0.025)) return deny('rejected', 'Credential not recognised');

  const cred = rng.pick(pool);
  const member = memberById.get(cred.memberId)!;
  const ids = { credentialId: cred.id, memberId: member.id };

  // 1. Credential validation
  const expired = cred.expiresAt !== null && new Date(cred.expiresAt) < occurredAt;
  if (cred.status === 'revoked') return deny('rejected', 'Credential revoked', ids);
  if (cred.status === 'suspended') return deny('rejected', 'Credential suspended', ids);
  if (cred.status === 'pending') return deny('rejected', 'Credential not yet activated', ids);
  if (expired || cred.status === 'expired') return deny('rejected', 'Credential expired', ids);

  // 2. Identity match, with fallback only when policy permits and assurance is preserved.
  let method = activity.primaryMethod;
  let fallbackUsed = false;
  const biometric = method === 'face' || method === 'fingerprint';
  const factorMissing = biometric && (method === 'face' ? member.faceEnrollment.status !== 'enrolled' : !member.factors.fingerprint);
  const primaryFailed = factorMissing || rng.chance(0.07);
  if (primaryFailed) {
    const fallback = activity.fallback.permitted
      ? activity.fallback.methods.find((m) => meetsAssurance(METHOD_ASSURANCE[m], activity.assuranceLevel))
      : undefined;
    if (!fallback) {
      return deny('failed', factorMissing ? `No enrolled ${method} factor; fallback not permitted` : 'Identity match failed; fallback not permitted', ids);
    }
    method = fallback;
    fallbackUsed = true;
    if (rng.chance(0.15)) return deny('failed', 'Identity match failed on fallback method', { ...ids, method, fallbackUsed });
  }
  const assuranceAchieved = METHOD_ASSURANCE[method];

  // 3. Authorization: verification succeeded, but is this person eligible for this action?
  let decision: Decision = 'allow';
  let reason = activity.outcome;
  if (rng.chance(0.006)) {
    decision = 'indeterminate';
    reason = 'Eligibility service timed out; access not granted';
  } else if (!activity.eligibility.credentialTypeIds.includes(cred.credentialTypeId)) {
    decision = 'deny';
    reason = 'Credential type not eligible for this activity';
  } else if (activity.eligibility.rosterMemberIds && !activity.eligibility.rosterMemberIds.includes(member.id)) {
    decision = 'deny';
    reason = 'Not on activity roster';
  } else if (activity.eligibility.requireActiveMember && member.status !== 'active') {
    decision = 'deny';
    reason = 'Relationship with organization is not active';
  }
  return { ...base, ...ids, method, fallbackUsed, result: 'success', decision, assuranceAchieved, reason };
}
