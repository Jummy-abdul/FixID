import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY } from '@/auth/authCore';
import { ORG_B } from '@/data/demoPersonas';
import { PERMISSIONS, PERMISSION_DESCRIPTION, SYSTEM_ROLES } from '@/domain/roles';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

function renderApp(path: string, state: AppState, accountId: string) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

/** Meridian's Exception Reviewer (Sam Rivera), here also allowed to view administrators and manage roles. */
function steward(): AppState {
  const s = createInitialState(new Date());
  return { ...s, session: { ...s.session, currentOrganizationId: ORG_B }, data: { ...s.data, customRoles: s.data.customRoles.map((r) => (r.name === 'Exception Reviewer' ? { ...r, permissions: [...r.permissions, 'administrators.view', 'roles.manage'] } : r)) } };
}

describe('privilege catalogue', () => {
  it('every privilege has a plain-language explanation; organization management is prepared but marked coming soon', () => {
    for (const p of PERMISSIONS) expect(PERMISSION_DESCRIPTION[p.id]?.length).toBeGreaterThan(10);
    expect(PERMISSIONS.filter((p) => p.area === 'Organizations' && p.planned).map((p) => p.id)).toEqual(['organizations.edit', 'organizations.members']);
    expect(PERMISSION_DESCRIPTION['organizations.members']).toMatch(/never grants administrator access/);
    // Only the Organization Admin gets the prepared privileges; Auditor and Verifier don't.
    expect(SYSTEM_ROLES.find((r) => r.id === 'auditor')!.permissions).not.toContain('organizations.members');
  });
});

describe('Roles & Privileges screen', () => {
  it('search and role-type filter narrow the table; an empty result can be cleared', async () => {
    const user = renderApp('/settings?tab=admins&view=roles', createInitialState(new Date()), 'acct_demo_b_admin');
    await user.selectOptions(await screen.findByLabelText('Role type'), 'custom');
    expect(screen.getAllByRole('row').slice(1).every((r) => r.textContent?.includes('Custom'))).toBe(true);
    await user.type(screen.getByLabelText('Search roles'), 'nothing like this');
    expect(screen.getByText('No roles match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('row').length).toBeGreaterThan(3);
  });

  it('role details list the administrators holding it', async () => {
    const user = renderApp('/settings?tab=admins&view=roles', createInitialState(new Date()), 'acct_demo_b_admin');
    await user.click(await screen.findByRole('button', { name: 'View Exception Reviewer' }));
    const details = screen.getByRole('dialog', { name: 'Exception Reviewer' });
    expect(within(details).getByRole('region', { name: 'Assigned administrators' })).toHaveTextContent('Sam Rivera');
    expect(within(details).getByRole('region', { name: 'Privileges' })).toHaveTextContent('Resolve exceptions when approval isn’t required');
  });

  it('selecting a whole module grants only the privileges the signed-in administrator holds', async () => {
    const user = renderApp('/settings?tab=admins&view=roles', steward(), 'acct_demo_b_reviewer');
    await user.click(await screen.findByRole('button', { name: 'Create Custom Role' }));
    const form = screen.getByRole('dialog', { name: 'Create custom role' });
    const exceptions = within(form).getByRole('group', { name: 'Exceptions' });
    expect(within(exceptions).getByRole('checkbox', { name: 'Approve, reject or return proposed exception decisions (never one’s own)' })).toBeDisabled();
    expect(within(form).getByText(/Approve, reject or return another reviewer’s proposed decision. You can’t grant this/)).toBeInTheDocument();
    await user.click(within(exceptions).getByRole('checkbox', { name: 'Select all Exceptions privileges you can grant' }));
    await user.type(within(form).getByLabelText(/Role name/), 'Case Handler');
    await user.click(within(form).getByRole('button', { name: 'Create Role' }));
    await waitFor(() => expect(loadState()?.data.customRoles.some((r) => r.name === 'Case Handler')).toBe(true));
    const saved = loadState()!.data.customRoles.find((r) => r.name === 'Case Handler')!;
    expect([...saved.permissions].sort()).toEqual(['exceptions.resolve', 'exceptions.review', 'exceptions.view']);
    // Users privileges: none can be granted, so the module checkbox is disabled.
    await user.click(screen.getByRole('button', { name: 'Create Custom Role' }));
    expect(within(within(screen.getByRole('dialog', { name: 'Create custom role' })).getByRole('group', { name: 'Users' })).getByRole('checkbox', { name: 'Select all Users privileges you can grant' })).toBeDisabled();
  });
});
