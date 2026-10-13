import { useCallback } from 'react';
import { demoOperatorProblem } from '@/auth/authCore';
import { useAuth } from '@/auth/AuthProvider';
import { useServices } from '@/services/ServicesProvider';
import { useActions } from '@/store/AppStore';
import { clearScenarioRuns } from './runs';

/** What a demo reset restores, and what it keeps. Shown before anyone confirms. */
export const RESET_EXPLANATION = {
  restores: [
    'The seeded demonstration organizations (A, B with B1 and B2, C, and the new organization) and their people, groups, credentials, activities (including shared activities and invitations), integrations, transactions, exceptions and audit events.',
    'The simulated identity service’s outage switch and saved scenario runs.',
  ],
  keeps: [
    'Organizations registered through sign-up, and all of their records.',
    'Accounts and the current sign-in (nobody is signed out).',
  ],
};

/**
 * Resets demonstration data, for demo operators only (see demoOperatorProblem). Returns the reason when
 * refused; nothing changes then.
 */
export function useDemoReset() {
  const { account } = useAuth();
  const { resetDemoData } = useActions();
  const { idSwitch } = useServices();
  const problem = demoOperatorProblem(account);
  const reset = useCallback((): { ok: true } | { ok: false; error: string } => {
    if (problem) return { ok: false, error: problem };
    const r = resetDemoData();
    if (!r.ok) return r;
    idSwitch.simulation.reset();
    clearScenarioRuns();
    try {
      Object.keys(window.sessionStorage).filter((k) => k.startsWith('fixid.prototype.addUserDraft.')).forEach((k) => window.sessionStorage.removeItem(k));
    } catch {
      /* nothing to clear */
    }
    return { ok: true };
  }, [problem, resetDemoData, idSwitch]);
  return { canReset: !problem, problem, reset };
}
