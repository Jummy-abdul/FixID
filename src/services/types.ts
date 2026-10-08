import type { CanonicalIdentity, Credential, CredentialType, Organization } from '@/domain/types';

export interface ServiceHealth {
  ok: boolean;
  latencyMs: number;
  message: string;
  checkedAt: string;
}

/** ID Switch: owner of canonical identities. FixID only reads and references them. */
export interface IdSwitchService {
  getIdentity(idSwitchId: string): Promise<CanonicalIdentity | null>;
  searchIdentities(query: string, limit?: number): Promise<CanonicalIdentity[]>;
  checkHealth(org: Organization): Promise<ServiceHealth>;
}

/** Credential issuance rules: identifier generation and validity calculation. Pure and synchronous. */
export interface CredentialIssuanceService {
  previewIdentifier(type: CredentialType): string;
  computeValidity(type: CredentialType, issueDate: Date, effectiveDate?: Date): { effectiveFrom: Date; expiresAt: Date | null };
  renewalOpensAt(type: CredentialType, credential: Credential): Date | null;
}

/** Seamfix Wallet: credential holder experience. FixID only pushes credentials and tracks delivery. */
export interface WalletService {
  checkHealth(org: Organization): Promise<ServiceHealth>;
  getHolderLink(credential: Credential): string;
}

export interface Services {
  idSwitch: IdSwitchService;
  issuance: CredentialIssuanceService;
  wallet: WalletService;
}
