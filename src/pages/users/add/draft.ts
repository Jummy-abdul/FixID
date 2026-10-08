import type { CanonicalIdentity } from '@/domain/types';
import { newId } from '@/lib/identifiers';
import type { ResolutionResult } from '@/services/types';

export type StepId = 'type' | 'credential' | 'details' | 'identity' | 'review' | 'done';

export interface CredentialForm {
  name: string;
  identifierLabel: string;
  identifierMode: 'generated' | 'manual';
  prefix: string;
  digits: number;
  effectiveDate: 'on-issue' | 'custom-date';
  expiry: 'duration' | 'fixed-date' | 'no-expiry';
  months: number;
  fixedDate: string;
  renewalAllowed: boolean;
  renewalWindowDays: number;
  cardDesignId: string;
}

export interface PersonForm {
  givenName: string;
  familyName: string;
  email: string;
  phone: string;
  identifier: string;
  effectiveDate: string;
  photoDataUrl?: string;
}

export interface Draft {
  version: 1;
  organizationId: string;
  /** Idempotency key for the issuance request. */
  requestId: string;
  step: StepId;
  /** Existing user type, or the name of a new one (saved together with the credential setup). */
  userType: { id: string } | { name: string } | null;
  /** How the credential step is answered: reuse an existing credential or configure a new one. */
  credentialChoice: { existingId: string } | 'new' | null;
  credentialForm: CredentialForm | null;
  /** The saved credential type that will be issued. */
  credentialTypeId: string | null;
  /** True when a saved configuration was reused, so the credential step was skipped. */
  reusedCredential: boolean;
  person: PersonForm;
  resolution: ResolutionResult | null;
  /** Identity fields the resolution was run against; a change invalidates it. */
  resolvedFor: string | null;
  existingMemberId: string | null;
  confirmNewIdentity: boolean;
  /** Identity created in ID Switch during a previous issuance attempt, reused on retry. */
  createdIdentity: CanonicalIdentity | null;
  issued: { credentialId: string; memberId: string } | null;
}

export const today = () => new Date().toISOString().slice(0, 10);

export function emptyDraft(organizationId: string): Draft {
  return {
    version: 1,
    organizationId,
    requestId: newId('req'),
    step: 'type',
    userType: null,
    credentialChoice: null,
    credentialForm: null,
    credentialTypeId: null,
    reusedCredential: false,
    person: { givenName: '', familyName: '', email: '', phone: '', identifier: '', effectiveDate: today() },
    resolution: null,
    resolvedFor: null,
    existingMemberId: null,
    confirmNewIdentity: false,
    createdIdentity: null,
    issued: null,
  };
}

export const identityKey = (p: PersonForm) =>
  [p.givenName, p.familyName, p.email, p.phone].map((v) => v.trim().toLowerCase()).join('|');

const key = (organizationId: string) => `fixid.prototype.addUserDraft.${organizationId}`;

export function loadDraft(organizationId: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(key(organizationId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d.version === 1 && d.organizationId === organizationId && d.step !== 'done' ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft) {
  try {
    window.sessionStorage.setItem(key(d.organizationId), JSON.stringify(d));
  } catch {
    /* storage full or unavailable: the journey still works in memory */
  }
}

export function clearDraft(organizationId: string) {
  try {
    window.sessionStorage.removeItem(key(organizationId));
  } catch {
    /* nothing to clear */
  }
}

/** A draft worth offering to resume: the admin has made at least one choice. */
export const hasProgress = (d: Draft | null) => !!d && (d.userType !== null || d.person.givenName !== '');
