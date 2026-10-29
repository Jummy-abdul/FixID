import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { NAVIGATION } from '@/layout/navigation';
import { loadState } from '@/store/persistence';
import { createInitialState } from '@/store/state';

/** Most module tests use the established sample organization; first-time tests pass the new one. */
function renderApp(path = '/', organizationId = SAMPLE_ORGANIZATION_ID) {
  const state = createInitialState(new Date());
  state.session.currentOrganizationId = organizationId;
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { state, user: userEvent.setup() };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('navigation', () => {
  const items = NAVIGATION.flatMap((g) => g.items);
  const headings: Record<string, RegExp> = {
    '/': /^dashboard$|good (morning|afternoon|evening)/i, '/users': /^users$/i, '/groups': /^groups$/i, '/credentials': /^credentials$/i,
    '/verification-activities': /^verification activities$/i, '/verification-history': /^verification history$/i,
    '/audit': /^audit logs$/i, '/settings': /^settings$/i,
  };

  it('has the approved sidebar structure and order', () => {
    expect(NAVIGATION.map((g) => g.label)).toEqual([null, 'User Management', 'Credential Management', 'Verification', 'Organizations', 'Administration']);
    expect(items.map((i) => i.label)).toEqual([
      'Dashboard', 'Users', 'Groups', 'Credentials', 'Verification Activities', 'My Verification Activities', 'Verification History', 'Exceptions', 'Reports', 'My Verification History', 'Organizations', 'Audit Logs', 'Settings',
    ]);
  });

  it('every sidebar item an Organization Admin can use routes to its page and is highlighted as active', async () => {
    const { user } = renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    // Performing verifications is the Verifier's job, so the verifier workspace items aren't shown.
    expect(within(nav).queryByRole('link', { name: 'My Verification Activities' })).toBeNull();
    for (const item of items.filter((i) => i.permission !== 'verification.execute')) {
      const link = within(nav).getByRole('link', { name: item.label });
      await user.click(link);
      expect(await screen.findByRole('heading', { level: 1, name: headings[item.to] })).toBeInTheDocument();
      expect(link).toHaveAttribute('aria-current', 'page');
    }
  });

  it('keeps the parent item active on nested routes, with Templates under Credentials', async () => {
    renderApp('/templates/credential-types');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).queryByRole('link', { name: 'Templates' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Credentials' })).toHaveClass('bg-white/10');
    expect(await screen.findByText('Member ID')).toBeInTheDocument();
  });

  it.each([
    ['/people?status=pending', /^users$/i],
    ['/transactions?range=today', /^verification history$/i],
    ['/card-designs', /^templates$/i],
    ['/credential-types', /^templates$/i],
  ])('redirects the previous route %s', async (path, heading) => {
    renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('redirects previous detail links, keeping the id', async () => {
    const state = createInitialState(new Date());
    state.session.currentOrganizationId = SAMPLE_ORGANIZATION_ID;
    const member = state.data.members.find((m) => m.organizationId === state.session.currentOrganizationId)!;
    render(
      <MemoryRouter initialEntries={[`/people/${member.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: member.displayName })).toBeInTheDocument();
  });

  it('shows a not-found state for unknown routes and entities', async () => {
    renderApp('/nowhere');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('shows a not-found state for an entity from another organization', async () => {
    const state = createInitialState(new Date());
    const otherOrgCredential = state.data.credentials.find((c) => c.organizationId !== state.session.currentOrganizationId)!;
    render(
      <MemoryRouter initialEntries={[`/credentials/${otherOrgCredential.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    expect(await screen.findByText('This credential was not found')).toBeInTheDocument();
  });
});

describe('top bar', () => {
  it('shows the workspace context, the App Launcher and the profile avatar', () => {
    renderApp('/');
    const header = screen.getByRole('banner');
    // The current organization and role; a switcher only because this account has several explicit memberships.
    const workspace = within(header).getByRole('region', { name: 'Workspace' });
    expect(within(workspace).getByRole('combobox', { name: 'Switch organization' })).toHaveDisplayValue('Northbridge Group');
    expect(workspace).toHaveTextContent('Organization Admin');
    // Only explicit memberships: no sub-organization of Meridian is offered to this account.
    expect(within(workspace).queryByRole('option', { name: /Harbourside|Eastgate/ })).toBeNull();
    expect(within(header).queryByRole('button', { name: /add person/i })).not.toBeInTheDocument();
    const buttons = within(header).getAllByRole('button').filter((b) => !/navigation/i.test(b.getAttribute('aria-label') ?? ''));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Applications', 'Account menu for Tobyson TE']);
    expect(within(header).getByText('TE')).toBeInTheDocument();
  });

  it('App Launcher lists applications, marks FixID current and supports keyboard and outside dismissal', async () => {
    const { user } = renderApp('/users');
    const trigger = screen.getByRole('button', { name: 'Applications' });
    expect(trigger).toHaveTextContent('');
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Seamfix applications' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => within(i).getAllByText(/./)[0].textContent)).toEqual(['FixID', 'Fixiam', 'Admin']);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(within(menu).getByText('Fixiam navigation is not configured yet.')).toBeInTheDocument();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /fixid/i }));
    expect(await screen.findByRole('heading', { level: 1, name: /good (morning|afternoon|evening)/i })).toBeInTheDocument();
  });

  it('profile menu shows the signed-in user and opens My Profile', async () => {
    const { user } = renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Account menu for Tobyson TE' }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(menu).getByText('Tobyson TE')).toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['My Profile', 'Organization AdminYou', 'Verifier', 'Auditor', 'Sign out']);
    await user.click(within(menu).getByRole('menuitem', { name: 'My Profile' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('dashboard', () => {
  const previewSelect = () => screen.getByLabelText('Dashboard preview');

  it('shows the first-time experience for a new organization with zero metrics and empty states', async () => {
    const { user } = renderApp('/', NEW_ORGANIZATION_ID);
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to FixID, Tobyson.' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /get started/i })).toHaveLength(1);
    const overview = screen.getByRole('region', { name: 'Overview' });
    for (const label of ['Users', 'Active credentials', 'Verification activities', 'Verifications']) {
      expect(within(overview).getByText(label).nextSibling).toHaveTextContent('0');
    }
    expect(screen.getByText('No verifications yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing recorded yet')).toBeInTheDocument();
    expect(screen.getByText('0 of 2 complete')).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('aria-current'));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toHaveTextContent('Add your first user and issue an ID');
    expect(screen.getByRole('button', { name: 'Set up verification' })).toBeDisabled();
    await user.click(within(steps[0]).getByRole('link', { name: /get started/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add manually/i })).toHaveAttribute('href', '/users/new/manual');
  });

  it('first-ID-issued preview advances the next milestone and enables verification', async () => {
    const { user } = renderApp('/');
    await user.selectOptions(previewSelect(), 'first-time-issued');
    expect(screen.getByRole('heading', { level: 2, name: 'Your first digital ID is live.' })).toBeInTheDocument();
    expect(screen.getByText('1 of 2 complete')).toBeInTheDocument();
    const next = screen.getAllByRole('listitem').find((li) => li.hasAttribute('aria-current'))!;
    expect(next).toHaveTextContent('Set up your first verification activity');
    expect(within(next).getByRole('link', { name: /set up verification/i })).toHaveAttribute('href', '/verification-activities');
  });

  it('switches previews without changing organization data', async () => {
    const { user } = renderApp('/');
    await waitFor(() => expect(localStorage.getItem('fixid.prototype.state')).not.toBeNull());
    const before = localStorage.getItem('fixid.prototype.state');
    for (const v of ['active', 'first-time-issued', 'automatic', 'first-time-new']) await user.selectOptions(previewSelect(), v);
    expect(localStorage.getItem('fixid.prototype.state')).toBe(before);
    expect(localStorage.getItem('fixid.prototype.dashboardPreview.v2')).toBe('first-time-new');
  });

  it('defaults to live setup progress (an established organization sees the active dashboard)', () => {
    renderApp('/');
    expect(screen.getByRole('heading', { level: 1, name: /good (morning|afternoon|evening)/i })).toBeInTheDocument();
  });

  it('active preview shows the sample organization for a new organization', async () => {
    const { user } = renderApp('/', NEW_ORGANIZATION_ID);
    await user.selectOptions(previewSelect(), 'active');
    expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveTextContent('Northbridge Group');
  });

  it('links metrics to pre-filtered lists', async () => {
    const { user, state } = renderApp('/');
    await user.click(screen.getByRole('link', { name: /active credentials/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Issued credentials' })).toBeInTheDocument();
    const active = state.data.credentials.filter((c) => c.organizationId === state.session.currentOrganizationId && c.status === 'active').length;
    expect(screen.getByText(String(active), { selector: 'span.font-medium' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /active/i })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('users', () => {
  it('filters by search and opens a user with their profile details', async () => {
    const { user, state } = renderApp('/users');
    const member = state.data.members.find((m) => m.organizationId === state.session.currentOrganizationId && m.status === 'active')!;
    await user.type(screen.getByRole('searchbox', { name: /search name/i }), member.displayName);
    await user.click(await screen.findByRole('link', { name: member.displayName }));
    expect(await screen.findByRole('heading', { level: 1, name: member.displayName })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Profile Details' })).toHaveAttribute('aria-selected', 'true');
    for (const label of ['First Name', 'Last Name', 'Email Address', 'Phone Number', 'Gender', 'Location', 'Identifier Name', 'Identifier Value', 'Date Created', 'Created By']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // No technical identity details for administrators.
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.querySelector('.animate-pulse')).toBeNull());
    expect(main.textContent).not.toMatch(/ID Switch|canonical|simulat/i);
    expect(main.textContent).not.toContain(member.idSwitchId);
  });

  it('shows an empty state when nothing matches', async () => {
    const { user } = renderApp('/users');
    await user.type(screen.getByRole('searchbox', { name: /search name/i }), 'zzzz-no-one');
    expect(await screen.findByText('No matching users')).toBeInTheDocument();
  });
});

describe('planned features', () => {
  it('are clearly labelled and do not change data', async () => {
    const { user } = renderApp('/profile');
    await waitFor(() => expect(localStorage.getItem('fixid.prototype.state')).not.toBeNull());
    const before = localStorage.getItem('fixid.prototype.state');
    await user.click(screen.getByRole('button', { name: /edit profile/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Planned')).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing has been changed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('fixid.prototype.state')).toBe(before);
  });
});

describe('settings', () => {
  it('shows the organization profile read-only, with "Not provided" for optional details', async () => {
    renderApp('/settings');
    const dl = screen.getByLabelText('Organization profile');
    const org = createInitialState().data.organizations.find((o) => o.id === SAMPLE_ORGANIZATION_ID)!;
    for (const [label, value] of [
      ['Organization Name', org.name], ['Short Name', org.shortName], ['Organization Email', org.contactEmail], ['Organization Phone Number', 'Not provided'],
      ['Organization Address', 'Not provided'], ['Country', org.country], ['Time Zone', org.timezone], ['Organization ID', org.id], ['Organization Status', 'Active'],
    ] as const) expect(dl).toHaveTextContent(`${label}${value}`);
    expect(dl).toHaveTextContent('Date Registered');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/Contact email/i)).toBeNull();
  });

  it('validates field by field, and a failed save changes nothing', async () => {
    const { user } = renderApp('/settings');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText(/Organization Name/);
    await user.clear(name);
    await user.type(name, 'X');
    const email = screen.getByLabelText(/Organization Email/);
    await user.clear(email);
    await user.type(email, 'not-an-email');
    await user.type(screen.getByLabelText(/Organization Phone Number/), 'call me');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/at least 2 characters/)).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid phone number/)).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Organization profile saved')).toBeNull();
    // Read-only fields aren't editable.
    for (const ro of [/^Country/, /Organization ID/, /Organization Status/, /Date Registered/]) expect(screen.queryByRole('textbox', { name: ro })).toBeNull();
    // Cancel discards everything.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const org = createInitialState().data.organizations.find((o) => o.id === SAMPLE_ORGANIZATION_ID)!;
    expect(screen.getByLabelText('Organization profile')).toHaveTextContent(`Organization Name${org.name}`);
    expect(screen.getByLabelText('Organization profile')).toHaveTextContent(`Organization Email${org.contactEmail}`);
  });

  it('saves changes, shows them immediately, persists, and records an audit event', async () => {
    const { user } = renderApp('/settings');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText(/Organization Name/);
    await user.clear(name);
    await user.type(name, 'Northbridge Group of Technology');
    await user.type(screen.getByLabelText(/Organization Phone Number/), '+234 801 234 5678');
    await user.type(screen.getByLabelText(/Organization Address/), '12 Marina Road, Lagos');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Organization profile saved')).toBeInTheDocument();
    const view = screen.getByLabelText('Organization profile');
    expect(view).toHaveTextContent('Organization NameNorthbridge Group of Technology');
    expect(view).toHaveTextContent('Organization Phone Number+234 801 234 5678');
    expect(view).toHaveTextContent('Organization Address12 Marina Road, Lagos');
    expect(screen.getByText(/Configuration for Northbridge Group of Technology/)).toBeInTheDocument();
    await waitFor(() => expect(loadState()?.data.organizations.find((o) => o.id === SAMPLE_ORGANIZATION_ID)).toMatchObject({ name: 'Northbridge Group of Technology', phone: '+234 801 234 5678', address: '12 Marina Road, Lagos' }));
    // Other organizations are untouched.
    const other = createInitialState().data.organizations.find((o) => o.id !== SAMPLE_ORGANIZATION_ID)!;
    expect(loadState()!.data.organizations.find((o) => o.id === other.id)).toEqual(other);
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Audit Logs' }));
    expect(await screen.findByText(/Updated organization profile \(name, phone, address\)/)).toBeInTheDocument();
  });

  it('shows Organization, Administrators & Roles, Integrations and Security; Integrations has built-in and custom services', async () => {
    const before = createInitialState().data.organizations.map((o) => o.integrations);
    const { user } = renderApp('/settings?tab=integrations');
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Organization', 'Administrators & Roles', 'Integrations', 'Security']);
    expect(screen.getByRole('tab', { name: 'Integrations' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('FixID Local Verification')).toBeInTheDocument();
    // The earlier hidden panel's built-in service health and demo provider switches are gone; no real provider names.
    for (const gone of [/Identity service$/, /Demonstration verification providers/, /Fixiam/, /check connection/i]) expect(screen.queryByText(gone)).toBeNull();
    // Organization and Administrators & Roles still work; organization configurations are untouched.
    await user.click(screen.getByRole('tab', { name: 'Organization' }));
    expect(screen.getByLabelText('Organization profile')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Administrators & Roles' }));
    expect(await screen.findByRole('button', { name: 'Invite Administrator' })).toBeInTheDocument();
    expect(loadState()?.data.organizations.map((o) => o.integrations) ?? before).toEqual(before);
  });

  it('keeps the demo tools out of Settings navigation but available to the demo account at their address', async () => {
    const { user } = renderApp('/settings?tab=demo');
    expect(screen.queryByRole('tab', { name: 'Demo data' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Reset all demo data?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset demo data' }));
    expect(await screen.findByText('Demo data reset')).toBeInTheDocument();
  });
});

describe('transactions', () => {
  it('opens a transaction and explains the decision pipeline', async () => {
    const { user } = renderApp('/verification-history?range=30d&earlier=1');
    const rows = await screen.findAllByRole('row');
    await user.click(rows[1]);
    expect(await screen.findByText('How this decision was reached')).toBeInTheDocument();
    for (const step of ['Credential validation', 'Identity match', 'Authorization']) expect(screen.getByText(step)).toBeInTheDocument();
  });
});
