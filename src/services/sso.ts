import { randomToken, sha256Hex } from '@/auth/authCore';
import type { SsoProvider } from '@/domain/types';
import type { ExternalIdentity } from '@/store/ssoOps';

/**
 * OIDC authentication boundary for administrator SSO (sign-in, connection tests, identity linking).
 *
 * A real OIDC flow needs a backend: it keeps the client secret, runs discovery, PKCE and the code exchange,
 * and validates the ID token's signature, issuer, audience, nonce and expiry. This prototype has no such
 * backend, so by default it uses a DEMONSTRATION provider: a page inside FixID, clearly labelled as
 * simulated, that stands in for the identity provider. It contacts no provider, issues no tokens, and every
 * result it produces is marked "demonstration". Setting VITE_SSO_BACKEND_URL switches to the live adapter,
 * which only talks to that FixID backend (contract below); the browser never calls the provider's token
 * endpoint or holds the client secret.
 */

export type SsoPurpose = 'test' | 'signin' | 'link';

/** One authentication attempt, kept in this tab until the provider returns. Single use, 10-minute lifetime. */
export interface SsoRequest {
  state: string;
  nonce: string;
  purpose: SsoPurpose;
  organizationId: string;
  versionId: string;
  provider: SsoProvider;
  issuer: string;
  clientId: string;
  startedAt: string;
}

export type SsoOutcome =
  | { ok: true; identity: ExternalIdentity }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'invalid'; message: string };

export interface SsoService {
  mode: 'live' | 'demonstration';
  /** Where the browser goes to authenticate. */
  authorizationUrl(req: SsoRequest, redirectUri: string): string;
  /** Validates the provider's response for a request and returns the authenticated identity. */
  complete(req: SsoRequest, params: URLSearchParams): Promise<SsoOutcome>;
}

const REQUEST_KEY = 'fixid.sso.request';
const REQUEST_TTL_MS = 10 * 60_000;

export function beginRequest(input: Omit<SsoRequest, 'state' | 'nonce' | 'startedAt'>): SsoRequest {
  const req: SsoRequest = { ...input, state: randomToken(16), nonce: randomToken(16), startedAt: new Date().toISOString() };
  try { window.sessionStorage.setItem(REQUEST_KEY, JSON.stringify(req)); } catch { /* storage unavailable */ }
  return req;
}

/** The pending request for this state, if any (not consumed). */
export function peekRequest(state: string | null): SsoRequest | null {
  try {
    const req = JSON.parse(window.sessionStorage.getItem(REQUEST_KEY) ?? 'null') as SsoRequest | null;
    if (!req || !state || req.state !== state) return null;
    return Date.now() - new Date(req.startedAt).getTime() > REQUEST_TTL_MS ? null : req;
  } catch { return null; }
}

/** Takes the pending request for this state; a state can be used once only (replays and forged callbacks fail). */
export function consumeRequest(state: string | null): SsoRequest | null {
  const req = peekRequest(state);
  try { window.sessionStorage.removeItem(REQUEST_KEY); } catch { /* ignore */ }
  return req;
}

const ERRORS: Record<string, { reason: 'cancelled' | 'unavailable' | 'invalid'; message: string }> = {
  access_denied: { reason: 'cancelled', message: 'Sign-in was cancelled at the identity provider.' },
  temporarily_unavailable: { reason: 'unavailable', message: 'The identity provider is unavailable right now. Try again later.' },
  server_error: { reason: 'unavailable', message: 'The identity provider is unavailable right now. Try again later.' },
};

function providerError(params: URLSearchParams): SsoOutcome | null {
  const error = params.get('error');
  if (!error) return null;
  return { ok: false, ...(ERRORS[error] ?? { reason: 'invalid', message: 'The identity provider returned an error, so nobody was signed in.' }) };
}

/* ---------------- Demonstration provider ---------------- */

const DEMO_RESPONSES_KEY = 'fixid.sso.demoResponses';
interface DemoResponse { iss: string; aud: string; sub: string; nonce: string; email?: string }

/** A stable subject identifier for a simulated provider account (as a real provider's `sub` would be). */
export async function demoSubject(issuer: string, username: string) {
  return `demo-${(await sha256Hex(`${issuer}|${username.trim().toLowerCase()}`)).slice(0, 24)}`;
}

/** Used by the demonstration provider page: records a simulated response and returns the callback URL. */
export async function demoRespond(req: SsoRequest, redirectUri: string, choice: { kind: 'success'; username: string } | { kind: 'error'; error: 'access_denied' | 'temporarily_unavailable' } | { kind: 'invalid' }): Promise<string> {
  const url = new URL(redirectUri);
  url.searchParams.set('state', req.state);
  if (choice.kind === 'error') { url.searchParams.set('error', choice.error); return url.toString(); }
  const code = randomToken(16);
  const response: DemoResponse = choice.kind === 'success'
    ? { iss: req.issuer, aud: req.clientId, sub: await demoSubject(req.issuer, choice.username), nonce: req.nonce, email: choice.username.includes('@') ? choice.username.trim().toLowerCase() : undefined }
    // An invalid response: right shape, wrong nonce (as a replayed or forged token would be).
    : { iss: req.issuer, aud: req.clientId, sub: 'demo-invalid', nonce: randomToken(8) };
  try {
    const all = JSON.parse(window.sessionStorage.getItem(DEMO_RESPONSES_KEY) ?? '{}') as Record<string, DemoResponse>;
    window.sessionStorage.setItem(DEMO_RESPONSES_KEY, JSON.stringify({ ...all, [code]: response }));
  } catch { /* storage unavailable */ }
  url.searchParams.set('code', code);
  return url.toString();
}

export const DEMONSTRATION_SSO: SsoService = {
  mode: 'demonstration',
  authorizationUrl: (req) => `/sso/demo-provider?state=${encodeURIComponent(req.state)}`,
  async complete(req, params) {
    const err = providerError(params);
    if (err) return err;
    const code = params.get('code');
    let response: DemoResponse | undefined;
    try {
      const all = JSON.parse(window.sessionStorage.getItem(DEMO_RESPONSES_KEY) ?? '{}') as Record<string, DemoResponse>;
      response = code ? all[code] : undefined;
      if (code) { delete all[code]; window.sessionStorage.setItem(DEMO_RESPONSES_KEY, JSON.stringify(all)); }
    } catch { response = undefined; }
    if (!response || response.nonce !== req.nonce || response.iss !== req.issuer || response.aud !== req.clientId || !response.sub) {
      return { ok: false, reason: 'invalid', message: 'The identity provider’s response couldn’t be validated, so nobody was signed in.' };
    }
    return { ok: true, identity: { issuer: response.iss, subject: response.sub, audience: response.aud, email: response.email, mode: 'demonstration' } };
  },
};

/* ---------------- Live adapter (FixID backend) ---------------- */

/**
 * Contract for a FixID backend:
 *   GET  {base}/sso/authorize?organizationId&versionId&state&nonce&redirect_uri → 302 to the provider (discovery + PKCE server-side)
 *   POST {base}/sso/callback { organizationId, versionId, state, nonce, code } →
 *        200 { issuer, subject, audience, email? } after validating the ID token (signature, iss, aud, nonce, exp)
 *        4xx/5xx → failure; nothing is signed in.
 */
export function createLiveSso(base: string, fetcher: typeof fetch = (...a) => fetch(...a)): SsoService {
  return {
    mode: 'live',
    authorizationUrl: (req, redirectUri) => `${base}/sso/authorize?${new URLSearchParams({ organizationId: req.organizationId, versionId: req.versionId, state: req.state, nonce: req.nonce, redirect_uri: redirectUri })}`,
    async complete(req, params) {
      const err = providerError(params);
      if (err) return err;
      let res: Response;
      try {
        res = await fetcher(`${base}/sso/callback`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ organizationId: req.organizationId, versionId: req.versionId, state: req.state, nonce: req.nonce, code: params.get('code') }),
        });
      } catch {
        return { ok: false, reason: 'unavailable', message: 'FixID couldn’t reach its sign-in service. Try again later.' };
      }
      if (res.status >= 500) return { ok: false, reason: 'unavailable', message: 'The identity provider is unavailable right now. Try again later.' };
      const body = res.ok ? await res.json().catch(() => null) as { issuer?: unknown; subject?: unknown; audience?: unknown; email?: unknown } | null : null;
      if (!body || typeof body.issuer !== 'string' || typeof body.subject !== 'string' || typeof body.audience !== 'string' || !body.subject) {
        return { ok: false, reason: 'invalid', message: 'The identity provider’s response couldn’t be validated, so nobody was signed in.' };
      }
      return { ok: true, identity: { issuer: body.issuer, subject: body.subject, audience: body.audience, email: typeof body.email === 'string' ? body.email : undefined, mode: 'verified' } };
    },
  };
}

export function createDefaultSso(): SsoService {
  const base = import.meta.env.VITE_SSO_BACKEND_URL;
  return base ? createLiveSso(base) : DEMONSTRATION_SSO;
}

let service: SsoService = createDefaultSso();
export const ssoService = () => service;
/** Tests replace the service (e.g. with the live adapter and a fake backend). */
export const setSsoService = (s: SsoService) => { service = s; };
