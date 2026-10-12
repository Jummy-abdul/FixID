/**
 * Prototype authentication (demo mode). Everything here runs in the browser and is NOT a security
 * boundary: production sign-up, verification, password storage and sessions must be enforced by a
 * backend identity provider. Passwords are never stored in plain text, even here: they're salted and
 * hashed with PBKDF2 before being kept in local storage.
 */

import { DEMO_PERSONAS } from '@/data/demoPersonas';

/** Demo mode is on unless explicitly disabled at build time (VITE_DEMO_AUTH=off). */
export const DEMO_AUTH_ENABLED = import.meta.env.VITE_DEMO_AUTH !== 'off';
/** Role preview is a design and review aid, available only in demo builds and never in production. */
export const ROLE_PREVIEW_ENABLED = DEMO_AUTH_ENABLED && import.meta.env.VITE_ROLE_PREVIEW !== 'off';

/** Development-only verification code accepted in demo mode (no email provider is connected). */
export const DEV_VERIFICATION_CODE = '123456';
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;

export const AUTH_STORAGE_KEY = 'fixid.auth.v1';
export const SIGNUP_STORAGE_KEY = 'fixid.auth.signup';

export type OnboardingStep = 'personal' | 'organization' | 'complete';

export interface Account {
  id: string;
  email: string;
  /** PBKDF2-SHA256 hash and its salt. */
  password: { hash: string; salt: string; iterations: number };
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  organizationId?: string;
  onboarding: OnboardingStep;
  createdAt: string;
  /** Sessions issued before this time are revoked (set by a password reset). */
  sessionsValidAfter?: string;
  /**
   * Platform-level operator (FixID staff), not a member of any organization. Opens the separate platform
   * overview instead of an organization workspace. Not an organization role and never assignable.
   */
  platformRole?: 'platform-admin';
}

/**
 * A FixID session, the same whichever way the administrator signed in. Timestamps are optional only for
 * fixed test sessions; every real sign-in sets them.
 */
export interface AuthSession {
  accountId: string;
  /** Absolute end: issuedAt + the maximum session duration. */
  expiresAt?: string;
  issuedAt?: string;
  lastActiveAt?: string;
  method?: 'password' | 'sso';
  /** SSO sign-ins: the organization signed in to, and the provider's name (for the sign-out message). */
  organizationId?: string;
  providerName?: string;
}

const envNumber = (v: string | undefined, fallback: number) => (v && Number(v) > 0 ? Number(v) : fallback);

/**
 * Session policy. PROVISIONAL defaults pending product/security confirmation, configurable per build
 * (VITE_SESSION_IDLE_MINUTES, VITE_SESSION_MAX_HOURS). Not final product policy.
 */
export const SESSION_POLICY = {
  idleMinutes: envNumber(import.meta.env.VITE_SESSION_IDLE_MINUTES, 30),
  maxHours: envNumber(import.meta.env.VITE_SESSION_MAX_HOURS, 8),
  provisional: true,
};
export const SESSION_EXPIRED_FLAG = 'fixid.auth.sessionExpired';
export const SIGNED_OUT_FLAG = 'fixid.auth.signedOut';

export function newSession(accountId: string, now = new Date(), extra: Pick<AuthSession, 'method' | 'organizationId' | 'providerName'> = { method: 'password' }): AuthSession {
  const at = now.toISOString();
  return { accountId, issuedAt: at, lastActiveAt: at, expiresAt: new Date(now.getTime() + SESSION_POLICY.maxHours * 3_600_000).toISOString(), ...extra };
}

/** Why a session can no longer be used, or null. Revocation follows a password reset. */
export function sessionProblem(session: AuthSession, account: Pick<Account, 'sessionsValidAfter'> | undefined, now = new Date()): 'expired' | 'idle' | 'revoked' | null {
  if (session.expiresAt && new Date(session.expiresAt) <= now) return 'expired';
  if (session.lastActiveAt && now.getTime() - new Date(session.lastActiveAt).getTime() > SESSION_POLICY.idleMinutes * 60_000) return 'idle';
  if (account?.sessionsValidAfter && (!session.issuedAt || new Date(session.issuedAt) < new Date(account.sessionsValidAfter))) return 'revoked';
  return null;
}

/** A single-use password reset link. Only a hash of its token is kept. */
export interface PasswordReset { tokenHash: string; accountId: string; createdAt: string; expiresAt: string; usedAt?: string }

/** PROVISIONAL: reset links are valid for 30 minutes, pending confirmation (VITE_RESET_LINK_MINUTES). */
export const RESET_LINK_MINUTES = envNumber(import.meta.env.VITE_RESET_LINK_MINUTES, 30);

export interface AuthStore { accounts: Account[]; session: AuthSession | null; resets?: PasswordReset[] }

/** The reusable demo account. Opens the existing sample organizations; only available in demo mode. */
export const DEMO_ACCOUNT: Account = {
  id: 'acct_demo',
  email: 'demo@fixid.app',
  password: { hash: '8cf24bb1e76544bb8819160bc26c6c150de755a1c06e2697ce5e48a235948ccc', salt: 'fixid.demo.v1', iterations: 100_000 },
  emailVerified: true,
  firstName: 'Tobyson',
  lastName: 'TE',
  onboarding: 'complete',
  createdAt: '2026-01-01T00:00:00.000Z',
};
export const DEMO_SESSION: AuthSession = { accountId: DEMO_ACCOUNT.id };

/**
 * Demonstration accounts for each kind of user (demo builds only). They use the demo account's password and
 * sign in through the normal password check; they don't exist when demo mode is off.
 */
export const DEMO_PERSONA_ACCOUNTS: Account[] = DEMO_PERSONAS.map((p) => ({
  id: p.accountId, email: p.email, password: DEMO_ACCOUNT.password, emailVerified: true, firstName: p.firstName, lastName: p.lastName,
  onboarding: 'complete', createdAt: DEMO_ACCOUNT.createdAt,
  ...(p.organizationId ? { organizationId: p.organizationId } : {}), ...(p.platform ? { platformRole: 'platform-admin' as const } : {}),
}));

/** The shared password of the demonstration accounts. Empty outside demo builds, where the accounts don't exist. */
export const DEMO_PASSWORD = DEMO_AUTH_ENABLED ? 'FixIDDemo2026!' : '';

/**
 * Demo operators may reset demonstration data: the multi-workspace demo account and the Platform
 * Administrator persona, in demo builds only. A prototype convenience, not a production access control.
 */
export function demoOperatorProblem(account: Pick<Account, 'id' | 'platformRole'> | null | undefined, enabled = DEMO_AUTH_ENABLED): string | null {
  if (!enabled) return 'Demonstration tools aren’t available in this build.';
  if (!account) return 'Sign in as a demo operator to reset demonstration data.';
  if (account.id !== DEMO_ACCOUNT.id && account.platformRole !== 'platform-admin') return 'Only a demo operator (the demo account or the Platform Administrator) can reset demonstration data.';
  return null;
}

/** Built-in demonstration accounts (none outside demo builds). */
export const builtInAccounts = (): Account[] => (DEMO_AUTH_ENABLED ? [DEMO_ACCOUNT, ...DEMO_PERSONA_ACCOUNTS] : []);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export function emailError(email: string): string | null {
  if (!email.trim()) return 'Enter your email address.';
  if (!EMAIL.test(email.trim())) return 'Enter a valid email address.';
  return null;
}

/* ---------------- Passwords ---------------- */

export interface PasswordRule { id: string; label: string; test: (p: string) => boolean }
export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'case', label: 'Upper and lowercase letters', test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { id: 'number', label: 'A number or symbol', test: (p) => /[\d\W_]/.test(p) },
];
export const passwordIsStrong = (p: string) => PASSWORD_RULES.every((r) => r.test(p));

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPassword(password: string, salt: string, iterations = 100_000): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}

export function randomToken(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a.buffer);
}

/** Constant-time comparison of two hex strings. */
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function passwordMatches(account: Account, password: string) {
  return sameHex(await hashPassword(password, account.password.salt, account.password.iterations), account.password.hash);
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/* ---------------- Failed sign-in protection ---------------- */

/**
 * PROVISIONAL protective control: after 5 failed sign-ins for an email within 15 minutes, sign-in for that
 * email is paused for 15 minutes. Applies equally to unknown emails so it reveals nothing. Browser-only in
 * the prototype; production enforces rate limits on the server (per account and per source).
 */
export const SIGN_IN_LOCKOUT = { maxAttempts: 5, windowMinutes: 15, lockMinutes: 15 };
const ATTEMPTS_KEY = 'fixid.auth.attempts';
type Attempts = Record<string, { failures: number; firstAt: string; lockedUntil?: string }>;

function loadAttempts(): Attempts {
  try { return JSON.parse(window.localStorage.getItem(ATTEMPTS_KEY) ?? '{}') as Attempts; } catch { return {}; }
}
function saveAttempts(a: Attempts) {
  try { window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a)); } catch { /* storage unavailable */ }
}

/** Minutes until sign-in is allowed again for an email, or 0. */
export function lockedMinutes(email: string, now = new Date()): number {
  const until = loadAttempts()[normalizeEmail(email)]?.lockedUntil;
  return until && new Date(until) > now ? Math.ceil((new Date(until).getTime() - now.getTime()) / 60_000) : 0;
}

/** Records a failed attempt; returns true when it starts a lockout. */
export function recordFailedSignIn(email: string, now = new Date()): boolean {
  const all = loadAttempts();
  const key = normalizeEmail(email);
  const prev = all[key];
  const fresh = !prev || now.getTime() - new Date(prev.firstAt).getTime() > SIGN_IN_LOCKOUT.windowMinutes * 60_000;
  const failures = fresh ? 1 : prev.failures + 1;
  const locked = failures >= SIGN_IN_LOCKOUT.maxAttempts;
  all[key] = { failures: locked ? 0 : failures, firstAt: fresh ? now.toISOString() : prev.firstAt, ...(locked ? { lockedUntil: new Date(now.getTime() + SIGN_IN_LOCKOUT.lockMinutes * 60_000).toISOString() } : {}) };
  saveAttempts(all);
  return locked;
}

export function clearFailedSignIns(email: string) {
  const all = loadAttempts();
  delete all[normalizeEmail(email)];
  saveAttempts(all);
}

/* ---------------- Storage ---------------- */

export function loadAuth(): AuthStore {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as AuthStore;
      if (Array.isArray(p.accounts)) {
        // Expired, idle and revoked sessions end here; Sign in explains why.
        const account = p.session ? p.accounts.find((a) => a.id === p.session!.accountId) : undefined;
        if (p.session && sessionProblem(p.session, account)) {
          try { window.sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1'); } catch { /* ignore */ }
          return { accounts: p.accounts, session: null, resets: p.resets ?? [] };
        }
        return { accounts: p.accounts, session: p.session ?? null, resets: p.resets ?? [] };
      }
    }
  } catch { /* fall through */ }
  return { accounts: [], session: null, resets: [] };
}

export function saveAuth(store: AuthStore) {
  try { window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(store)); } catch { /* storage unavailable */ }
}

/* ---------------- Sign-up session (email verification) ---------------- */

export interface SignupDraft {
  email: string;
  /** Issued code metadata. The code itself is never stored. */
  code: { issuedAt: string; expiresAt: string; attemptsLeft: number };
  verified: boolean;
}

export function loadSignup(): SignupDraft | null {
  try {
    const raw = window.sessionStorage.getItem(SIGNUP_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SignupDraft) : null;
  } catch { return null; }
}
export function saveSignup(d: SignupDraft | null) {
  try {
    if (d) window.sessionStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify(d));
    else window.sessionStorage.removeItem(SIGNUP_STORAGE_KEY);
  } catch { /* storage unavailable */ }
}

export function issueCode(now = new Date()): SignupDraft['code'] {
  return { issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(), attemptsLeft: CODE_MAX_ATTEMPTS };
}

export type CodeCheck = { ok: true } | { ok: false; error: string; code?: SignupDraft['code'] };

/** Checks an entered code. In demo mode the expected code is DEV_VERIFICATION_CODE. */
export function checkCode(draft: SignupDraft, entered: string, now = new Date()): CodeCheck {
  if (!/^\d{6}$/.test(entered)) return { ok: false, error: 'Enter the 6-digit code.' };
  if (new Date(draft.code.expiresAt) <= now) return { ok: false, error: 'This code has expired. Request a new code to continue.' };
  if (draft.code.attemptsLeft <= 0) return { ok: false, error: 'Too many attempts. Request a new code to continue.' };
  if (DEMO_AUTH_ENABLED && entered === DEV_VERIFICATION_CODE) return { ok: true };
  const attemptsLeft = draft.code.attemptsLeft - 1;
  return {
    ok: false,
    error: attemptsLeft <= 0 ? 'Too many attempts. Request a new code to continue.' : "That code isn't correct. Please try again.",
    code: { ...draft.code, attemptsLeft },
  };
}
