import type { SsoConfigVersion, SsoConnection, SsoProvider } from './types';

/**
 * Single sign-on (OIDC) for administrators: one connection per organization in R1. Fixiam is the initial
 * provider; Custom OIDC covers other compatible identity providers. Configuration, tests and activation are
 * organization-scoped; SSO authenticates existing administrators and never creates or promotes them.
 */

export type SsoStatus = 'not-configured' | 'not-activated' | 'active';

export const SSO_STATUS_LABEL: Record<SsoStatus, string> = { 'not-configured': 'Not Configured', 'not-activated': 'Not Activated', active: 'Active' };

export const SSO_PROVIDERS: { id: SsoProvider; name: string; description: string; secretRequired: boolean }[] = [
  { id: 'fixiam', name: 'Fixiam', description: 'Seamfix’s identity and access management service.', secretRequired: true },
  { id: 'custom-oidc', name: 'Custom OIDC', description: 'Another OpenID Connect–compatible identity provider.', secretRequired: false },
];

export const providerName = (p: SsoProvider) => SSO_PROVIDERS.find((x) => x.id === p)!.name;

export function ssoStatus(c: SsoConnection | undefined): SsoStatus {
  if (!c?.current) return 'not-configured';
  return c.enabled ? 'active' : 'not-activated';
}

/** The configuration a test or activation applies to: pending changes when there are any, otherwise the saved one. */
export const versionUnderReview = (c: SsoConnection | undefined): SsoConfigVersion | undefined => c?.pending ?? c?.current;

/** Activation needs a completed, successful test of exactly the version being activated. */
export function canActivate(c: SsoConnection | undefined): boolean {
  const v = versionUnderReview(c);
  if (!c || !v?.testedAt) return false;
  return !!c.pending || !c.enabled;
}

/** The fixed address the identity provider returns administrators to. Registered with the provider as the redirect URI. */
export const redirectUri = (origin: string) => `${origin}/sso/callback`;

export interface SsoFormValues { provider: SsoProvider; issuer: string; clientId: string; clientSecret: string }
export type SsoFormErrors = Partial<Record<'issuer' | 'clientId' | 'clientSecret', string>>;

/** Canonical issuer: https URL without query, fragment or trailing slash. */
export const normalizeIssuer = (v: string) => v.trim().replace(/\/+$/, '');

export function validateSsoForm(v: SsoFormValues, opts: { secretAlreadySet: boolean }): SsoFormErrors {
  const e: SsoFormErrors = {};
  const issuer = normalizeIssuer(v.issuer);
  if (!issuer) e.issuer = 'Enter the issuer URL.';
  else {
    let url: URL | null = null;
    try { url = new URL(issuer); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || !url.hostname.includes('.')) e.issuer = 'Enter a valid https:// URL, such as https://id.example.com/realms/acme.';
    else if (url.search || url.hash) e.issuer = 'The issuer URL can’t include a query string or fragment.';
  }
  const clientId = v.clientId.trim();
  if (!clientId) e.clientId = 'Enter the client ID.';
  else if (clientId.length > 200 || /\s/.test(clientId)) e.clientId = 'Enter a client ID without spaces (up to 200 characters).';
  const required = SSO_PROVIDERS.find((p) => p.id === v.provider)!.secretRequired;
  if (required && !v.clientSecret && !opts.secretAlreadySet) e.clientSecret = 'Enter the client secret.';
  else if (v.clientSecret && v.clientSecret.length < 8) e.clientSecret = 'The client secret looks too short. Copy it again from your identity provider.';
  return e;
}

/** Whether a form differs from a saved version in anything that affects authentication. */
export function changesAuthentication(v: SsoFormValues, saved: SsoConfigVersion | undefined): boolean {
  if (!saved) return true;
  return v.provider !== saved.provider || normalizeIssuer(v.issuer) !== saved.issuer || v.clientId.trim() !== saved.clientId || !!v.clientSecret;
}
