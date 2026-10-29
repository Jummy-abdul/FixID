import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_SESSION, DEV_VERIFICATION_CODE, loadAuth } from '@/auth/authCore';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { canGrantRoles, permissionsFor } from '@/domain/roles';
import {
  adminsOf, applyAcceptInvite, applyExpireInvite, applyInvite as applyInviteRaw, applyResendInvite, applySetAdminStatus, applySetRoles, invitationByToken, invitationExpired,
  normalizeAdministrators, type InviteInput,
} from '@/store/adminOps';
import { LEGACY_ROLE_TEMPLATES } from '@/domain/roles';
import { loadState } from '@/store/persistence';
import { authorizeAction, createInitialState, reducer, type AppState } from '@/store/state';
import { withExampleCustomRoles } from './helpers/roles';

const AT = new Date().toISOString();
const HOUR = 3_600_000;

/** Invites with a name and link token unless a test gives them. */
let tokens = 0;
const applyInvite = (s: AppState, input: Omit<InviteInput, 'name' | 'token'> & Partial<Pick<InviteInput, 'name' | 'token'>>) =>
  applyInviteRaw(s, { name: 'Invited Person', token: `tok_${++tokens}`, ...input });

/** Gives an organization the former built-in Credential Manager as its own custom role (as established organizations have). */
function withCredentialManager(s: AppState, org: string): AppState {
  const t = LEGACY_ROLE_TEMPLATES[0];
  return { ...s, data: { ...s.data, customRoles: [...s.data.customRoles, { ...t, system: false as const, organizationId: org, createdAt: AT, createdBy: 'Test', updatedAt: AT, updatedBy: 'Test' }] } };
}

function sampleState(org = SAMPLE_ORGANIZATION_ID): AppState {
  const s = withExampleCustomRoles(createInitialState(new Date()));
  s.session.currentOrganizationId = org;
  return s;
}

function renderApp(path: string, state: AppState, signedIn = true) {
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} {...(signedIn ? { authSession: DEMO_SESSION } : {})}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}

const rowFor = (text: string) => screen.getByText(text).closest('tr')!;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('administrator rules', () => {
  it('lets only administrators who manage admins invite, and never beyond their own permissions', () => {
    const s = sampleState();
    expect(applyInvite(s, { organizationId: SAMPLE_ORGANIZATION_ID, id: 'a1', email: 'new@example.org', roleIds: ['auditor'], at: AT })).toMatchObject({ ok: true });
    // Act as the Credential Manager.
    const cm = adminsOf(s, SAMPLE_ORGANIZATION_ID).find((a) => a.roleIds.includes('credential-manager') && a.status === 'active')!;
    const asCm: AppState = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: cm.userId! } } };
    expect(applyInvite(asCm, { organizationId: SAMPLE_ORGANIZATION_ID, id: 'a2', email: 'x@example.org', roleIds: ['auditor'], at: AT }))
      .toMatchObject({ ok: false, error: "You don't have permission to do this." });
    expect(canGrantRoles(permissionsFor(['credential-manager']), ['credential-manager'])).toBe(false);
    expect(canGrantRoles(permissionsFor(['organization-admin']), ['verifier'])).toBe(true);
    expect(canGrantRoles(permissionsFor(['verification-manager']), ['verifier'])).toBe(false);
  });

  it('handles duplicate, existing, deactivated and expired invitations', () => {
    const s = sampleState();
    const admins = adminsOf(s, SAMPLE_ORGANIZATION_ID);
    const invite = (email: string) => applyInvite(s, { organizationId: SAMPLE_ORGANIZATION_ID, id: 'x', email, roleIds: ['auditor'], at: AT });
    expect(invite(admins.find((a) => a.status === 'active' && a.name === 'Kwame Mensah')!.email)).toMatchObject({ ok: false, error: 'This person is already an administrator.' });
    expect(invite(admins.find((a) => a.status === 'deactivated')!.email)).toMatchObject({ ok: false, error: expect.stringMatching(/Reactivate/) });
    expect(invite(admins.find((a) => a.name === 'Chidi Eze')!.email)).toMatchObject({ ok: false, error: expect.stringMatching(/pending invitation. Resend/) });
    // An expired invitation stays Invited: it's resent, not duplicated.
    const expired = admins.find((a) => a.name === 'Funmi Adeyemi')!;
    expect(invitationExpired(expired)).toBe(true);
    expect(invite(expired.email.toUpperCase())).toMatchObject({ ok: false, error: expect.stringMatching(/expired. Resend/) });
    // One organization per administrator account: an email with an account or pending invitation elsewhere can't be invited.
    expect(applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'y', email: admins.find((a) => a.name === 'Kwame Mensah')!.email, roleIds: ['auditor'], at: AT }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/another organization/) });
    expect(applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'y', email: admins.find((a) => a.name === 'Chidi Eze')!.email, roleIds: ['auditor'], at: AT }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/another organization/) });
    // Exactly one role, and a full name.
    expect(invite('two@example.org')).toMatchObject({ ok: true });
    expect(applyInvite(s, { organizationId: SAMPLE_ORGANIZATION_ID, id: 'z', email: 'z@example.org', roleIds: ['auditor', 'verifier'], at: AT })).toMatchObject({ ok: false, error: 'Choose one role.' });
    expect(applyInvite(s, { organizationId: SAMPLE_ORGANIZATION_ID, id: 'z', email: 'z@example.org', name: ' ', roleIds: ['auditor'], at: AT })).toMatchObject({ ok: false, error: 'Enter their full name.' });
  });

  it('invitation links expire after 72 hours, work once, and resending invalidates the old link', () => {
    const s = withExampleCustomRoles(createInitialState(new Date()));
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_a', email: 'a@example.org', name: 'Amaka Obi', roleIds: ['verifier'], token: 'first', at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const rec = invitationByToken(invited.state, 'first')!;
    expect(rec).toMatchObject({ status: 'invited', name: 'Amaka Obi', roleIds: ['verifier'] });
    expect(new Date(rec.invitation!.expiresAt).getTime() - new Date(AT).getTime()).toBe(72 * HOUR);
    // Not accepted after expiry.
    const later = new Date(new Date(AT).getTime() + 72 * HOUR + 1000).toISOString();
    expect(applyAcceptInvite(invited.state, { adminId: 'adm_a', userId: 'u1', name: 'Amaka Obi', at: later, token: 'first' })).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    // Resending (here after expiry) issues a new link; the old one stops working.
    const resent = applyResendInvite(invited.state, { organizationId: NEW_ORGANIZATION_ID, adminId: 'adm_a', token: 'second', at: later });
    if (!resent.ok) throw new Error(resent.error);
    expect(invitationByToken(resent.state, 'first')).toBeUndefined();
    expect(applyAcceptInvite(resent.state, { adminId: 'adm_a', userId: 'u1', name: 'Amaka Obi', at: later, token: 'first' })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer valid/) });
    const joined = applyAcceptInvite(resent.state, { adminId: 'adm_a', userId: 'u1', name: 'Amaka Obi', at: later, token: 'second' });
    if (!joined.ok) throw new Error(joined.error);
    expect(adminsOf(joined.state, NEW_ORGANIZATION_ID).find((a) => a.id === 'adm_a')).toMatchObject({ status: 'active', userId: 'u1', roleIds: ['verifier'] });
    // Single use.
    expect(invitationByToken(joined.state, 'second')).toBeUndefined();
    expect(applyAcceptInvite(joined.state, { adminId: 'adm_a', userId: 'u2', name: 'Someone', at: later, token: 'second' })).toMatchObject({ ok: false });
    // An account that already belongs to another organization can't join a second one.
    const other = applyInvite(createInitialState(new Date()), { organizationId: NEW_ORGANIZATION_ID, id: 'adm_b', email: 'b@example.org', roleIds: ['auditor'], token: 'b', at: AT });
    if (!other.ok) throw new Error(other.error);
    const elsewhere = { ...other.state, data: { ...other.state.data, administrators: [...other.state.data.administrators, { ...rec, id: 'x', organizationId: SAMPLE_ORGANIZATION_ID, status: 'active' as const, userId: 'u9', email: 'u9@example.org' }] } };
    expect(applyAcceptInvite(elsewhere, { adminId: 'adm_b', userId: 'u9', name: 'B', at: AT, token: 'b' })).toMatchObject({ ok: false, error: expect.stringMatching(/another organization/) });
    // Simulated expiry (prototype) makes a pending invitation expire now.
    const expired = applyExpireInvite(other.state, { organizationId: NEW_ORGANIZATION_ID, adminId: 'adm_b', at: AT });
    if (!expired.ok) throw new Error(expired.error);
    expect(invitationExpired(adminsOf(expired.state, NEW_ORGANIZATION_ID).find((a) => a.id === 'adm_b')!, new Date(new Date(AT).getTime() + 1))).toBe(true);
    expect(expired.state.data.audit[0]).toMatchObject({ action: 'admin.invitation-expired' });
  });

  it('saved data keeps one role per administrator: Viewer becomes Auditor, Organization Admin wins', () => {
    const s = sampleState();
    const [a, b, c] = adminsOf(s, SAMPLE_ORGANIZATION_ID).filter((x) => x.userId !== s.data.admin.id);
    const legacy: AppState = {
      ...s, session: { ...s.session, previewRoleId: 'viewer' },
      data: { ...s.data, administrators: s.data.administrators.map((x) => (x.id === a.id ? { ...x, roleIds: ['viewer'] } : x.id === b.id ? { ...x, roleIds: ['viewer', 'organization-admin'] } : x.id === c.id ? { ...x, roleIds: ['viewer', 'credential-manager'] } : x)) },
    };
    const n = normalizeAdministrators(legacy);
    const by = (id: string) => n.data.administrators.find((x) => x.id === id)!.roleIds;
    expect([by(a.id), by(b.id), by(c.id)]).toEqual([['auditor'], ['organization-admin'], ['auditor']]);
    expect(n.session.previewRoleId).toBe('auditor');
    expect(n.data.administrators.every((x) => x.roleIds.length === 1)).toBe(true);
    expect(normalizeAdministrators(n)).toBe(n);
  });

  it('protects the last Organization Admin and blocks self-deactivation', () => {
    const s = withExampleCustomRoles(createInitialState(new Date()));
    const owner = adminsOf(s, NEW_ORGANIZATION_ID)[0];
    expect(applySetRoles(s, { organizationId: NEW_ORGANIZATION_ID, adminId: owner.id, roleIds: ['auditor'], at: AT }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/at least one active Organization Admin.*role can’t be changed/) });
    // A second Organization Admin can't remove the only other one's role either when that would leave none.
    const second = { ...owner, id: 'adm_2', userId: 'usr_second', email: 'second@example.org', name: 'Second Admin' };
    const two: AppState = { ...s, data: { ...s.data, administrators: [...s.data.administrators, second] } };
    const demoted = applySetRoles(two, { organizationId: NEW_ORGANIZATION_ID, adminId: second.id, roleIds: ['auditor'], at: AT });
    if (!demoted.ok) throw new Error(demoted.error);
    expect(applySetRoles(two, { organizationId: NEW_ORGANIZATION_ID, adminId: owner.id, roleIds: ['auditor'], at: AT }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/can't remove your own Organization Admin role/) });
    const asSecondOnly: AppState = { ...two, data: { ...two.data, admin: { ...two.data.admin, id: second.userId }, administrators: two.data.administrators.map((a) => (a.id === owner.id ? { ...a, roleIds: ['auditor'] } : a)) } };
    expect(applySetAdminStatus(asSecondOnly, { organizationId: NEW_ORGANIZATION_ID, adminId: owner.id, status: 'deactivated', at: AT })).toMatchObject({ ok: true });
    expect(applySetRoles(asSecondOnly, { organizationId: NEW_ORGANIZATION_ID, adminId: second.id, roleIds: ['auditor'], at: AT })).toMatchObject({ ok: false });
    expect(applySetAdminStatus(s, { organizationId: NEW_ORGANIZATION_ID, adminId: owner.id, status: 'deactivated', at: AT }))
      .toMatchObject({ ok: false, error: "You can't deactivate your own access." });
    // Another administrator can't deactivate the last active Organization Admin either.
    const asOther: AppState = { ...two, data: { ...two.data, admin: { ...two.data.admin, id: second.userId }, administrators: two.data.administrators.map((a) => (a.id === second.id ? { ...a, roleIds: ['custom_admins'] } : a)), customRoles: [...two.data.customRoles, { id: 'custom_admins', organizationId: NEW_ORGANIZATION_ID, name: 'People Admin', description: '', permissions: ['administrators.view', 'administrators.manage'], system: false as const, createdAt: AT, createdBy: 'T', updatedAt: AT, updatedBy: 'T' }] } };
    expect(applySetAdminStatus(asOther, { organizationId: NEW_ORGANIZATION_ID, adminId: owner.id, status: 'deactivated', at: AT })).toMatchObject({ ok: false });
  });

  it('refuses protected changes in the store without the permission', () => {
    const s = sampleState();
    const viewer = adminsOf(s, SAMPLE_ORGANIZATION_ID).find((a) => a.roleIds.includes('auditor'))!;
    const reactivated = applySetAdminStatus(s, { organizationId: SAMPLE_ORGANIZATION_ID, adminId: viewer.id, status: 'active', at: AT });
    if (!reactivated.ok) throw new Error(reactivated.error);
    const asViewer: AppState = { ...reactivated.state, data: { ...reactivated.state.data, admin: { ...s.data.admin, id: viewer.userId! } } };
    expect(authorizeAction(asViewer, 'users/status')).toMatch(/permission/);
    const member = asViewer.data.members.find((m) => m.organizationId === SAMPLE_ORGANIZATION_ID && m.status === 'active')!;
    const after = reducer(asViewer, { type: 'users/status', input: { organizationId: SAMPLE_ORGANIZATION_ID, memberId: member.id, status: 'inactive', at: AT } });
    expect(after).toBe(asViewer);
  });
});

describe('Administrators & Roles', () => {
  it('lists administrators with Full Name, Email, Role, Status and Actions, with search and filters', async () => {
    const { user } = renderApp('/settings', sampleState());
    await user.click(screen.getByRole('tab', { name: 'Administrators & Roles' }));
    expect(await screen.findByText('Kwame Mensah')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Full Name', 'Email', 'Role', 'Status', 'Actions']);
    // The first Organization Admin is listed.
    expect(rowFor('Tobyson TE')).toHaveTextContent('You');
    expect(rowFor('Tobyson TE')).toHaveTextContent('Organization Admin');
    expect(rowFor('Grace Okafor')).toHaveTextContent('Inactive');
    expect(rowFor('Grace Okafor')).toHaveTextContent('Auditor');
    expect(rowFor('Halima Bello')).toHaveTextContent('Verifier');
    // Invited accounts show whether the invitation is pending or expired, without a fourth status.
    expect(rowFor('Chidi Eze')).toHaveTextContent('InvitedPending');
    expect(rowFor('Funmi Adeyemi')).toHaveTextContent('InvitedExpired');
    await user.selectOptions(screen.getByLabelText('Status'), 'invited');
    expect(screen.queryByText('Kwame Mensah')).toBeNull();
    expect(screen.getByText('Funmi Adeyemi')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await user.type(screen.getByRole('searchbox', { name: 'Search administrators' }), 'halima');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    await user.click(within(rowFor('Halima Bello')).getByRole('button', { name: 'Actions for Halima Bello' }));
    await user.click(screen.getByRole('menuitem', { name: 'View Details' }));
    const details = screen.getByRole('dialog', { name: 'Halima Bello' });
    expect(details).toHaveTextContent('Full NameHalima Bello');
    expect(details).toHaveTextContent('RoleVerifier');
    expect(details).toHaveTextContent('StatusActive');
  });

  it('invites an administrator with full name, email and one role; simulated delivery gives a link', async () => {
    const state = sampleState();
    const kwame = adminsOf(state, SAMPLE_ORGANIZATION_ID).find((a) => a.name === 'Kwame Mensah')!;
    const { user } = renderApp('/settings?tab=admins', state);
    await screen.findByRole('cell', { name: 'Kwame Mensah' });
    await user.click(screen.getByRole('button', { name: 'Invite Administrator' }));
    const drawer = screen.getByRole('dialog', { name: 'Invite administrator' });
    await user.click(within(drawer).getByRole('button', { name: 'Send Invitation' }));
    expect(within(drawer).getByText('Enter their full name.')).toBeInTheDocument();
    expect(within(drawer).getByText('Enter an email address.')).toBeInTheDocument();
    expect(within(drawer).getByText('Choose a role.')).toBeInTheDocument();
    await user.type(within(drawer).getByLabelText(/full name/i), 'Ngozi Ade');
    await user.type(within(drawer).getByLabelText(/^email/i), kwame.email.toUpperCase());
    // Single select: system and custom roles.
    for (const name of ['Organization Admin', 'Verifier', 'Auditor', 'Credential Manager', 'Verification Manager']) expect(within(drawer).getByRole('radio', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    await user.click(within(drawer).getByRole('radio', { name: /^Auditor/ }));
    await user.click(within(drawer).getByRole('radio', { name: /^Credential Manager/ }));
    expect(within(drawer).getByRole('radio', { name: /^Auditor/ })).not.toBeChecked();
    await user.click(within(drawer).getByRole('button', { name: 'Send Invitation' }));
    expect(within(drawer).getByText('This person is already an administrator.')).toBeInTheDocument();
    await user.clear(within(drawer).getByLabelText(/^email/i));
    await user.type(within(drawer).getByLabelText(/^email/i), 'ops.lead@example.org');
    expect(drawer).toHaveTextContent('Issue credentials (allowed)');
    await user.click(within(drawer).getByRole('button', { name: 'Send Invitation' }));
    const sent = await screen.findByRole('dialog', { name: 'Invitation created' });
    expect(sent).toHaveTextContent('Simulated delivery: no email was sent');
    const link = (within(sent).getByLabelText('Invitation link') as HTMLInputElement).value;
    expect(link).toMatch(/\/invite\/[0-9a-f]{48}$/);
    await user.click(within(sent).getByRole('button', { name: 'Done' }));
    const row = rowFor('Ngozi Ade');
    expect(row).toHaveTextContent('ops.lead@example.org');
    expect(row).toHaveTextContent('InvitedPending');
    expect(row).toHaveTextContent('Credential Manager');
    const saved = loadState()!;
    expect(saved.data.audit[0]).toMatchObject({ action: 'admin.invited', actor: 'Tobyson TE', organizationId: SAMPLE_ORGANIZATION_ID, resourceType: 'administrator' });
    expect(adminsOf(saved, SAMPLE_ORGANIZATION_ID).find((a) => a.email === 'ops.lead@example.org')).toMatchObject({ name: 'Ngozi Ade', roleIds: ['credential-manager'], status: 'invited' });
  });

  it('changes the role, deactivates with confirmation, reactivates, resends and revokes', async () => {
    const { user } = renderApp('/settings?tab=admins', sampleState());
    await screen.findByText('Kwame Mensah');
    await user.click(within(rowFor('Kwame Mensah')).getByRole('button', { name: 'Actions for Kwame Mensah' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change Role' }));
    const drawer = screen.getByRole('dialog', { name: 'Change role: Kwame Mensah' });
    expect(drawer).toHaveTextContent('Current role: Verification Manager');
    expect(within(drawer).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(within(drawer).getByRole('radio', { name: /^Auditor/ }));
    expect(within(drawer).getByText('Permissions after saving')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Role changed')).toBeInTheDocument();
    expect(rowFor('Kwame Mensah')).toHaveTextContent('Auditor');
    expect(rowFor('Kwame Mensah')).not.toHaveTextContent('Verification Manager');
    expect(loadState()!.data.audit[0]).toMatchObject({
      action: 'admin.roles-changed', summary: "Tobyson TE changed Kwame Mensah's role from Verification Manager to Auditor.", subject: { name: 'Kwame Mensah' },
      changes: [{ field: 'Role', from: 'Verification Manager', to: 'Auditor' }], result: 'success',
    });

    // Cancel leaves the role unchanged.
    await user.click(within(rowFor('Kwame Mensah')).getByRole('button', { name: 'Actions for Kwame Mensah' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change Role' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Change role: Kwame Mensah' })).getByRole('radio', { name: /^Verifier/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(rowFor('Kwame Mensah')).toHaveTextContent('Auditor');

    await user.click(within(rowFor('Kwame Mensah')).getByRole('button', { name: 'Actions for Kwame Mensah' }));
    await user.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
    const confirm = screen.getByRole('dialog', { name: 'Deactivate Kwame Mensah?' });
    expect(confirm).toHaveTextContent('name, email, role and history are kept');
    await user.click(within(confirm).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Kwame Mensah is now inactive')).toBeInTheDocument();
    expect(rowFor('Kwame Mensah')).toHaveTextContent('Inactive');
    expect(rowFor('Kwame Mensah')).toHaveTextContent('Auditor');

    await user.click(within(rowFor('Kwame Mensah')).getByRole('button', { name: 'Actions for Kwame Mensah' }));
    expect(screen.queryByRole('menuitem', { name: 'Change Role' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Reactivate' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Reactivate Kwame Mensah?' })).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(rowFor('Kwame Mensah')).toHaveTextContent('Active'));

    // Resending an expired invitation creates a new pending one.
    await user.click(within(rowFor('Funmi Adeyemi')).getByRole('button', { name: 'Actions for Funmi Adeyemi' }));
    await user.click(screen.getByRole('menuitem', { name: 'Resend Invitation' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Resend invitation?' })).getByRole('button', { name: 'Resend Invitation' }));
    const resent = await screen.findByRole('dialog', { name: 'Invitation resent' });
    await user.click(within(resent).getByRole('button', { name: 'Done' }));
    expect(rowFor('Funmi Adeyemi')).toHaveTextContent('InvitedPending');

    await user.click(within(rowFor('Chidi Eze')).getByRole('button', { name: 'Actions for Chidi Eze' }));
    await user.click(screen.getByRole('menuitem', { name: 'Revoke Invitation' }));
    await user.click(screen.getByRole('button', { name: 'Revoke Invitation' }));
    await waitFor(() => expect(screen.queryByText('Chidi Eze')).toBeNull());
    expect(loadState()!.data.audit.slice(0, 5).map((e) => e.action)).toEqual(['admin.invitation-revoked', 'admin.invitation-resent', 'admin.reactivated', 'admin.deactivated', 'admin.roles-changed']);
  });

  it('protects the last active Organization Admin in the interface', async () => {
    const s = withExampleCustomRoles(createInitialState(new Date()));
    s.session.currentOrganizationId = NEW_ORGANIZATION_ID;
    const { user } = renderApp('/settings?tab=admins', s);
    await screen.findByText('Tobyson TE');
    await user.click(within(rowFor('Tobyson TE')).getByRole('button', { name: 'Actions for Tobyson TE' }));
    expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Change Role' }));
    const drawer = screen.getByRole('dialog', { name: 'Change role: Tobyson TE' });
    await user.click(within(drawer).getByRole('radio', { name: /^Auditor/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(within(drawer).getByRole('alert')).toHaveTextContent('at least one active Organization Admin');
    expect(adminsOf(loadState() ?? s, NEW_ORGANIZATION_ID)[0].roleIds).toEqual(['organization-admin']);
  });

  it('a new organization sees only the three system roles until it creates a custom role, which then becomes selectable', async () => {
    const s = createInitialState(new Date());
    s.session.currentOrganizationId = NEW_ORGANIZATION_ID;
    const { user } = renderApp('/settings?tab=admins&view=roles', s);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual(['Organization Admin: view details', 'Verifier: view details', 'Auditor: view details']);
    expect(screen.queryByRole('button', { name: /^Edit|^Delete/ })).toBeNull();
    expect(screen.getByText(/No custom roles yet/)).toBeInTheDocument();

    // Invite offers only the system roles.
    await user.click(screen.getByRole('tab', { name: 'Administrators' }));
    await user.click(await screen.findByRole('button', { name: 'Invite Administrator' }));
    let drawer = screen.getByRole('dialog', { name: 'Invite administrator' });
    expect(within(drawer).getAllByRole('radio').map((r) => r.closest('label')!.querySelector('span span')!.firstChild!.textContent)).toEqual(['Organization Admin', 'Verifier', 'Auditor']);
    await user.click(within(drawer).getByRole('button', { name: 'Cancel' }));

    // Create one from the empty state.
    await user.click(screen.getByRole('tab', { name: 'Roles & Privileges' }));
    expect(screen.getByText(/No custom roles yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create Custom Role' }));
    const form = screen.getByRole('dialog', { name: 'Create custom role' });
    await user.type(within(form).getByLabelText(/Role name/), 'Records Officer');
    await user.type(within(form).getByLabelText(/Description/), 'Keeps user records up to date.');
    await user.click(within(within(form).getByRole('group', { name: 'Users' })).getByRole('checkbox', { name: 'View users' }));
    await user.click(within(form).getByRole('button', { name: 'Create Role' }));
    const section = await waitFor(() => screen.getAllByRole('row').find((r) => r.textContent?.includes('Records Officer'))!);
    expect(section).toHaveTextContent('Keeps user records up to date.');
    expect(section).toHaveTextContent('Custom');
    expect(within(section).getByRole('button', { name: 'Edit Records Officer' })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Delete Records Officer' })).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'View Records Officer' }));
    expect(within(screen.getByRole('dialog', { name: 'Records Officer' })).getByRole('region', { name: 'Privileges' })).toHaveTextContent('View users');
    await user.click(within(screen.getByRole('dialog', { name: 'Records Officer' })).getByRole('button', { name: 'Edit Role' }));
    expect(within(screen.getByRole('dialog', { name: 'Edit Records Officer' })).getByRole('checkbox', { name: 'View users' })).toBeChecked();
    await user.click(within(screen.getByRole('dialog', { name: 'Edit Records Officer' })).getByRole('button', { name: 'Cancel' }));
    expect(loadState()!.data.customRoles.filter((r) => r.organizationId === NEW_ORGANIZATION_ID)).toEqual([expect.objectContaining({ name: 'Records Officer', organizationId: NEW_ORGANIZATION_ID })]);

    // Now it can be chosen when inviting.
    await user.click(screen.getByRole('tab', { name: 'Administrators' }));
    await user.click(await screen.findByRole('button', { name: 'Invite Administrator' }));
    drawer = screen.getByRole('dialog', { name: 'Invite administrator' });
    expect(within(drawer).getByRole('radio', { name: /^Records Officer/ })).toBeInTheDocument();
  });

  it('shows the three protected system roles and the organization’s custom roles with their permissions', async () => {
    const { user } = renderApp('/settings?tab=admins&view=roles', sampleState());
    const rows = screen.getAllByRole('row').slice(1);
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Role', 'Description', 'Assigned admins', 'Privileges', 'Role type', 'Actions']);
    for (const [name, kind] of [['Organization Admin', 'System'], ['Verifier', 'System'], ['Auditor', 'System'], ['Credential Manager', 'Custom'], ['Verification Manager', 'Custom']]) {
      expect(rows.find((r) => r.textContent?.startsWith(name))).toHaveTextContent(kind);
    }
    // Exactly three system roles; Viewer is gone.
    expect(rows.filter((r) => r.textContent?.includes('System'))).toHaveLength(3);
    expect(rows.some((r) => r.textContent?.startsWith('Viewer'))).toBe(false);
    // The Verifier role holds exactly one privilege, shown with its explanation.
    await user.click(screen.getByRole('button', { name: 'View Verifier' }));
    const details = screen.getByRole('dialog', { name: 'Verifier' });
    const privileges = within(details).getByRole('region', { name: 'Privileges' });
    expect(within(privileges).getAllByRole('listitem').map((li) => li.querySelector('.font-medium')!.textContent)).toEqual(['Perform verifications (assigned activities only)']);
    expect(privileges).toHaveTextContent('only for activities they’re assigned to');
    expect(within(details).queryByRole('button', { name: 'Edit Role' })).toBeNull();
    expect(details).toHaveTextContent('can’t be edited or deleted');
    await user.click(within(details).getAllByRole('button', { name: 'Close' }).at(-1)!);
    // System roles can't be edited or deleted; custom ones can.
    expect(screen.queryByRole('button', { name: 'Edit Verifier' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Organization Admin' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit Credential Manager' })).toBeInTheDocument();
  });
});

async function acceptInvite(user: UserEvent, email: string, first: string, last: string) {
  await screen.findByRole('heading', { level: 1, name: 'Create your FixID account' });
  await user.type(screen.getByLabelText('Email address'), email);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { level: 1, name: 'Check your inbox' });
  await user.click(screen.getByLabelText('Digit 1'));
  await user.paste(DEV_VERIFICATION_CODE);
  await screen.findByRole('heading', { level: 1, name: 'Secure your account' });
  await user.type(screen.getByLabelText('New password'), 'Joining2026!');
  await user.type(screen.getByLabelText('Confirm password'), 'Joining2026!');
  await user.click(screen.getByRole('button', { name: 'Create password' }));
  await screen.findByRole('heading', { level: 1, name: 'What should we call you?' });
  await user.type(screen.getByLabelText(/first name/i), first);
  await user.type(screen.getByLabelText(/last name/i), last);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('invitations, permissions and revoked access', () => {
  it('an invited Credential Manager joins the organization with limited permissions', async () => {
    const s = withCredentialManager(createInitialState(new Date()), NEW_ORGANIZATION_ID);
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_cm', email: 'cm@example.org', roleIds: ['credential-manager'], at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const { user } = renderApp('/signup', invited.state, false);
    await screen.findByRole('heading', { level: 1, name: 'Create your FixID account' });
    await acceptInvite(user, 'cm@example.org', 'Chidi', 'Obi');
    expect(await screen.findByRole('heading', { name: 'Welcome to FixID, Chidi.' }, { timeout: 3000 })).toBeInTheDocument();
    const state = loadState()!;
    expect(adminsOf(state, NEW_ORGANIZATION_ID).find((a) => a.id === 'adm_cm')).toMatchObject({ status: 'active', name: 'Chidi Obi', userId: loadAuth().accounts[0].id });
    expect(state.data.audit[0]).toMatchObject({ action: 'admin.joined', actor: 'Chidi Obi' });

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).queryByRole('link', { name: 'Audit Log' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Verification Events' })).toBeNull();
    await user.click(within(nav).getByRole('link', { name: 'Users' }));
    await screen.findByRole('heading', { level: 1, name: 'Users' });
    expect(screen.queryByRole('link', { name: /add user/i })).toBeNull();
    await user.click(within(nav).getByRole('link', { name: 'Credentials' }));
    expect(await screen.findByRole('button', { name: 'Create credential' })).toBeInTheDocument();
    // No settings or administrator permissions: Settings isn't offered, and its link is refused.
    expect(within(nav).queryByRole('link', { name: 'Settings' })).toBeNull();
  }, 20_000);

  it('blocks direct navigation to screens without permission', async () => {
    const s = withExampleCustomRoles(createInitialState(new Date()));
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_v', email: 'viewer@example.org', roleIds: ['auditor'], at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const first = renderApp('/signup', invited.state, false);
    await acceptInvite(first.user, 'viewer@example.org', 'Vera', 'Eze');
    await screen.findByRole('heading', { name: 'Welcome to FixID, Vera.' }, { timeout: 3000 });
    first.unmount();
    renderApp('/users/new/manual', loadState()!, false);
    expect(await screen.findByRole('heading', { name: "You don't have access to this page" })).toBeInTheDocument();
  }, 20_000);

  it('a Verifier signs up and sees only the focused verifier workspace', async () => {
    const s = withExampleCustomRoles(createInitialState(new Date()));
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_ver', email: 'verifier@example.org', roleIds: ['verifier'], at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const { user } = renderApp('/signup', invited.state, false);
    await acceptInvite(user, 'verifier@example.org', 'Femi', 'Lawal');
    expect(await screen.findByRole('heading', { level: 1, name: 'My Dashboard' }, { timeout: 3000 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Dashboard', 'My Verification Activities', 'My Verification History']);
    expect(screen.getByText(/No activities assigned to you yet/)).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'My Verification Activities' }));
    expect(await screen.findByText('No verification activities assigned to you.')).toBeInTheDocument();
  }, 20_000);

  it('deactivation takes effect for the affected administrator', async () => {
    const s = withExampleCustomRoles(createInitialState(new Date()));
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_x', email: 'x@example.org', roleIds: ['auditor'], at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const first = renderApp('/signup', invited.state, false);
    await acceptInvite(first.user, 'x@example.org', 'Ada', 'Uche');
    await screen.findByRole('heading', { name: 'Welcome to FixID, Ada.' }, { timeout: 3000 });
    const session = loadAuth().session;
    first.unmount();

    // The Organization Admin (demo account) deactivates them.
    const admin = renderApp('/settings?tab=admins', loadState()!);
    await screen.findByText('Ada Uche');
    await admin.user.click(within(rowFor('Ada Uche')).getByRole('button', { name: 'Actions for Ada Uche' }));
    await admin.user.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
    await admin.user.click(within(screen.getByRole('dialog', { name: 'Deactivate Ada Uche?' })).getByRole('button', { name: 'Deactivate' }));
    await screen.findByText('Ada Uche is now inactive');
    admin.unmount();

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...loadAuth(), session }));
    renderApp('/', loadState()!, false);
    expect(await screen.findByRole('heading', { name: 'Your access has been removed' }, { timeout: 3000 })).toBeInTheDocument();
  }, 20_000);

  it('accepts an invitation from its link: organization shown, account set up, workspace opens with the role; the link then stops working', async () => {
    const s = withExampleCustomRoles(createInitialState(new Date()));
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_link', email: 'link@example.org', name: 'Bisi Lawal', roleIds: ['verifier'], token: 'abc123', at: AT });
    if (!invited.ok) throw new Error(invited.error);
    const first = renderApp('/invite/abc123', invited.state, false);
    const org = invited.state.data.organizations.find((o) => o.id === NEW_ORGANIZATION_ID)!;
    expect(await screen.findByRole('heading', { level: 1, name: `Join ${org.name}` })).toBeInTheDocument();
    expect(screen.getByLabelText('Invitation')).toHaveTextContent(`Organization${org.name}Your roleVerifier`);
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Bisi Lawal');
    expect(screen.getByLabelText('Email address')).toHaveValue('link@example.org');
    await first.user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(screen.getByText('Create a password.')).toBeInTheDocument();
    await first.user.type(screen.getByLabelText('Create password'), 'Joining2026!');
    await first.user.type(screen.getByLabelText('Confirm password'), 'Joining2026!');
    await first.user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    // Enters the workspace with the assigned role: the Verifier's focused workspace.
    expect(await screen.findByRole('heading', { level: 1, name: 'My Dashboard' }, { timeout: 3000 })).toBeInTheDocument();
    const saved = loadState()!;
    expect(adminsOf(saved, NEW_ORGANIZATION_ID).find((a) => a.id === 'adm_link')).toMatchObject({ status: 'active', name: 'Bisi Lawal', roleIds: ['verifier'], userId: loadAuth().accounts[0].id });
    expect(loadAuth().accounts[0]).toMatchObject({ email: 'link@example.org', organizationId: NEW_ORGANIZATION_ID, onboarding: 'complete' });
    first.unmount();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...loadAuth(), session: null }));
    // Single use.
    renderApp('/invite/abc123', saved, false);
    expect(await screen.findByRole('heading', { level: 1, name: 'This invitation link isn’t valid' })).toBeInTheDocument();
  }, 20_000);

  it('refuses an expired invitation link', async () => {
    const s = withExampleCustomRoles(createInitialState(new Date()));
    const past = new Date(Date.now() - 73 * HOUR).toISOString();
    const invited = applyInvite(s, { organizationId: NEW_ORGANIZATION_ID, id: 'adm_old', email: 'old@example.org', roleIds: ['auditor'], token: 'old', at: past });
    if (!invited.ok) throw new Error(invited.error);
    renderApp('/invite/old', invited.state, false);
    expect(await screen.findByRole('heading', { level: 1, name: 'This invitation has expired' })).toBeInTheDocument();
    expect(screen.getByText(/Ask an Organization Admin to resend/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
  });

  it('an expired session returns to Sign in with an explanation', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId: 'acct_demo', expiresAt: '2020-01-01T00:00:00.000Z' } }));
    renderApp('/users', createInitialState(new Date()), false);
    expect(await screen.findByText('Your session has expired. Sign in again to continue.')).toBeInTheDocument();
  });
});

describe('saved data from before administrators', () => {
  it('adds administrator records instead of discarding data', () => {
    const s = withExampleCustomRoles(createInitialState(new Date()));
    const owned = { ...s.data.organizations[0], id: 'org_mine', name: 'Mine', ownerAccountId: 'acct_1', contactEmail: 'me@mine.example' };
    const { administrators: _dropped, ...oldData } = { ...s.data, organizations: [...s.data.organizations, owned] };
    const legacy = { ...s, data: oldData };
    localStorage.setItem('fixid.prototype.state', JSON.stringify(legacy));
    const loaded = loadState()!;
    expect(adminsOf(loaded, 'org_mine')).toEqual([expect.objectContaining({ userId: 'acct_1', roleIds: ['organization-admin'], status: 'active', email: 'me@mine.example' })]);
    expect(adminsOf(loaded, SAMPLE_ORGANIZATION_ID).length).toBeGreaterThan(1);
    expect(loaded.data.members).toHaveLength(s.data.members.length);
  });
});
