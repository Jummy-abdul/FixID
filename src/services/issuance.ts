import { addDays, addMonths, startOfDay } from '@/lib/dates';
import { formatIdentifier } from '@/lib/identifiers';
import type { CredentialIssuanceService } from './types';

/** Next academic/operational term start used by the "start-of-term" rule: 1 Jan, 1 May or 1 Sep. */
function nextTermStart(from: Date): Date {
  const y = from.getFullYear();
  const candidates = [new Date(y, 0, 1), new Date(y, 4, 1), new Date(y, 8, 1), new Date(y + 1, 0, 1)];
  return candidates.find((c) => c >= startOfDay(from)) ?? candidates[candidates.length - 1];
}

export function createIssuanceService(): CredentialIssuanceService {
  return {
    previewIdentifier(type) {
      return formatIdentifier(type.identifier.prefix, type.identifier.digits, type.identifier.nextSequence);
    },
    computeValidity(type, issueDate, effectiveDate) {
      const effectiveFrom =
        type.effectiveDate === 'start-of-term' ? nextTermStart(issueDate)
        : type.effectiveDate === 'custom-date' && effectiveDate ? effectiveDate
        : issueDate;
      const v = type.validity;
      const expiresAt = v.kind === 'duration' ? addMonths(effectiveFrom, v.months)
        : v.kind === 'fixed-date' ? new Date(v.date)
        : null;
      return { effectiveFrom, expiresAt };
    },
    renewalOpensAt(type, credential) {
      if (!type.renewal.allowed || !credential.expiresAt) return null;
      return addDays(new Date(credential.expiresAt), -type.renewal.windowDays);
    },
  };
}
