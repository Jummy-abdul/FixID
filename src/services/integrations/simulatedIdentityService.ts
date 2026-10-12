import type { BiometricMatchRequest, IdentityLookupRequest, LookupResponseV1, MatchResponseV1 } from './contract';

/**
 * Simulated Identity Service (demonstration only). Implements the FixID contract v1.0 with entirely
 * fictional records and deterministic outcomes, so success and failure cases can be shown repeatably.
 * It holds no real identities, receives no real biometric data and compares nothing: matching outcomes are
 * chosen by the capture fixture in the request. Every response is marked `simulated: true`.
 */

export const SIMULATED_SERVICE_NAME = 'Simulated Identity Service';

/** Lookup test references and what they return. */
export const SIMULATED_LOOKUP_REFERENCES = [
  { value: 'DEMO-10001', outcome: 'FOUND', note: 'Record found (Sample Person A)' },
  { value: 'DEMO-10002', outcome: 'FOUND', note: 'Record found (Sample Person B, record suspended)' },
  { value: 'DEMO-20001', outcome: 'NOT_FOUND', note: 'Record not found' },
  { value: 'DEMO-30001', outcome: 'MULTIPLE_MATCHES', note: 'Multiple records returned' },
  { value: 'DEMO-50001', outcome: 'UNAVAILABLE', note: 'Service unavailable' },
  { value: 'DEMO-40001', outcome: 'ERROR', note: 'Invalid request' },
] as const;

/** Matching fixtures: the capture reference selects the outcome (no comparison happens). */
export const SIMULATED_MATCH_FIXTURES = [
  { captureReference: 'SIM-CAPTURE-MATCH', outcome: 'MATCH', note: 'Match' },
  { captureReference: 'SIM-CAPTURE-NO-MATCH', outcome: 'NO_MATCH', note: 'No match' },
  { captureReference: 'SIM-CAPTURE-INCONCLUSIVE', outcome: 'INCONCLUSIVE', note: 'Inconclusive' },
  { captureReference: 'SIM-CAPTURE-UNAVAILABLE', outcome: 'UNAVAILABLE', note: 'Service unavailable' },
  { captureReference: 'SIM-CAPTURE-UNSUPPORTED', outcome: 'ERROR', note: 'Invalid or unsupported matching request' },
] as const;

const RECORDS: Record<string, NonNullable<LookupResponseV1['record']>> = {
  'DEMO-10001': { referenceId: 'REF-10001', displayName: 'Sample Person A', attributes: { recordStatus: 'ACTIVE', recordType: 'SAMPLE' } },
  'DEMO-10002': { referenceId: 'REF-10002', displayName: 'Sample Person B', attributes: { recordStatus: 'SUSPENDED', recordType: 'SAMPLE' } },
};
const KNOWN_REFERENCE_IDS = new Set(Object.values(RECORDS).map((r) => r.referenceId));

export function simulatedLookup(req: IdentityLookupRequest): LookupResponseV1 {
  const base = { requestId: req.requestId, simulated: true as const };
  const value = (req.referenceValue ?? '').trim().toUpperCase();
  if (req.referenceType !== 'EXTERNAL_ID' || !/^[A-Z0-9-]{3,40}$/.test(value) || value === 'DEMO-40001') {
    return { ...base, status: 'ERROR', error: { code: 'INVALID_REQUEST', message: 'The reference type or value is invalid.' } };
  }
  if (value === 'DEMO-50001') return { ...base, status: 'UNAVAILABLE', error: { code: 'SERVICE_UNAVAILABLE', message: 'The identity service is temporarily unavailable.' } };
  if (value === 'DEMO-30001') return { ...base, status: 'MULTIPLE_MATCHES', candidates: 2 };
  const record = RECORDS[value];
  return record ? { ...base, status: 'FOUND', record } : { ...base, status: 'NOT_FOUND' };
}

export function simulatedMatch(req: BiometricMatchRequest): MatchResponseV1 {
  const base = { requestId: req.requestId, simulated: true as const };
  if (req.modality !== 'FACE' || !KNOWN_REFERENCE_IDS.has(req.referenceId) || req.captureReference === 'SIM-CAPTURE-UNSUPPORTED') {
    return { ...base, status: 'ERROR', error: { code: 'UNSUPPORTED_REQUEST', message: 'The reference, modality or capture isn’t supported.' } };
  }
  const tx = `SIM-TXN-${req.requestId}`;
  switch (req.captureReference) {
    case 'SIM-CAPTURE-MATCH': return { ...base, status: 'MATCH', providerTransactionId: tx, result: { score: 0.96, scoreScale: '0_TO_1', threshold: 0.85 } };
    case 'SIM-CAPTURE-NO-MATCH': return { ...base, status: 'NO_MATCH', providerTransactionId: tx, result: { score: 0.21, scoreScale: '0_TO_1', threshold: 0.85 } };
    case 'SIM-CAPTURE-INCONCLUSIVE': return { ...base, status: 'INCONCLUSIVE', providerTransactionId: tx };
    case 'SIM-CAPTURE-UNAVAILABLE': return { ...base, status: 'UNAVAILABLE', error: { code: 'SERVICE_UNAVAILABLE', message: 'The matching service is temporarily unavailable.' } };
    default: return { ...base, status: 'ERROR', error: { code: 'UNKNOWN_CAPTURE', message: 'Unknown capture fixture.' } };
  }
}
