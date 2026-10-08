import type { AssuranceLevel, VerificationMethod } from './types';

/** Assurance a verification method can achieve on its own. */
export const METHOD_ASSURANCE: Record<VerificationMethod, AssuranceLevel> = {
  face: 'high',
  fingerprint: 'high',
  nfc: 'substantial',
  qr: 'low',
  manual: 'low',
};

const RANK: Record<AssuranceLevel, number> = { low: 1, substantial: 2, high: 3 };

export function meetsAssurance(achieved: AssuranceLevel, required: AssuranceLevel): boolean {
  return RANK[achieved] >= RANK[required];
}

/**
 * Fallback methods that would downgrade assurance below the activity's requirement.
 * PRD §14: fallback must never silently reduce the required assurance level.
 */
export function invalidFallbacks(methods: VerificationMethod[], required: AssuranceLevel): VerificationMethod[] {
  return methods.filter((m) => !meetsAssurance(METHOD_ASSURANCE[m], required));
}
