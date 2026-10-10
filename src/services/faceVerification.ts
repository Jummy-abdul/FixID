/**
 * 1:1 facial verification boundary: a known person's enrolled reference against one live capture.
 * Never a 1:N search. FixID sends the person's reference ID (never their portrait) and the capture; the
 * provider holds the enrolled template, compares, checks liveness where it can, and returns a decision.
 *
 * No facial verification provider is integrated in this prototype. By default the service is
 * unavailable, so no match can ever be produced. `VITE_FACE_VERIFICATION_URL` points it at a backend
 * endpoint implementing the contract below. The browser must never call a biometric vendor directly with
 * credentials. Test doubles live under `src/test/helpers`, apart from application code.
 */

export interface FaceVerificationRequest {
  /** Idempotency key: the verification attempt it belongs to. */
  requestId: string;
  organizationId: string;
  /** Reference to the person's enrolled identity (their identity-service ID). */
  subjectRef: string;
  /** The live capture as a JPEG data URL. Held in memory for this request only; never stored by FixID. */
  probe: string;
  checkLiveness: boolean;
}

export type FaceDecision = 'match' | 'no-match' | 'inconclusive';
export type LivenessDecision = 'live' | 'not-live' | 'inconclusive' | 'not-checked';

export type FaceVerificationResponse =
  | { status: 'completed'; decision: FaceDecision; liveness: LivenessDecision; reference: string; reason?: string }
  | { status: 'unavailable' | 'error'; reason: string };

export interface FaceVerificationService {
  available: boolean;
  providerName: string;
  /** Whether the provider performs liveness / presentation-attack detection. */
  supportsLiveness: boolean;
  verify(req: FaceVerificationRequest): Promise<FaceVerificationResponse>;
}

export const FACE_UNAVAILABLE_REASON = 'Biometric verification unavailable: no facial verification provider is connected (integration required). No comparison was made.';

export const NO_FACE_VERIFICATION: FaceVerificationService = {
  available: false,
  providerName: 'None',
  supportsLiveness: false,
  async verify() { return { status: 'unavailable', reason: FACE_UNAVAILABLE_REASON }; },
};

const DECISIONS = new Set<FaceDecision>(['match', 'no-match', 'inconclusive']);
const LIVENESS = new Set<LivenessDecision>(['live', 'not-live', 'inconclusive', 'not-checked']);

/**
 * Adapter for a FixID backend endpoint. Contract (JSON):
 *   POST {endpoint}  { requestId, organizationId, subjectRef, checkLiveness, probe: { mediaType: 'image/jpeg', data: <base64> } }
 *   200 → { decision: 'match' | 'no-match' | 'inconclusive', liveness: 'live' | 'not-live' | 'inconclusive' | 'not-checked', reference: string, reason?: string }
 *   503 → provider unavailable. Anything else, or a malformed body, is an error: never a match.
 */
export function createHttpFaceVerification(endpoint: string, opts: { providerName?: string; supportsLiveness?: boolean; fetcher?: typeof fetch } = {}): FaceVerificationService {
  const fetcher = opts.fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    available: true,
    providerName: opts.providerName ?? 'Facial verification service',
    supportsLiveness: opts.supportsLiveness ?? true,
    async verify(req) {
      const data = req.probe.replace(/^data:image\/\w+;base64,/, '');
      let res: Response;
      try {
        res = await fetcher(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ requestId: req.requestId, organizationId: req.organizationId, subjectRef: req.subjectRef, checkLiveness: req.checkLiveness, probe: { mediaType: 'image/jpeg', data } }),
        });
      } catch {
        return { status: 'error', reason: 'The facial verification service couldn’t be reached (network interruption). No comparison was made.' };
      }
      if (res.status === 503) return { status: 'unavailable', reason: 'The facial verification service is unavailable right now. No comparison was made.' };
      if (!res.ok) return { status: 'error', reason: `The facial verification service returned an error (${res.status}). No comparison was made.` };
      let body: unknown;
      try { body = await res.json(); } catch { body = null; }
      const b = body as { decision?: unknown; liveness?: unknown; reference?: unknown; reason?: unknown } | null;
      if (!b || !DECISIONS.has(b.decision as FaceDecision) || !LIVENESS.has(b.liveness as LivenessDecision) || typeof b.reference !== 'string' || !b.reference) {
        return { status: 'error', reason: 'The facial verification service returned a response FixID couldn’t interpret, so it wasn’t used.' };
      }
      return { status: 'completed', decision: b.decision as FaceDecision, liveness: b.liveness as LivenessDecision, reference: b.reference, ...(typeof b.reason === 'string' ? { reason: b.reason } : {}) };
    },
  };
}

export function createDefaultFaceVerification(): FaceVerificationService {
  const url = import.meta.env.VITE_FACE_VERIFICATION_URL;
  return url ? createHttpFaceVerification(url, { supportsLiveness: import.meta.env.VITE_FACE_VERIFICATION_LIVENESS !== 'off' }) : NO_FACE_VERIFICATION;
}

/** Whether this build has a facial verification provider configured. */
export const faceProviderConfigured = () => !!import.meta.env.VITE_FACE_VERIFICATION_URL;
