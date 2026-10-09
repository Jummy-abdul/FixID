import type {
  ActivityPurpose, AssuranceLevel, CredentialType, Industry, VerificationMethod,
} from './types';

export const METHOD_LABEL: Record<VerificationMethod, string> = {
  qr: 'QR code', nfc: 'NFC', face: 'Face', fingerprint: 'Fingerprint', manual: 'Manual check',
};

export const ASSURANCE_LABEL: Record<AssuranceLevel, string> = { low: 'Low', substantial: 'Substantial', high: 'High' };

export const PURPOSE_LABEL: Record<ActivityPurpose, string> = {
  entry: 'Entry', examination: 'Examination', attendance: 'Attendance', service: 'Service eligibility', membership: 'Membership',
};

export const INDUSTRY_LABEL: Record<Industry, string> = {
  education: 'Education', corporate: 'Corporate', healthcare: 'Healthcare', events: 'Events', membership: 'Membership organization',
};

export const EFFECTIVE_DATE_LABEL: Record<CredentialType['effectiveDate'], string> = {
  'on-issue': 'On issue date', 'custom-date': 'Chosen at issuance', 'start-of-term': 'Start of next term',
};

/** Plain-language rules for configuration summaries. */
export function effectiveDateLabel(e: CredentialType['effectiveDate']): string {
  return e === 'on-issue' ? 'Effective from issuance date' : e === 'custom-date' ? 'Specified during issuance' : 'Start of the next term';
}

export function expirationLabel(v: CredentialType['validity']): string {
  if (v.kind === 'no-expiry') return 'Never expires';
  if (v.kind === 'fixed-date') return `Expires on ${new Date(v.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (v.kind === 'set-at-issuance') return 'Expiration date chosen during issuance';
  const years = v.months % 12 === 0 ? v.months / 12 : null;
  return `Valid for ${years ? `${years} year${years === 1 ? '' : 's'}` : `${v.months} month${v.months === 1 ? '' : 's'}`}`;
}

export function validityLabel(v: CredentialType['validity']): string {
  if (v.kind === 'no-expiry') return 'Does not expire';
  if (v.kind === 'fixed-date') return `Expires on ${new Date(v.date).toLocaleDateString('en-GB')}`;
  if (v.kind === 'set-at-issuance') return 'Expiry date chosen when issuing';
  return v.months % 12 === 0 ? `${v.months / 12} year${v.months === 12 ? '' : 's'} from effective date` : `${v.months} month${v.months === 1 ? '' : 's'} from effective date`;
}
