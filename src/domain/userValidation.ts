import { countryByCode, toE164 } from '@/data/countries';
import { validateManualValue } from '@/domain/identifierPattern';
import type { IdentifierConfig } from '@/domain/types';
import type { PersonForm } from '@/pages/users/add/draft';

export type PersonErrors = Partial<Record<keyof PersonForm, string>>;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

/**
 * The rules for a new user, shared by the individual Create User flow and bulk import, so both
 * accept and refuse exactly the same details.
 */
export function validatePerson(p: PersonForm, config: IdentifierConfig, taken: (v: string) => boolean): PersonErrors {
  const e: PersonErrors = {};
  if (!p.givenName.trim()) e.givenName = 'Enter their first name.';
  else if (!NAME.test(p.givenName.trim())) e.givenName = 'Use letters only.';
  if (!p.familyName.trim()) e.familyName = 'Enter their last name.';
  else if (!NAME.test(p.familyName.trim())) e.familyName = 'Use letters only.';
  if (!p.email.trim()) e.email = 'Enter their email address.';
  else if (!EMAIL.test(p.email.trim())) e.email = 'Enter a valid email address.';
  if (p.phone.trim() && (!/^[+\d][\d\s()-]*$/.test(p.phone.trim()) || !internationalPhone(p))) e.phone = 'Enter a valid phone number.';
  if (config.mode === 'manual') {
    const v = p.identifierValue.trim();
    const invalid = v ? validateManualValue(v) : `Enter their ${config.name}.`;
    if (invalid) e.identifierValue = invalid;
    else if (taken(v)) e.identifierValue = `${v} is already assigned to another user.`;
  }
  return e;
}

/** The phone number in international format (E.164), or '' when none was entered. */
export function internationalPhone(p: PersonForm): string | null {
  if (!p.phone.trim()) return '';
  return toE164(countryByCode(p.phoneCountry)?.dial ?? '+234', p.phone);
}

