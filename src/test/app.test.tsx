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
    '/': /good (morning|afternoon|evening)/i, '/people': /^people$/i, '/credentials': /^credentials$/i,
    '/activities': /^verification$/i, '/transactions': /^transactions$/i, '/credential-types': /^credential types$/i,
    '/card-designs': /^card designs$/i, '/audit': /^audit log$/i, '/settings': /^settings$/i,
  };

  it('every primary navigation item routes to a meaningful page', async () => {
    const { user } = renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const item of items) {
      await user.click(within(nav).getByRole('link', { name: item.label }));
      expect(await screen.findByRole('heading', { level: 1, name: headings[item.to] })).toBeInTheDocument();
    }
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

describe('organization context', () => {
  it('switching organization re-scopes the whole app', async () => {
    const { user } = renderApp('/');
    expect(screen.getAllByText('Northbridge University').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /northbridge university/i }));
    await user.click(screen.getByRole('option', { name: /meridian health group/i }));
    expect(await screen.findByText(/across Meridian Health Group today/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Credential Types' }));
    expect(await screen.findByText('Clinical Staff Badge')).toBeInTheDocument();
    expect(screen.queryByText('Student ID')).not.toBeInTheDocument();
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

describe('people', () => {
  it('filters by search and opens a person with their ID Switch identity', async () => {
    const { user, state } = renderApp('/people');
    const member = state.data.members.find((m) => m.organizationId === state.session.currentOrganizationId && m.status === 'active')!;
    await user.type(screen.getByRole('searchbox', { name: /search name/i }), member.displayName);
    await user.click(await screen.findByText(member.displayName, { selector: 'span.font-medium' }));
    expect(await screen.findByRole('heading', { level: 1, name: member.displayName })).toBeInTheDocument();
    expect(screen.getByText('Organization context')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Legal name')).toBeInTheDocument());
    expect(screen.getAllByText(member.idSwitchId).length).toBeGreaterThan(0);
  });

  it('shows an empty state when nothing matches', async () => {
    const { user } = renderApp('/people');
    await user.type(screen.getByRole('searchbox', { name: /search name/i }), 'zzzz-no-one');
    expect(await screen.findByText('No matching people')).toBeInTheDocument();
  });
});

describe('planned features', () => {
  it('are clearly labelled and do not change data', async () => {
    const { user } = renderApp('/people');
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

  it('saves changes, updates the shell, persists, and records an audit event', async () => {
    const { user } = renderApp('/settings');
    const name = screen.getByLabelText(/organization name/i);
    await user.clear(name);
    await user.type(name, 'Northbridge University of Technology');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Organization profile saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /northbridge university of technology/i })).toBeInTheDocument();
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
    const { user } = renderApp('/transactions?range=30d');
    const rows = await screen.findAllByRole('row');
    await user.click(rows[1]);
    expect(await screen.findByText('How this decision was reached')).toBeInTheDocument();
    for (const step of ['Credential validation', 'Identity match', 'Authorization']) expect(screen.getByText(step)).toBeInTheDocument();
  });
});
