import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { DEMO_ADMIN, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { PERMISSIONS, ROLES, canPerformVerification, editableRuleLayers, permissionsFor } from '@/domain/roles';
import { actorPermissions, actorRecord, adminsOf, applySetRoles } from '@/store/adminOps';
import { loadState, saveState } from '@/store/persistence';
import { PREVIEW_READ_ONLY, authorizeAction, createInitialState, effectivePermissions, reducer, type AppState } from '@/store/state';

const AT = new Date().toISOString();

function sampleState(): AppState {
  const s = createInitialState(new Date());
  s.session.currentOrganizationId = SAMPLE_ORGANIZATION_ID;
  return s;
}

function renderApp(path: string, state: AppState) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('current prototype account', () => {
  it('is an active Organization Admin with every organization permission, in its own organizations only', () => {
    const s = sampleState();
    for (const org of s.data.organizations) {
      const rec = actorRecord(s, org.id)!;
      expect(rec).toMatchObject({ status: 'active', roleIds: ['organization-admin'] });
      expect([...actorPermissions(s, org.id)].sort()).toEqual(PERMISSIONS.map((p) => p.id).filter((p) => p !== 'verification.execute').sort());
    }
    expect(actorPermissions(s, 'org_somewhere_else').size).toBe(0);
  });

  it('restores the Organization Admin role in saved data where it has drifted, without touching others', () => {
    const s = sampleState();
    const mine = actorRecord(s, SAMPLE_ORGANIZATION_ID)!;
    const others = adminsOf(s, SAMPLE_ORGANIZATION_ID).filter((a) => a.id !== mine.id);
    saveState({ ...s, data: { ...s.data, administrators: s.data.administrators.map((a) => (a.id === mine.id ? { ...a, roleIds: ['viewer'] } : a)) } });
    const loaded = loadState()!;
    expect(actorRecord(loaded, SAMPLE_ORGANIZATION_ID)!.roleIds).toEqual(['organization-admin', 'viewer']);
    expect(adminsOf(loaded, SAMPLE_ORGANIZATION_ID).filter((a) => a.id !== mine.id)).toEqual(others);
  });

  it('can open every module', async () => {
    for (const path of ['/', '/users', '/groups', '/credentials', '/activities', '/verification-history', '/settings?tab=admins', '/settings', '/audit']) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppProviders initialState={sampleState()} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
        </MemoryRouter>,
      );
      expect(screen.queryByText("You don't have access to this page")).toBeNull();
      unmount();
    }
  });
});

describe('verification governance and verifiers', () => {
  it('lets only rule managers change organization rules, never platform or governing-authority rules', () => {
    expect(editableRuleLayers(permissionsFor(['organization-admin']))).toEqual(['organization']);
    expect(editableRuleLayers(permissionsFor(['verification-manager']))).toEqual(['organization']);
    expect(editableRuleLayers(permissionsFor(['verifier']))).toEqual([]);
    expect(editableRuleLayers(permissionsFor(['viewer']))).toEqual([]);
    const verifier = ROLES.find((r) => r.id === 'verifier')!;
    expect(verifier.permissions).not.toContain('verification.verifiers.assign');
    expect(verifier.permissions).not.toContain('verification.rules.manage');
  });

  it('authorizes verifiers per assigned activity', () => {
    const base = { status: 'active', roleIds: ['verifier'], verifierActivityIds: ['act_1'] };
    expect(canPerformVerification(base, 'act_1')).toBe(true);
    expect(canPerformVerification(base, 'act_2')).toBe(false);
    expect(canPerformVerification({ ...base, status: 'deactivated' }, 'act_1')).toBe(false);
    expect(canPerformVerification({ ...base, roleIds: ['verification-manager'] }, 'act_1')).toBe(false);
  });
});

describe('Role Preview', () => {
  it('narrows what the screens use and makes the workspace read-only, without changing stored roles', () => {
    const s = sampleState();
    const p = reducer(s, { type: 'preview/start', roleId: 'credential-manager' });
    expect(p.session.previewRoleId).toBe('credential-manager');
    expect(p.data).toBe(s.data);
    expect([...effectivePermissions(p)].sort()).toEqual(['credentials.issue', 'credentials.manage', 'credentials.view', 'groups.view', 'users.view']);
    expect(actorPermissions(p, SAMPLE_ORGANIZATION_ID).has('roles.assign')).toBe(true);
    // Even actions the previewed role could take are refused while previewing.
    expect(authorizeAction(p, 'issuance/issue')).toBe(PREVIEW_READ_ONLY);
    expect(authorizeAction(p, 'admins/roles')).toBe(PREVIEW_READ_ONLY);
    const kwame = adminsOf(p, SAMPLE_ORGANIZATION_ID).find((a) => a.name === 'Kwame Mensah')!;
    expect(reducer(p, { type: 'admins/roles', organizationId: SAMPLE_ORGANIZATION_ID, adminId: kwame.id, roleIds: ['viewer'], at: AT })).toBe(p);
    const stopped = reducer(p, { type: 'preview/stop' });
    expect(stopped.session.previewRoleId).toBeUndefined();
    expect(effectivePermissions(stopped)).toEqual(actorPermissions(s, SAMPLE_ORGANIZATION_ID));
  });

  it('is only available to an active Organization Admin', () => {
    const s = sampleState();
    const cm = adminsOf(s, SAMPLE_ORGANIZATION_ID).find((a) => a.roleIds.includes('credential-manager') && a.status === 'active')!;
    const asCm: AppState = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: cm.userId! } } };
    expect(reducer(asCm, { type: 'preview/start', roleId: 'viewer' })).toBe(asCm);
  });

  it('previews a restricted role from the account menu and exits back to full access', async () => {
    const user = renderApp('/', sampleState());
    await user.click(screen.getByRole('button', { name: `Account menu for ${DEMO_ADMIN.name}` }));
    await user.click(within(screen.getByRole('menu', { name: 'Account' })).getByRole('menuitem', { name: 'Credential Manager' }));
    const banner = await screen.findByRole('region', { name: 'Role preview' });
    expect(banner).toHaveTextContent('Role preview: Credential Manager');
    const nav = screen.getAllByRole('navigation')[0];
    expect(within(nav).queryByRole('link', { name: /Audit Log/ })).toBeNull();
    expect(within(nav).getByRole('link', { name: /Credentials/ })).toBeInTheDocument();
    // Stored roles are untouched.
    expect(actorRecord(loadState()!, SAMPLE_ORGANIZATION_ID)!.roleIds).toEqual(['organization-admin']);

    await user.selectOptions(within(banner).getByLabelText('Preview role'), 'verifier');
    expect(await screen.findByRole('heading', { name: 'This role has no portal access' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('region', { name: 'Role preview' })).getByRole('button', { name: 'Exit preview' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Role preview' })).toBeNull());
    expect(within(screen.getAllByRole('navigation')[0]).getByRole('link', { name: /Audit Log/ })).toBeInTheDocument();
  });

  it('blocks direct navigation to pages the previewed role cannot use', async () => {
    renderApp('/audit', reducer(sampleState(), { type: 'preview/start', roleId: 'credential-manager' }));
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it('shows a read-only role its view of administrators, without management actions', async () => {
    const s = reducer(sampleState(), { type: 'preview/start', roleId: 'viewer' });
    const user = renderApp('/settings?tab=admins', s);
    expect(await screen.findByText('Kwame Mensah')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite Administrator' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(await screen.findByRole('button', { name: 'Invite Administrator' })).toBeInTheDocument();
  });
});

describe('administrative audit records', () => {
  it('show previous and new values in the existing Audit Log', async () => {
    const s = sampleState();
    const kwame = adminsOf(s, SAMPLE_ORGANIZATION_ID).find((a) => a.name === 'Kwame Mensah')!;
    const r = applySetRoles(s, { organizationId: SAMPLE_ORGANIZATION_ID, adminId: kwame.id, roleIds: ['credential-manager'], at: AT });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.data.audit[0]).toMatchObject({ action: 'admin.roles-changed', summary: "Tobyson TE changed Kwame Mensah's role from Verification Manager to Credential Manager." });
    // A refused change records nothing.
    expect(applySetRoles(r.state, { organizationId: SAMPLE_ORGANIZATION_ID, adminId: kwame.id, roleIds: [], at: AT })).toMatchObject({ ok: false });

    const user = renderApp('/audit?area=admin', r.state);
    const row = screen.getByText(/changed Kwame Mensah's role/).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /Details for/ }));
    const drawer = screen.getByRole('dialog', { name: 'Audit event' });
    expect(drawer).toHaveTextContent('Affected administratorKwame Mensah');
    expect(drawer).toHaveTextContent('RolesVerification ManagerCredential Manager');
    expect(drawer).toHaveTextContent('Outcomesuccess');
  });
});
