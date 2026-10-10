/**
 * Demonstration providers. These stand in for services FixID doesn't have yet (holder binding and
 * wallet presentation). Facial verification has no demonstration stand-in: it goes through the real
 * provider boundary (`src/services/faceVerification.ts`) or is reported as unavailable. They never decide anything on their own: the verifier
 * picks a labelled test scenario, and the provider returns the matching, predictable response.
 * Nothing here is real verification, and these adapters are kept apart from the real ones.
 */

export type HolderBindingScenario = 'valid' | 'invalid' | 'unavailable';

export type SimulatedResponse = { status: 'passed' | 'failed' | 'inconclusive' | 'error'; explanation: string };

export const HOLDER_SCENARIOS: { id: HolderBindingScenario; label: string }[] = [
  { id: 'valid', label: 'Valid holder proof' }, { id: 'invalid', label: 'Invalid holder proof' }, { id: 'unavailable', label: 'Service unavailable' },
];

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const simulatedHolderBinding = async (s: HolderBindingScenario | undefined): Promise<SimulatedResponse> => {
  await pause(120);
  if (!s) return { status: 'inconclusive', explanation: 'No holder proof was presented.' };
  return {
    valid: { status: 'passed' as const, explanation: 'The presenter proved control of the credential (simulated).' },
    invalid: { status: 'failed' as const, explanation: 'The holder proof was invalid (simulated).' },
    unavailable: { status: 'error' as const, explanation: 'The presentation proof service was unavailable (simulated).' },
  }[s];
};
