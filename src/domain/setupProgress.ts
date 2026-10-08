import type { Credential, Member, VerificationActivity } from './types';

/**
 * A credential counts as issued once issuance completed. `pending` (awaiting approval)
 * has not been issued yet. Later lifecycle states (suspended, revoked, expired) were issued.
 * Wallet delivery is tracked separately and does not affect issuance.
 */
export function isIssued(c: Credential): boolean {
  return c.status !== 'pending';
}

/** An activity counts as configured once it is live. Drafts and paused activities do not count. */
export function isConfiguredActivity(a: VerificationActivity): boolean {
  return a.status === 'active' || a.status === 'completed';
}

export type SetupMilestoneId = 'first-id' | 'first-verification';

export interface SetupProgress {
  milestones: { id: SetupMilestoneId; done: boolean }[];
  completed: number;
  total: number;
  /** The recommended next milestone, or null when setup is complete. */
  next: SetupMilestoneId | null;
  isComplete: boolean;
  /** Tracked separately: a user can exist before any digital ID is issued. */
  firstUserCreated: boolean;
  firstCredentialIssued: boolean;
  firstVerificationConfigured: boolean;
}

/**
 * Derives first-time setup progress from organization data.
 * The first milestone needs both a user and an issued credential; a user alone is partial progress.
 */
export function getSetupProgress(data: { members?: Member[]; credentials: Credential[]; activities: VerificationActivity[] }): SetupProgress {
  const firstCredentialIssued = data.credentials.some(isIssued);
  const firstUserCreated = (data.members?.length ?? 0) > 0 || firstCredentialIssued;
  const firstVerificationConfigured = data.activities.some(isConfiguredActivity);
  const milestones: SetupProgress['milestones'] = [
    { id: 'first-id', done: firstUserCreated && firstCredentialIssued },
    { id: 'first-verification', done: firstVerificationConfigured },
  ];
  const completed = milestones.filter((m) => m.done).length;
  const next = milestones.find((m) => !m.done)?.id ?? null;
  return {
    milestones, completed, total: milestones.length, next, isComplete: next === null,
    firstUserCreated, firstCredentialIssued, firstVerificationConfigured,
  };
}
