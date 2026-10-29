import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY } from '@/auth/authCore';
import { ALL_PERSONAS, ORG_C } from '@/data/demoPersonas';
import { activityLabel, moduleOf } from '@/domain/auditCatalog';
import { applySaveRole } from '@/store/adminOps';
import { applySaveManagedOrg } from '@/store/managedOrgOps';
import { createInitialState, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };
function as(accountId: string, orgId: string, s = createInitialState(new Date())): AppState {
  const p = ALL_PERSONAS.find((x) => x.accountId === accountId)!;
  return { ...s, data: { ...s.data, admin: { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner', organizationIds: [orgId] } }, session: { ...s.session, currentOrganizationId: orgId } };
}
function renderApp(path: string, state: AppState, accountId: string) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
/** Brightwater after Jordan creates a custom role and an organization: real actions, real events. */
function withActions() {
  let s = as('acct_demo_c_admin', ORG_C);
  s = ok(applySaveRole(s, { organizationId: ORG_C, id: 'role_desk', name: 'Front Desk', description: 'Views users.', permissions: ['users.view'], at: AT })).state;
  s = ok(applySaveRole(s, { organizationId: ORG_C, id: 'role_desk', name: 'Front Desk', description: 'Views users.', permissions: ['users.view', 'groups.view'], at: AT })).state;
  s = ok(applySaveManagedOrg(s, { organizationId: ORG_C, id: 'morg_new', name: 'East Wing', at: AT })).state;
  return s;
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('audit catalogue', () => {
  it('names activities and modules in plain language', () => {
    expect([activityLabel('role.created'), moduleOf('role.created')]).toEqual(['Administrative role created', 'Roles & Privileges']);
    expect([activityLabel('managed-organization.member-assigned'), moduleOf('managed-organization.member-assigned')]).toEqual(['User assigned to an organization', 'Organizations']);
    expect([activityLabel('exception.proposal-approved'), moduleOf('exception.proposal-approved')]).toEqual(['Exception decision approved', 'Exceptions']);
    expect([activityLabel('verification-activity.verifier-assigned'), moduleOf('verification-activity.verifier-assigned')]).toEqual(['Verifier assigned', 'Verification Activities']);
    expect(moduleOf('admin.invited')).toBe('Administrators');
  });

  it('verification attempts aren’t audit events: they stay in Verification History', () => {
    const s = createInitialState(new Date());
    expect(s.data.verificationAttempts.length).toBeGreaterThan(0);
    expect(s.data.audit.some((e) => ['verification.started', 'verification.completed', 'verification.cancelled'].includes(e.action))).toBe(false);
    // Administrative actions on the seeded cases are recorded.
    expect(s.data.audit.some((e) => e.action === 'exception.proposal-approved')).toBe(true);
  });
});

describe('Audit Logs screen', () => {
  it('shows activity, performer, module, date and details; filters combine and clear', async () => {
    const user = renderApp('/audit', withActions(), 'acct_demo_c_admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Audit Logs' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Activity', 'Performed by', 'Module', 'Date and time', 'Details']);
    await user.selectOptions(screen.getByLabelText('Module'), 'Roles & Privileges');
    await user.selectOptions(screen.getByLabelText('Performed by'), 'Jordan Blake');
    let rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('td .font-medium')!.textContent)).toEqual(['Role privileges updated', 'Administrative role created']);
    await user.selectOptions(screen.getByLabelText('Activity type'), 'role.updated');
    rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    // Details show what changed, before and after.
    await user.click(within(rows[0]).getByRole('button', { name: /Details for/ }));
    const drawer = screen.getByRole('dialog', { name: 'Role privileges updated' });
    expect(drawer).toHaveTextContent('Roles & Privileges');
    expect(drawer).toHaveTextContent('What changed');
    expect(drawer).toHaveTextContent('View groups');
    expect(within(drawer).queryByRole('button', { name: /Edit|Delete/ })).toBeNull();
    await user.click(within(drawer).getAllByRole('button', { name: /Close/ })[0]);
    await user.type(screen.getByLabelText('Search audit logs'), 'nothing like this');
    expect(screen.getByText('No activity matches')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('row').length).toBeGreaterThan(5);
    // Organization Management actions are there too.
    await user.selectOptions(screen.getByLabelText('Module'), 'Organizations');
    expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('Organization created') && r.textContent.includes('East Wing'))).toBe(true);
  });

  it('a date range in the future matches nothing', async () => {
    const user = renderApp('/audit', createInitialState(new Date()), 'acct_demo_c_admin');
    await user.type(await screen.findByLabelText('From date'), '2099-01-01');
    expect(screen.getByText('No activity matches')).toBeInTheDocument();
  });

  it('read-only for the restricted administrator; the verifier has no access', async () => {
    renderApp('/audit', createInitialState(new Date()), `${ORG_C}_usr_2`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Audit Logs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete|Edit/ })).toBeNull();
  });

  it('a verifier can’t open Audit Logs', async () => {
    renderApp('/audit', createInitialState(new Date()), `${ORG_C}_usr_4`);
    expect(await screen.findByRole('heading', { name: "You don't have access to this page" }, { timeout: 4000 })).toBeInTheDocument();
  });
});
