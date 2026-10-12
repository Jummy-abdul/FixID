import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, FlaskConical, KeyRound, Loader2 } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { providerName, redirectUri, versionUnderReview } from '@/domain/sso';
import type { SsoConnection } from '@/domain/types';
import { beginRequest, consumeRequest, demoRespond, peekRequest, ssoService, type SsoPurpose, type SsoRequest } from '@/services/sso';
import { ssoFor } from '@/store/ssoOps';
import { useActions, useStore } from '@/store/AppStore';
import { AuthHeading, AuthLayout, FormError } from './AuthLayout';

const LAST_ORG_KEY = 'fixid.sso.lastOrganization';
const linkCls = 'font-semibold text-brand-600 hover:text-brand-700';

/**
 * Starts an SSO authentication for a purpose: a connection test (the configuration under review), identity
 * linking or sign-in (the active configuration). Returns the provider address to go to.
 */
export function startSso(purpose: SsoPurpose, connection: SsoConnection): string | null {
  const v = purpose === 'test' ? versionUnderReview(connection) : connection.enabled ? connection.current : undefined;
  if (!v) return null;
  const req = beginRequest({ purpose, organizationId: connection.organizationId, versionId: v.id, provider: v.provider, issuer: v.issuer, clientId: v.clientId });
  return ssoService().authorizationUrl(req, redirectUri(window.location.origin));
}

/** Goes to the provider: an in-app route for the demonstration provider, otherwise the FixID backend. */
export function useGoToProvider() {
  const navigate = useNavigate();
  return (url: string | null) => { if (!url) return; if (url.startsWith('/')) navigate(url); else window.location.assign(url); };
}

/* ------------------------------------------------------------------ */
/* Sign in with SSO: identify the organization first                   */
/* ------------------------------------------------------------------ */

/**
 * Organization discovery uses the Organization ID, never the email domain: a domain can't prove membership
 * and may be shared by several organizations. Unknown IDs and organizations without active SSO get the same
 * answer, so nothing is revealed about which organizations exist.
 */
export function SsoSignInPage() {
  const { state } = useStore();
  const go = useGoToProvider();
  const [orgId, setOrgId] = useState(() => { try { return window.localStorage.getItem(LAST_ORG_KEY) ?? ''; } catch { return ''; } });
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ id: string; name: string; provider: string; connection: SsoConnection } | null>(null);

  const identify = (e: FormEvent) => {
    e.preventDefault();
    setFound(null);
    const id = orgId.trim().toLowerCase();
    if (!id) return setError('Enter your Organization ID.');
    const org = state.data.organizations.find((o) => o.id.toLowerCase() === id);
    const c = org ? ssoFor(state, org.id) : undefined;
    if (!org || !c?.enabled || !c.current) return setError('Single sign-on isn’t available for this Organization ID. Check the ID with your Organization Admin, or sign in with your email and password.');
    setError(null);
    try { window.localStorage.setItem(LAST_ORG_KEY, org.id); } catch { /* ignore */ }
    setFound({ id: org.id, name: org.name, provider: providerName(c.current.provider), connection: c });
  };

  return (
    <AuthLayout footer={<Link to="/signin" className={linkCls}>Sign in with email and password</Link>}>
      <AuthHeading title="Sign in with SSO" description="Enter your Organization ID to sign in through your organization’s identity provider." />
      {found ? (
        <div className="space-y-5">
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-inset ring-slate-200">
            <p className="text-slate-500">Organization</p>
            <p className="font-semibold text-slate-900">{found.name}</p>
          </div>
          <Button className="h-11 w-full" icon={<KeyRound className="h-4 w-4" />} onClick={() => go(startSso('signin', found.connection))}>Sign in with {found.provider}</Button>
          <button type="button" className={`${linkCls} text-sm`} onClick={() => setFound(null)}>Use a different Organization ID</button>
        </div>
      ) : (
        <form onSubmit={identify} noValidate className="space-y-5">
          <Field label="Organization ID" error={error ?? undefined} hint="Shown in Settings → Organization. Ask your Organization Admin if you don’t know it.">
            {(p) => <Input {...p} autoFocus autoComplete="organization" className="h-11 font-mono" value={orgId} onChange={(e) => { setOrgId(e.target.value); setError(null); }} />}
          </Field>
          <Button type="submit" className="h-11 w-full">Continue</Button>
        </form>
      )}
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Demonstration identity provider (prototype only)                    */
/* ------------------------------------------------------------------ */

const PURPOSE: Record<SsoPurpose, string> = {
  test: 'An administrator is testing the SSO connection.',
  link: 'An administrator is linking their identity to their FixID account.',
  signin: 'Signing in to FixID.',
};

/**
 * Stands in for the organization's identity provider when no FixID SSO backend is connected. Everything
 * here is simulated: no provider is contacted, no password is checked, and no token is issued.
 */
export function DemoProviderPage() {
  const [params] = useSearchParams();
  const { account } = useAuth();
  const [req] = useState<SsoRequest | null>(() => peekRequest(params.get('state')));
  const [username, setUsername] = useState(() => (req?.purpose === 'link' && account ? account.email : ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  if (ssoService().mode !== 'demonstration') return <SsoProblem title="Page not available" message="This page is only part of the prototype’s demonstration mode." />;
  if (!req) return <SsoProblem title="This sign-in request has expired" message="Go back to FixID and start again." />;

  const respond = async (choice: Parameters<typeof demoRespond>[2]) => {
    setBusy(true);
    const url = new URL(await demoRespond(req, redirectUri(window.location.origin), choice));
    navigate(`${url.pathname}${url.search}`, { replace: true });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return setError('Enter the identity to simulate.');
    void respond({ kind: 'success', username });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-200">
        <div role="note" aria-label="Demonstration provider" className="flex gap-2 bg-amber-100 px-5 py-3 text-sm text-amber-950">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p><span className="font-semibold">Demonstration identity provider (simulated).</span> No real {providerName(req.provider)} sign-in happens and {req.issuer} isn’t contacted. Results are marked as demonstration results in FixID.</p>
        </div>
        <div className="space-y-5 px-6 py-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{providerName(req.provider)} (simulated)</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Sign in</h1>
            <p className="mt-1 text-sm text-slate-500">{PURPOSE[req.purpose]} Client <span className="font-mono">{req.clientId}</span>.</p>
          </div>
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field label="Identity to simulate" error={error ?? undefined} hint="A username or email at the identity provider. The same identity always gets the same provider ID, as with a real provider. No password is checked.">
              {(p) => <Input {...p} autoFocus value={username} onChange={(e) => { setUsername(e.target.value); setError(null); }} />}
            </Field>
            <Button type="submit" className="w-full" loading={busy}>Sign in (simulated)</Button>
          </form>
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-sm">
            <button type="button" className={linkCls} disabled={busy} onClick={() => void respond({ kind: 'error', error: 'access_denied' })}>Cancel</button>
            <button type="button" className="font-medium text-slate-600 hover:text-slate-900" disabled={busy} onClick={() => void respond({ kind: 'error', error: 'temporarily_unavailable' })}>Simulate provider unavailable</button>
            <button type="button" className="font-medium text-slate-600 hover:text-slate-900" disabled={busy} onClick={() => void respond({ kind: 'invalid' })}>Simulate invalid response</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Callback: validate the response, then finish the purpose            */
/* ------------------------------------------------------------------ */

export interface SsoNotice { ok: boolean; message: string; mode?: 'live' | 'demonstration' }

export function SsoCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { signInWithSso } = useAuth();
  const { recordSsoTest, linkSsoIdentity } = useActions();
  const { getState } = useStore();
  const [problem, setProblem] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const req = consumeRequest(params.get('state'));
    if (!req) { setProblem('This sign-in attempt has expired or was already used. Start again.'); return; }
    const service = ssoService();
    void service.complete(req, params).then((outcome) => {
      if (req.purpose === 'test') {
        const message = outcome.ok
          ? service.mode === 'demonstration'
            ? 'The demonstration provider completed a simulated sign-in and FixID validated its response. No real identity provider was contacted.'
            : 'FixID signed in with the identity provider and validated its response.'
          : outcome.message;
        const r = recordSsoTest(req.organizationId, req.versionId, outcome.ok, message, service.mode);
        navigate('/settings?tab=security', { replace: true, state: { ssoNotice: r.ok ? { ok: outcome.ok, message, mode: service.mode } : { ok: false, message: r.error } } });
        return;
      }
      if (req.purpose === 'link') {
        const r = outcome.ok ? linkSsoIdentity(req.organizationId, outcome.identity) : { ok: false as const, error: outcome.message };
        navigate('/profile', { replace: true, state: { ssoNotice: r.ok ? { ok: true, message: 'Your SSO identity is linked. You can now sign in with SSO.' } : { ok: false, message: r.error } } });
        return;
      }
      if (!outcome.ok) { setProblem(outcome.message); return; }
      const c = ssoFor(getState(), req.organizationId);
      if (!c?.enabled || c.current?.id !== req.versionId) { setProblem('Your organization’s SSO settings changed while you were signing in. Start again.'); return; }
      const r = signInWithSso(req.organizationId, outcome.identity, providerName(req.provider));
      if (!r.ok) { setProblem(r.error); return; }
      navigate('/', { replace: true });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (problem) return <SsoProblem title="SSO sign-in didn’t complete" message={problem} />;
  return (
    <AuthLayout>
      <p role="status" className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Completing sign-in…</p>
    </AuthLayout>
  );
}

function SsoProblem({ title, message }: { title: string; message: string }) {
  const { pathname } = useLocation();
  return (
    <AuthLayout>
      <AlertTriangle className="mb-4 h-10 w-10 text-amber-500" aria-hidden="true" />
      <AuthHeading title={title} />
      <FormError>{message}</FormError>
      <div className="mt-6 flex flex-col gap-3 text-sm">
        {pathname !== '/signin/sso' && <Link to="/signin/sso" className={linkCls}>Try SSO again</Link>}
        <Link to="/signin" className={`inline-flex items-center gap-1.5 ${linkCls}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Sign in with email and password</Link>
      </div>
    </AuthLayout>
  );
}
