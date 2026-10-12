import { LOOKUP_OUTCOMES, MATCH_OUTCOMES, type LookupOutcome, type MatchOutcome } from '@/domain/integrations';

/**
 * FixID external identity verification contract, version 1.0: request and response shapes and validators.
 * Every response from any provider (simulated or real) is validated here before FixID uses it; anything
 * that doesn't conform is an ERROR, never a success.
 */

export interface IdentityLookupRequest { referenceType: 'EXTERNAL_ID'; referenceValue: string; requestId: string; purpose: 'IDENTITY_VERIFICATION' }

/** Provider response (wire shape). */
export interface LookupResponseV1 {
  requestId: string;
  status: LookupOutcome;
  record?: { referenceId: string; displayName?: string; attributes?: Record<string, unknown> };
  candidates?: number;
  error?: { code: string; message: string };
  /** Set by the Simulated Identity Service on every response. */
  simulated?: boolean;
}

/**
 * Biometric matching request. `captureReference` and `livenessEvidenceReference` are references to
 * transient evidence: a real integration must define an authorized, secure transfer of the capture itself
 * (payload format, encryption, retention); a reference string alone can't be matched.
 */
export interface BiometricMatchRequest { requestId: string; referenceId: string; modality: 'FACE'; captureReference: string; livenessEvidenceReference?: string }

export interface MatchResponseV1 {
  requestId: string;
  status: MatchOutcome;
  providerTransactionId?: string;
  /** Provider semantics are kept as given: scores aren't comparable across engines and aren't normalized. */
  result?: { score: number; scoreScale: string; threshold?: number };
  error?: { code: string; message: string };
  simulated?: boolean;
}

/** What FixID callers get: validated and minimized. */
export interface IdentityLookupResult {
  status: LookupOutcome;
  referenceId?: string;
  displayName?: string;
  /** Only the attributes the integration permits for verification. */
  permittedAttributes?: Record<string, unknown>;
  message?: string;
  simulated: boolean;
}

export interface BiometricMatchResult {
  status: MatchOutcome;
  providerTransactionId?: string;
  score?: number;
  scoreScale?: string;
  threshold?: number;
  message?: string;
  /** True for the Simulated Identity Service: the outcome was chosen by a fixture, not by comparing faces. */
  simulated: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function lookupSchemaProblem(r: unknown, requestId: string): string | null {
  if (!isObj(r)) return 'The response isn’t a JSON object.';
  if (r.requestId !== requestId) return 'The response’s requestId doesn’t match the request.';
  if (!LOOKUP_OUTCOMES.includes(r.status as LookupOutcome)) return `Unknown lookup status "${String(r.status)}".`;
  if (r.status === 'FOUND') {
    if (!isObj(r.record) || typeof r.record.referenceId !== 'string' || !r.record.referenceId) return 'A FOUND response needs record.referenceId.';
    if (r.record.attributes !== undefined && !isObj(r.record.attributes)) return 'record.attributes must be an object.';
  }
  if (r.status === 'ERROR' && (!isObj(r.error) || typeof r.error.code !== 'string')) return 'An ERROR response needs error.code.';
  return null;
}

export function matchSchemaProblem(r: unknown, requestId: string): string | null {
  if (!isObj(r)) return 'The response isn’t a JSON object.';
  if (r.requestId !== requestId) return 'The response’s requestId doesn’t match the request.';
  if (!MATCH_OUTCOMES.includes(r.status as MatchOutcome)) return `Unknown matching status "${String(r.status)}".`;
  if (r.status === 'MATCH' || r.status === 'NO_MATCH') {
    if (typeof r.providerTransactionId !== 'string' || !r.providerTransactionId) return `A ${r.status} response needs providerTransactionId.`;
    if (!isObj(r.result) || typeof r.result.score !== 'number' || typeof r.result.scoreScale !== 'string') return `A ${r.status} response needs result.score and result.scoreScale.`;
  }
  if (r.status === 'ERROR' && (!isObj(r.error) || typeof r.error.code !== 'string')) return 'An ERROR response needs error.code.';
  return null;
}

/** Keeps only permitted attributes; nothing else from the provider reaches FixID. */
export function minimizeLookup(r: LookupResponseV1, permitted: string[]): IdentityLookupResult {
  const simulated = !!r.simulated;
  if (r.status !== 'FOUND' || !r.record) return { status: r.status, message: r.error?.message, simulated };
  const source: Record<string, unknown> = { displayName: r.record.displayName, ...(r.record.attributes ?? {}) };
  const permittedAttributes = Object.fromEntries(permitted.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
  return { status: 'FOUND', referenceId: r.record.referenceId, displayName: permitted.includes('displayName') ? r.record.displayName : undefined, permittedAttributes, simulated };
}

export function toMatchResult(r: MatchResponseV1): BiometricMatchResult {
  return {
    status: r.status, providerTransactionId: r.providerTransactionId, score: r.result?.score, scoreScale: r.result?.scoreScale, threshold: r.result?.threshold,
    message: r.error?.message, simulated: !!r.simulated,
  };
}
