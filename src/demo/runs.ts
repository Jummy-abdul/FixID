import type { Baseline } from './scenarios';

/** Scenario runs (demo builds only): when each scenario was loaded, and the baseline taken then. */
export interface ScenarioRun { scenarioId: string; baseline: Baseline; loadedBy: string; startedAt?: string }

export const RUNS_KEY = 'fixid.demo.runs.v1';

export function loadScenarioRuns(): Record<string, ScenarioRun> {
  try {
    const raw = window.localStorage.getItem(RUNS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveScenarioRuns(runs: Record<string, ScenarioRun>) {
  try { window.localStorage.setItem(RUNS_KEY, JSON.stringify(runs)); } catch { /* not saved */ }
}

export function clearScenarioRuns() {
  try { window.localStorage.removeItem(RUNS_KEY); } catch { /* nothing to clear */ }
}
