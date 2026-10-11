const KEY = 'fixid.justRegistered';

/** Remembers, for this browser tab only, that an organization was just registered, so its workspace shows the confirmation once. */
export function markJustRegistered(organizationId: string) {
  try { sessionStorage.setItem(KEY, organizationId); } catch { /* storage unavailable: no confirmation, nothing else lost */ }
}

export function justRegistered(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function clearJustRegistered() {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
