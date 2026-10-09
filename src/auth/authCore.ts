/**
 * Prototype authentication (demo mode). Everything here runs in the browser and is NOT a security
 * boundary: production sign-up, verification, password storage and sessions must be enforced by a
 * backend identity provider. Passwords are never stored in plain text, even here: they're salted and
 * hashed with PBKDF2 before being kept in local storage.
 */

/** Demo mode is on unless explicitly disabled at build time (VITE_DEMO_AUTH=off). */
export const DEMO_AUTH_ENABLED = import.meta.env.VITE_DEMO_AUTH !== 'off';

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
}

export interface AuthSession { accountId: string; expiresAt?: string }

export const SESSION_TTL_MS = 12 * 60 * 60_000;
export const SESSION_EXPIRED_FLAG = 'fixid.auth.sessionExpired';
export const newSession = (accountId: string, now = new Date()): AuthSession => ({ accountId, expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString() });

export interface AuthStore { accounts: Account[]; session: AuthSession | null }

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

/* ---------------- Storage ---------------- */

export function loadAuth(): AuthStore {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as AuthStore;
      if (Array.isArray(p.accounts)) {
        // Expired sessions end here; Sign in explains why.
        if (p.session?.expiresAt && new Date(p.session.expiresAt) <= new Date()) {
          try { window.sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1'); } catch { /* ignore */ }
          return { accounts: p.accounts, session: null };
        }
        return { accounts: p.accounts, session: p.session ?? null };
      }
    }
  } catch { /* fall through */ }
  return { accounts: [], session: null };
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
