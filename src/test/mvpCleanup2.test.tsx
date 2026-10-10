import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { adminsOf } from '@/store/adminOps';
import { applySaveActivity } from '@/store/activityOps';
import { loadState } from '@/store/persistence';
import { createInitialState, reducer, type AppState } from '@/store/state';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import { createVerificationService } from '@/verification/engine';
import { assign } from './helpers/identity';

const ORG = SAMPLE_ORGANIZATION_ID;
const AT = new Date().toISOString();

const base = (): AppState => { const s = createInitialState(new Date()); s.session.currentOrganizationId = ORG; return s; };
const me = (s: AppState) => adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
const byName = (s: AppState, name: string) => s.data.activityConfigs.find((a) => a.organizationId === ORG && a.name === name)!;

function renderApp(path: string, state: AppState) {
  const view = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), ...view };
}
const navLinks = () => within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link').map((l) => l.textContent);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('#006 Credential Details without wallet information', () => {
  it('shows no Seamfix Wallet field or wallet events, and keeps lifecycle events and the record', async () => {
    let s = base();
    const c = s.data.credentials.find((x) => x.organizationId === ORG && x.wallet.status !== 'delivered')!;
    s = reducer(s, { type: 'wallet/update', credentialId: c.id, status: 'delivered', at: AT });
    expect(s.data.audit.some((e) => e.resourceId === c.id && e.action === 'wallet.delivered')).toBe(true);
    renderApp(`/credentials/${c.id}`, s);
    const main = screen.getByRole('main');
    expect(main).not.toHaveTextContent(/Seamfix Wallet|Added to Seamfix Wallet|Wallet delivery/);
    expect(main).toHaveTextContent('Credential issued');
    expect(main).toHaveTextContent('Reference number');
    // The underlying wallet record and its audit entry are untouched.
    expect(s.data.credentials.find((x) => x.id === c.id)!.wallet.status).toBe('delivered');
  });
});

describe('#007 neutral placeholders', () => {
  it('uses neutral examples for groups and activities', async () => {
    const { user, unmount } = renderApp('/groups', base());
    await user.click(screen.getAllByRole('button', { name: /Create Group/i })[0]);
    expect(screen.getByPlaceholderText('Enter group name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter a brief description of this group')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/engineering|department/i);
    unmount();
    renderApp('/verification-activities/new', base());
    expect(screen.getByPlaceholderText('Enter activity name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe the purpose of this verification activity')).toBeInTheDocument();
    expect(screen.getByRole('main')).not.toHaveTextContent(/exam|CSC|student/i);
  });
});

describe('#008 no Verifier Workspace shortcuts', () => {
  it('has no Open Verifier Workspace action on the list or activity details', () => {
    const s = base();
    const { unmount } = renderApp('/verification-activities', s);
    expect(screen.queryByRole('link', { name: /Open Verifier Workspace/ })).toBeNull();
    unmount();
    renderApp(`/verification-activities/${byName(s, 'Annual Staff Conference').id}`, s);
    expect(screen.queryByRole('link', { name: /Open Verifier Workspace/ })).toBeNull();
  });
});

describe('#009 / #010 activity drafts and verifiers', () => {
  it('keeps a new activity as a draft through a trip to invite an administrator, and continues where it stopped', async () => {
    const s = base();
    const { user } = renderApp('/verification-activities/new', s);
    await user.type(screen.getByLabelText(/Activity Name/), 'Volunteer Briefing');
    await user.type(screen.getByLabelText(/Description/), 'Entry to the volunteer briefing');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    // Saved as one draft as soon as the first step was done.
    await waitFor(() => expect(loadState()!.data.activityConfigs.filter((a) => a.name === 'Volunteer Briefing')).toHaveLength(1));
    const draft = loadState()!.data.activityConfigs.find((a) => a.name === 'Volunteer Briefing')!;
    expect(draft).toMatchObject({ status: 'draft', editorStep: 'people', createdBy: me(s).name });
    // The administrator creating it is preselected as its verifier.
    expect(within(screen.getByRole('list', { name: 'Assigned verifiers' })).getByText(me(s).name!)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Select group Volunteers/ }));
    await user.click(screen.getByRole('button', { name: 'Invite Administrator' }));

    // Settings → Administrators & Roles, with the invitation open and a way back.
    expect(await screen.findByRole('dialog', { name: 'Invite administrator' })).toBeInTheDocument();
    const saved = loadState()!.data.activityConfigs.find((a) => a.id === draft.id)!;
    expect(saved.participants).toEqual({ groupIds: [`${ORG}_grp_volunteers`], memberIds: [] });
    expect(loadState()!.data.activityConfigs.filter((a) => a.name === 'Volunteer Briefing')).toHaveLength(1);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Invite administrator' })).toBeNull());
    await user.click(within(screen.getByRole('region', { name: 'Activity draft' })).getByRole('link', { name: /Back to activity/ }));

    // Back where it stopped, with everything kept.
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Volunteer Briefing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Participants & Verifiers/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('checkbox', { name: /Select group Volunteers/ })).toBeChecked();
    expect(within(screen.getByRole('list', { name: 'Assigned verifiers' })).getByText(me(s).name!)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Activity Details/ }));
    expect(screen.getByLabelText(/Activity Name/)).toHaveValue('Volunteer Briefing');
    expect(screen.getByLabelText(/Description/)).toHaveValue('Entry to the volunteer briefing');
    // Still a draft: never active, and not offered to verifiers.
    const stored = loadState()!;
    expect(stored.data.activityConfigs.find((a) => a.id === draft.id)!.status).toBe('draft');
    const service = createVerificationService({ getState: () => stored, dispatch: () => undefined, idSwitch: createMockIdSwitch() });
    expect(service.listAuthorizedActivities(ORG).some((x) => x.activity.id === draft.id)).toBe(false);
  });

  it('offers Continue Editing for drafts on the list, reopening the saved step', async () => {
    let s = base();
    const saved = applySaveActivity(s, {
      organizationId: ORG, ids: { activityId: 'va_resume', versionId: 'vv_resume' }, at: AT,
      form: { name: 'Resume Me', description: '', purpose: '', type: 'identity', checks: [], outcome: { onRequiredFailure: 'not-verified', onInconclusive: 'unable-to-verify' }, verifierIds: [], editorStep: 'review' },
    });
    if (!saved.ok) throw new Error(saved.error);
    s = saved.state;
    const { user } = renderApp('/verification-activities', s);
    await user.type(await screen.findByLabelText('Search activities by name'), 'Resume');
    await user.click(await screen.findByRole('link', { name: 'Continue Editing Resume Me' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Resume Me' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review & Activate/ })).toHaveAttribute('aria-current', 'step');
  });

  it('shows only the missing-verifier warning, and only when nobody is assigned', async () => {
    const s = base();
    const { user } = renderApp('/verification-activities/new', s);
    await user.type(screen.getByLabelText(/Activity Name/), 'Gate Check');
    await user.click(screen.getByRole('button', { name: /Review & Activate/ }));
    const review = await screen.findByRole('heading', { name: 'Review & Activate' });
    const section = review.closest('section')!;
    expect(section).not.toHaveTextContent(/biometric|provider|integration/i);
    expect(section).not.toHaveTextContent('No verifier assigned');
    await user.click(screen.getByRole('button', { name: /Participants & Verifiers/ }));
    await user.click(screen.getByRole('button', { name: `Unassign ${me(s).name}` }));
    await user.click(screen.getByRole('button', { name: /Review & Activate/ }));
    const again = (await screen.findByRole('heading', { name: 'Review & Activate' })).closest('section')!;
    expect(again).toHaveTextContent('No verifier assigned');
    expect(again).toHaveTextContent('Assign at least one verifier to allow verification for this activity.');
    expect(again).not.toHaveTextContent('Worth checking');
  });

  it('only assigns administrators who can verify; selection grants no permission', () => {
    let s = base();
    const kwame = adminsOf(s, ORG).find((a) => a.name === 'Kwame Mensah')!;
    const form = { name: 'Restricted', description: '', purpose: '', type: 'identity' as const, checks: [], outcome: { onRequiredFailure: 'not-verified' as const, onInconclusive: 'unable-to-verify' as const } };
    expect(applySaveActivity(s, { organizationId: ORG, ids: { activityId: 'va_r', versionId: 'vv_r' }, at: AT, form: { ...form, verifierIds: [kwame.id] } }))
      .toMatchObject({ ok: false, error: 'Only active administrators who can perform verifications can be assigned.' });
    const ok = applySaveActivity(s, { organizationId: ORG, ids: { activityId: 'va_r', versionId: 'vv_r' }, at: AT, form: { ...form, verifierIds: [me(s).id] } });
    if (!ok.ok) throw new Error(ok.error);
    s = ok.state;
    expect(s.data.verifierAssignments.filter((v) => v.activityId === 'va_r' && v.status === 'active').map((v) => v.administratorId)).toEqual([me(s).id]);
  });
});

describe('#012 simple Activity Overview', () => {
  it('shows an operational summary without technical configuration', () => {
    const s = base();
    const activity = byName(s, 'Annual Staff Conference');
    renderApp(`/verification-activities/${activity.id}`, s);
    const summary = screen.getByRole('region', { name: 'Activity summary' });
    expect(summary).toHaveTextContent('Eligible participants');
    expect(summary).toHaveTextContent('Verified participants0');
    expect(summary).toHaveTextContent('Entries granted0');
    const main = screen.getByRole('main');
    for (const gone of ['How people are verified', 'How the result is decided', 'Technical details', 'Configuration versions', 'Liveness', 'Facial Identity Matching', 'provider']) {
      expect(main).not.toHaveTextContent(gone);
    }
    expect(main).toHaveTextContent('Assigned verifiers');
    expect(main).toHaveTextContent('Location check');
    expect(main).toHaveTextContent('Last updated');
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.replace(/\d+$/, ''))).toEqual(['Overview', 'Participants', 'Verification History']);
  });
});

describe('#013 role-based navigation and role switching', () => {
  it('gives the Organization Admin one organization-wide Verification History, and switches to and from the Verifier view', async () => {
    let s = base();
    const conference = byName(s, 'Annual Staff Conference');
    s = assign(s, me(s).id, [conference.id]);
    const { user } = renderApp('/', s);
    expect(navLinks()).toEqual(['Dashboard', 'Users', 'Groups', 'Credentials', 'Verification Activities', 'Verification History', 'Audit Log', 'Settings']);

    await user.click(screen.getByRole('button', { name: /Account menu for/ }));
    await user.click(within(screen.getByRole('menu', { name: 'Account' })).getByRole('menuitem', { name: /^Verifier/ }));
    expect(await screen.findByRole('region', { name: 'Role view' })).toHaveTextContent('Verifier view');
    expect(navLinks()).toEqual(['Dashboard', 'My Verification Activities', 'My Verification History']);
    expect(await screen.findByRole('heading', { level: 1, name: 'My Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Your active activities' })).toHaveTextContent('Annual Staff Conference');

    // Only assigned activities, and verification can start (the view works, within the Verifier role).
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'My Verification Activities' }));
    const list = await screen.findByRole('list', { name: 'Your verification activities' });
    expect(within(list).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Annual Staff Conference']);
    expect(within(list).getByRole('button', { name: 'Start verification: Annual Staff Conference' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Switch back' }));
    await waitFor(() => expect(navLinks()).toContain('Settings'));
    expect(navLinks()).not.toContain('My Verification History');
  });

  it('blocks organization-wide modules and others’ verifications in the Verifier view, even by direct link', async () => {
    let s = base();
    const conference = byName(s, 'Annual Staff Conference');
    const halima = adminsOf(s, ORG).find((a) => a.roleIds.includes('verifier'))!;
    s = assign(assign(s, me(s).id, [conference.id]), halima.id, [conference.id]);
    // Someone else's verification.
    let other = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: halima.userId! } } };
    const service = createVerificationService({ getState: () => other, dispatch: (a) => { other = reducer(other, a); }, idSwitch: createMockIdSwitch() });
    const started = service.startAttempt(ORG, conference.id);
    if (!started.ok) throw new Error(started.error);
    s = { ...other, data: { ...other.data, admin: s.data.admin } };
    const view = reducer(s, { type: 'preview/start', roleId: 'verifier' });
    for (const path of ['/users', '/credentials', '/verification-history', '/settings', '/audit', `/verification-activities/${conference.id}`]) {
      const { unmount } = renderApp(path, view);
      expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
      unmount();
    }
    const { unmount } = renderApp(`/verify/attempts/${started.attempt.id}`, view);
    expect(screen.getByRole('heading', { name: 'Verification not available' })).toBeInTheDocument();
    unmount();
    // My Verification History shows only the signed-in administrator's own work.
    renderApp('/verify/history', view);
    expect(screen.getByText('No verifications yet')).toBeInTheDocument();
    // Outside the role view, the Organization Admin can see organization-wide records.
    expect(createVerificationService({ getState: () => s, dispatch: () => undefined, idSwitch: createMockIdSwitch() }).getAttempt(started.attempt.id)).toBeDefined();
  });

  it('never grants a permission the administrator doesn’t have, and still requires an assignment', () => {
    const s = base();
    const view = reducer(s, { type: 'preview/start', roleId: 'verifier' });
    const service = createVerificationService({ getState: () => view, dispatch: () => undefined, idSwitch: createMockIdSwitch() });
    expect(service.startAttempt(ORG, byName(s, 'Annual Staff Conference').id)).toMatchObject({ ok: false, error: 'Not assigned to this activity.' });
    // A Verifier can't switch views at all.
    const halima = adminsOf(s, ORG).find((a) => a.roleIds.includes('verifier'))!;
    const asHalima = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: halima.userId! } } };
    expect(reducer(asHalima, { type: 'preview/start', roleId: 'organization-admin' })).toBe(asHalima);
  });
});
