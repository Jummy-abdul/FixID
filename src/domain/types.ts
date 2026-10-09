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

export type Industry = 'education' | 'corporate' | 'healthcare' | 'events' | 'membership';

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
  | { kind: 'no-expiry' };

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
  status: 'active' | 'draft' | 'retired';
  createdAt: ISODate;
}

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
  | 'credential.issued'
  | 'credential.activated'
  | 'credential.suspended'
  | 'credential.revoked'
  | 'credential.renewed'
  | 'activity.updated'
  | 'organization.updated'
  | 'wallet.delivered'
  | 'wallet.failed';

/** Administrative and security-sensitive audit record (PRD §19.4). */
export interface AuditEvent {
  id: string;
  organizationId: string;
  action: AuditAction;
  actor: string;
  actorType: 'admin' | 'system' | 'integration';
  resourceType: 'member' | 'credential' | 'credential-type' | 'identifier' | 'activity' | 'organization';
  resourceId: string;
  result: 'success' | 'failure';
  summary: string;
  occurredAt: ISODate;
  /** Optional link target inside the app. */
  href?: string;
}
