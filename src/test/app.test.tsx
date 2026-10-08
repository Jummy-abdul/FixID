import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { NAVIGATION } from '@/layout/navigation';
import { loadState } from '@/store/persistence';
import { createInitialState } from '@/store/state';

function renderApp(path = '/') {
  const state = createInitialState(new Date());
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { state, user: userEvent.setup() };
}

beforeEach(() => localStorage.clear());

describe('navigation', () => {
  const items = NAVIGATION.flatMap((g) => g.items);
  const headings: Record<string, RegExp> = {
    '/': /good (morning|afternoon|evening)/i, '/users': /^users$/i, '/groups': /^groups$/i, '/credentials': /^credentials$/i,
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
    const { user } = renderApp('/users');
    const before = localStorage.getItem('fixid.prototype.state');
    await user.click(screen.getAllByRole('button', { name: /add person & issue/i })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Planned · Milestone 2/)).toBeInTheDocument();
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
    await waitFor(() => expect(loadState()?.data.organizations[0].name).toBe('Northbridge University of Technology'));
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
