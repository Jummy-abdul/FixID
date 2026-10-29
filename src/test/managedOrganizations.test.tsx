import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY } from '@/auth/authCore';
import { ALL_PERSONAS, ORG_B, ORG_C } from '@/data/demoPersonas';
import { actorPermissions } from '@/store/adminOps';
import {
  applyAssignOrgMembers, applyLinkOrgActivity, applyManagedOrgStatus, applyRemoveOrgMember, applySaveManagedOrg, managedOrgFor, managedOrgsOf, organizationOfActivity,
} from '@/store/managedOrgOps';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };
const err = (r: { ok: boolean }) => (r as { error?: string }).error;
function as(accountId: string, orgId: string, s = createInitialState(new Date())): AppState {
  const p = ALL_PERSONAS.find((x) => x.accountId === accountId);
  const admin = p ? { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner' as const, organizationIds: [orgId] } : { ...s.data.admin, id: accountId };
  return { ...s, data: { ...s.data, admin }, session: { ...s.session, currentOrganizationId: orgId } };
}
const jordan = (s?: AppState) => as('acct_demo_c_admin', ORG_C, s);
const auditor = (s?: AppState) => as(`${ORG_C}_usr_2`, ORG_C, s);
const RIVERSIDE = 'morg_bw_riverside';
const m = (n: number) => `${ORG_C}_m_${String(n).padStart(3, '0')}`;

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

describe('managed organizations (store)', () => {
  it('demo data covers active, empty and inactive organizations; one user belongs to two', () => {
    const s = createInitialState(new Date());
    const bw = managedOrgsOf(s, ORG_C);
    expect(bw.map((o) => [o.reference, o.status, o.members.length, o.activityIds.length])).toEqual([
      ['ORG-1001', 'active', 5, 2], ['ORG-1002', 'active', 3, 1], ['ORG-1003', 'active', 0, 0], ['ORG-1004', 'inactive', 1, 1],
    ]);
    expect(bw.filter((o) => o.members.some((x) => x.memberId === m(1)))).toHaveLength(2);
    // Every referenced user and activity exists in the same workspace.
    for (const o of [...bw, ...managedOrgsOf(s, ORG_B)]) {
      for (const x of o.members) expect(s.data.members.find((p) => p.id === x.memberId)?.organizationId).toBe(o.organizationId);
      for (const id of o.activityIds) expect(s.data.activityConfigs.find((a) => a.id === id)?.organizationId).toBe(o.organizationId);
    }
  });

  it('creating needs organizations.manage; names are unique; a reference is generated and the change is audited', () => {
    expect(err(applySaveManagedOrg(auditor(), { organizationId: ORG_C, id: 'morg_x', name: 'East Wing', at: AT }))).toMatch(/doesn’t allow/);
    expect(applySaveManagedOrg(jordan(), { organizationId: ORG_C, id: 'morg_x', name: 'riverside campus', at: AT })).toMatchObject({ ok: false, errors: { name: 'An organization with this name already exists.' } });
    const s = ok(applySaveManagedOrg(jordan(), { organizationId: ORG_C, id: 'morg_x', name: ' East Wing ', description: 'New building', at: AT })).state;
    expect(managedOrgFor(s, ORG_C, 'morg_x')).toMatchObject({ name: 'East Wing', reference: 'ORG-1005', status: 'active', createdBy: 'Jordan Blake', members: [], activityIds: [] });
    expect(s.data.audit[0]).toMatchObject({ action: 'managed-organization.created', resourceType: 'managed-organization', resourceId: 'morg_x' });
    // Creating one adds no administrators.
    expect(s.data.administrators).toHaveLength(createInitialState(new Date()).data.administrators.length);
  });

  it('assigning users: existing users only, no duplicates or inactive users, and no privileges granted', () => {
    let s = jordan();
    expect(err(applyAssignOrgMembers(s, { organizationId: ORG_C, id: RIVERSIDE, memberIds: [m(1)], at: AT }))).toMatch(/already assigned/);
    expect(err(applyAssignOrgMembers(s, { organizationId: ORG_C, id: RIVERSIDE, memberIds: [`${ORG_B}_m_002`], at: AT }))).toMatch(/this workspace/);
    expect(err(applyAssignOrgMembers(s, { organizationId: ORG_C, id: 'morg_bw_facilities', memberIds: [m(20)], at: AT }))).toMatch(/inactive/);
    const inactive = s.data.members.find((p) => p.organizationId === ORG_C && p.status === 'inactive');
    if (inactive) expect(err(applyAssignOrgMembers(s, { organizationId: ORG_C, id: RIVERSIDE, memberIds: [inactive.id], at: AT }))).toMatch(/Inactive users/);
    expect(err(applyAssignOrgMembers(auditor(s), { organizationId: ORG_C, id: RIVERSIDE, memberIds: [m(20)], at: AT }))).toMatch(/doesn’t allow/);
    const perms = actorPermissions(s, ORG_C, 'acct_demo_c_admin');
    s = ok(applyAssignOrgMembers(s, { organizationId: ORG_C, id: RIVERSIDE, memberIds: [m(20), m(21)], at: AT })).state;
    expect(managedOrgFor(s, ORG_C, RIVERSIDE)!.members).toHaveLength(7);
    expect(s.data.audit[0]).toMatchObject({ action: 'managed-organization.member-assigned', related: [expect.objectContaining({ id: m(20) }), expect.objectContaining({ id: m(21) })] });
    expect(actorPermissions(s, ORG_C, 'acct_demo_c_admin')).toEqual(perms);
    expect(s.data.administrators.some((a) => a.userId === m(20))).toBe(false);
  });

  it('removing a user removes only the association', () => {
    const before = jordan();
    const s = ok(applyRemoveOrgMember(before, { organizationId: ORG_C, id: RIVERSIDE, memberId: m(1), at: AT })).state;
    expect(managedOrgFor(s, ORG_C, RIVERSIDE)!.members.some((x) => x.memberId === m(1))).toBe(false);
    expect(s.data.members.find((p) => p.id === m(1))).toEqual(before.data.members.find((p) => p.id === m(1)));
    // Still in Northgate Contractors.
    expect(managedOrgFor(s, ORG_C, 'morg_bw_northgate')!.members.some((x) => x.memberId === m(1))).toBe(true);
    expect(s.data.verificationAttempts).toEqual(before.data.verificationAttempts);
  });

  it('activities belong to at most one organization; associating or removing never touches the activity or its records', () => {
    const before = jordan();
    let s = before;
    const lounge = `${ORG_C}_va_restricted_lounge`;
    expect(err(applyLinkOrgActivity(s, { organizationId: ORG_C, id: 'morg_bw_alumni', activityId: lounge, link: true, at: AT }))).toMatch(/already associated with Riverside Campus/);
    const activity = s.data.activityConfigs.find((a) => a.id === lounge);
    s = ok(applyLinkOrgActivity(s, { organizationId: ORG_C, id: RIVERSIDE, activityId: lounge, link: false, at: AT })).state;
    s = ok(applyLinkOrgActivity(s, { organizationId: ORG_C, id: 'morg_bw_alumni', activityId: lounge, link: true, at: AT })).state;
    expect(organizationOfActivity(s, ORG_C, lounge)?.name).toBe('Alumni Relations Office');
    expect(s.data.activityConfigs.find((a) => a.id === lounge)).toEqual(activity);
    expect(s.data.verificationExceptions).toEqual(before.data.verificationExceptions);
  });

  it('deactivating keeps users, activities and records, and blocks new associations; other workspaces are out of reach', () => {
    let s = ok(applyManagedOrgStatus(jordan(), { organizationId: ORG_C, id: RIVERSIDE, status: 'inactive', at: AT })).state;
    expect(managedOrgFor(s, ORG_C, RIVERSIDE)).toMatchObject({ status: 'inactive' });
    expect(managedOrgFor(s, ORG_C, RIVERSIDE)!.members).toHaveLength(5);
    expect(managedOrgFor(s, ORG_C, RIVERSIDE)!.activityIds).toHaveLength(2);
    expect(err(applyAssignOrgMembers(s, { organizationId: ORG_C, id: RIVERSIDE, memberIds: [m(30)], at: AT }))).toMatch(/inactive/);
    s = ok(applyManagedOrgStatus(s, { organizationId: ORG_C, id: RIVERSIDE, status: 'active', at: AT })).state;
    expect(s.data.audit.filter((a) => a.action === 'managed-organization.status-changed')).toHaveLength(2);
    // Brightwater's administrator can't act on Meridian's organizations.
    expect(applyManagedOrgStatus(jordan(), { organizationId: ORG_B, id: 'morg_mg_operations', status: 'inactive', at: AT }).ok).toBe(false);
  });
});

describe('Organizations screens', () => {
  it('lists organizations with search and status filter; the auditor sees them without Create', async () => {
    const user = renderApp('/organizations', createInitialState(new Date()), 'acct_demo_c_admin');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Organization name', 'Reference', 'Status', 'Assigned users', 'Verification activities', 'Created', 'Created by', 'Actions']);
    expect(within(table).getByRole('row', { name: /Riverside Campus/ })).toHaveTextContent('ORG-1001');
    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');
    expect(screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td')!.textContent)).toEqual(['Former Facilities Unit']);
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await user.type(screen.getByLabelText('Search organizations'), 'nope');
    expect(screen.getByText('No organizations match')).toBeInTheDocument();
  });

  it('auditor: read-only', async () => {
    renderApp('/organizations', createInitialState(new Date()), `${ORG_C}_usr_2`);
    expect(await screen.findByRole('row', { name: /Riverside Campus/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Organization' })).toBeNull();
  });

  it('creates an organization, assigns a user, and removes them again', async () => {
    const user = renderApp('/organizations', createInitialState(new Date()), 'acct_demo_c_admin');
    await user.click(await screen.findByRole('button', { name: 'Create Organization' }));
    const form = screen.getByRole('dialog', { name: 'Create organization' });
    await user.click(within(form).getByRole('button', { name: 'Create Organization' }));
    expect(within(form).getByText('Enter the organization’s name.')).toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Organization name/), 'East Wing');
    await user.click(within(form).getByRole('button', { name: 'Create Organization' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'East Wing' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization details')).toHaveTextContent('ORG-1005');

    await user.click(screen.getByRole('tab', { name: /Users/ }));
    await user.click(screen.getByRole('button', { name: 'Assign Users' }));
    const drawer = screen.getByRole('dialog', { name: 'Assign users to East Wing' });
    await user.type(within(drawer).getByLabelText('Search users to assign'), 'Olamide');
    await user.click(within(drawer).getByRole('checkbox', { name: /Olamide Asante/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Assign 1' }));
    expect(await screen.findByRole('row', { name: /Olamide Asante/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Olamide Asante' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No users assigned')).toBeInTheDocument();
    await waitFor(() => expect(loadState()!.data.members.some((p) => p.displayName === 'Olamide Asante')).toBe(true));
  });

  it('the activity and the user pages show their organizations', async () => {
    const s = createInitialState(new Date());
    renderApp(`/verification-activities/${ORG_C}_va_restricted_lounge`, s, 'acct_demo_c_admin');
    expect(await screen.findByRole('link', { name: 'Riverside Campus' })).toHaveAttribute('href', `/organizations/${RIVERSIDE}`);
  });

  it('a user’s page lists both their organizations', async () => {
    renderApp(`/users/${m(1)}`, createInitialState(new Date()), 'acct_demo_c_admin');
    const list = await screen.findByRole('list', { name: 'Organizations' });
    expect(within(list).getAllByRole('link').map((a) => a.textContent)).toEqual(['Riverside Campus', 'Northgate Contractors']);
  });
});
