/**
 * Demonstration providers. These stand in for services FixID doesn't have yet (facial matching,
 * liveness, holder binding, wallet presentation). They never decide anything on their own: the verifier
 * picks a labelled test scenario, and the provider returns the matching, predictable response.
 * Nothing here is real verification, and these adapters are kept apart from the real ones.
 */

export type LivenessScenario = 'live' | 'not-live' | 'poor-quality' | 'unavailable';
export type FaceScenario = 'match' | 'no-match' | 'poor-quality' | 'timeout';
export type HolderBindingScenario = 'valid' | 'invalid' | 'unavailable';

export type SimulatedResponse = { status: 'passed' | 'failed' | 'inconclusive' | 'error'; explanation: string };

export const LIVENESS_SCENARIOS: { id: LivenessScenario; label: string }[] = [
  { id: 'live', label: 'Live person present' }, { id: 'not-live', label: 'Not a live capture (e.g. a photo)' },
  { id: 'poor-quality', label: 'Capture too poor to judge' }, { id: 'unavailable', label: 'Service unavailable' },
];
export const FACE_SCENARIOS: { id: FaceScenario; label: string }[] = [
  { id: 'match', label: 'Capture matches the reference' }, { id: 'no-match', label: 'Capture doesn’t match' },
  { id: 'poor-quality', label: 'Capture too poor to compare' }, { id: 'timeout', label: 'Service times out' },
];
export const HOLDER_SCENARIOS: { id: HolderBindingScenario; label: string }[] = [
  { id: 'valid', label: 'Valid holder proof' }, { id: 'invalid', label: 'Invalid holder proof' }, { id: 'unavailable', label: 'Service unavailable' },
];

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const simulatedLiveness = async (s: LivenessScenario | undefined): Promise<SimulatedResponse> => {
  await pause(150);
  if (!s) return { status: 'inconclusive', explanation: 'No capture was provided.' };
  return {
    live: { status: 'passed' as const, explanation: 'Liveness confirmed (simulated).' },
    'not-live': { status: 'failed' as const, explanation: 'The capture didn’t come from a live person (simulated).' },
    'poor-quality': { status: 'inconclusive' as const, explanation: 'The capture quality was too low to judge (simulated).' },
    unavailable: { status: 'error' as const, explanation: 'The liveness service was unavailable (simulated).' },
  }[s];
};

export const simulatedFaceMatch = async (s: FaceScenario | undefined): Promise<SimulatedResponse> => {
  await pause(200);
  if (!s) return { status: 'inconclusive', explanation: 'No capture was provided.' };
  if (s === 'timeout') return new Promise(() => {}); // never resolves; the engine's timeout handles it
  return {
    match: { status: 'passed' as const, explanation: 'The capture matched the authorized reference (simulated).' },
    'no-match': { status: 'failed' as const, explanation: 'The capture didn’t match the authorized reference (simulated).' },
    'poor-quality': { status: 'inconclusive' as const, explanation: 'The capture was too poor to compare (simulated).' },
  }[s];
};

export const simulatedHolderBinding = async (s: HolderBindingScenario | undefined): Promise<SimulatedResponse> => {
  await pause(120);
  if (!s) return { status: 'inconclusive', explanation: 'No holder proof was presented.' };
  return {
    valid: { status: 'passed' as const, explanation: 'The presenter proved control of the credential (simulated).' },
    invalid: { status: 'failed' as const, explanation: 'The holder proof was invalid (simulated).' },
    unavailable: { status: 'error' as const, explanation: 'The presentation proof service was unavailable (simulated).' },
  }[s];
};
