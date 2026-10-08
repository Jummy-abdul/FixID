import type { Credential, VerificationActivity } from './types';

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
}

/**
 * Derives first-time setup progress from organization data.
 * Deliberately ignores user count: adding a user without issuing an ID is not progress.
 */
export function getSetupProgress(data: { credentials: Credential[]; activities: VerificationActivity[] }): SetupProgress {
  const milestones: SetupProgress['milestones'] = [
    { id: 'first-id', done: data.credentials.some(isIssued) },
    { id: 'first-verification', done: data.activities.some(isConfiguredActivity) },
  ];
  const completed = milestones.filter((m) => m.done).length;
  const next = milestones.find((m) => !m.done)?.id ?? null;
  return { milestones, completed, total: milestones.length, next, isComplete: next === null };
}
