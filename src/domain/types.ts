/**
 * FixID domain model.
 *
 * Ownership boundaries (per updated product decisions):
 * - ID Switch owns canonical identities (`CanonicalIdentity`). FixID only stores a reference.
 * - FixID owns the organization-specific context (`Member`), credential configuration
 *   (`CredentialType`, `CardDesign`), issuance (`Credential`), verification activities
 *   (`VerificationPoint`) and `Transaction`s.
 * - Seamfix Wallet owns the holder experience; FixID only tracks delivery status.
 */

export type ISODate = string;

export type Industry = 'education' | 'corporate' | 'healthcare' | 'events' | 'membership' | 'other';

export interface Organization {
  id: string;
  name: string;
  shortName: string;
  industry: Industry;
  country: string;
  timezone: string;
  contactEmail: string;
  /** Default label for people in this org, e.g. "Student", "Employee". */
  memberLabel: string;
  defaultCardDesignId: string;
  integrations: OrganizationIntegrations;
  createdAt: ISODate;
  /** State or region, when given during onboarding. */
  region?: string;
  /** Set for organizations created by a signed-up administrator (not demo data). */
  ownerAccountId?: string;
}

export interface OrganizationIntegrations {
  idSwitch: { connected: boolean; tenantRef: string };
  seamfixWallet: { connected: boolean; issuerDid: string };
  /** Fixiam is an independent workforce IAM product and is optional for FixID. */
  fixiam: { connected: boolean };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  /** Display initials for the avatar, when they cannot be derived from the name. */
  initials?: string;
  role: 'Owner' | 'Administrator' | 'Operator' | 'Auditor';
  /** Organizations this admin can act within. */
  organizationIds: string[];
}

/** Canonical identity record held by ID Switch. Never persisted inside FixID state. */
export interface CanonicalIdentity {
  idSwitchId: string;
  givenName: string;
  familyName: string;
  email: string;
  phone: string;
  dateOfBirth: ISODate;
  /** Optional profile attributes held in the canonical record. */
  gender?: 'Female' | 'Male';
  location?: string;
  /** Country name and region/state, when recorded. */
  country?: string;
  region?: string;
  nationality: string;
  verificationLevel: 'basic' | 'verified' | 'high-assurance';
  /** Other Seamfix products that reference this canonical identity, e.g. Fixiam. */
  linkedProducts: ('Fixiam' | 'FixID')[];
}

export type MemberStatus = 'active' | 'inactive' | 'pending';

/**
 * Facial enrollment is a separate, user-initiated capability (live capture with liveness).
 * It is independent of user status and credential issuance; an uploaded photo never counts.
 */
export type FaceEnrollmentStatus = 'not-enrolled' | 'pending' | 'enrolled' | 'expired' | 'failed';

/** Organization-specific identity context. Minimal by design. */
export interface Member {
  id: string;
  organizationId: string;
  idSwitchId: string;
  /** Snapshot of display name for fast listing; source of truth remains ID Switch. */
  displayName: string;
  /** Optional descriptive role from a source system, e.g. "Student". Not a configuration entity. */
  relationship: string;
  unit: string;
  /** The organizational identifier assigned to this person, e.g. a matric number. */
  identifier?: { configId: string; value: string; source?: string };
  status: MemberStatus;
  /** How the ID Switch identity was obtained when the person was onboarded (PRD §15.4). */
  resolution: 'linked-existing' | 'created-new';
  /** Facial enrollment, tracked separately from user status. Raw biometric data is never exposed (PRD §18.6). */
  faceEnrollment: {
    status: FaceEnrollmentStatus;
    updatedAt?: ISODate;
    /** The current enrollment invitation. Resending refreshes it; there is never more than one open link. */
    invitation?: EnrollmentInvitation;
    /** Approved display portrait, available only after successful enrollment. */
    portraitUrl?: string;
    /** True when the portrait is a decorative demo image rather than an enrollment capture. */
    portraitIsSample?: boolean;
  };
  /** Other biometric factors (status only). */
  factors: { fingerprint: boolean };
  joinedAt: ISODate;
  /** Administrator who added the user, when known. */
  createdBy?: string;
  /** Idempotency key of the request that created this user. */
  creationRequestId?: string;
}

export interface EnrollmentInvitation {
  id: string;
  /** Masked address the link was sent to. */
  sentTo: string;
  firstSentAt: ISODate;
  sentAt: ISODate;
  sendCount: number;
  /** No email integration exists in the prototype; invitations are recorded, not delivered. */
  simulated: true;
}

export type AdministratorStatus = 'invited' | 'active' | 'deactivated';

/**
 * Someone authorized to operate FixID for an organization. Separate from Member (a person whose
 * identity and credentials are managed); the same person may be both, linked via `memberId`.
 */
export interface OrgAdministrator {
  id: string;
  organizationId: string;
  email: string;
  name?: string;
  /** The signed-in user (AdminUser.id) once the invitation is accepted. */
  userId?: string;
  /** Optional link to the same person's user record in User Management. */
  memberId?: string;
  roleIds: string[];
  status: AdministratorStatus;
  invitation?: { sentAt: ISODate; expiresAt: ISODate; sendCount: number; invitedBy: string };
  /** Verification activities a verifier may perform (enforced by verification services in production). */
  verifierActivityIds?: string[];
  createdAt: ISODate;
  lastActiveAt?: ISODate;
}

export type DateFormat = 'YYYY' | 'YY' | 'MM' | 'DD' | 'YYYYMM' | 'YYYYMMDD';

/** One building block of a generated identifier. */
export type IdentifierSegment =
  | { id: string; kind: 'static'; value: string }
  | { id: string; kind: 'separator'; value: '-' | '/' | '_' | '.' }
  | { id: string; kind: 'sequence'; start: number; digits: number; zeroPad: boolean }
  | { id: string; kind: 'random-numeric'; length: number }
  | { id: string; kind: 'random-alphanumeric'; length: number; charset: 'upper' | 'mixed' }
  | { id: string; kind: 'date'; format: DateFormat };

/**
 * Reusable, organization-level identifier configuration (e.g. Matric Number).
 * Keyed by a stable id, never by its display name.
 */
export interface IdentifierConfig {
  id: string;
  organizationId: string;
  name: string;
  mode: 'manual' | 'generated';
  /** Pattern for generated identifiers. Empty for manual entry. */
  segments: IdentifierSegment[];
  /** Next value of the sequential segment. Persisted; only advanced when an identifier is assigned. */
  nextSequence: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type ValidityRule =
  | { kind: 'duration'; months: number }
  | { kind: 'fixed-date'; date: ISODate }
  | { kind: 'no-expiry' }
  /** An exact expiry date chosen by the administrator when issuing; required before issuing. */
  | { kind: 'set-at-issuance' };

export type EffectiveDateRule = 'on-issue' | 'custom-date' | 'start-of-term';

export interface CredentialType {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  /**
   * Identifier rules. `generated`: prefix + zero-padded sequence (e.g. NBU-STU-000123).
   * `manual`: supplied per person (e.g. an existing matric number). Unique per credential type either way.
   */
  identifier: { label: string; mode: 'generated' | 'manual'; prefix: string; digits: number; nextSequence: number };
  /**
   * When set, the credential shows the holder's organizational identifier from this configuration
   * instead of generating its own. Credentials configured in FixID always use this.
   */
  identifierConfigId?: string;
  effectiveDate: EffectiveDateRule;
  validity: ValidityRule;
  renewal: { allowed: boolean; windowDays: number };
  lifecycle: { requiresApproval: boolean; allowSuspension: boolean; autoExpire: boolean };
  cardDesignId: string;
  /** Starter template used to render credentials of this type. */
  templateId: TemplateId;
  status: 'active' | 'draft' | 'retired';
  createdAt: ISODate;
  updatedAt?: ISODate;
}

export type TemplateId = 'classic-landscape' | 'modern-landscape' | 'classic-portrait' | 'modern-portrait';

export interface CardDesign {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
  primaryColor: string;
  accentColor: string;
  textColor: string;
  layout: 'horizontal' | 'vertical';
  showPhoto: boolean;
  showQr: boolean;
  fields: CardField[];
}

export type CardField = 'name' | 'identifier' | 'relationship' | 'unit' | 'expiry' | 'issued';

export type CredentialStatus = 'active' | 'pending' | 'suspended' | 'revoked' | 'expired';

export type WalletDeliveryStatus = 'delivered' | 'pending' | 'failed' | 'not-sent';

export interface Credential {
  id: string;
  organizationId: string;
  memberId: string;
  credentialTypeId: string;
  identifier: string;
  status: CredentialStatus;
  issuedAt: ISODate;
  effectiveFrom: ISODate;
  expiresAt: ISODate | null;
  wallet: { status: WalletDeliveryStatus; updatedAt: ISODate };
  /** Idempotency key of the issuance request that created this credential. */
  issuanceRequestId?: string;
  /** The issuance run that created this credential, when it was issued to several people at once (e.g. from a group). Ownership stays with the holder. */
  issuanceBatchId?: string;
  /**
   * What the configuration looked like when this credential was issued. Later edits to the
   * configuration apply to future issuance only and never rewrite issued credentials.
   */
  snapshot?: { credentialName: string; templateId: TemplateId; identifierLabel: string };
}

export type VerificationMethod = 'qr' | 'nfc' | 'face' | 'fingerprint' | 'manual';

export type AssuranceLevel = 'low' | 'substantial' | 'high';

export type ActivityPurpose = 'entry' | 'examination' | 'attendance' | 'service' | 'membership';

/**
 * A configurable verification activity (PRD §10, FR-026..FR-028): purpose, eligibility,
 * methods, assurance, fallback, context and outcome on one reusable engine.
 */
export interface VerificationActivity {
  id: string;
  organizationId: string;
  name: string;
  purpose: ActivityPurpose;
  description: string;
  location: string;
  eligibility: {
    credentialTypeIds: string[];
    relationships: string[];
    /** Optional explicit roster, e.g. students registered for CSC 401. */
    rosterMemberIds?: string[];
    /**
     * Groups whose current members are eligible (by stable group ID, never by name). Reserved for
     * configurable verification activities; while set, the groups can't be removed.
     */
    groupIds?: string[];
    requireActiveMember: boolean;
  };
  primaryMethod: VerificationMethod;
  /** Fallback is only used when explicitly permitted and must respect the assurance level. */
  fallback: { permitted: boolean; methods: VerificationMethod[] };
  assuranceLevel: AssuranceLevel;
  /** What happens on an allow decision, e.g. "Grant entry", "Record attendance". */
  outcome: string;
  schedule: { kind: 'always' } | { kind: 'window'; startsAt: ISODate; endsAt: ISODate };
  status: 'active' | 'paused' | 'draft' | 'completed';
  createdAt: ISODate;
}

export type VerificationResult = 'success' | 'failed' | 'rejected';
export type Decision = 'allow' | 'deny' | 'indeterminate';

/** A single verification attempt and its outcome (PRD §19.3). */
export interface Transaction {
  id: string;
  organizationId: string;
  activityId: string;
  credentialId: string | null;
  memberId: string | null;
  method: VerificationMethod;
  fallbackUsed: boolean;
  result: VerificationResult;
  decision: Decision;
  assuranceAchieved: AssuranceLevel | null;
  reason: string;
  verifier: string;
  occurredAt: ISODate;
}

export type AuditAction =
  | 'identity.resolved'
  | 'identity.linked'
  | 'identity.created'
  | 'user.created'
  | 'user.activated'
  | 'user.deactivated'
  | 'enrollment.invited'
  | 'identifier.created'
  | 'identifier.updated'
  | 'credential-type.created'
  | 'credential-type.updated'
  | 'credential.issued'
  | 'credential.activated'
  | 'credential.suspended'
  | 'credential.revoked'
  | 'credential.renewed'
  | 'activity.updated'
  | 'organization.updated'
  | 'organization.created'
  | 'admin.invited'
  | 'admin.invitation-resent'
  | 'admin.invitation-revoked'
  | 'admin.joined'
  | 'admin.role-assigned'
  | 'group.created'
  | 'group.updated'
  | 'group.removed'
  | 'group.members-added'
  | 'group.members-removed'
  | 'issuance.batch-started'
  | 'issuance.batch-completed'
  | 'admin.role-removed'
  | 'admin.roles-changed'
  | 'admin.deactivated'
  | 'admin.reactivated'
  | 'wallet.delivered'
  | 'wallet.failed';

/** Administrative and security-sensitive audit record (PRD §19.4). */
export interface AuditEvent {
  id: string;
  organizationId: string;
  action: AuditAction;
  actor: string;
  actorType: 'admin' | 'system' | 'integration';
  resourceType: 'member' | 'credential' | 'credential-type' | 'identifier' | 'activity' | 'organization' | 'administrator' | 'group';
  resourceId: string;
  /** `partial` when an operation on several records succeeded for some and not others. */
  result: 'success' | 'partial' | 'failure';
  summary: string;
  occurredAt: ISODate;
  /** Optional link target inside the app. */
  href?: string;
  /** The record the event is about, by name, when it isn't obvious from the resource id (e.g. the affected administrator). */
  subject?: { id: string; name: string };
  /** Other records affected, e.g. the users added to a group. */
  related?: { id: string; name: string }[];
  /** Previous and new values for changes. */
  changes?: { field: string; from: string; to: string }[];
}

/**
 * A reusable, organization-scoped collection of users (e.g. a department, cohort, team or location).
 * The ID is stable when the name changes. Groups organize managed users only: membership never grants
 * administrative access, issues credentials or proves identity.
 */
export interface Group {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  createdAt: ISODate;
  createdBy: string;
  updatedAt: ISODate;
  updatedBy: string;
}

/** One user's membership of one group. Stored once; groups and user profiles both read it. */
export interface GroupMembership {
  organizationId: string;
  groupId: string;
  memberId: string;
  addedAt: ISODate;
  addedBy: string;
}

/** Outcome for one person in an issuance run. Skipped means not attempted because they weren't eligible. */
export interface IssuanceBatchResult {
  memberId: string;
  memberName: string;
  outcome: 'issued' | 'failed' | 'skipped';
  reason?: string;
  credentialId?: string;
}

/**
 * One issuance operation for several recipients, started from a group. Each credential it creates
 * is an ordinary credential owned by its holder; the run only records where it came from and how it went.
 */
export interface IssuanceBatch {
  id: string;
  organizationId: string;
  /** The group the run was started from. Kept by ID, so it survives renames. */
  groupId: string;
  groupName: string;
  credentialTypeId: string;
  credentialName: string;
  initiatedAt: ISODate;
  initiatedBy: string;
  completedAt: ISODate;
  status: 'completed' | 'partial' | 'failed';
  results: IssuanceBatchResult[];
}
