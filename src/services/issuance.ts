import { addDays, addMonths, startOfDay } from '@/lib/dates';
import { formatIdentifier } from '@/lib/identifiers';
import type { CredentialType } from '@/domain/types';
import type { CredentialIssuanceService } from './types';

/** Next academic/operational term start used by the "start-of-term" rule: 1 Jan, 1 May or 1 Sep. */
function nextTermStart(from: Date): Date {
  const y = from.getFullYear();
  const candidates = [new Date(y, 0, 1), new Date(y, 4, 1), new Date(y, 8, 1), new Date(y + 1, 0, 1)];
  return candidates.find((c) => c >= startOfDay(from)) ?? candidates[candidates.length - 1];
}

/** Next generated identifier for a type, or null when identifiers are entered manually. */
export function previewIdentifier(type: CredentialType): string | null {
  if (type.identifier.mode === 'manual') return null;
  return formatIdentifier(type.identifier.prefix, type.identifier.digits, type.identifier.nextSequence);
}

/** `expiryDate` is only used by rules that collect the expiry date at issuance. */
export function computeValidity(type: Pick<CredentialType, 'effectiveDate' | 'validity'>, issueDate: Date, effectiveDate?: Date, expiryDate?: Date) {
  const effectiveFrom =
    type.effectiveDate === 'start-of-term' ? nextTermStart(issueDate)
    : type.effectiveDate === 'custom-date' && effectiveDate ? effectiveDate
    : issueDate;
  const v = type.validity;
  const expiresAt = v.kind === 'duration' ? addMonths(effectiveFrom, v.months)
    : v.kind === 'fixed-date' ? new Date(v.date)
    : v.kind === 'set-at-issuance' ? expiryDate ?? null
    : null;
  return { effectiveFrom, expiresAt };
}

export function createIssuanceService(): CredentialIssuanceService {
  return {
    previewIdentifier,
    computeValidity,
    renewalOpensAt(type, credential) {
      if (!type.renewal.allowed || !credential.expiresAt) return null;
      return addDays(new Date(credential.expiresAt), -type.renewal.windowDays);
    },
  };
}
