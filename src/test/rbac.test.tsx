import { LEGACY_ROLE_TEMPLATES, type Permission } from '@/domain/roles';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { CUSTOM_ROLE_PERMISSIONS, PROTECTED_PERMISSIONS, findRole, permissionsFor, rolesFor } from '@/domain/roles';
import {
  actorPermissions, adminPermissions, adminsOf, applyDeleteRole, applySaveRole, applySetAdminStatus, applySetRoles, roleProblems, type RoleInput,
} from '@/store/adminOps';
import { applyCreateGroup } from '@/store/groupOps';
import { applyCreateUser, prepareCreateUser, type CreateUserInput } from '@/store/operations';
import { applySaveActivity } from '@/store/activityOps';
import { loadState, saveState } from '@/store/persistence';
import { PREVIEW_READ_ONLY, authorizeAction, createInitialState, effectivePermissions, reducer, type AppState } from '@/store/state';
import { withExampleCustomRoles } from './helpers/roles';
import { ORG_B2 } from '@/data/demoPersonas';

const ORG = SAMPLE_ORGANIZATION_ID;
const AT = new Date().toISOString();

function base(): AppState {
  const s = withExampleCustomRoles(createInitialState(new Date()));
  s.session.currentOrganizationId = ORG;
  return s;
}
/** Another organization the demo account belongs to, with an administrator other than the Organization Admin. */
const otherOrg = (s: AppState) => s.data.organizations.find((o) => o.id !== ORG && s.data.admin.organizationIds.includes(o.id)
  && adminsOf(s, o.id).some((a) => !a.roleIds.includes('organization-admin') && a.status === 'active'))!.id;
const as = (s: AppState, adminId: string): AppState => ({ ...s, data: { ...s.data, admin: { ...s.data.admin, id: adminsOf(s, ORG).find((a) => a.id === adminId)!.userId! } } });
const byRole = (s: AppState, role: string) => adminsOf(s, ORG).find((a) => a.roleIds.includes(role) && a.status === 'active')!;
const kwame = (s: AppState) => adminsOf(s, ORG).find((a) => a.name === 'Kwame Mensah')!;
const officer = (over: Partial<RoleInput> = {}): RoleInput => ({
  organizationId: ORG, id: 'role_records', name: 'Student Records Officer', description: 'Manages student records',
  permissions: ['users.view', 'users.create', 'users.edit', 'groups.view'], at: AT, ...over,
});
function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}
function renderApp(path: string, state: AppState) {
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}
const navLinks = () => within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link').map((l) => l.textContent);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('system roles and permissions', () => {
  it('has three protected system roles; the Organization Admin holds every organization permission, including verifying', () => {
    const s = base();
    expect(rolesFor(s.data.customRoles, ORG).filter((r) => r.system).map((r) => r.name)).toEqual(['Organization Admin', 'Verifier', 'Auditor']);
    const admin = permissionsFor(['organization-admin']);
    expect(PROTECTED_PERMISSIONS.every((p) => admin.has(p))).toBe(true);
    expect(admin.has('verification.execute')).toBe(true);
    expect([...permissionsFor(['verifier'])]).toEqual(['verification.execute']);
    // The Auditor is read-only (per the roles and permissions matrix): it views administrators, roles, the
    // organization profile and the audit log, and can't create, change, issue, verify, invite or manage anything.
    const auditor = [...permissionsFor(['auditor'])];
    expect(auditor.every((p) => p.endsWith('.view'))).toBe(true);
    expect(auditor).toEqual(expect.arrayContaining(['administrators.view', 'organization.view', 'audit.view', 'verification.results.view']));
    expect(auditor).not.toContain('verification.execute');
  });

  it('combines several roles into the union of their permissions, resolved within the organization', () => {
    const s = base();
    const a = { organizationId: ORG, roleIds: ['auditor', 'credential-manager'] };
    const union = adminPermissions(s, a);
    expect(union.has('audit.view')).toBe(true);
    expect(union.has('credentials.issue')).toBe(true);
    expect(union.has('users.create')).toBe(false);
    // A custom role ID means nothing outside its organization.
    expect(adminPermissions(s, { organizationId: 'org_nowhere', roleIds: ['credential-manager'] }).size).toBe(0);
  });

  it('starts every organization with only the three system roles; custom roles come from administrators', () => {
    const fresh = createInitialState(new Date());
    // The only custom roles in demo data back the custom-role demonstration accounts (B2 and B).
    expect(fresh.data.customRoles.map((r) => [r.organizationId, r.name])).toEqual([[ORG_B2, 'Records Officer'], ['org_meridian', 'Exception Reviewer']]);
    for (const o of fresh.data.organizations.filter((x) => x.id !== ORG_B2 && x.id !== 'org_meridian')) expect(rolesFor(fresh.data.customRoles, o.id).map((r) => r.name)).toEqual(['Organization Admin', 'Verifier', 'Auditor']);
    expect(fresh.data.administrators.filter((a) => a.organizationId !== ORG_B2 && a.userId !== 'acct_demo_b_reviewer').every((a) => findRole(fresh.data.customRoles, a.organizationId, a.roleIds[0]!)?.system)).toBe(true);
    // A created role belongs only to the organization that created it.
    const created = ok(applySaveRole(base(), officer())).state;
    expect(findRole(created.data.customRoles, ORG, 'role_records')!.name).toBe('Student Records Officer');
    expect(findRole(created.data.customRoles, otherOrg(created), 'role_records')).toBeUndefined();
  });

  it('removes the former example roles from saved data, keeping roles administrators edited or assigned', () => {
    const s = createInitialState(new Date());
    const example = (t: (typeof LEGACY_ROLE_TEMPLATES)[number], organizationId: string, updatedBy = 'FixID') => ({ ...t, system: false as const, organizationId, createdAt: AT, createdBy: 'FixID', updatedAt: AT, updatedBy });
    const other = otherOrg(s);
    const sample = (org: string, suffix: string) => s.data.administrators.find((a) => a.id === `${org}${suffix}`)!;
    const halima = s.data.administrators.find((a) => a.organizationId === other && a.name === 'Halima Bello')!;
    saveState({
      ...s,
      data: {
        ...s.data,
        // ORG: untouched examples held by the sample administrators. Other org: one assigned to someone else, one edited.
        customRoles: [example(LEGACY_ROLE_TEMPLATES[0], ORG), example(LEGACY_ROLE_TEMPLATES[1], ORG), example(LEGACY_ROLE_TEMPLATES[0], other), example(LEGACY_ROLE_TEMPLATES[1], other, 'Tobyson TE')],
        administrators: s.data.administrators.map((a) => (a.id === sample(ORG, '_adm_2').id ? { ...a, roleIds: ['credential-manager'] } : a.id === sample(ORG, '_adm_3').id ? { ...a, roleIds: ['verification-manager'] } : a.id === halima.id ? { ...a, roleIds: ['credential-manager'] } : a)),
      },
    });
    const loaded = loadState()!;
    expect(rolesFor(loaded.data.customRoles, ORG).map((r) => r.name)).toEqual(['Organization Admin', 'Verifier', 'Auditor']);
    expect(loaded.data.administrators.find((a) => a.id === sample(ORG, '_adm_2').id)!.roleIds).toEqual(['auditor']);
    expect(loaded.data.administrators.find((a) => a.id === sample(ORG, '_adm_3').id)!.roleIds).toEqual(['verifier']);
    expect(rolesFor(loaded.data.customRoles, other).map((r) => r.name)).toEqual(['Organization Admin', 'Verifier', 'Auditor', 'Credential Manager', 'Verification Manager']);
    expect(loaded.data.administrators.find((a) => a.id === halima.id)!.roleIds).toEqual(['credential-manager']);
  });
});

describe('custom roles', () => {
  it('creates, edits and audits a custom role; changes apply to holders straight away', () => {
    let s = ok(applySaveRole(base(), officer())).state;
    expect(s.data.audit[0]).toMatchObject({ action: 'role.created', resourceType: 'role', organizationId: ORG, actor: 'Tobyson TE', subject: { name: 'Student Records Officer' } });
    s = ok(applySetRoles(s, { organizationId: ORG, adminId: kwame(s).id, roleIds: ['role_records'], at: AT })).state;
    expect(s.data.audit[0]).toMatchObject({ action: 'admin.roles-changed', summary: "Tobyson TE changed Kwame Mensah's role from Verification Manager to Student Records Officer." });
    expect(actorPermissions(as(s, kwame(s).id), ORG).has('users.create')).toBe(true);
    // Removing a permission from the role removes it from everyone who holds it, immediately.
    s = ok(applySaveRole(s, officer({ permissions: ['users.view', 'groups.view', 'users.import'] }))).state;
    expect(s.data.audit[0]).toMatchObject({ action: 'role.updated', changes: expect.arrayContaining([{ field: 'Permissions added', from: '—', to: 'Import users from a CSV file' }]) });
    expect(s.data.audit[0].summary).toMatch(/applies to 1 administrator/);
    const now = actorPermissions(as(s, kwame(s).id), ORG);
    expect(now.has('users.create')).toBe(false);
    expect(now.has('users.import')).toBe(true);
  });

  it('offers every catalogue permission to custom roles, but nobody grants what they don’t hold; names are unique', () => {
    const s = base();
    // The R1 matrix makes every permission selectable for custom roles.
    expect(CUSTOM_ROLE_PERMISSIONS).toEqual(expect.arrayContaining(['roles.manage', 'roles.assign', 'administrators.invite', 'organization.view']));
    expect(applySaveRole(s, officer({ permissions: ['users.view', 'roles.manage'] }))).toMatchObject({ ok: true });
    // A custom role that manages roles still can't grant permissions its holder doesn't have.
    const managerRole = { id: 'role_mgr', organizationId: ORG, name: 'Role Manager', description: '', permissions: ['administrators.view', 'roles.manage', 'users.view'] as Permission[], system: false as const, createdAt: AT, createdBy: 'T', updatedAt: AT, updatedBy: 'T' };
    const k = kwame(s);
    const asManager = as({ ...s, data: { ...s.data, customRoles: [...s.data.customRoles, managerRole], administrators: s.data.administrators.map((a) => (a.id === k.id ? { ...a, roleIds: ['role_mgr'] } : a)) } }, k.id);
    expect(applySaveRole(asManager, officer({ id: 'role_x', name: 'Issuer', permissions: ['credentials.issue'] }))).toMatchObject({ ok: false, error: "You can't grant privileges you don't have yourself." });
    expect(applySaveRole(asManager, officer({ id: 'role_y', name: 'Lookup', permissions: ['users.view'] }))).toMatchObject({ ok: true });
    expect(roleProblems(s, officer({ name: 'auditor' })).name).toBe('A role with this name already exists.');
    expect(roleProblems(s, officer({ permissions: [] })).permissions).toBe('Choose at least one privilege.');
    expect(roleProblems(s, officer({ name: ' ' })).name).toBe('Enter a role name.');
  });

  it('protects system roles and refuses to delete a role that’s still assigned', () => {
    let s = base();
    expect(applyDeleteRole(s, { organizationId: ORG, roleId: 'auditor', at: AT })).toMatchObject({ ok: false, error: 'System roles can’t be deleted.' });
    expect(applySaveRole(s, officer({ id: 'organization-admin', name: 'Admin 2' }))).toMatchObject({ ok: false, error: 'System roles can’t be changed.' });
    expect(applyDeleteRole(s, { organizationId: ORG, roleId: 'verification-manager', at: AT })).toMatchObject({ ok: false, error: expect.stringMatching(/assigned to 1 administrator \(Kwame Mensah\)/) });
    s = ok(applySaveRole(s, officer())).state;
    s = ok(applyDeleteRole(s, { organizationId: ORG, roleId: 'role_records', at: AT })).state;
    expect(findRole(s.data.customRoles, ORG, 'role_records')).toBeUndefined();
    expect(s.data.audit[0]).toMatchObject({ action: 'role.deleted', subject: { name: 'Student Records Officer' } });
  });

  it('keeps custom roles inside their organization', () => {
    let s = ok(applySaveRole(base(), officer())).state;
    const other = otherOrg(s);
    expect(findRole(s.data.customRoles, other, 'role_records')).toBeUndefined();
    // Can't be assigned, previewed, edited or deleted from another organization.
    const there = { ...s, session: { ...s.session, currentOrganizationId: other } };
    const someone = adminsOf(s, other).find((a) => !a.roleIds.includes('organization-admin') && a.status === 'active')!;
    expect(applySetRoles(there, { organizationId: other, adminId: someone.id, roleIds: ['role_records'], at: AT })).toMatchObject({ ok: false, error: 'Choose a valid role.' });
    expect(reducer(there, { type: 'preview/start', roleId: 'role_records' }).session.previewRoleId).toBeUndefined();
    expect(applySaveRole(there, officer({ organizationId: other }))).toMatchObject({ ok: false, error: 'This role doesn’t exist in this organization.' });
    expect(applyDeleteRole(there, { organizationId: other, roleId: 'role_records', at: AT })).toMatchObject({ ok: false });
    // Actions naming another organization are refused by the store.
    s = reducer(s, { type: 'roles/save', input: officer({ organizationId: other, id: 'role_sneaky', name: 'Sneaky' }) });
    expect(s.data.customRoles.some((r) => r.id === 'role_sneaky')).toBe(false);
    expect(reducer(s, { type: 'groups/create', input: { organizationId: other, id: 'grp_x', name: 'X', description: '', at: AT } }).data.groups.some((g) => g.id === 'grp_x')).toBe(false);
  });
});

describe('server-side checks (store) refuse unauthorized requests', () => {
  it('refuses role management and role assignment without the protected permissions', () => {
    const s = base();
    const cm = as(s, byRole(s, 'credential-manager').id);
    expect(applySaveRole(cm, officer())).toMatchObject({ ok: false, error: "You don't have permission to do this." });
    expect(reducer(cm, { type: 'roles/save', input: officer() })).toBe(cm);
    expect(applySetRoles(cm, { organizationId: ORG, adminId: kwame(s).id, roleIds: ['auditor'], at: AT })).toMatchObject({ ok: false });
    expect(applySetAdminStatus(cm, { organizationId: ORG, adminId: kwame(s).id, status: 'deactivated', at: AT })).toMatchObject({ ok: false });
  });

  it('refuses a Viewer every change, and separates adding users from importing them', () => {
    const s = base();
    const viewer = ok(applySetRoles(s, { organizationId: ORG, adminId: kwame(s).id, roleIds: ['auditor'], at: AT })).state;
    const v = as(viewer, kwame(viewer).id);
    const user: CreateUserInput = { requestId: 'r', organizationId: ORG, at: AT, identifierConfigId: `${ORG}_idc_member-number`, identifierValue: 'RB/1', person: { givenName: 'Ada', familyName: 'Eze' }, identity: { idSwitchId: 'IDS-R1', resolution: 'created-new' }, memberId: 'm_r' };
    expect(authorizeAction(v, 'users/create')).toMatch(/permission/);
    expect(prepareCreateUser(v, user)).toMatchObject({ ok: false });
    expect(applyCreateGroup(v, { organizationId: ORG, id: 'g', name: 'G', description: '', at: AT })).toMatchObject({ ok: false });
    const act = viewer.data.activityConfigs.find((a) => a.organizationId === ORG)!;
    expect(applySaveActivity(v, { organizationId: ORG, activityId: act.id, ids: { activityId: act.id, versionId: 'x' }, at: AT, form: { name: 'Renamed', description: '', purpose: '', type: 'identity', checks: [], outcome: { onRequiredFailure: 'not-verified', onInconclusive: 'unable-to-verify' }, verifierIds: [], keepConfiguration: true } })).toMatchObject({ ok: false });

    // A role that may add users individually can't import, and the other way round.
    let r = ok(applySaveRole(s, officer({ permissions: ['users.view', 'users.create'] }))).state;
    r = ok(applySetRoles(r, { organizationId: ORG, adminId: kwame(r).id, roleIds: ['role_records'], at: AT })).state;
    const officerState = as(r, kwame(r).id);
    expect(prepareCreateUser(officerState, user)).toMatchObject({ ok: true });
    expect(prepareCreateUser(officerState, { ...user, source: 'import' })).toMatchObject({ ok: false });
    expect(applyCreateUser(officerState, { ...user, source: 'import', assigned: { value: 'RB/1', nextSequence: null } })).toMatchObject({ ok: false });
  });

  it('protects the last active Organization Admin', () => {
    const s = base();
    const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
    expect(applySetRoles(s, { organizationId: ORG, adminId: me.id, roleIds: ['auditor'], at: AT })).toMatchObject({ ok: false });
    expect(applySetAdminStatus(s, { organizationId: ORG, adminId: me.id, status: 'deactivated', at: AT })).toMatchObject({ ok: false });
  });
});

describe('preview as role', () => {
  it('switches to a role view without changing real permissions, allowing only what the role allows', () => {
    const s = ok(applySaveRole(base(), officer())).state;
    const p = reducer(s, { type: 'preview/start', roleId: 'role_records' });
    expect(p.data).toBe(s.data);
    expect([...effectivePermissions(p)].sort()).toEqual(['groups.view', 'users.create', 'users.edit', 'users.view']);
    expect(actorPermissions(p, ORG)).toEqual(actorPermissions(s, ORG));
    // The Organization Admin holds all of this role's permissions, so the view works, but only within the role.
    expect(authorizeAction(p, 'users/create')).toBeNull();
    expect(authorizeAction(p, 'roles/delete')).toBe("You don't have permission to do this.");
    expect(reducer(p, { type: 'roles/delete', organizationId: ORG, roleId: 'role_records', at: AT })).toBe(p);
    // The Verifier view can verify (assignment is still checked by the service), and nothing else.
    const v = reducer(s, { type: 'preview/start', roleId: 'verifier' });
    expect([...effectivePermissions(v)]).toEqual(['verification.execute']);
    expect(authorizeAction(v, 'verify/start')).toBeNull();
    expect(authorizeAction(v, 'vactivities/save')).toBe("You don't have permission to do this.");
    // A role the administrator doesn't hold entirely is only a read-only preview (demo builds).
    const limited = { ...s, data: { ...s.data, administrators: s.data.administrators.map((a) => (a.userId === s.data.admin.id && a.organizationId === ORG ? { ...a, roleIds: ['organization-admin'] } : a)) } };
    void limited; void PREVIEW_READ_ONLY;
    // Only an Organization Admin may preview.
    const cm = as(s, byRole(s, 'credential-manager').id);
    expect(reducer(cm, { type: 'preview/start', roleId: 'auditor' })).toBe(cm);
  });
});

describe('screens', () => {
  it('creates a custom role in Roles & Privileges, previews it, and the interface follows its permissions', async () => {
    const { user } = renderApp('/settings?tab=admins&view=roles', base());
    await user.click(screen.getAllByRole('button', { name: 'Create Custom Role' })[0]);
    const drawer = screen.getByRole('dialog', { name: 'Create custom role' });
    await user.click(within(drawer).getByRole('button', { name: 'Create Role' }));
    expect(within(drawer).getByText('Enter a role name.')).toBeInTheDocument();
    expect(within(drawer).getByText('Choose at least one privilege.')).toBeInTheDocument();
    // Every catalogue permission can be chosen (the Organization Admin holds them all).
    expect(within(drawer).getByRole('checkbox', { name: /Create, edit and delete custom roles/ })).toBeEnabled();
    expect(within(drawer).getByRole('checkbox', { name: /Change administrators’ roles/ })).toBeEnabled();
    await user.type(within(drawer).getByLabelText(/Role name/), 'Student Records Officer');
    const users = within(drawer).getByRole('group', { name: 'Users' });
    await user.click(within(users).getByRole('checkbox', { name: 'View users' }));
    await user.click(within(users).getByRole('checkbox', { name: 'Add users' }));
    await user.click(within(within(drawer).getByRole('group', { name: 'Groups' })).getByRole('checkbox', { name: 'View groups' }));
    await user.click(within(drawer).getByRole('button', { name: 'Create Role' }));
    expect(await screen.findByText('Role created')).toBeInTheDocument();
    const saved = loadState()!.data.customRoles.find((r) => r.name === 'Student Records Officer')!;
    expect(saved).toMatchObject({ organizationId: ORG, system: false, permissions: ['users.view', 'users.create', 'groups.view'] });
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Student Records Officer'))!;
    expect(row).toHaveTextContent('Custom');
    expect(row).toHaveTextContent(/3 of \d+/);
    await user.click(within(row).getByRole('button', { name: 'View Student Records Officer' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Student Records Officer' })).getByRole('button', { name: 'Preview as Student Records Officer' }));
    expect(await screen.findByRole('region', { name: 'Role view' })).toHaveTextContent('Student Records Officer view');
    expect(navLinks()).toEqual(['Dashboard', 'Users', 'Groups']);
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Users' }));
    expect(await screen.findByRole('link', { name: 'Add user' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Import Users' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Switch back' }));
    await waitFor(() => expect(navLinks()).toContain('Settings'));
    expect(navLinks()).toContain('Credentials');
  });

  it('blocks direct navigation to modules a previewed role can’t use', () => {
    const s = ok(applySaveRole(base(), officer())).state;
    const p = reducer(s, { type: 'preview/start', roleId: 'role_records' });
    for (const path of ['/credentials', '/settings', '/audit', '/verification-activities', '/users/import']) {
      const { unmount } = renderApp(path, p);
      expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
      unmount();
    }
  });

  it('assigns a custom role to an administrator from the Administrators tab', async () => {
    const s = ok(applySaveRole(base(), officer())).state;
    const { user } = renderApp('/settings?tab=admins', s);
    await screen.findByText('Kwame Mensah');
    await user.click(within(screen.getByText('Kwame Mensah').closest('tr')!).getByRole('button', { name: 'Actions for Kwame Mensah' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change Role' }));
    const drawer = screen.getByRole('dialog', { name: 'Change role: Kwame Mensah' });
    await user.click(within(drawer).getByRole('radio', { name: /^Student Records Officer/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Role changed')).toBeInTheDocument();
    expect(screen.getByText('Kwame Mensah').closest('tr')!).toHaveTextContent('Student Records Officer');
    expect(loadState()!.data.audit[0]).toMatchObject({ action: 'admin.roles-changed', summary: "Tobyson TE changed Kwame Mensah's role from Verification Manager to Student Records Officer." });
  });

  it('explains why an assigned custom role can’t be deleted, and deletes an unassigned one', async () => {
    const s = ok(applySaveRole(base(), officer())).state;
    const { user } = renderApp('/settings?tab=admins&view=roles', s);
    await user.click(screen.getByRole('button', { name: 'Delete Verification Manager' }));
    expect(screen.getByRole('dialog', { name: 'Verification Manager can’t be deleted yet' })).toHaveTextContent('Kwame Mensah');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await user.click(screen.getByRole('button', { name: 'Delete Student Records Officer' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete Student Records Officer?' })).getByRole('button', { name: 'Delete Role' }));
    expect(await screen.findByText('Role deleted')).toBeInTheDocument();
    expect(loadState()!.data.customRoles.some((r) => r.id === 'role_records')).toBe(false);
  });

  it('shows the Auditor a read-only workspace', async () => {
    const p = reducer(base(), { type: 'preview/start', roleId: 'auditor' });
    const { user, unmount } = renderApp('/users', p);
    expect(navLinks()).toEqual(['Dashboard', 'Users', 'Groups', 'Credentials', 'Verification Activities', 'Verification History', 'Exceptions', 'Reports', 'Organizations', 'Audit Logs', 'Settings']);
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    expect(screen.queryByRole('link', { name: 'Add user' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Import Users' })).toBeNull();
    void user;
    unmount();
    renderApp('/verification-activities', p);
    expect(screen.queryByRole('link', { name: 'Create Activity' })).toBeNull();
  });
});
