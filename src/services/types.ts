import type { GeolocationService, MapsService } from './location';
import type { CanonicalIdentity, Credential, CredentialType, Organization, WalletDeliveryStatus } from '@/domain/types';

export interface ServiceHealth {
  ok: boolean;
  latencyMs: number;
  message: string;
  checkedAt: string;
}

export interface IdentityQuery {
  givenName: string;
  familyName: string;
  email?: string;
  phone?: string;
  /** Optional profile attributes, recorded when a new identity is created. */
  gender?: 'Female' | 'Male';
  country?: string;
  region?: string;
}

/**
 * Outcome of resolving a person against ID Switch.
 * - match: email or phone on record AND the name agree: safe to reuse.
 * - conflict: email or phone belongs to an identity with a different name (or to two identities): never merged.
 * - possible: name-only similarity; too weak to link automatically.
 * - none: no existing identity found.
 */
export type ResolutionResult =
  | { kind: 'match'; identity: CanonicalIdentity; matchedOn: ('email' | 'phone')[] }
  | { kind: 'conflict'; field: 'email' | 'phone' | 'email-and-phone' }
  | { kind: 'possible'; candidates: CanonicalIdentity[] }
  | { kind: 'none' };

export class IdSwitchUnavailableError extends Error {
  constructor() {
    super('The identity service is temporarily unavailable.');
    this.name = 'IdSwitchUnavailableError';
  }
}

/** ID Switch: owner of canonical identities. FixID resolves, references and requests creation; it never stores them. */
export interface IdSwitchService {
  getIdentity(idSwitchId: string): Promise<CanonicalIdentity | null>;
  /** Contact details for listing, read from ID Switch on demand (never copied into FixID). Throws when unavailable. */
  getContacts(idSwitchIds: string[]): Promise<Map<string, { email?: string; phone?: string }>>;
  searchIdentities(query: string, limit?: number): Promise<CanonicalIdentity[]>;
  /** Throws IdSwitchUnavailableError when the service cannot be reached. */
  resolveIdentity(query: IdentityQuery): Promise<ResolutionResult>;
  /** Requests a new canonical identity. Throws when unavailable or when the email/phone is already on record. */
  createIdentity(query: IdentityQuery): Promise<CanonicalIdentity>;
  checkHealth(org: Organization): Promise<ServiceHealth>;
  /** Prototype controls for the simulation. */
  simulation: { isOutage(): boolean; setOutage(on: boolean): void; reset(): void };
}

/** Credential issuance rules: identifier generation and validity calculation. Pure and synchronous. */
export interface CredentialIssuanceService {
  /** Next generated identifier, or null when identifiers are entered manually. */
  previewIdentifier(type: CredentialType): string | null;
  computeValidity(type: CredentialType, issueDate: Date, effectiveDate?: Date): { effectiveFrom: Date; expiresAt: Date | null };
  renewalOpensAt(type: CredentialType, credential: Credential): Date | null;
}

/** Seamfix Wallet: credential holder experience. FixID only pushes credentials and tracks delivery. */
export interface WalletService {
  checkHealth(org: Organization): Promise<ServiceHealth>;
  /** Makes an issued credential available to the holder's Seamfix Wallet (simulated). */
  deliver(org: Organization, credential: Credential): Promise<WalletDeliveryStatus>;
  getHolderLink(credential: Credential): string;
}

/** Portrait enrollment invitations (simulated: links are recorded, not emailed). */
export interface EnrollmentService {
  sendInvitation(input: { memberId: string; name: string; email: string }): Promise<{ invitationId: string; sentTo: string; simulated: true }>;
}

export interface Services {
  enrollment: EnrollmentService;
  idSwitch: IdSwitchService;
  issuance: CredentialIssuanceService;
  wallet: WalletService;
  /** Map tiles and address search for choosing an activity's location. */
  maps: MapsService;
  /** The verifier device's location, captured only for activities with a location check. */
  geolocation: GeolocationService;
}
