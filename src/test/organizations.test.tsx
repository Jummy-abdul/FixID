import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_SESSION, loadAuth } from '@/auth/authCore';
import { DEMO_PERSONAS, ORG_A, ORG_B, ORG_B1, ORG_B2 } from '@/data/demoPersonas';
import { permissionsFor } from '@/domain/roles';
import { actorPermissions, adminsOf, applyAcceptInvite, invitationByToken } from '@/store/adminOps';
import {
  applyCreateSubOrganization, applyResendSubOrganizationInvite, canHaveSubOrganizations, parentRelationship, subOrganization, subRelationships,
  type SubOrganizationValues,
} from '@/store/orgOps';
import { loadState } from '@/store/persistence';
import { createInitialState, reducer, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const persona = (accountId: string) => DEMO_PERSONAS.find((p) => p.accountId === accountId)!;

/** State as a persona sees it in the store: signed in to their home organization. */
function as(accountId: string, s = createInitialState(new Date())): AppState {
  const p = persona(accountId);
  return { ...s, data: { ...s.data, admin: { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner', organizationIds: [p.organizationId!] } }, session: { ...s.session, currentOrganizationId: p.organizationId! } };
}
const values = (over: Partial<SubOrganizationValues> = {}): SubOrganizationValues => ({
  name: 'Meridian Riverside Centre', shortName: '', industry: '', contactEmail: '', phone: '', adminEmail: 'new.admin@riverside.example', memberLabel: 'Member', timezone: 'UTC', ...over,
});
const create = (s: AppState, parent: string, over: Partial<SubOrganizationValues> = {}, id = 'org_new') =>
  applyCreateSubOrganization(s, { parentOrganizationId: parent, ids: { organizationId: id, administratorId: `${id}_adm`, relationshipId: `rel_${id}` }, token: `tok_${id}`, values: values(over), at: AT });
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };

function renderApp(path: string, state: AppState = createInitialState(new Date()), session: 'demo' | 'none' = 'none') {
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} {...(session === 'demo' ? { authSession: DEMO_SESSION } : {})}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}

/** Signs in through the normal sign-in page using a demonstration account. */
async function signInAs(user: UserEvent, personaLabel: string) {
  await screen.findByRole('heading', { level: 1, name: 'Welcome back' });
  await user.click(screen.getByRole('button', { name: 'View demo accounts' }));
  await user.click(screen.getByRole('button', { name: `Use ${personaLabel} account` }));
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}
const workspace = () => screen.findByRole('region', { name: 'Workspace' }, { timeout: 4000 });
const navLinks = () => within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link').map((l) => l.textContent);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('organization structure (store)', () => {
  it('seeds A (independent), B with sub-organizations B1 and B2, each its own workspace', () => {
    const s = createInitialState(new Date());
    expect(subRelationships(s, ORG_A)).toEqual([]);
    expect(parentRelationship(s, ORG_A)).toBeUndefined();
    expect(subRelationships(s, ORG_B).map((r) => r.childOrganizationId).sort()).toEqual([ORG_B1, ORG_B2].sort());
    for (const id of [ORG_B1, ORG_B2]) {
      expect(parentRelationship(s, id)).toMatchObject({ parentOrganizationId: ORG_B, type: 'sub-organization', status: 'active' });
      expect(adminsOf(s, id).length).toBeGreaterThan(0);
      expect(s.data.members.some((m) => m.organizationId === id)).toBe(true);
      // No parent administrator is a member of a sub-organization.
      expect(adminsOf(s, id).some((a) => adminsOf(s, ORG_B).some((b) => b.userId && b.userId === a.userId))).toBe(false);
    }
  });

  it('lets an authorized Organization Admin create a sub-organization: its own workspace, an invitation, no access for the creator', () => {
    const s = as('acct_demo_b_admin');
    const r = ok(create(s, ORG_B));
    const created = r.state.data.organizations.find((o) => o.id === 'org_new')!;
    expect(created).toMatchObject({ name: 'Meridian Riverside Centre', shortName: 'MRC', country: s.data.organizations.find((o) => o.id === ORG_B)!.country, onboarding: 'awaiting-administrator' });
    expect(parentRelationship(r.state, 'org_new')).toMatchObject({ parentOrganizationId: ORG_B, origin: 'created-by-parent', initialAdministratorId: 'org_new_adm' });
    // The initial administrator is invited, not active.
    expect(adminsOf(r.state, 'org_new')).toEqual([expect.objectContaining({ email: 'new.admin@riverside.example', status: 'invited', roleIds: ['organization-admin'] })]);
    // The creator has no membership or permissions there.
    expect(actorPermissions(r.state, 'org_new').size).toBe(0);
    expect(r.state.data.audit.find((e) => e.action === 'organization.sub-created')).toMatchObject({ organizationId: ORG_B, resourceId: 'org_new' });
    expect(r.state.data.audit.find((e) => e.action === 'organization.created' && e.organizationId === 'org_new')).toBeTruthy();
    // Accepting completes onboarding.
    const joined = ok(applyAcceptInvite(r.state, { adminId: 'org_new_adm', userId: 'acct_new', name: 'New Admin', at: AT, token: 'tok_org_new' })).state;
    expect(joined.data.organizations.find((o) => o.id === 'org_new')!.onboarding).toBe('complete');
  });

  it('allows one level only, one parent per organization, and refuses roles without the permission', () => {
    const s = createInitialState(new Date());
    expect(canHaveSubOrganizations(s, ORG_B1)).toBe(false);
    expect(create(as('acct_demo_b1_admin', s), ORG_B1)).toMatchObject({ ok: false, error: expect.stringMatching(/can’t have sub-organizations/) });
    // A new sub-organization is always a new organization: an existing one is never reassigned.
    const once = ok(create(as('acct_demo_b_admin', s), ORG_B)).state;
    expect(create(as('acct_demo_b_admin', once), ORG_B, {}, 'org_new')).toMatchObject({ ok: false });
    expect((once.data.organizationRelationships).filter((r) => r.childOrganizationId === 'org_new')).toHaveLength(1);
    // Verifier and Auditor can't create organizations; the Auditor may view them.
    expect(permissionsFor(['verifier']).has('organizations.view')).toBe(false);
    expect(permissionsFor(['auditor']).has('organizations.view')).toBe(true);
    expect(permissionsFor(['auditor']).has('organizations.manage')).toBe(false);
    expect(create(as('acct_demo_b1_verifier', s), ORG_B1)).toMatchObject({ ok: false });
    // Another organization can't be used as the parent from here.
    const b = as('acct_demo_b_admin', s);
    expect(reducer(b, { type: 'organizations/createSub', organizationId: ORG_A, input: { parentOrganizationId: ORG_A, ids: { organizationId: 'x', administratorId: 'y', relationshipId: 'z' }, token: 't', values: values(), at: AT } })).toBe(b);
  });

  it('refuses duplicate administrators and resends invalidate the earlier link', () => {
    const s = as('acct_demo_b_admin');
    expect(create(s, ORG_B, { adminEmail: persona('acct_demo_b1_admin').email })).toMatchObject({ ok: false, error: expect.stringMatching(/another organization/) });
    const r = ok(create(s, ORG_B)).state;
    const again = ok(applyResendSubOrganizationInvite(r, { organizationId: ORG_B, childOrganizationId: 'org_new', token: 'tok_2', at: AT })).state;
    expect(invitationByToken(again, 'tok_org_new')).toBeUndefined();
    expect(invitationByToken(again, 'tok_2')).toMatchObject({ organizationId: 'org_new', status: 'invited' });
  });

  it('keeps sub-organizations’ records private from their parent and siblings', () => {
    const s = as('acct_demo_b_admin');
    expect(actorPermissions(s, ORG_B1).size).toBe(0);
    expect(subOrganization(s, ORG_B2, ORG_B1)).toBeUndefined();
    // A change aimed at B1's records is refused from B.
    const member = s.data.members.find((m) => m.organizationId === ORG_B1 && m.status === 'active')!;
    expect(reducer(s, { type: 'users/status', input: { organizationId: ORG_B1, memberId: member.id, status: 'inactive', at: AT } })).toBe(s);
    // B2's administrator can't change B1 either.
    const b2 = as('acct_demo_b2_admin');
    expect(reducer(b2, { type: 'users/status', input: { organizationId: ORG_B1, memberId: member.id, status: 'inactive', at: AT } })).toBe(b2);
  });
});

describe('demonstration accounts and role-specific experiences', () => {
  it('Organization Admin of an organization with sub-organizations: lists them, sees details, not records', async () => {
    const { user } = renderApp('/signin');
    await signInAs(user, 'Organization Admin — owns a shared activity');
    expect(await workspace()).toHaveTextContent('Meridian Group');
    expect(screen.getByRole('region', { name: 'Workspace' })).toHaveTextContent('Organization Admin');
    // A single membership: no switcher.
    expect(within(screen.getByRole('region', { name: 'Workspace' })).queryByRole('combobox')).toBeNull();
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Organizations' }));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Organization Name', 'Organization ID', 'Administrator', 'Status', 'Date Created', 'Actions']);
    expect(within(table).getByRole('row', { name: /Meridian Harbourside/ })).toHaveTextContent('Lina Ford');
    await user.type(screen.getByRole('searchbox', { name: 'Search organizations' }), 'eastgate');
    expect(within(table).queryByText('Meridian Harbourside')).toBeNull();
    await user.click(within(table).getByRole('link', { name: 'Meridian Eastgate' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Meridian Eastgate' })).toBeInTheDocument();
    expect(screen.getByLabelText('Relationship')).toHaveTextContent('Parent organizationMeridian Group');
    expect(screen.getByText(/Being its parent doesn’t give access to them/)).toBeInTheDocument();
  }, 20_000);

  it('creates a sub-organization end to end and its invited administrator activates it', async () => {
    const first = renderApp('/signin');
    await signInAs(first.user, 'Organization Admin — independent organization');
    expect(await workspace()).toHaveTextContent('Northbridge Group');
    await first.user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Organizations' }));
    expect(await screen.findByText('No sub-organizations yet')).toBeInTheDocument();
    await first.user.click(screen.getAllByRole('button', { name: 'Create Organization' })[0]);
    const drawer = screen.getByRole('dialog', { name: 'Create organization' });
    // No organization-type choice; required fields are validated.
    expect(within(drawer).queryByText(/type/i)).toBeNull();
    await first.user.click(within(drawer).getByRole('button', { name: 'Create Organization' }));
    expect(within(drawer).getByText('Enter the organization name.')).toBeInTheDocument();
    expect(within(drawer).getByText('Enter an email address.')).toBeInTheDocument();
    await first.user.type(within(drawer).getByLabelText(/Organization Name/), 'Northbridge Medical School');
    await first.user.type(within(drawer).getByLabelText(/Initial Administrator Email/), 'dean.office@nbmed.example');
    await first.user.click(within(drawer).getByRole('button', { name: 'Create Organization' }));
    const done = await screen.findByRole('dialog', { name: 'Organization created' });
    expect(done).toHaveTextContent('Simulated delivery: no email was sent');
    const link = (within(done).getByLabelText('Invitation link') as HTMLInputElement).value;
    await first.user.click(within(done).getByRole('button', { name: 'Done' }));
    const row = screen.getByRole('row', { name: /Northbridge Medical School/ });
    expect(row).toHaveTextContent('Awaiting administrator');
    expect(row).toHaveTextContent('Invitation pending');
    first.unmount();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...loadAuth(), session: null }));

    const second = renderApp(new URL(link).pathname, loadState()!);
    expect(await screen.findByRole('heading', { level: 1, name: 'Join Northbridge Medical School' })).toBeInTheDocument();
    await second.user.type(screen.getByLabelText(/Full name/), 'Dana Wells');
    await second.user.type(screen.getByLabelText('Create password'), 'Joining2026!');
    await second.user.type(screen.getByLabelText('Confirm password'), 'Joining2026!');
    await second.user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await workspace()).toHaveTextContent('Northbridge Medical School');
    expect(screen.getByRole('region', { name: 'Workspace' })).toHaveTextContent('Sub-organization of Northbridge Group');
    const saved = loadState()!;
    const org = saved.data.organizations.find((o) => o.name === 'Northbridge Medical School')!;
    expect(org.onboarding).toBe('complete');
    // The new sub-organization's administrator sees its parent, and can't create nested organizations.
    await second.user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Organizations' }));
    expect(await screen.findByLabelText('Parent relationship')).toHaveTextContent('Northbridge Group');
    expect(screen.queryByRole('button', { name: 'Create Organization' })).toBeNull();
  }, 30_000);

  it('Sub-organization Admin and sibling isolation by direct URL', async () => {
    const { user } = renderApp('/signin');
    await signInAs(user, 'Sub-organization Admin (B2)');
    expect(await workspace()).toHaveTextContent('Meridian Eastgate');
    const b1Member = createInitialState(new Date()).data.members.find((m) => m.organizationId === ORG_B1)!;
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Users' }));
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    expect(screen.queryByText(b1Member.displayName)).toBeNull();
  }, 20_000);

  it('Verifier: assigned activities only', async () => {
    const { user } = renderApp('/signin');
    await signInAs(user, 'Verifier');
    expect(await workspace()).toHaveTextContent('Meridian Harbourside');
    expect(screen.getByRole('region', { name: 'Workspace' })).toHaveTextContent('Verifier');
    expect(navLinks()).toEqual(['Dashboard', 'My Verification Activities', 'My Verification History']);
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'My Verification Activities' }));
    expect(await screen.findByText('Visitor Identity Check')).toBeInTheDocument();
    expect(screen.getByText('Annual Staff Conference')).toBeInTheDocument();
    expect(screen.queryByText('Membership Verification')).toBeNull();
  }, 20_000);

  it('Auditor: read-only, can view organizations but not create, no Security', async () => {
    const { user } = renderApp('/signin');
    await signInAs(user, 'Auditor');
    expect(await workspace()).toHaveTextContent('Northbridge Group');
    expect(navLinks()).toEqual(['Dashboard', 'Users', 'Groups', 'Credentials', 'Verification Activities', 'Verification History', 'Exceptions', 'Reports', 'Organizations', 'Audit Log', 'Settings']);
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Organizations' }));
    expect(await screen.findByText('No sub-organizations yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Organization' })).toBeNull();
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Settings' }));
    expect((await screen.findAllByRole('tab')).map((t) => t.textContent)).toEqual(['Organization', 'Administrators & Roles', 'Integrations']);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  }, 20_000);

  it('custom role: only its configured permissions', async () => {
    const { user } = renderApp('/signin');
    await signInAs(user, 'Custom role (Records Officer)');
    expect(await workspace()).toHaveTextContent('Records Officer');
    expect(navLinks()).toEqual(['Dashboard', 'Users', 'Groups']);
  }, 20_000);

  it('Platform Administrator: a separate platform overview with organization metadata only', async () => {
    const { user } = renderApp('/signin');
    await signInAs(user, 'Platform Administrator');
    expect(await screen.findByRole('heading', { level: 1, name: 'Platform overview' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Organization relationships' })).toHaveTextContent('Meridian Harboursideis a sub-organization ofMeridian Group');
    expect(screen.getAllByRole('table')[0]).toHaveTextContent('Meridian Eastgate');
    expect(screen.queryByText(/@harbourside\.example/)).toBeNull();
    // Workspace pages aren't available to the platform account.
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument();
  }, 20_000);

  it('the multi-workspace account switches only between explicit memberships, without carrying data over', async () => {
    const { user } = renderApp('/users', createInitialState(new Date()), 'demo');
    const ws = await workspace();
    const options = within(ws).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(['Northbridge Group', 'Meridian Group']));
    expect(options.some((o) => /Harbourside|Eastgate/.test(o ?? ''))).toBe(false);
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    const northbridgePerson = createInitialState(new Date()).data.members.find((m) => m.organizationId === ORG_A && m.status === 'active')!;
    await user.selectOptions(within(ws).getByRole('combobox', { name: 'Switch organization' }), 'Meridian Group');
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Workspace' })).getByRole('combobox')).toHaveDisplayValue('Meridian Group'));
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Users' }));
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    expect(screen.queryByText(northbridgePerson.displayName)).toBeNull();
    // Meridian's Organizations page lists its sub-organizations, but switching never offers them.
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Organizations' }));
    expect(await screen.findByText('Meridian Harbourside')).toBeInTheDocument();
  }, 20_000);

  it('a parent administrator can’t open a sub-organization’s records or a non-child organization by URL', async () => {
    const s = createInitialState(new Date());
    const b1Member = s.data.members.find((m) => m.organizationId === ORG_B1)!;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId: 'acct_demo_b_admin' } }));
    const a = renderApp(`/users/${b1Member.id}`, s);
    await workspace();
    expect(screen.queryByText(b1Member.displayName)).toBeNull();
    a.unmount();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId: 'acct_demo_b2_admin' } }));
    renderApp(`/organizations/${ORG_B1}`, s);
    expect(await screen.findByRole('heading', { name: 'Organization not available' }, { timeout: 4000 })).toBeInTheDocument();
  }, 20_000);
});

describe('direct URLs respect roles', () => {
  it('a Verifier is refused Settings and Organizations by direct link', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId: 'acct_demo_b1_verifier' } }));
    const a = renderApp('/settings');
    expect(await screen.findByRole('heading', { name: "You don't have access to this page" }, { timeout: 4000 })).toBeInTheDocument();
    a.unmount();
    renderApp('/organizations');
    expect(await screen.findByRole('heading', { name: "You don't have access to this page" }, { timeout: 4000 })).toBeInTheDocument();
  });
});
