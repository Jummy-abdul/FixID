import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import {
  AUTH_STORAGE_KEY, DEMO_SESSION, SESSION_POLICY, SIGN_IN_LOCKOUT, hashPassword, loadAuth, newSession, sessionProblem, type Account, type AuthStore,
} from '@/auth/authCore';
import { loadMailbox } from '@/auth/demoMailbox';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { permissionsFor } from '@/domain/roles';
import { canActivate, ssoStatus, validateSsoForm, type SsoFormValues } from '@/domain/sso';
import { createLiveSso, demoSubject, setSsoService, DEMONSTRATION_SSO, type SsoRequest } from '@/services/sso';
import { adminsOf, applyAcceptInvite, applyInvite, applySetAdminStatus } from '@/store/adminOps';
import { loadState } from '@/store/persistence';
import {
  applyActivateSso, applyDisableSso, applyDiscardSsoChanges, applyLinkSsoIdentity, applySaveSso, applySsoTestResult, linkedAdministrator, ssoFor,
} from '@/store/ssoOps';
import { createInitialState, reducer, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const ORG = NEW_ORGANIZATION_ID;
const ISSUER = 'https://id.crestfield.example/realms/staff';
const values = (over: Partial<SsoFormValues> = {}): SsoFormValues => ({ provider: 'fixiam', issuer: ISSUER, clientId: 'fixid-portal', clientSecret: 's3cret-value-123', ...over });

function base(org = ORG): AppState {
  const s = createInitialState(new Date());
  s.session.currentOrganizationId = org;
  return s;
}
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };

/** A configured, tested and active connection (store level). */
function activeSso(s = base()): AppState {
  s = ok(applySaveSso(s, { organizationId: ORG, versionId: 'v1', values: values(), at: AT })).state;
  s = ok(applySsoTestResult(s, { organizationId: ORG, versionId: 'v1', ok: true, message: 'ok', mode: 'demonstration', at: AT })).state;
  return ok(applyActivateSso(s, { organizationId: ORG, at: AT })).state;
}

function renderApp(path: string, state?: AppState, signedIn = true) {
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state ?? loadState() ?? createInitialState(new Date())} {...(signedIn ? { authSession: DEMO_SESSION } : {})}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}
const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name }, { timeout: 3000 });

/** Completes the demonstration provider's simulated sign-in as an identity. */
async function simulatedProvider(user: UserEvent, identity: string) {
  await screen.findByRole('note', { name: 'Demonstration provider' });
  const box = screen.getByLabelText(/Identity to simulate/);
  await user.clear(box);
  await user.type(box, identity);
  await user.click(screen.getByRole('button', { name: 'Sign in (simulated)' }));
}

/** An account with a FixID password, stored the way sign-up stores it. */
async function storedAccount(over: Partial<Account> & Pick<Account, 'id' | 'email'>, password = 'Original2026!'): Promise<Account> {
  const salt = 'test-salt';
  return { emailVerified: true, onboarding: 'complete', createdAt: AT, password: { hash: await hashPassword(password, salt), salt, iterations: 100_000 }, ...over };
}
const writeAuth = (store: AuthStore) => localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(store));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setSsoService(DEMONSTRATION_SSO); });

describe('Story 01/02/05 — SSO configuration rules (store)', () => {
  it('validates the form: https issuer, client ID, and a client secret where required', () => {
    expect(validateSsoForm(values({ issuer: 'http://id.example.com', clientId: '', clientSecret: '' }), { secretAlreadySet: false }))
      .toEqual({ issuer: expect.stringMatching(/https/), clientId: 'Enter the client ID.', clientSecret: 'Enter the client secret.' });
    expect(validateSsoForm(values({ issuer: 'not a url' }), { secretAlreadySet: false }).issuer).toMatch(/valid https/);
    expect(validateSsoForm(values({ issuer: `${ISSUER}?x=1` }), { secretAlreadySet: false }).issuer).toMatch(/query string/);
    // Custom OIDC may be a public client; a saved secret can be kept.
    expect(validateSsoForm(values({ provider: 'custom-oidc', clientSecret: '' }), { secretAlreadySet: false })).toEqual({});
    expect(validateSsoForm(values({ clientSecret: '' }), { secretAlreadySet: true })).toEqual({});
  });

  it('saving never activates, a test only counts for the version tested, and activation needs that test', () => {
    let s = ok(applySaveSso(base(), { organizationId: ORG, versionId: 'v1', values: values(), at: AT })).state;
    expect(ssoStatus(ssoFor(s, ORG))).toBe('not-activated');
    expect(canActivate(ssoFor(s, ORG))).toBe(false);
    expect(applyActivateSso(s, { organizationId: ORG, at: AT })).toMatchObject({ ok: false, error: expect.stringMatching(/Test this configuration/) });
    // A failed test shows an error but doesn't add a status.
    s = ok(applySsoTestResult(s, { organizationId: ORG, versionId: 'v1', ok: false, message: 'Provider unavailable', mode: 'demonstration', at: AT })).state;
    expect(ssoStatus(ssoFor(s, ORG))).toBe('not-activated');
    expect(ssoFor(s, ORG)!.lastTest).toMatchObject({ ok: false, message: 'Provider unavailable' });
    // A result for another version is refused.
    expect(applySsoTestResult(s, { organizationId: ORG, versionId: 'other', ok: true, message: '', mode: 'demonstration', at: AT })).toMatchObject({ ok: false });
    s = ok(applySsoTestResult(s, { organizationId: ORG, versionId: 'v1', ok: true, message: 'ok', mode: 'demonstration', at: AT })).state;
    s = ok(applyActivateSso(s, { organizationId: ORG, at: AT })).state;
    expect(ssoStatus(ssoFor(s, ORG))).toBe('active');
    expect(s.data.audit.slice(0, 4).map((e) => e.action)).toEqual(['sso.activated', 'sso.tested', 'sso.test-failed', 'sso.saved']);
  });

  it('keeps the active configuration while changes are pending; changes need their own test; pending changes can be discarded', () => {
    let s = activeSso();
    s = ok(applySaveSso(s, { organizationId: ORG, versionId: 'v2', values: values({ clientId: 'fixid-portal-2', clientSecret: '' }), at: AT })).state;
    let c = ssoFor(s, ORG)!;
    expect(c).toMatchObject({ enabled: true, current: { id: 'v1', clientId: 'fixid-portal' }, pending: { id: 'v2', clientId: 'fixid-portal-2' } });
    // Changing the client means the saved secret can't be reused.
    expect(c.pending!.clientSecretSet).toBe(false);
    expect(canActivate(c)).toBe(false);
    s = ok(applySsoTestResult(s, { organizationId: ORG, versionId: 'v2', ok: true, message: 'ok', mode: 'demonstration', at: AT })).state;
    const discarded = ok(applyDiscardSsoChanges(s, { organizationId: ORG, at: AT })).state;
    expect(ssoFor(discarded, ORG)).toMatchObject({ enabled: true, current: { id: 'v1' }, pending: undefined });
    s = ok(applyActivateSso(s, { organizationId: ORG, at: AT })).state;
    c = ssoFor(s, ORG)!;
    expect(c).toMatchObject({ enabled: true, current: { id: 'v2' }, pending: undefined });
  });

  it('disabling keeps the configuration, stops SSO and needs a new test to reactivate', () => {
    let s = ok(applyDisableSso(activeSso(), { organizationId: ORG, at: AT })).state;
    expect(ssoStatus(ssoFor(s, ORG))).toBe('not-activated');
    expect(ssoFor(s, ORG)!.current).toMatchObject({ id: 'v1', issuer: ISSUER });
    expect(canActivate(ssoFor(s, ORG))).toBe(false);
    s = ok(applySsoTestResult(s, { organizationId: ORG, versionId: 'v1', ok: true, message: 'ok', mode: 'demonstration', at: AT })).state;
    expect(ssoStatus(ssoFor(ok(applyActivateSso(s, { organizationId: ORG, at: AT })).state, ORG))).toBe('active');
  });

  it('never keeps the client secret in workspace data', () => {
    const s = ok(applySaveSso(base(), { organizationId: ORG, versionId: 'v1', values: values({ clientSecret: 'TOP-SECRET-xyz-987' }), at: AT })).state;
    expect(JSON.stringify(s)).not.toContain('TOP-SECRET-xyz-987');
    expect(ssoFor(s, ORG)!.current!.clientSecretSet).toBe(true);
  });

  it('only Manage SSO Configuration may change SSO, and only in the organization being worked in', () => {
    expect(permissionsFor(['organization-admin']).has('sso.manage')).toBe(true);
    for (const r of ['verifier', 'auditor']) expect(permissionsFor([r]).has('sso.manage')).toBe(false);
    const s = base(SAMPLE_ORGANIZATION_ID);
    const auditor = adminsOf(s, SAMPLE_ORGANIZATION_ID).find((a) => a.roleIds[0] === 'auditor' && a.status === 'active')!;
    const asAuditor: AppState = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: auditor.userId! } } };
    expect(applySaveSso(asAuditor, { organizationId: SAMPLE_ORGANIZATION_ID, versionId: 'x', values: values(), at: AT })).toMatchObject({ ok: false });
    expect(reducer(asAuditor, { type: 'sso/save', input: { organizationId: SAMPLE_ORGANIZATION_ID, versionId: 'x', values: values(), at: AT } })).toBe(asAuditor);
    // Another organization's connection can't be changed from here, even by an Organization Admin.
    const here = base(SAMPLE_ORGANIZATION_ID);
    expect(reducer(here, { type: 'sso/save', input: { organizationId: ORG, versionId: 'x', values: values(), at: AT } })).toBe(here);
  });
});

describe('Story 04 — linking identities', () => {
  it('links by issuer and subject, keeps role and status, and never links one identity twice or across providers', () => {
    let s = activeSso();
    const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
    const identity = { issuer: ISSUER, subject: 'sub-123', audience: 'fixid-portal', email: 'someone@else.example', mode: 'demonstration' as const };
    s = ok(applyLinkSsoIdentity(s, { organizationId: ORG, identity, at: AT })).state;
    const linked = adminsOf(s, ORG).find((a) => a.id === me.id)!;
    expect(linked).toMatchObject({ roleIds: me.roleIds, status: 'active', organizationId: ORG, ssoIdentity: { issuer: ISSUER, subject: 'sub-123', mode: 'demonstration' } });
    // The email from the provider is irrelevant: only issuer + subject identify the administrator.
    expect(linkedAdministrator(s, ORG, ISSUER, 'sub-123')!.id).toBe(me.id);
    expect(linkedAdministrator(s, ORG, ISSUER, 'sub-other')).toBeUndefined();
    // Untrusted provider or wrong client.
    expect(applyLinkSsoIdentity(s, { organizationId: ORG, identity: { ...identity, issuer: 'https://evil.example' }, at: AT })).toMatchObject({ ok: false, error: expect.stringMatching(/doesn’t trust/) });
    expect(applyLinkSsoIdentity(s, { organizationId: ORG, identity: { ...identity, audience: 'another-app' }, at: AT })).toMatchObject({ ok: false });
    // Already linked to someone else.
    const other = { ...me, id: 'adm_other', userId: 'usr_other', email: 'other@example.org', ssoIdentity: undefined };
    const two: AppState = { ...s, data: { ...s.data, administrators: [...s.data.administrators, other], admin: { ...s.data.admin, id: 'usr_other' } } };
    expect(applyLinkSsoIdentity(two, { organizationId: ORG, identity, at: AT })).toMatchObject({ ok: false, error: expect.stringMatching(/already linked/) });
  });
});

describe('Settings → Security (Stories 01, 02, 05) and SSO sign-in (Stories 03, 04, 06)', () => {
  it('configures, tests with the labelled demonstration provider, activates, links an identity and signs in with SSO', async () => {
    const first = renderApp('/settings?tab=security', base());
    const { user } = first;
    expect(await screen.findByRole('heading', { name: /Single Sign-On \(SSO\)/ })).toHaveTextContent('Not Configured');
    expect(screen.getByText(/Connect your organization's identity provider to allow administrators to sign in using Single Sign-On\./)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Demonstration mode');
    await user.click(screen.getByRole('button', { name: 'Set up SSO' }));
    const form = screen.getByRole('form', { name: 'SSO configuration' });
    expect(within(form).getByRole('radio', { name: /Fixiam/ })).toBeChecked();
    expect(within(form).getByRole('radio', { name: /Custom OIDC/ })).toBeInTheDocument();
    expect(within(form).getByLabelText('FixID Redirect URI')).toHaveValue(`${window.location.origin}/sso/callback`);
    await user.click(within(form).getByRole('button', { name: 'Save configuration' }));
    expect(within(form).getByText('Enter the issuer URL.')).toBeInTheDocument();
    expect(within(form).getByText('Enter the client secret.')).toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Issuer URL/), ISSUER);
    await user.type(within(form).getByLabelText(/Client ID/), 'fixid-portal');
    await user.type(within(form).getByLabelText(/Client secret/), 'super-secret-001');
    await user.click(within(form).getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByRole('heading', { name: /Single Sign-On/ })).toHaveTextContent('Not Activated');
    expect(screen.getByRole('region', { name: 'Configuration' })).toHaveTextContent('Client secretSaved (hidden)');
    expect(screen.queryByText('super-secret-001')).toBeNull();
    expect(screen.getByRole('button', { name: 'Activate SSO' })).toBeDisabled();

    // A cancelled test is a failure with a message, not a new status.
    await user.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByRole('note', { name: 'Demonstration provider' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Connection test failed.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Single Sign-On/ })).toHaveTextContent('Not Activated');
    expect(screen.getByRole('button', { name: 'Activate SSO' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Test Connection' }));
    await simulatedProvider(user, 'tobyson@crestfield.example');
    expect(await screen.findByText('Connection test successful (demonstration).')).toBeInTheDocument();
    expect(screen.getByText(/No real identity provider was contacted/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activate SSO' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /Single Sign-On/ })).toHaveTextContent('Active'));

    // Link the signed-in administrator's identity from My Profile.
    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await user.click(screen.getByRole('menuitem', { name: 'My Profile' }));
    await user.click(await screen.findByRole('button', { name: 'Link SSO identity' }));
    await simulatedProvider(user, 'tobyson@crestfield.example');
    expect(await screen.findByText('Your SSO identity is linked. You can now sign in with SSO.')).toBeInTheDocument();
    expect(screen.getByText(/Demonstration link: made with the simulated provider/)).toBeInTheDocument();
    const saved = loadState()!;
    expect(adminsOf(saved, ORG).find((a) => a.ssoIdentity)).toMatchObject({ roleIds: ['organization-admin'], status: 'active', ssoIdentity: { issuer: ISSUER, mode: 'demonstration' } });
    first.unmount();
    writeAuth({ accounts: [], session: null });

    // Signed out: sign in with SSO through the organization's ID.
    const second = renderApp('/signin', saved, false);
    await heading('Welcome back');
    await second.user.click(screen.getByRole('link', { name: 'Sign in with SSO' }));
    await heading('Sign in with SSO');
    await second.user.type(screen.getByLabelText('Organization ID'), 'org_unknown');
    await second.user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Single sign-on isn’t available for this Organization ID/)).toBeInTheDocument();
    await second.user.clear(screen.getByLabelText('Organization ID'));
    await second.user.type(screen.getByLabelText('Organization ID'), ORG.toUpperCase());
    await second.user.click(screen.getByRole('button', { name: 'Continue' }));
    // An unlinked identity is refused: no account is created.
    await second.user.click(screen.getByRole('button', { name: 'Sign in with Fixiam' }));
    await simulatedProvider(second.user, 'stranger@crestfield.example');
    expect(await heading('SSO sign-in didn’t complete')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('isn’t linked to a FixID administrator account');
    expect(adminsOf(loadState()!, ORG)).toHaveLength(adminsOf(saved, ORG).length);
    // The linked identity signs in and gets its role's workspace.
    await second.user.click(screen.getByRole('link', { name: 'Try SSO again' }));
    await second.user.click(screen.getByRole('button', { name: 'Continue' }));
    await second.user.click(screen.getByRole('button', { name: 'Sign in with Fixiam' }));
    await simulatedProvider(second.user, 'tobyson@crestfield.example');
    expect(await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 3000 })).toBeInTheDocument();
    expect(loadAuth().session).toMatchObject({ accountId: 'acct_demo', method: 'sso', organizationId: ORG, providerName: 'Fixiam' });
    expect(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Settings' })).toBeInTheDocument();

    // Signing out ends only the FixID session, and says so.
    await second.user.click(screen.getByRole('button', { name: /Account menu/ }));
    await second.user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await heading('Welcome back');
    expect(screen.getByText(/You’ve signed out of FixID\. You may still be signed in to Fixiam/)).toBeInTheDocument();
    expect(loadAuth().session).toBeNull();
  }, 40_000);

  it('explains provider unavailability and invalid responses, and refuses replayed callbacks', async () => {
    let s = activeSso();
    s = ok(applyLinkSsoIdentity(s, { organizationId: ORG, identity: { issuer: ISSUER, subject: 'x', audience: 'fixid-portal', mode: 'demonstration' }, at: AT })).state;
    const { user } = renderApp('/signin/sso', s, false);
    await user.type(await screen.findByLabelText('Organization ID'), ORG);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Sign in with Fixiam' }));
    await screen.findByRole('note', { name: 'Demonstration provider' });
    await user.click(screen.getByRole('button', { name: 'Simulate provider unavailable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The identity provider is unavailable right now');
    await user.click(screen.getByRole('link', { name: 'Try SSO again' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Sign in with Fixiam' }));
    await screen.findByRole('note', { name: 'Demonstration provider' });
    await user.click(screen.getByRole('button', { name: 'Simulate invalid response' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be validated');
    expect(loadAuth().session).toBeNull();
  });

  it('refuses SSO sign-in when SSO is disabled, or the linked administrator is inactive', async () => {
    let s = activeSso();
    const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
    s = ok(applyLinkSsoIdentity(s, { organizationId: ORG, identity: { issuer: ISSUER, subject: 'x', audience: 'fixid-portal', mode: 'demonstration' }, at: AT })).state;
    const disabled = ok(applyDisableSso(s, { organizationId: ORG, at: AT })).state;
    const a = renderApp('/signin/sso', disabled, false);
    await a.user.type(await screen.findByLabelText('Organization ID'), ORG);
    await a.user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Single sign-on isn’t available/)).toBeInTheDocument();
    a.unmount();
    // Inactive: the record is deactivated directly (the last Organization Admin can't be through the UI).
    const subject = await demoSubject(ISSUER, 'tobyson@crestfield.example');
    const relinked = { ...s, data: { ...s.data, administrators: s.data.administrators.map((x) => (x.id === me.id ? { ...x, status: 'deactivated' as const, ssoIdentity: { ...x.ssoIdentity!, subject } } : x)) } };
    const b = renderApp('/signin/sso', relinked, false);
    await b.user.type(await screen.findByLabelText('Organization ID'), ORG);
    await b.user.click(screen.getByRole('button', { name: 'Continue' }));
    await b.user.click(screen.getByRole('button', { name: 'Sign in with Fixiam' }));
    await simulatedProvider(b.user, 'tobyson@crestfield.example');
    expect(await screen.findByRole('alert')).toHaveTextContent('This administrator account is inactive');
    expect(loadAuth().session).toBeNull();
  });

  it('administrators without Manage SSO Configuration don’t get Security, even by direct link', async () => {
    const s = createInitialState(new Date());
    s.session.currentOrganizationId = SAMPLE_ORGANIZATION_ID;
    const auditorView = reducer(s, { type: 'preview/start', roleId: 'auditor' });
    renderApp('/settings?tab=security', auditorView);
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    expect(tabs).not.toContain('Security');
    expect(screen.queryByRole('heading', { name: /Single Sign-On/ })).toBeNull();
  });
});

describe('Story 06 — sessions', () => {
  it('ends sessions after the provisional idle and maximum limits, and after revocation', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    const s = newSession('acct', now);
    expect(SESSION_POLICY).toMatchObject({ idleMinutes: 30, maxHours: 8, provisional: true });
    expect(sessionProblem(s, undefined, new Date(now.getTime() + 29 * 60_000))).toBeNull();
    expect(sessionProblem(s, undefined, new Date(now.getTime() + 31 * 60_000))).toBe('idle');
    expect(sessionProblem({ ...s, lastActiveAt: new Date(now.getTime() + 8 * 3_600_000 - 60_000).toISOString() }, undefined, new Date(now.getTime() + 8 * 3_600_000 + 1))).toBe('expired');
    expect(sessionProblem(s, { sessionsValidAfter: new Date(now.getTime() + 1000).toISOString() }, new Date(now.getTime() + 2000))).toBe('revoked');
  });

  it('an idle saved session returns to Sign in with an explanation', async () => {
    const old = new Date(Date.now() - 45 * 60_000);
    writeAuth({ accounts: [], session: newSession('acct_demo', old) });
    renderApp('/users', createInitialState(new Date()), false);
    expect(await screen.findByText('Your session has expired. Sign in again to continue.')).toBeInTheDocument();
  });
});

describe('Stories 10/11 — email and password sign-in', () => {
  it('pauses sign-in after repeated failures, with the same message for unknown emails, and never creates a session', async () => {
    const { user } = renderApp('/signin', createInitialState(new Date()), false);
    await heading('Welcome back');
    for (let i = 0; i < SIGN_IN_LOCKOUT.maxAttempts; i++) {
      await user.clear(screen.getByLabelText('Email address'));
      await user.type(screen.getByLabelText('Email address'), 'demo@fixid.app');
      await user.clear(screen.getByLabelText('Password'));
      await user.type(screen.getByLabelText('Password'), 'wrong-password');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));
      await screen.findByRole('alert');
    }
    expect(screen.getByRole('alert')).toHaveTextContent('Too many unsuccessful sign-in attempts');
    // Even the right password is refused while paused.
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'FixIDDemo2026!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many unsuccessful sign-in attempts'));
    expect(loadAuth().session).toBeNull();
  }, 20_000);

  it('refuses an inactive administrator, and lets an Organization Admin reach Security with email and password while SSO is active', async () => {
    let s = activeSso();
    s = ok(applyInvite(s, { organizationId: ORG, id: 'adm_j', email: 'joy@crestfield.example', name: 'Joy Ade', roleIds: ['auditor'], token: 't', at: AT })).state;
    s = ok(applyAcceptInvite(s, { adminId: 'adm_j', userId: 'acct_joy', name: 'Joy Ade', at: AT, token: 't' })).state;
    s = ok(applySetAdminStatus(s, { organizationId: ORG, adminId: 'adm_j', status: 'deactivated', at: AT })).state;
    writeAuth({ accounts: [await storedAccount({ id: 'acct_joy', email: 'joy@crestfield.example', organizationId: ORG })], session: null });
    const a = renderApp('/signin', s, false);
    await heading('Welcome back');
    await a.user.type(screen.getByLabelText('Email address'), 'joy@crestfield.example');
    await a.user.type(screen.getByLabelText('Password'), 'Original2026!');
    await a.user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This administrator account is inactive');
    expect(loadAuth().session).toBeNull();
    a.unmount();

    const b = renderApp('/signin', s, false);
    await heading('Welcome back');
    await b.user.type(screen.getByLabelText('Email address'), 'demo@fixid.app');
    await b.user.type(screen.getByLabelText('Password'), 'FixIDDemo2026!');
    await b.user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 3000 });
    expect(loadAuth().session).toMatchObject({ method: 'password' });
  }, 20_000);
});

describe('Story 12 — password reset', () => {
  it('sends a single-use link, sets a new password, revokes sessions and returns to sign in', async () => {
    const account = await storedAccount({ id: 'acct_r', email: 'reset@crestfield.example', organizationId: ORG });
    writeAuth({ accounts: [account], session: null, resets: [] });
    const r = renderApp('/forgot-password', createInitialState(new Date()), false);
    await heading('Forgot your password?');
    await r.user.type(screen.getByLabelText('Email address'), 'nobody@crestfield.example');
    await r.user.click(screen.getByRole('button', { name: /Send reset link/ }));
    await heading('Check your inbox');
    const generic = screen.getByText(/^If an account exists/).textContent;
    expect(loadMailbox()).toHaveLength(0);
    r.unmount();

    const again = renderApp('/forgot-password', createInitialState(new Date()), false);
    await heading('Forgot your password?');
    await again.user.type(screen.getByLabelText('Email address'), 'Reset@Crestfield.example');
    await again.user.click(screen.getByRole('button', { name: /Send reset link/ }));
    await heading('Check your inbox');
    expect(screen.getByText(/^If an account exists/).textContent).toBe(generic);
    const mail = loadMailbox();
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: 'reset@crestfield.example', link: expect.stringMatching(/^\/reset-password\?token=[0-9a-f]{64}$/) });
    expect(JSON.stringify(loadAuth())).not.toContain(mail[0].link.split('=')[1]);
    again.unmount();

    const reset = renderApp(mail[0].link, createInitialState(new Date()), false);
    await heading('Set a new password');
    await reset.user.type(screen.getByLabelText('New password'), 'weak');
    await reset.user.type(screen.getByLabelText('Confirm password'), 'other');
    await reset.user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText("This password doesn't meet the requirements below.")).toBeInTheDocument();
    await reset.user.clear(screen.getByLabelText('New password'));
    await reset.user.type(screen.getByLabelText('New password'), 'Renewed2026!');
    await reset.user.clear(screen.getByLabelText('Confirm password'));
    await reset.user.type(screen.getByLabelText('Confirm password'), 'Renewed2026!');
    await reset.user.click(screen.getByRole('button', { name: 'Reset password' }));
    await heading('Welcome back');
    expect(screen.getByText(/Your password has been reset/)).toBeInTheDocument();
    const after = loadAuth();
    expect(after.accounts[0].sessionsValidAfter).toBeTruthy();
    expect(sessionProblem(newSession('acct_r', new Date(Date.now() - 60_000)), after.accounts[0])).toBe('revoked');
    reset.unmount();

    // Single use.
    renderApp(mail[0].link, createInitialState(new Date()), false);
    expect(await heading('This reset link has already been used.')).toBeInTheDocument();
  }, 30_000);

  it('rejects expired and invalid links', async () => {
    const account = await storedAccount({ id: 'acct_e', email: 'e@crestfield.example' });
    const { sha256Hex } = await import('@/auth/authCore');
    const token = 'a'.repeat(64);
    writeAuth({ accounts: [account], session: null, resets: [{ tokenHash: await sha256Hex(token), accountId: 'acct_e', createdAt: AT, expiresAt: new Date(Date.now() - 1000).toISOString() }] });
    const a = renderApp(`/reset-password?token=${token}`, createInitialState(new Date()), false);
    expect(await heading('This reset link has expired.')).toBeInTheDocument();
    a.unmount();
    renderApp('/reset-password?token=nonsense', createInitialState(new Date()), false);
    expect(await heading('This reset link isn’t valid.')).toBeInTheDocument();
  });
});

describe('live SSO adapter (FixID backend contract)', () => {
  const req: SsoRequest = { state: 's', nonce: 'n', purpose: 'signin', organizationId: ORG, versionId: 'v1', provider: 'fixiam', issuer: ISSUER, clientId: 'fixid-portal', startedAt: AT };
  it('sends the browser to the backend, and only accepts a validated identity from it', async () => {
    const calls: unknown[] = [];
    const svc = createLiveSso('https://api.fixid.example', (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ issuer: ISSUER, subject: 'abc', audience: 'fixid-portal' }), { status: 200 });
    }) as typeof fetch);
    expect(svc.authorizationUrl(req, 'https://app/sso/callback')).toMatch(/^https:\/\/api\.fixid\.example\/sso\/authorize\?.*state=s.*nonce=n/);
    expect(await svc.complete(req, new URLSearchParams('code=c&state=s'))).toEqual({ ok: true, identity: { issuer: ISSUER, subject: 'abc', audience: 'fixid-portal', mode: 'verified' } });
    expect(calls[0]).toMatchObject({ code: 'c', nonce: 'n', state: 's' });
    const down = createLiveSso('https://api', (async () => new Response('', { status: 503 })) as typeof fetch);
    expect(await down.complete(req, new URLSearchParams('code=c'))).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(await svc.complete(req, new URLSearchParams('error=access_denied'))).toMatchObject({ ok: false, reason: 'cancelled' });
  });
});
