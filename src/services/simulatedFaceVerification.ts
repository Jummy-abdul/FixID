import type { FaceVerificationResponse, FaceVerificationService } from './faceVerification';

/**
 * Simulated facial verification (demonstration only). Used for local verification when no real facial
 * verification provider is configured and the organization has demonstration biometrics turned on. It
 * receives no image and compares nothing: the verifier chooses the outcome from labelled fixtures, so
 * success and failure cases can be shown repeatably. Every result it produces is marked simulated.
 */

export type SimulatedFaceOutcome = 'match' | 'no-match' | 'poor-capture' | 'unavailable';
export type SimulatedLivenessOutcome = 'passed' | 'failed' | 'inconclusive' | 'unavailable';

export const SIMULATED_FACE_OUTCOMES: { id: SimulatedFaceOutcome; label: string }[] = [
  { id: 'match', label: 'Match' },
  { id: 'no-match', label: 'No match' },
  { id: 'poor-capture', label: 'Poor capture (inconclusive)' },
  { id: 'unavailable', label: 'Service unavailable' },
];
export const SIMULATED_LIVENESS_OUTCOMES: { id: SimulatedLivenessOutcome; label: string }[] = [
  { id: 'passed', label: 'Passed' },
  { id: 'failed', label: 'Failed' },
  { id: 'inconclusive', label: 'Inconclusive' },
  { id: 'unavailable', label: 'Unavailable' },
];

export const SIMULATED_FACE_PROVIDER = 'Simulated facial verification';

export function simulatedFaceVerification(choice: { match?: SimulatedFaceOutcome; liveness?: SimulatedLivenessOutcome } = {}): FaceVerificationService {
  return {
    available: true,
    providerName: SIMULATED_FACE_PROVIDER,
    supportsLiveness: true,
    async verify(req): Promise<FaceVerificationResponse> {
      await new Promise((r) => setTimeout(r, 60));
      if (!choice.match || choice.match === 'unavailable' || choice.liveness === 'unavailable') {
        return { status: 'unavailable', reason: 'The simulated facial verification service is unavailable. No comparison was made.' };
      }
      const liveness = !req.checkLiveness ? 'not-checked' : choice.liveness === 'failed' ? 'not-live' : choice.liveness === 'inconclusive' ? 'inconclusive' : 'live';
      const reference = `SIM-FACE-${req.requestId}`;
      if (choice.match === 'poor-capture') return { status: 'completed', decision: 'inconclusive', liveness, reference, reason: 'Simulated: the capture quality was too poor to compare.' };
      return { status: 'completed', decision: choice.match, liveness, reference, reason: choice.match === 'no-match' ? 'Simulated: the capture didn’t match the enrolled reference.' : undefined };
    },
  };
}
