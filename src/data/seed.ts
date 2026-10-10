import { METHOD_ASSURANCE, meetsAssurance } from '@/domain/rules';
import type {
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
  for (const org of organizations) {
    const domain = org.contactEmail.split('@')[1] ?? 'example.org';
    out.push({
      id: `${org.id}_adm_owner`, organizationId: org.id, email: 'tobyson.te@fixid.demo', name: 'Tobyson TE', userId: 'usr_tobyson',
      roleIds: ['organization-admin'], status: 'active', createdAt: org.createdAt, lastActiveAt: iso(today),
    });
    if (org.id === NEW_ORGANIZATION_ID) continue;
    const invite = (sentDaysAgo: number) => ({ sentAt: ago(sentDaysAgo), expiresAt: ago(sentDaysAgo - 7), sendCount: 1, invitedBy: 'Tobyson TE' });
    out.push(
      { id: `${org.id}_adm_2`, organizationId: org.id, email: `adaora.nwosu@${domain}`, name: 'Adaora Nwosu', userId: `${org.id}_usr_2`, roleIds: ['credential-manager'], status: 'active', createdAt: ago(300), lastActiveAt: ago(1) },
      { id: `${org.id}_adm_3`, organizationId: org.id, email: `kwame.mensah@${domain}`, name: 'Kwame Mensah', userId: `${org.id}_usr_3`, roleIds: ['verification-manager'], status: 'active', createdAt: ago(240), lastActiveAt: ago(3) },
      { id: `${org.id}_adm_4`, organizationId: org.id, email: `halima.bello@${domain}`, name: 'Halima Bello', userId: `${org.id}_usr_4`, roleIds: ['verifier'], status: 'active', createdAt: ago(200), lastActiveAt: ago(2) },
      { id: `${org.id}_adm_5`, organizationId: org.id, email: `grace.okafor@${domain}`, name: 'Grace Okafor', userId: `${org.id}_usr_5`, roleIds: ['viewer'], status: 'deactivated', createdAt: ago(380), lastActiveAt: ago(40) },
      { id: `${org.id}_adm_6`, organizationId: org.id, email: `operations@${domain}`, roleIds: ['credential-manager', 'viewer'], status: 'invited', createdAt: ago(2), invitation: invite(2) },
      { id: `${org.id}_adm_7`, organizationId: org.id, email: `records@${domain}`, roleIds: ['viewer'], status: 'invited', createdAt: ago(12), invitation: invite(12) },
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
  const by = 'Tobyson TE';
  const out = { activityConfigs: [] as ActivityConfig[], activityVersions: [] as ActivityVersion[], verifierAssignments: [] as VerifierAssignment[] };
  const outcome = { onRequiredFailure: 'not-verified' as const, onInconclusive: 'unable-to-verify' as const };
  for (const org of organizations) {
    if (org.id === NEW_ORGANIZATION_ID || !org.integrations.idSwitch.connected) continue;
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
    // Officer-led examination clearance: matric number, then a live face verified 1:1 against the enrolled
    // portrait, then eligibility. Nobody is assigned as a verifier; an administrator assigns them.
    const matric = d.identifierConfigs.find((i) => i.organizationId === org.id && i.name === 'Matric number');
    if (matric) {
      const candidates = d.members.filter((m) => m.organizationId === org.id && m.status === 'active' && m.identifier?.configId === matric.id).slice(0, 24).map((m) => m.id);
      add('exam', {
        name: '2026 Examination Clearance', description: 'Confirm each candidate’s identity and eligibility before they enter the examination hall.', purpose: 'Clear registered candidates into the 2026 examinations.',
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
  /** Build a roster from members in these units, for activities like examinations. */
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
  /** Organizational reference for each person, from a source system (e.g. matric number). */
  externalRef?: (relationship: string, rng: Rng) => { label: string; value: string; source: string };
  activities: ActivityBlueprint[];
  registrySlice: number[];
  dailyTransactions: [number, number];
}

const BLUEPRINTS: OrgBlueprint[] = [
  {
    org: {
      id: 'org_northbridge',
      name: 'Northbridge University',
      shortName: 'NBU',
      industry: 'education',
      country: 'Nigeria',
      timezone: 'Africa/Lagos',
      contactEmail: 'identity.office@northbridge.edu.ng',
      memberLabel: 'Member',
      integrations: {
        idSwitch: { connected: true, tenantRef: 'ids-tenant-nbu-01' },
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
        key: 'student', name: 'Student ID', description: 'Primary identity credential for enrolled students.',
        prefix: 'NBU-STU-', digits: 6, effectiveDate: 'start-of-term', validity: { kind: 'duration', months: 12 },
        renewal: { allowed: true, windowDays: 30 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Student'],
      },
      {
        key: 'staff', name: 'Staff ID', description: 'Identity credential for academic and non-academic staff.',
        prefix: 'NBU-STF-', digits: 5, effectiveDate: 'on-issue', validity: { kind: 'duration', months: 24 },
        renewal: { allowed: true, windowDays: 45 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Staff'],
      },
      {
        key: 'library', name: 'Library Pass', description: 'Grants borrowing rights and access to the main library.',
        prefix: 'NBU-LIB-', digits: 6, effectiveDate: 'on-issue', validity: { kind: 'no-expiry' },
        renewal: { allowed: false, windowDays: 0 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: false },
        status: 'active', holders: ['Student', 'Staff'],
      },
      {
        key: 'alumni', name: 'Alumni Card', description: 'Lifetime membership credential for graduates. Not yet published.',
        prefix: 'NBU-ALU-', digits: 6, effectiveDate: 'on-issue', validity: { kind: 'no-expiry' },
        renewal: { allowed: false, windowDays: 0 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: false },
        status: 'draft', holders: [],
      },
    ],
    relationships: [{ value: 'Student', weight: 0.78 }, { value: 'Staff', weight: 0.22 }],
    units: ['Faculty of Engineering', 'Faculty of Law', 'College of Medicine', 'Faculty of Arts', 'School of Business', 'Faculty of Sciences'],
    externalRef: (rel, rng) => rel === 'Student'
      ? { label: 'Matric number', value: `NBU/${2021 + rng.int(0, 4)}/${rng.int(10000, 99999)}`, source: 'Student records system' }
      : { label: 'Staff number', value: `SN-${rng.int(1000, 9999)}`, source: 'HR system' },
    activities: [
      {
        key: 'campus', name: 'Campus Entry', purpose: 'entry', description: 'Verify students and staff at campus gates.',
        location: 'Main Gate, North entrance', eligibleTypes: ['student', 'staff'], relationships: ['Student', 'Staff'],
        primaryMethod: 'qr', fallback: { permitted: true, methods: ['nfc'] }, assuranceLevel: 'low', outcome: 'Grant entry',
        status: 'active', verifiers: ['Gate A turnstile', 'Gate B turnstile', 'Security desk tablet'], volume: 5,
      },
      {
        key: 'library', name: 'Library Access', purpose: 'entry', description: 'Admit pass holders into the Kenneth Dike Library.',
        location: 'Kenneth Dike Library', eligibleTypes: ['library'], relationships: ['Student', 'Staff'],
        primaryMethod: 'nfc', fallback: { permitted: true, methods: ['qr'] }, assuranceLevel: 'low', outcome: 'Grant entry',
        status: 'active', verifiers: ['Library entry reader'], volume: 2,
      },
      {
        key: 'csc401', name: 'CSC 401 Examination', purpose: 'examination',
        description: 'Admit only students registered for CSC 401 into the examination hall.',
        location: 'Exam Hall A, Faculty of Sciences', eligibleTypes: ['student'], relationships: ['Student'], rosterUnit: 'Faculty of Sciences',
        primaryMethod: 'face', fallback: { permitted: true, methods: ['nfc'] }, assuranceLevel: 'substantial', outcome: 'Admit to examination',
        status: 'active', window: [-2, 5], verifiers: ['Invigilator tablet 1', 'Invigilator tablet 2'], volume: 4,
      },
      {
        key: 'staff-attendance', name: 'Staff Attendance', purpose: 'attendance', description: 'Record daily attendance for staff.',
        location: 'Senate Building lobby', eligibleTypes: ['staff'], relationships: ['Staff'],
        primaryMethod: 'nfc', fallback: { permitted: true, methods: ['face'] }, assuranceLevel: 'substantial', outcome: 'Record attendance',
        status: 'active', verifiers: ['Senate lobby kiosk'], volume: 1.2,
      },
      {
        key: 'convocation', name: 'Convocation 2026', purpose: 'entry', description: 'Graduation ceremony entry. Configuration in progress.',
        location: 'University Main Auditorium', eligibleTypes: ['student'], relationships: ['Student'],
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
      name: 'Meridian Health Group',
      shortName: 'MHG',
      industry: 'healthcare',
      country: 'Nigeria',
      timezone: 'Africa/Lagos',
      contactEmail: 'security@meridianhealth.ng',
      memberLabel: 'Member',
      integrations: {
        idSwitch: { connected: true, tenantRef: 'ids-tenant-mhg-04' },
        seamfixWallet: { connected: true, issuerDid: 'did:sfx:issuer:meridian-health' },
        fixiam: { connected: true },
      },
    },
    design: {
      primaryColor: '#0f766e', accentColor: '#99f6e4', textColor: '#ffffff', layout: 'vertical',
      showPhoto: true, showQr: true, fields: ['name', 'identifier', 'relationship', 'unit', 'expiry'],
    },
    types: [
      {
        key: 'clinical', name: 'Clinical Staff Badge', description: 'Identity and access badge for employed clinical staff.',
        prefix: 'MHG-CS-', digits: 5, effectiveDate: 'on-issue', validity: { kind: 'duration', months: 12 },
        renewal: { allowed: true, windowDays: 30 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Clinician', 'Nurse'],
      },
      {
        key: 'admin', name: 'Administrative Staff Badge', description: 'Badge for non-clinical employees.',
        prefix: 'MHG-AS-', digits: 5, effectiveDate: 'on-issue', validity: { kind: 'duration', months: 12 },
        renewal: { allowed: true, windowDays: 30 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Administrator'],
      },
      {
        key: 'locum', name: 'Visiting Clinician Pass', description: 'Time-bound pass for locum and visiting clinicians.',
        prefix: 'MHG-VC-', digits: 4, effectiveDate: 'custom-date', validity: { kind: 'duration', months: 3 },
        renewal: { allowed: true, windowDays: 7 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Visiting Clinician'],
      },
    ],
    relationships: [
      { value: 'Clinician', weight: 0.35 }, { value: 'Nurse', weight: 0.35 },
      { value: 'Administrator', weight: 0.2 }, { value: 'Visiting Clinician', weight: 0.1 },
    ],
    units: ['Ikoyi Hospital', 'Lekki Clinic', 'Abuja Specialist Centre', 'Central Pharmacy'],
    externalRef: (rel, rng) => rel === 'Visiting Clinician'
      ? { label: 'MDCN folio', value: `MDCN/${rng.int(30000, 89999)}`, source: 'Provided at onboarding' }
      : { label: 'Employee ID', value: `MHG-E${rng.int(1000, 9999)}`, source: 'Fixiam' },
    activities: [
      {
        key: 'theatre', name: 'Theatre Wing Access', purpose: 'entry', description: 'High-assurance access to operating theatres.',
        location: 'Ikoyi Hospital, Level 2', eligibleTypes: ['clinical', 'locum'], relationships: ['Clinician', 'Nurse', 'Visiting Clinician'],
        primaryMethod: 'face', fallback: { permitted: true, methods: ['fingerprint'] }, assuranceLevel: 'high', outcome: 'Grant entry',
        status: 'active', verifiers: ['Theatre door terminal'], volume: 2,
      },
      {
        key: 'pharmacy', name: 'Pharmacy Store Access', purpose: 'entry', description: 'Controlled drug store access. No fallback permitted.',
        location: 'Central Pharmacy', eligibleTypes: ['clinical'], relationships: ['Clinician', 'Nurse'],
        primaryMethod: 'nfc', fallback: { permitted: false, methods: [] }, assuranceLevel: 'substantial', outcome: 'Unlock store',
        status: 'active', verifiers: ['Pharmacy store reader'], volume: 1,
      },
      {
        key: 'attendance', name: 'Shift Attendance', purpose: 'attendance', description: 'Record clock-in for all staff shifts.',
        location: 'All sites', eligibleTypes: ['clinical', 'admin', 'locum'], relationships: ['Clinician', 'Nurse', 'Administrator', 'Visiting Clinician'],
        primaryMethod: 'nfc', fallback: { permitted: true, methods: ['face'] }, assuranceLevel: 'substantial', outcome: 'Record attendance',
        status: 'active', verifiers: ['Ikoyi staff entrance', 'Lekki staff entrance', 'Abuja staff entrance'], volume: 3,
      },
    ],
    registrySlice: range(52, 92),
    dailyTransactions: [18, 34],
  },
  {
    org: {
      id: 'org_lts',
      name: 'Lagos Tech Summit 2026',
      shortName: 'LTS',
      industry: 'events',
      country: 'Nigeria',
      timezone: 'Africa/Lagos',
      contactEmail: 'accreditation@lagostechsummit.com',
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
        key: 'attendee', name: 'Attendee Badge', description: 'General admission for all summit days.',
        prefix: 'LTS26-A-', digits: 5, effectiveDate: 'custom-date', validity: { kind: 'duration', months: 1 },
        renewal: { allowed: false, windowDays: 0 }, lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Attendee'],
      },
      {
        key: 'speaker', name: 'Speaker Badge', description: 'Speaker access including green room and VIP lounge.',
        prefix: 'LTS26-S-', digits: 4, effectiveDate: 'custom-date', validity: { kind: 'duration', months: 1 },
        renewal: { allowed: false, windowDays: 0 }, lifecycle: { requiresApproval: true, allowSuspension: true, autoExpire: true },
        status: 'active', holders: ['Speaker'],
      },
    ],
    relationships: [{ value: 'Attendee', weight: 0.85 }, { value: 'Speaker', weight: 0.15 }],
    units: ['Day pass', 'Full summit', 'Startup track', 'Investor track'],
    externalRef: (_rel, rng) => ({ label: 'Ticket number', value: `TKT-${rng.int(100000, 999999)}`, source: 'Ticketing platform' }),
    activities: [
      {
        key: 'hall', name: 'Hall 1 Entry', purpose: 'entry', description: 'Main hall admission for all badge holders.',
        location: 'Eko Convention Centre', eligibleTypes: ['attendee', 'speaker'], relationships: ['Attendee', 'Speaker'],
        primaryMethod: 'qr', fallback: { permitted: true, methods: ['manual'] }, assuranceLevel: 'low', outcome: 'Grant entry',
        status: 'active', window: [-3, 1], verifiers: ['Hall 1 scanner A', 'Hall 1 scanner B'], volume: 5,
      },
      {
        key: 'vip', name: 'VIP Lounge', purpose: 'entry', description: 'Speakers only.',
        location: 'Eko Convention Centre, Mezzanine', eligibleTypes: ['speaker'], relationships: ['Speaker'],
        primaryMethod: 'qr', fallback: { permitted: false, methods: [] }, assuranceLevel: 'low', outcome: 'Grant entry',
        status: 'active', window: [-3, 1], verifiers: ['VIP host phone'], volume: 1,
      },
    ],
    registrySlice: [...range(40, 52), ...range(92, 122)],
    dailyTransactions: [20, 60],
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
        createdBy: ADMIN_NAME,
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
        ? orgMembers.filter((m) => m.unit === rosterUnit && m.relationship === 'Student' && m.status !== 'pending').map((m) => m.id)
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
        id: '', organizationId: orgId, action: 'user.created', actor: ADMIN_NAME, actorType: 'admin',
        resourceType: 'member', resourceId: m.id, result: 'success', occurredAt: m.joinedAt, href: `/users/${m.id}`,
        summary: `Added ${m.displayName}`,
      });
    }
    const recentCredentials = [...orgCredentials].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).slice(0, 14);
    const typeById = new Map(credentialTypes.map((t) => [t.id, t]));
    for (const c of recentCredentials) {
      const m = memberById.get(c.memberId)!;
      audit.push({
        id: '', organizationId: orgId, action: 'credential.issued', actor: ADMIN_NAME, actorType: 'admin',
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
        actor: ADMIN_NAME, actorType: 'admin', resourceType: 'credential', resourceId: c.id, result: 'success',
        occurredAt: iso(addDays(today, -rng.int(1, 20))), href: `/credentials/${c.id}`,
        summary: `${c.status === 'revoked' ? 'Revoked' : 'Suspended'} ${c.identifier} (${m.displayName})`,
      });
    }
  }

  // A brand-new organization: only the default digital ID design every organization receives.
  organizations.unshift({
    id: NEW_ORGANIZATION_ID,
    name: 'Crestfield Academy',
    shortName: 'CFA',
    industry: 'education',
    country: 'Nigeria',
    timezone: 'Africa/Lagos',
    contactEmail: 'admin@crestfield.edu.ng',
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

  const administrators = seedAdministrators(organizations, today);
  const seededGroups = seedGroups(organizations, members, today);
  return {
    organizations,
    admin: { ...DEMO_ADMIN, organizationIds: organizations.map((o) => o.id) },
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
    ...seedVerificationActivities(organizations, { credentialTypes, identifierConfigs, groups: seededGroups.groups, administrators, members }, today),
    verificationAttempts: [],
    customRoles: seedCustomRoles(organizations, today),
    logoAssets: [],
  };
}

/** Each demo organization's own copies of the roles that used to be built in, so existing assignments keep working. */
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
