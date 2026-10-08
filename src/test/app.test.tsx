import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
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
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
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
    '/templates': /^templates$/i, '/activities': /^activities$/i, '/verification-history': /^verification history$/i,
    '/audit': /^audit log$/i, '/settings': /^settings$/i,
  };

  it('has the approved sidebar structure and order', () => {
    expect(NAVIGATION.map((g) => g.label)).toEqual([null, 'User Management', 'Credential Management', 'Verification', 'Administration']);
    expect(items.map((i) => i.label)).toEqual([
      'Dashboard', 'Users', 'Groups', 'Credentials', 'Templates', 'Activities', 'Verification History', 'Audit Log', 'Settings',
    ]);
  });

  it('every sidebar item routes to its page and is highlighted as active', async () => {
    const { user } = renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const item of items) {
      const link = within(nav).getByRole('link', { name: item.label });
      await user.click(link);
      expect(await screen.findByRole('heading', { level: 1, name: headings[item.to] })).toBeInTheDocument();
      expect(link).toHaveAttribute('aria-current', 'page');
    }
  });

  it('keeps the parent item active on nested routes', async () => {
    renderApp('/templates/credential-types');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Templates' })).toHaveClass('bg-white/10');
    expect(await screen.findByText('Student ID')).toBeInTheDocument();
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
        <AppProviders initialState={state}><AppRoutes /></AppProviders>
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
        <AppProviders initialState={state}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    expect(await screen.findByText('This credential was not found')).toBeInTheDocument();
  });
});

describe('top bar', () => {
  it('contains only the App Launcher and the profile avatar', () => {
    renderApp('/');
    const header = screen.getByRole('banner');
    expect(within(header).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(header).queryByText(/northbridge/i)).not.toBeInTheDocument();
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
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['My Profile']);
    await user.click(within(menu).getByRole('menuitem', { name: 'My Profile' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('groups', () => {
  it('is a clearly planned shell that fabricates no groups', async () => {
    const { user } = renderApp('/groups');
    expect(screen.getByText('Groups are not available yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create group/i }));
    expect(within(await screen.findByRole('dialog')).getByText(/Nothing has been changed/)).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  const previewSelect = () => screen.getByLabelText('Dashboard preview (prototype only)');

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
    expect(await screen.findByRole('heading', { level: 1, name: 'Add your first user' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add manually/i })).toHaveAttribute('href', '/users/new/manual');
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('first-ID-issued preview advances the next milestone and enables verification', async () => {
    const { user } = renderApp('/');
    await user.selectOptions(previewSelect(), 'first-time-issued');
    expect(screen.getByRole('heading', { level: 2, name: 'Your first digital ID is live.' })).toBeInTheDocument();
    expect(screen.getByText('1 of 2 complete')).toBeInTheDocument();
    const next = screen.getAllByRole('listitem').find((li) => li.hasAttribute('aria-current'))!;
    expect(next).toHaveTextContent('Set up your first verification activity');
    expect(within(next).getByRole('link', { name: /set up verification/i })).toHaveAttribute('href', '/activities');
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
    expect(screen.getByText(/across Northbridge University today/)).toBeInTheDocument();
  });

  it('links metrics to pre-filtered lists', async () => {
    const { user, state } = renderApp('/');
    await user.click(screen.getByRole('link', { name: /active credentials/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Credentials' })).toBeInTheDocument();
    const active = state.data.credentials.filter((c) => c.organizationId === state.session.currentOrganizationId && c.status === 'active').length;
    expect(screen.getByText(String(active), { selector: 'span.font-medium' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /active/i })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('users', () => {
  it('filters by search and opens a user with their ID Switch identity', async () => {
    const { user, state } = renderApp('/users');
    const member = state.data.members.find((m) => m.organizationId === state.session.currentOrganizationId && m.status === 'active')!;
    await user.type(screen.getByRole('searchbox', { name: /search name/i }), member.displayName);
    await user.click(await screen.findByText(member.displayName, { selector: 'span.font-medium' }));
    expect(await screen.findByRole('heading', { level: 1, name: member.displayName })).toBeInTheDocument();
    expect(screen.getByText('Organization context')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Legal name')).toBeInTheDocument());
    expect(screen.getAllByText(member.idSwitchId).length).toBeGreaterThan(0);
  });

  it('shows an empty state when nothing matches', async () => {
    const { user } = renderApp('/users');
    await user.type(screen.getByRole('searchbox', { name: /search name/i }), 'zzzz-no-one');
    expect(await screen.findByText('No matching people')).toBeInTheDocument();
  });
});

describe('planned features', () => {
  it('are clearly labelled and do not change data', async () => {
    const { user } = renderApp('/templates');
    await waitFor(() => expect(localStorage.getItem('fixid.prototype.state')).not.toBeNull());
    const before = localStorage.getItem('fixid.prototype.state');
    await user.click(screen.getByRole('button', { name: /customize design/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Planned · Milestone 3/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing has been changed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('fixid.prototype.state')).toBe(before);
  });
});

describe('settings', () => {
  it('validates the organization form', async () => {
    const { user } = renderApp('/settings');
    const name = screen.getByLabelText(/organization name/i);
    await user.clear(name);
    await user.type(name, 'X');
    const email = screen.getByLabelText(/contact email/i);
    await user.clear(email);
    await user.type(email, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/at least 3 characters/)).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
  });

  it('saves changes, persists, and records an audit event', async () => {
    const { user } = renderApp('/settings');
    const name = screen.getByLabelText(/organization name/i);
    await user.clear(name);
    await user.type(name, 'Northbridge University of Technology');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Organization profile saved')).toBeInTheDocument();
    expect(screen.getByText(/Configuration for Northbridge University of Technology/)).toBeInTheDocument();
    await waitFor(() => expect(loadState()?.data.organizations.find((o) => o.id === SAMPLE_ORGANIZATION_ID)?.name).toBe('Northbridge University of Technology'));
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Audit Log' }));
    expect(await screen.findByText(/Updated organization profile \(name\)/)).toBeInTheDocument();
  });

  it('checks integration health with a loading state', async () => {
    const { user } = renderApp('/settings?tab=integrations');
    await user.click(screen.getAllByRole('button', { name: /check connection/i })[0]);
    expect(await screen.findByText(/Connected to tenant ids-tenant-nbu-01/)).toBeInTheDocument();
  });

  it('requires confirmation before resetting demo data', async () => {
    const { user } = renderApp('/settings?tab=demo');
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
    const { user } = renderApp('/verification-history?range=30d');
    const rows = await screen.findAllByRole('row');
    await user.click(rows[1]);
    expect(await screen.findByText('How this decision was reached')).toBeInTheDocument();
    for (const step of ['Credential validation', 'Identity match', 'Authorization']) expect(screen.getByText(step)).toBeInTheDocument();
  });
});
