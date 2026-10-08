import { STATE_VERSION, STORAGE_KEY, type AppState } from './state';

/** Returns persisted state if present and compatible, otherwise null. Never throws. */
export function loadState(): AppState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (parsed?.version !== STATE_VERSION || !parsed.data?.organizations?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: AppState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}
