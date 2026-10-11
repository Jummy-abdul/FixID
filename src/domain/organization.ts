import type { Industry, Organization } from './types';

/**
 * Organization Profile (Settings → Organization). Organization-level information only: administrators
 * are managed in Administrators & Roles, and branding is a separate capability.
 */

/** The fields an Organization Administrator may change. Country, ID, status and registration date are read-only. */
export const EDITABLE_ORGANIZATION_FIELDS = ['name', 'shortName', 'industry', 'memberLabel', 'contactEmail', 'phone', 'address', 'timezone'] as const;
export type EditableOrganizationField = (typeof EDITABLE_ORGANIZATION_FIELDS)[number];
export interface OrganizationProfileValues {
  name: string; shortName: string; industry: Industry; memberLabel: string; contactEmail: string; phone: string; address: string; timezone: string;
}

export const ORGANIZATION_FIELD_LABEL: Record<EditableOrganizationField, string> = {
  name: 'Organization Name', shortName: 'Short Name', industry: 'Industry', memberLabel: 'Default Person Label',
  contactEmail: 'Organization Email', phone: 'Organization Phone Number', address: 'Organization Address', timezone: 'Time Zone',
};

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function profileValues(o: Organization): OrganizationProfileValues {
  return { name: o.name, shortName: o.shortName, industry: o.industry, memberLabel: o.memberLabel, contactEmail: o.contactEmail, phone: o.phone ?? '', address: o.address ?? '', timezone: o.timezone };
}

/** Trims text; optional fields left empty mean "Not provided". */
export function normalizeProfile(v: OrganizationProfileValues): OrganizationProfileValues {
  return {
    ...v, name: v.name.trim().replace(/\s+/g, ' '), shortName: v.shortName.trim().toUpperCase(), memberLabel: v.memberLabel.trim(),
    contactEmail: v.contactEmail.trim(), phone: v.phone.trim(), address: v.address.trim(), timezone: v.timezone.trim(),
  };
}

export type ProfileErrors = Partial<Record<EditableOrganizationField, string>>;

/** Field-level checks, shared by the form and the store (which refuses invalid changes). */
export function validateOrganizationProfile(v: OrganizationProfileValues, timezones: readonly string[]): ProfileErrors {
  const e: ProfileErrors = {};
  if (v.name.length < 2) e.name = 'Enter an organization name of at least 2 characters.';
  else if (v.name.length > 80) e.name = 'Organization name must be 80 characters or fewer.';
  if (!/^[A-Z0-9]{2,5}$/.test(v.shortName)) e.shortName = 'Use 2–5 uppercase letters or numbers, e.g. NBU.';
  if (v.memberLabel.length < 2) e.memberLabel = 'Enter a label, e.g. Member or Employee.';
  else if (v.memberLabel.length > 30) e.memberLabel = 'Keep the label to 30 characters or fewer.';
  if (!EMAIL.test(v.contactEmail)) e.contactEmail = 'Enter a valid email address.';
  if (v.phone && (!/^\+?[\d\s()-]+$/.test(v.phone) || v.phone.replace(/\D/g, '').length < 7 || v.phone.replace(/\D/g, '').length > 15)) {
    e.phone = 'Enter a valid phone number, e.g. +234 801 234 5678.';
  }
  if (v.address.length > 200) e.address = 'Keep the address to 200 characters or fewer.';
  if (!timezones.includes(v.timezone)) e.timezone = 'Choose a time zone.';
  return e;
}

/** A short name for a newly registered organization: initials, or the first letters of a one-word name. */
export function deriveShortName(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  const initials = words.map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] ?? '').join('').toUpperCase().slice(0, 3);
  if (initials.length >= 2) return initials;
  const letters = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'ORG').padEnd(2, 'X');
}

const BASE_TIMEZONES = ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'Asia/Dubai', 'UTC'];

/** Time zones offered in the profile; the organization's current one is always included. */
export function timezoneOptions(current?: string): string[] {
  return current && !BASE_TIMEZONES.includes(current) ? [current, ...BASE_TIMEZONES] : BASE_TIMEZONES;
}
