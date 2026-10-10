import type { FaceVerificationRequest, FaceVerificationResponse, FaceVerificationService } from '@/services/faceVerification';

/**
 * Test double for the facial verification boundary. Automated tests only: it isn't reachable from the
 * application, which uses the real adapter or none. It records requests so tests can check what was sent.
 */
export function fakeFaceVerification(
  respond: FaceVerificationResponse | ((req: FaceVerificationRequest) => FaceVerificationResponse | Promise<FaceVerificationResponse>),
  opts: { supportsLiveness?: boolean } = {},
): FaceVerificationService & { calls: FaceVerificationRequest[] } {
  const calls: FaceVerificationRequest[] = [];
  return {
    available: true, providerName: 'Test facial verification', supportsLiveness: opts.supportsLiveness ?? true, calls,
    async verify(req) { calls.push(req); return typeof respond === 'function' ? respond(req) : respond; },
  };
}

export const FACE = {
  match: { status: 'completed', decision: 'match', liveness: 'live', reference: 'cmp-001' },
  noMatch: { status: 'completed', decision: 'no-match', liveness: 'live', reference: 'cmp-002' },
  notLive: { status: 'completed', decision: 'match', liveness: 'not-live', reference: 'cmp-003' },
  poor: { status: 'completed', decision: 'inconclusive', liveness: 'inconclusive', reference: 'cmp-004', reason: 'The capture was too blurred to compare.' },
  down: { status: 'unavailable', reason: 'The facial verification service is unavailable right now. No comparison was made.' },
} satisfies Record<string, FaceVerificationResponse>;

/** A small valid JPEG data URL standing in for a camera capture. */
export const CAPTURE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
