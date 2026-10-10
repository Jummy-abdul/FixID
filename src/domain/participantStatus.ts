import type { VerificationAttempt } from './types';

export type ParticipantVerification = 'verified' | 'failed' | 'unable' | 'not-verified';
export type ParticipantEntry = 'granted' | 'denied' | 'not-granted' | 'pending' | 'not-recorded';

export interface ParticipantStatus {
  verification: ParticipantVerification;
  entry: ParticipantEntry;
  /** The latest completed verification for this person, if any. */
  attemptId?: string;
  at?: string;
}

export const PARTICIPANT_VERIFICATION_LABEL: Record<ParticipantVerification, string> = { verified: 'Verified', failed: 'Failed', unable: 'Unable to verify', 'not-verified': 'Not verified' };
export const PARTICIPANT_ENTRY_LABEL: Record<ParticipantEntry, string> = { granted: 'Granted', denied: 'Denied', 'not-granted': 'Not granted', pending: 'Pending', 'not-recorded': 'Not recorded' };

/**
 * Each participant's status for one activity, from persisted verification attempts only. Identity
 * verification and physical entry are kept apart: finding someone's identifier or capturing a photo
 * never makes them Verified, and being verified never means they entered.
 */
export function participantStatuses(attempts: VerificationAttempt[], activityId: string): Map<string, ParticipantStatus> {
  const done = attempts
    .filter((a) => a.activityId === activityId && a.status === 'completed' && a.subject?.memberId)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const out = new Map<string, ParticipantStatus>();
  for (const a of done) {
    const id = a.subject!.memberId!;
    if (out.has(id)) continue;
    const mine = done.filter((x) => x.subject!.memberId === id);
    const verification: ParticipantVerification = a.verificationResult === 'verified' ? 'verified' : a.verificationResult === 'not-verified' ? 'failed' : 'unable';
    const decision = mine.find((x) => x.entry);
    const entry: ParticipantEntry = mine.some((x) => x.entry?.status === 'entered') ? 'granted'
      : decision?.entry?.status === 'denied' ? 'denied'
        : verification === 'verified' ? 'pending' : 'not-granted';
    out.set(id, { verification, entry, attemptId: a.id, at: a.completedAt });
  }
  return out;
}

export const statusOf = (m: Map<string, ParticipantStatus>, memberId: string): ParticipantStatus => m.get(memberId) ?? { verification: 'not-verified', entry: 'not-recorded' };

/** Progress for an activity's eligible participants. */
export function participantProgress(m: Map<string, ParticipantStatus>, eligible: Set<string>) {
  let verified = 0, granted = 0, denied = 0;
  for (const id of eligible) {
    const s = statusOf(m, id);
    if (s.verification === 'verified') verified++;
    if (s.entry === 'granted') granted++;
    if (s.entry === 'denied') denied++;
  }
  return { eligible: eligible.size, verified, pending: eligible.size - verified, granted, denied };
}
