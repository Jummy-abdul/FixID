import type { CanonicalIdentity } from '@/domain/types';
import { DEFAULT_COUNTRY } from '@/data/countries';
import { newId } from '@/lib/identifiers';
import type { ResolutionResult } from '@/services/types';

/** identifier → details → created (success modal). Issuance continues in Credential Management. */
export type Phase = 'identifier' | 'details' | 'created';

export interface PersonForm {
  givenName: string;
  familyName: string;
  email: string;
  /** National number as typed; stored in international format when the user is created. */
  phone: string;
  /** ISO code of the calling-code country. */
  phoneCountry: string;
  /** ISO country code, optional. */
  country: string;
  region: string;
  gender: '' | 'Female' | 'Male';
  /** Only for identifiers entered manually. */
  identifierValue: string;
}

export interface Draft {
  version: 4;
  organizationId: string;
  /** Idempotency key for creating this user. */
  requestId: string;
  phase: Phase;
  identifierConfigId: string | null;
  person: PersonForm;
  resolution: ResolutionResult | null;
  /** Identity fields the resolution was run against; any change invalidates it. */
  resolvedFor: string | null;
  confirmNewIdentity: boolean;
  /** Identity created during an earlier attempt, reused on retry. */
  createdIdentity: CanonicalIdentity | null;
  memberId: string | null;
}

export function emptyDraft(organizationId: string, identifierConfigId: string | null = null): Draft {
  return {
    version: 4,
    organizationId,
    requestId: newId('req'),
    phase: 'identifier',
    identifierConfigId,
    person: { givenName: '', familyName: '', email: '', phone: '', phoneCountry: DEFAULT_COUNTRY, country: '', region: '', gender: '', identifierValue: '' },
    resolution: null,
    resolvedFor: null,
    confirmNewIdentity: false,
    createdIdentity: null,
    memberId: null,
  };
}

export const identityKey = (p: PersonForm) => [p.givenName, p.familyName, p.email, p.phoneCountry, p.phone].map((v) => v.trim().toLowerCase()).join('|');

const key = (organizationId: string) => `fixid.prototype.addUserDraft.${organizationId}`;

export function loadDraft(organizationId: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(key(organizationId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d.version === 4 && d.organizationId === organizationId ? d : null;
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

/** An unfinished draft worth offering to resume (before the user is created). */
export const hasProgress = (d: Draft | null) =>
  !!d && (d.phase === 'identifier' || d.phase === 'details') && (d.identifierConfigId !== null || d.person.givenName !== '');
