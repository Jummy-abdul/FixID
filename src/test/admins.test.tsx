import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_SESSION, DEV_VERIFICATION_CODE, loadAuth } from '@/auth/authCore';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { canGrantRoles, permissionsFor } from '@/domain/roles';
import { adminsOf, applyInvite, applySetAdminStatus, applySetRoles } from '@/store/adminOps';
import { loadState } from '@/store/persistence';
import { authorizeAction, createInitialState, reducer, type AppState } from '@/store/state';

const AT = new Date().toISOString();

function sampleState(org = SAMPLE_ORGANIZATION_ID): AppState {
  const s = createInitialState(new Date());
  s.session.currentOrganizationId = org;
  return s;
}

function renderApp(path: string, state: AppState, signedIn = true) {
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} {...(signedIn ? { authSession: DEMO_SESSION } : {})}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}

const rowFor = (text: string) => screen.getByText(text).closest('tr')!;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('administrator rules', () => {
  it('lets only administrators who manage admins invite, and never beyond their own permissions', () => {
    const s = sampleState();
    expect(applyInvite(s, { organizationId: SAMPLE_ORGANIZATION_ID, id: 'a1', email: 'new@example.org', roleIds: ['viewer'], at: AT })).toMatchObject({ ok: true });
    // Act as the Credential Manager.
    const cm = adminsOf(s, SAMPLE_ORGANIZATION_ID).find((a) => a.roleIds.includes('credential-manager') && a.status === 'active')!;
    const asCm: AppState = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: cm.userId! } } };
    expect(applyInvite(asCm, { organizationId: SAMPLE_ORGANIZATION_ID, id: 'a2', email: 'x@example.org', roleIds: ['viewer'], at: AT }))
      .toMatchObject({ ok: false, error: "You don't have permission to do this." });
    expect(canGrantRoles(permissionsFor(['credential-manager']), ['credential-manager'])).toBe(false);
    expect(canGrantRoles(permissionsFor(['organization-admin']), ['verifier'])).toBe(true);
    expect(canGrantRoles(permissionsFor(['verification-manager']), ['verifier'])).toBe(false);
  });

  it('handles duplicate, existing, deactivated and expired invitations', () => {
    const s = sampleState();
    const admins = adminsOf(s, SAMPLE_ORGANIZATION_ID);
    const invite = (email: string) => applyInvite(s, { organizationId: SAMPLE_ORGANIZATION_ID, id: 'x', email, roleIds: ['viewer'], at: AT });
    expect(invite(admins.find((a) => a.status === 'active' && a.name === 'Kwame Mensah')!.email)).toMatchObject({ ok: false, error: 'This person is already an administrator.' });
    expect(invite(admins.find((a) => a.status === 'deactivated')!.email)).toMatchObject({ ok: false, error: expect.stringMatching(/Reactivate/) });
    expect(invite(admins.find((a) => a.email.startsWith('operations@'))!.email)).toMatchObject({ ok: false, error: expect.stringMatching(/pending invitation/) });
    const expired = admins.find((a) => a.email.startsWith('records@'))!;
    const r = invite(expired.email.toUpperCase());
    if (!r.ok) throw new Error(r.error);
    expect(adminsOf(r.state, SAMPLE_ORGANIZATION_ID).filter((a) => a.email === expired.email)).toHaveLength(1);
  });

  it('protects the last Organization Admin and blocks self-deactivation', () => {
    const s = createInitialState(new Date());
    const owner = adminsOf(s, NEW_ORGANIZATION_ID)[0];
    expect(applySetRoles(s, { organizationId: NEW_ORGANIZATION_ID, adminId: owner.id, roleIds: ['viewer'], at: AT }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/can't remove your own Organization Admin role/) });
    // A second Organization Admin can't remove the only other one's role either when that would leave none.
    const second = { ...owner, id: 'adm_2', userId: 'usr_second', email: 'second@example.org', name: 'Second Admin' };
    const two: AppState = { ...s, data: { ...s.data, administrators: [...s.data.administrators, second] } };
    const demoted = applySetRoles(two, { organizationId: NEW_ORGANIZATION_ID, adminId: second.id, roleIds: ['viewer'], at: AT });
    if (!demoted.ok) throw new Error(demoted.error);
    const asSecondOnly: AppState = { ...two, data: { ...two.data, admin: { ...two.data.admin, id: second.userId }, administrators: two.data.administrators.map((a) => (a.id === owner.id ? { ...a, roleIds: ['credential-manager'] } : a)) } };
    expect(applySetAdminStatus(asSecondOnly, { organizationId: NEW_ORGANIZATION_ID, adminId: owner.id, status: 'deactivated', at: AT })).toMatchObject({ ok: true });
    expect(applySetRoles(asSecondOnly, { organizationId: NEW_ORGANIZATION_ID, adminId: second.id, roleIds: ['viewer'], at: AT })).toMatchObject({ ok: false });
    expect(applySetAdminStatus(s, { organizationId: NEW_ORGANIZATION_ID, adminId: owner.id, status: 'deactivated', at: AT }))
      .toMatchObject({ ok: false, error: "You can't deactivate your own access." });
  });

  it('refuses protected changes in the store without the permission', () => {
    const s = sampleState();
    const viewer = adminsOf(s, SAMPLE_ORGANIZATION_ID).find((a) => a.roleIds.includes('viewer'))!;
    const reactivated = applySetAdminStatus(s, { organizationId: SAMPLE_ORGANIZATION_ID, adminId: viewer.id, status: 'active', at: AT });
    if (!reactivated.ok) throw new Error(reactivated.error);
    const asViewer: AppState = { ...reactivated.state, data: { ...reactivated.state.data, admin: { ...s.data.admin, id: viewer.userId! } } };
    expect(authorizeAction(asViewer, 'users/status')).toMatch(/permission/);
    const member = asViewer.data.members.find((m) => m.organizationId === SAMPLE_ORGANIZATION_ID && m.status === 'active')!;
    const after = reducer(asViewer, { type: 'users/status', input: { organizationId: SAMPLE_ORGANIZATION_ID, memberId: member.id, status: 'inactive', at: AT } });
    expect(after).toBe(asViewer);
  });
});

describe('Administrators & Roles', () => {
  it('lists administrators with roles, status and last active, with search and filters', async () => {
    const { user } = renderApp('/settings', sampleState());
    await user.click(screen.getByRole('tab', { name: 'Administrators & Roles' }));
    expect(await screen.findByText('Kwame Mensah')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Name', 'Email address', 'Roles', 'Status', 'Last active', 'Actions']);
    expect(rowFor('Tobyson TE')).toHaveTextContent('You');
    expect(rowFor('Grace Okafor')).toHaveTextContent('Deactivated');
    expect(rowFor('Halima Bello')).toHaveTextContent('Verifier');
    expect(screen.getByText(/^records@/).closest('tr')).toHaveTextContent('Invitation expired');
    await user.selectOptions(screen.getByLabelText('Status'), 'invited');
    expect(screen.queryByText('Kwame Mensah')).toBeNull();
    expect(screen.getByText(/^operations@/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await user.type(screen.getByRole('searchbox', { name: 'Search administrators' }), 'halima');
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('invites an administrator with review, then shows them as Invited and records it in the audit log', async () => {
    const state = sampleState();
    const kwame = adminsOf(state, SAMPLE_ORGANIZATION_ID).find((a) => a.name === 'Kwame Mensah')!;
    const { user } = renderApp('/settings?tab=admins', state);
    await screen.findByText('Kwame Mensah');
    await user.click(screen.getByRole('button', { name: 'Invite Administrator' }));
    const drawer = screen.getByRole('dialog', { name: 'Invite administrator' });
    await user.click(within(drawer).getByRole('button', { name: 'Review invitation' }));
    expect(within(drawer).getByText('Enter an email address.')).toBeInTheDocument();
    expect(within(drawer).getByText('Choose at least one role.')).toBeInTheDocument();
    await user.type(within(drawer).getByLabelText(/email address/i), kwame.email.toUpperCase());
    await user.click(within(drawer).getByRole('checkbox', { name: /Viewer \/ Auditor/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Review invitation' }));
    expect(within(drawer).getByText('This person is already an administrator.')).toBeInTheDocument();
    await user.clear(within(drawer).getByLabelText(/email address/i));
    await user.type(within(drawer).getByLabelText(/email address/i), 'ops.lead@example.org');
    await user.click(within(drawer).getByRole('checkbox', { name: /Credential Manager/ }));
    expect(within(drawer).getByRole('checkbox', { name: /Verifier/ })).not.toBeDisabled();
    await user.click(within(drawer).getByRole('button', { name: 'Review invitation' }));
    const review = screen.getByRole('dialog', { name: 'Review invitation' });
    expect(review).toHaveTextContent('ops.lead@example.org');
    expect(review).toHaveTextContent('Issue and manage issued credentials (allowed)');
    await user.click(within(review).getByRole('button', { name: 'Create invitation' }));
    expect(await screen.findByText('Invitation created')).toBeInTheDocument();
    expect(screen.getByText(/can join by signing up with this email address/)).toBeInTheDocument();
    const row = screen.getByText('ops.lead@example.org').closest('tr')!;
    expect(row).toHaveTextContent('Invited');
    expect(row).toHaveTextContent('Credential Manager');
    expect(loadState()!.data.audit[0]).toMatchObject({ action: 'admin.invited', actor: 'Tobyson TE', organizationId: SAMPLE_ORGANIZATION_ID, resourceType: 'administrator' });
  });

  it('changes roles, deactivates, reactivates and revokes with confirmation', async () => {
    const { user } = renderApp('/settings?tab=admins', sampleState());
    await screen.findByText('Kwame Mensah');
    await user.click(within(rowFor('Kwame Mensah')).getByRole('button', { name: 'Actions for Kwame Mensah' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit Role Assignment' }));
    const drawer = screen.getByRole('dialog', { name: 'Kwame Mensah' });
    await user.click(within(drawer).getByRole('checkbox', { name: /Viewer \/ Auditor/ }));
    expect(within(drawer).getByText('Permissions after saving')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Save roles' }));
    expect(await screen.findByText('Roles updated')).toBeInTheDocument();
    expect(rowFor('Kwame Mensah')).toHaveTextContent('Viewer / Auditor');
    expect(loadState()!.data.audit[0]).toMatchObject({
      action: 'admin.role-assigned', summary: 'Tobyson TE assigned Viewer / Auditor to Kwame Mensah.', subject: { name: 'Kwame Mensah' },
      changes: [{ field: 'Roles', from: 'Verification Manager', to: 'Verification Manager, Viewer / Auditor' }], result: 'success',
    });

    await user.click(within(rowFor('Kwame Mensah')).getByRole('button', { name: 'Actions for Kwame Mensah' }));
    await user.click(screen.getByRole('menuitem', { name: 'Deactivate Access' }));
    const confirm = screen.getByRole('dialog', { name: 'Deactivate access?' });
    await user.click(within(confirm).getByRole('button', { name: 'Deactivate Access' }));
    expect(await screen.findByText('Access deactivated')).toBeInTheDocument();
    expect(rowFor('Kwame Mensah')).toHaveTextContent('Deactivated');

    await user.click(within(rowFor('Kwame Mensah')).getByRole('button', { name: 'Actions for Kwame Mensah' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reactivate Access' }));
    await user.click(screen.getByRole('button', { name: 'Reactivate Access' }));
    await waitFor(() => expect(rowFor('Kwame Mensah')).toHaveTextContent('Active'));

    const invited = screen.getByText(/^operations@/).textContent!;
    await user.click(within(rowFor(invited)).getByRole('button', { name: `Actions for ${invited}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Revoke Invitation' }));
    await user.click(screen.getByRole('button', { name: 'Revoke Invitation' }));
    await waitFor(() => expect(screen.queryByText(invited)).toBeNull());
    expect(loadState()!.data.audit.slice(0, 4).map((e) => e.action)).toEqual(['admin.invitation-revoked', 'admin.reactivated', 'admin.deactivated', 'admin.role-assigned']);
  });

  it('shows the five roles with structured permissions; the Verifier has no portal access', async () => {
    renderApp('/settings?tab=admins&view=roles', sampleState());
    for (const name of ['Organization Admin', 'Credential Manager', 'Verification Manager', 'Verifier', 'Viewer / Auditor']) {
      expect(screen.getByRole('heading', { level: 3, name: new RegExp(`^${name.replace('/', '\\/')}`) })).toBeInTheDocument();
    }
    const verifier = screen.getByRole('heading', { level: 3, name: /^Verifier/ }).closest('.rounded-xl')!;
    expect(verifier).toHaveTextContent('No portal access');
    const allowed = within(verifier as HTMLElement).getAllByRole('listitem').filter((li) => li.textContent?.includes('(allowed)')).map((li) => li.textContent);
    expect(allowed).toEqual(['Perform verifications (allowed)Assigned activities only', 'View verification results and history (allowed)Assigned activities only']);
  });
});

async function acceptInvite(user: UserEvent, email: string, first: string, last: string) {
  await screen.findByRole('heading', { level: 1, name: 'Create your FixID account' });
  await user.type(screen.getByLabelText('Email address'), email);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { level: 1, name: 'Check your inbox' });
  await user.click(screen.getByLabelText('Digit 1'));
  await user.paste(DEV_VERIFICATION_CODE);
  await screen.findByRole('heading', { level: 1, name: 'Secure your account' });
  await user.type(screen.getByLabelText('New password'), 'Joining2026!');
  await user.type(screen.getByLabelText('Confirm password'), 'Joining2026!');
  await user.click(screen.getByRole('button', { name: 'Create password' }));
  await screen.findByRole('heading', { level: 1, name: 'What should we call you?' });
  await user.type(screen.getByLabelText(/first name/i), first);
  await user.type(screen.getByLabelText(/last name/i), last);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('invitations, permissions and revoked access', () => {
  it('an invited Credential Manager joins the organization with limited permissions', async () => {
    const s = createInitialState(new Date());
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_cm', email: 'cm@example.org', roleIds: ['credential-manager'], at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const { user } = renderApp('/signup', invited.state, false);
    await screen.findByRole('heading', { level: 1, name: 'Create your FixID account' });
    await acceptInvite(user, 'cm@example.org', 'Chidi', 'Obi');
    expect(await screen.findByRole('heading', { name: 'Welcome to FixID, Chidi.' }, { timeout: 3000 })).toBeInTheDocument();
    const state = loadState()!;
    expect(adminsOf(state, NEW_ORGANIZATION_ID).find((a) => a.id === 'adm_cm')).toMatchObject({ status: 'active', name: 'Chidi Obi', userId: loadAuth().accounts[0].id });
    expect(state.data.audit[0]).toMatchObject({ action: 'admin.joined', actor: 'Chidi Obi' });

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).queryByRole('link', { name: 'Audit Log' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Verification Events' })).toBeNull();
    await user.click(within(nav).getByRole('link', { name: 'Users' }));
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    expect(screen.queryByRole('link', { name: /add user/i })).toBeNull();
    await user.click(within(nav).getByRole('link', { name: 'Credentials' }));
    expect(await screen.findByRole('button', { name: 'Create credential' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Settings' }));
    expect(screen.queryByRole('tab', { name: 'Administrators & Roles' })).toBeNull();
    expect(screen.getByText(/Only administrators who manage settings can change them/)).toBeInTheDocument();
  }, 20_000);

  it('blocks direct navigation to screens without permission', async () => {
    const s = createInitialState(new Date());
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_v', email: 'viewer@example.org', roleIds: ['viewer'], at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const first = renderApp('/signup', invited.state, false);
    await acceptInvite(first.user, 'viewer@example.org', 'Vera', 'Eze');
    await screen.findByRole('heading', { name: 'Welcome to FixID, Vera.' }, { timeout: 3000 });
    first.unmount();
    renderApp('/users/new/manual', loadState()!, false);
    expect(await screen.findByRole('heading', { name: "You don't have access to this page" })).toBeInTheDocument();
  }, 20_000);

  it('a Verifier signs up but has no access to the administration portal', async () => {
    const s = createInitialState(new Date());
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_ver', email: 'verifier@example.org', roleIds: ['verifier'], at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const { user } = renderApp('/signup', invited.state, false);
    await acceptInvite(user, 'verifier@example.org', 'Femi', 'Lawal');
    expect(await screen.findByRole('heading', { name: "This portal isn't part of your role" }, { timeout: 3000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { level: 1, name: 'Welcome back' });
  }, 20_000);

  it('deactivation takes effect for the affected administrator', async () => {
    const s = createInitialState(new Date());
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_x', email: 'x@example.org', roleIds: ['viewer'], at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const first = renderApp('/signup', invited.state, false);
    await acceptInvite(first.user, 'x@example.org', 'Ada', 'Uche');
    await screen.findByRole('heading', { name: 'Welcome to FixID, Ada.' }, { timeout: 3000 });
    const session = loadAuth().session;
    first.unmount();

    // The Organization Admin (demo account) deactivates them.
    const admin = renderApp('/settings?tab=admins', loadState()!);
    await screen.findByText('Ada Uche');
    await admin.user.click(within(rowFor('Ada Uche')).getByRole('button', { name: 'Actions for Ada Uche' }));
    await admin.user.click(screen.getByRole('menuitem', { name: 'Deactivate Access' }));
    await admin.user.click(screen.getByRole('button', { name: 'Deactivate Access' }));
    await screen.findByText('Access deactivated');
    admin.unmount();

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...loadAuth(), session }));
    renderApp('/', loadState()!, false);
    expect(await screen.findByRole('heading', { name: 'Your access has been removed' }, { timeout: 3000 })).toBeInTheDocument();
  }, 20_000);

  it('an expired session returns to Sign in with an explanation', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId: 'acct_demo', expiresAt: '2020-01-01T00:00:00.000Z' } }));
    renderApp('/users', createInitialState(new Date()), false);
    expect(await screen.findByText('Your session has expired. Sign in again to continue.')).toBeInTheDocument();
  });
});

describe('saved data from before administrators', () => {
  it('adds administrator records instead of discarding data', () => {
    const s = createInitialState(new Date());
    const owned = { ...s.data.organizations[0], id: 'org_mine', name: 'Mine', ownerAccountId: 'acct_1', contactEmail: 'me@mine.example' };
    const { administrators: _dropped, ...oldData } = { ...s.data, organizations: [...s.data.organizations, owned] };
    const legacy = { ...s, data: oldData };
    localStorage.setItem('fixid.prototype.state', JSON.stringify(legacy));
    const loaded = loadState()!;
    expect(adminsOf(loaded, 'org_mine')).toEqual([expect.objectContaining({ userId: 'acct_1', roleIds: ['organization-admin'], status: 'active', email: 'me@mine.example' })]);
    expect(adminsOf(loaded, SAMPLE_ORGANIZATION_ID).length).toBeGreaterThan(1);
    expect(loaded.data.members).toHaveLength(s.data.members.length);
  });
});
