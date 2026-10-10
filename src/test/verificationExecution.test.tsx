import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { isGroupMember } from '@/domain/groups';
import type { ActivityCheck, Member } from '@/domain/types';
import { newCheck } from '@/domain/verification';
import { adminsOf } from '@/store/adminOps';
import { applyActivate, applySaveActivity, type ActivityForm } from '@/store/activityOps';
import { applyCompleteAttempt } from '@/store/attemptOps';
import { createInitialState, reducer, type Action, type AppState } from '@/store/state';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import { createVerificationService, type VerificationInputs } from '@/verification/engine';
import { assign, statedDetails } from './helpers/identity';

const ORG = SAMPLE_ORGANIZATION_ID;
let seq = 0;

/** A store harness: the same reducer the app uses, without React. */
function harness(initial: AppState, opts: { now?: () => Date; outage?: boolean } = {}) {
  let state = initial;
  const dispatch = (a: Action) => { state = reducer(state, a); };
  const idSwitch = createMockIdSwitch();
  if (opts.outage) (idSwitch as unknown as { simulation: { setOutage: (v: boolean) => void } }).simulation.setOutage(true);
  const service = createVerificationService({ getState: () => state, dispatch, idSwitch, now: opts.now, timeoutMs: 600 });
  return { get state() { return state; }, set state(s: AppState) { state = s; }, dispatch, service };
}

const org = (s: AppState) => s.data.organizations.find((o) => o.id === ORG)!;
const halima = (s: AppState) => adminsOf(s, ORG).find((a) => a.roleIds.includes('verifier') && a.status === 'active')!;
/** Signed in as Halima (a Verifier), assigned to the given activities (all of the organization's by default). */
const asHalima = (s: AppState, activityIds = s.data.activityConfigs.filter((a) => a.organizationId === ORG).map((a) => a.id)): AppState =>
  assign({ ...s, data: { ...s.data, admin: { ...s.data.admin, id: halima(s).userId! } } }, halima(s).id, activityIds);
const withDemo = (s: AppState, on = true): AppState => ({ ...s, data: { ...s.data, organizations: s.data.organizations.map((o) => (o.id === ORG ? { ...o, integrations: { ...o.integrations, verificationDemo: { enabled: on } } } : o)) } });
const base = () => { const s = createInitialState(new Date()); s.session.currentOrganizationId = ORG; return s; };
const chk = (s: AppState, type: ActivityCheck['type'], extra: Partial<ActivityCheck> = {}) => newCheck(type, `c_${type}_${++seq}`, org(s), extra);
const activity = (s: AppState, name: string) => s.data.activityConfigs.find((a) => a.organizationId === ORG && a.name === name)!;

/** Creates and activates an activity (as the Organization Admin) assigned to Halima. */
function addActivity(s: AppState, form: Omit<ActivityForm, 'verifierIds' | 'description' | 'purpose' | 'outcome'> & Partial<ActivityForm>): { state: AppState; id: string } {
  const ids = { activityId: `va_x${++seq}`, versionId: `vv_x${seq}` };
  const saved = applySaveActivity(s, { organizationId: ORG, ids, at: new Date().toISOString(), form: { description: '', purpose: '', outcome: { onRequiredFailure: 'not-verified', onInconclusive: 'unable-to-verify' }, verifierIds: [halima(s).id], ...form } });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  const act = applyActivate(saved.state, { organizationId: ORG, activityId: ids.activityId, at: new Date().toISOString() });
  if (!act.ok) throw new Error(JSON.stringify(act));
  return { state: act.state, id: ids.activityId };
}

async function verify(h: ReturnType<typeof harness>, activityId: string, inputs: VerificationInputs) {
  const started = h.service.startAttempt(ORG, activityId);
  if (!started.ok) throw new Error(started.error);
  const r = await h.service.submitInputs(started.attempt.id, inputs, { submissionId: `s${++seq}` });
  if (!r.ok) throw new Error(r.error);
  return r.attempt;
}

const memberFor = (s: AppState) => {
  const lookup = s.data.activityVersions.find((v) => v.id === activity(s, 'Visitor Identity Check').activeVersionId)!.checks.find((c) => c.type === 'identity-lookup')!;
  return s.data.members.find((m) => m.organizationId === ORG && !!m.identifier && (!lookup.params.identifierConfigId || m.identifier.configId === lookup.params.identifierConfigId) && m.status === 'active')!;
};

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('Scenario A — identity verification without a credential', () => {
  it('verifies through the trusted source only when the person’s details match; a lookup alone never verifies', async () => {
    const h = harness(asHalima(base()));
    const m = memberFor(h.state);
    const id = activity(h.state, 'Visitor Identity Check').id;
    const ok = await verify(h, id, { identifier: m.identifier!.value, attributes: statedDetails(m) });
    expect(ok).toMatchObject({ status: 'completed', outcome: 'verified', verificationResult: 'verified', simulated: false, subject: { memberId: m.id } });
    expect(ok.checks.find((c) => c.type === 'attribute-match')).toMatchObject({ status: 'passed', requirement: 'required' });
    expect(ok.subject!.label).not.toContain(m.identifier!.value);
    expect(ok.entry).toBeUndefined();

    // Finding the record isn't enough: someone else's details fail, and no details can't be verified.
    const wrong = await verify(h, id, { identifier: m.identifier!.value, attributes: { 'Full name': 'Someone Else', 'Date of birth': '1990-01-01' } });
    expect(wrong).toMatchObject({ outcome: 'not-verified', accessDecision: 'not-permitted' });
    expect(wrong.checks.find((c) => c.type === 'identity-lookup')!.status).toBe('passed');
    const lookupOnly = await verify(h, id, { identifier: m.identifier!.value });
    expect(lookupOnly).toMatchObject({ outcome: 'unable-to-verify', accessDecision: 'review-required' });
    expect(lookupOnly.outcome).not.toBe('verified');

    const missing = await verify(h, activity(h.state, 'Visitor Identity Check').id, { identifier: 'NOPE-0000' });
    expect(missing.outcome).toBe('not-verified');
    expect(missing.checks.find((c) => c.type === 'identity-lookup')).toMatchObject({ status: 'failed', explanation: 'No identity record matches this identifier.' });
  });
});

describe('Scenario E — provider unavailable', () => {
  it('records Unable to Verify, not a negative result, when the identity service is down', async () => {
    const h = harness(asHalima(base()), { outage: true });
    const a = await verify(h, activity(h.state, 'Visitor Identity Check').id, { identifier: memberFor(h.state).identifier!.value });
    expect(a.outcome).toBe('unable-to-verify');
    expect(a.checks.find((c) => c.type === 'identity-lookup')!.status).toBe('error');
  });
});

describe('Scenario B — credential verification', () => {
  const credentialOf = (s: AppState, status: string) => {
    const v = s.data.activityVersions.find((x) => x.id === activity(s, 'Membership Verification').activeVersionId)!;
    const typeId = v.checks.find((c) => c.type === 'credential-authenticity')!.params.credentialTypeIds![0];
    return s.data.credentials.find((c) => c.organizationId === ORG && c.credentialTypeId === typeId && c.status === status && (!c.expiresAt || new Date(c.expiresAt) > new Date()) && new Date(c.effectiveFrom) < new Date())!;
  };

  it('never treats a credential number as proof of authenticity', async () => {
    const h = harness(asHalima(base()));
    const a = await verify(h, activity(h.state, 'Membership Verification').id, { credential: { method: 'reference', value: credentialOf(h.state, 'active').identifier } });
    expect(a.outcome).toBe('unable-to-verify');
    expect(a.checks.find((c) => c.type === 'credential-authenticity')!.status).toBe('inconclusive');
    expect(a.checks.find((c) => c.type === 'credential-status')!.status).toBe('skipped');
  });

  it('verifies a presented credential in demonstration mode, labelled as simulated, and fails a suspended one', async () => {
    const h = harness(asHalima(withDemo(base())));
    const good = await verify(h, activity(h.state, 'Membership Verification').id, { credential: { method: 'simulated-presentation', value: credentialOf(h.state, 'active').identifier } });
    expect(good).toMatchObject({ outcome: 'verified', simulated: true });
    expect(good.checks.find((c) => c.type === 'credential-authenticity')!.explanation).toMatch(/not who is presenting it/);
    const suspended = credentialOf(h.state, 'suspended');
    if (suspended) {
      const bad = await verify(h, activity(h.state, 'Membership Verification').id, { credential: { method: 'simulated-presentation', value: suspended.identifier } });
      expect(bad.outcome).toBe('not-verified');
      expect(bad.checks.find((c) => c.type === 'credential-status')!.status).toBe('failed');
    }
  });
});

describe('Scenario C — identity and credential', () => {
  it('a valid credential alone doesn’t verify when a required identity check fails', async () => {
    let s = withDemo(base());
    const m = memberFor(s);
    const cred = s.data.credentials.find((c) => c.memberId === m.id && c.status === 'active' && (!c.expiresAt || new Date(c.expiresAt) > new Date()))!;
    const enrolled = { ...s, data: { ...s.data, members: s.data.members.map((x) => (x.id === m.id ? { ...x, faceEnrollment: { ...x.faceEnrollment, status: 'enrolled' as const } } : x)) } };
    const lookup = s.data.activityVersions.find((v) => v.id === activity(s, 'Visitor Identity Check').activeVersionId)!.checks.find((c) => c.type === 'identity-lookup')!;
    const made = addActivity(enrolled, {
      name: 'Combined Check', type: 'identity-credential',
      checks: [chk(s, 'identity-lookup', { params: lookup.params }), chk(s, 'credential-authenticity', { params: { credentialTypeIds: [cred.credentialTypeId] } }),
        chk(s, 'credential-status'), chk(s, 'liveness'), chk(s, 'face-match', { sourceId: 'identity-service' })],
    });
    s = asHalima(made.state);
    const h = harness(s);
    const inputs = { identifier: m.identifier!.value, credential: { method: 'simulated-presentation' as const, value: cred.identifier } };
    expect((await verify(h, made.id, { ...inputs, demo: { liveness: 'live', face: 'match' } })).outcome).toBe('verified');
    const noMatch = await verify(h, made.id, { ...inputs, demo: { liveness: 'live', face: 'no-match' } });
    expect(noMatch.outcome).toBe('not-verified');
    expect(noMatch.checks.find((c) => c.type === 'credential-status')!.status).toBe('passed');
    // Not live: facial matching isn't run against an unreliable capture.
    const notLive = await verify(h, made.id, { ...inputs, demo: { liveness: 'not-live', face: 'match' } });
    expect(notLive.checks.find((c) => c.type === 'face-match')!.status).toBe('skipped');
    expect(notLive.outcome).toBe('not-verified');
    // A provider timeout is operational, not a failed match.
    const timeout = await verify(h, made.id, { ...inputs, demo: { liveness: 'live', face: 'timeout' } });
    expect(timeout.checks.find((c) => c.type === 'face-match')).toMatchObject({ status: 'error', explanation: expect.stringMatching(/didn’t respond in time/) });
    expect(timeout.outcome).toBe('unable-to-verify');
  });
});

describe('Scenario D — group eligibility', () => {
  it('checks current membership only for a securely identified person', async () => {
    let s = base();
    const lookup = s.data.activityVersions.find((v) => v.id === activity(s, 'Visitor Identity Check').activeVersionId)!.checks.find((c) => c.type === 'identity-lookup')!;
    const group = s.data.groups.find((g) => g.id === `${ORG}_grp_volunteers`)!;
    const made = addActivity(s, { name: 'Volunteer Check', type: 'identity', checks: [chk(s, 'identity-lookup', { params: lookup.params }), chk(s, 'group-membership', { params: { groupIds: [group.id] } })] });
    s = asHalima(made.state);
    const h = harness(s);
    const candidates = s.data.members.filter((m) => m.organizationId === ORG && m.status === 'active' && !!m.identifier && (!lookup.params.identifierConfigId || m.identifier.configId === lookup.params.identifierConfigId));
    const member = candidates.find((m) => isGroupMember(s.data, ORG, group.id, m.id)) as Member;
    const outsider = candidates.find((m) => !isGroupMember(s.data, ORG, group.id, m.id))!;
    if (member) expect((await verify(h, made.id, { identifier: member.identifier!.value })).outcome).toBe('verified');
    const out = await verify(h, made.id, { identifier: outsider.identifier!.value });
    expect(out.outcome).toBe('not-verified');
    expect(out.checks.find((c) => c.type === 'group-membership')!.status).toBe('failed');
    const unknown = await verify(h, made.id, { identifier: 'UNKNOWN' });
    expect(unknown.checks.find((c) => c.type === 'group-membership')).toMatchObject({ status: 'skipped', explanation: expect.stringMatching(/couldn’t be securely identified/) });
  });
});

describe('alternatives', () => {
  it('needs at least one approved alternative to pass', async () => {
    let s = withDemo(base());
    const m = memberFor(s);
    const cred = s.data.credentials.find((c) => c.memberId === m.id && c.status === 'active' && (!c.expiresAt || new Date(c.expiresAt) > new Date()))!;
    s = { ...s, data: { ...s.data, members: s.data.members.map((x) => (x.id === m.id ? { ...x, faceEnrollment: { ...x.faceEnrollment, status: 'enrolled' as const } } : x)) } };
    const lookup = s.data.activityVersions.find((v) => v.id === activity(s, 'Visitor Identity Check').activeVersionId)!.checks.find((c) => c.type === 'identity-lookup')!;
    const made = addActivity(s, {
      name: 'Either Method', type: 'identity-credential',
      checks: [chk(s, 'identity-lookup', { params: lookup.params }), chk(s, 'credential-authenticity', { params: { credentialTypeIds: [cred.credentialTypeId] } }),
        chk(s, 'holder-binding', { requirement: 'alternative' }), chk(s, 'liveness', { requirement: 'alternative' }), chk(s, 'face-match', { requirement: 'alternative', sourceId: 'identity-service' })],
    });
    const h = harness(asHalima(made.state));
    const inputs = { identifier: m.identifier!.value, credential: { method: 'simulated-presentation' as const, value: cred.identifier } };
    expect((await verify(h, made.id, { ...inputs, demo: { holderBinding: 'valid', liveness: 'not-live' } })).outcome).toBe('verified');
    expect((await verify(h, made.id, { ...inputs, demo: { holderBinding: 'invalid', liveness: 'not-live' } })).outcome).toBe('not-verified');
    expect((await verify(h, made.id, { ...inputs, demo: { holderBinding: 'unavailable', liveness: 'not-live' } })).outcome).toBe('unable-to-verify');
  });
});

describe('Scenario F — authorization', () => {
  it('lets a verifier perform only the activities they’re assigned to, refuses others and records the refusal', () => {
    const h = harness(asHalima(base(), []));
    const visitor = activity(h.state, 'Visitor Identity Check');
    // The Verifier role alone opens nothing.
    expect(h.service.listAuthorizedActivities(ORG)).toEqual([]);
    expect(h.service.startAttempt(ORG, visitor.id)).toMatchObject({ ok: false, code: 'not-assigned' });
    expect(h.state.data.audit[0]).toMatchObject({ action: 'verification.denied', result: 'failure' });
    expect(h.state.data.verificationAttempts).toHaveLength(0);
    h.state = assign(h.state, halima(h.state).id, [visitor.id, activity(h.state, 'Event Access Verification').id]);
    expect(h.service.listAuthorizedActivities(ORG).map((x) => x.activity.name)).toEqual(['Visitor Identity Check']);
    expect(h.service.startAttempt(ORG, visitor.id)).toMatchObject({ ok: true });
    // Assigned to a draft activity: still refused.
    expect(h.service.startAttempt(ORG, activity(h.state, 'Event Access Verification').id)).toMatchObject({ ok: false, code: 'inactive' });
    // An Organization Admin isn't a verifier unless explicitly given the role.
    const admin = harness(base());
    expect(admin.service.startAttempt(ORG, visitor.id)).toMatchObject({ ok: false, code: 'not-authorized' });
  });

  it('an assignment to another verifier doesn’t authorize anyone else', () => {
    let s = asHalima(base(), []);
    const act = activity(s, 'Visitor Identity Check');
    const other = adminsOf(s, ORG).find((a) => a.id !== halima(s).id)!;
    s = assign(s, other.id, [act.id]);
    expect(harness(s).service.startAttempt(ORG, act.id)).toMatchObject({ ok: false, code: 'not-assigned' });
  });

  it('stops a verifier whose assignment is removed mid-attempt from recording a result', async () => {
    const h = harness(asHalima(base()));
    const act = activity(h.state, 'Visitor Identity Check');
    const started = h.service.startAttempt(ORG, act.id);
    if (!started.ok) throw new Error();
    h.state = { ...h.state, data: { ...h.state.data, verifierAssignments: h.state.data.verifierAssignments.map((v) => (v.activityId === act.id ? { ...v, status: 'removed' as const } : v)) } };
    expect(await h.service.submitInputs(started.attempt.id, { identifier: memberFor(h.state).identifier!.value }, { submissionId: 'x' })).toMatchObject({ ok: false, code: 'not-assigned' });
  });
});

describe('attempt lifecycle', () => {
  it('pins the configuration version, ignores duplicate submissions and refuses a second completion', async () => {
    const h = harness(asHalima(base()));
    const act = activity(h.state, 'Visitor Identity Check');
    const started = h.service.startAttempt(ORG, act.id);
    if (!started.ok) throw new Error();
    expect(started.attempt.versionNumber).toBe(1);
    // A new version is activated while the attempt is in progress.
    const v1 = h.state.data.activityVersions.find((v) => v.id === act.activeVersionId)!;
    const asAdmin = { ...h.state, data: { ...h.state.data, admin: base().data.admin } };
    const changed = applySaveActivity(asAdmin, { organizationId: ORG, activityId: act.id, ids: { activityId: act.id, versionId: 'vv_new' }, at: new Date().toISOString(),
      form: { name: act.name, description: act.description, purpose: act.purpose, type: v1.type, outcome: { ...v1.outcome, onRequiredFailure: 'pending-review' }, verifierIds: [halima(h.state).id], checks: v1.checks } });
    if (!changed.ok) throw new Error();
    const published = applyActivate(changed.state, { organizationId: ORG, activityId: act.id, at: new Date().toISOString() });
    if (!published.ok) throw new Error(JSON.stringify(published));
    h.state = { ...published.state, data: { ...published.state.data, admin: h.state.data.admin } };

    const inputs = { identifier: memberFor(h.state).identifier!.value, attributes: { 'Full name': 'Wrong Name', 'Date of birth': '2000-01-01' } };
    // Version 2 refers failures for review; this attempt keeps version 1, where a failure is Not Verified.
    const r1 = await h.service.submitInputs(started.attempt.id, inputs, { submissionId: 'same' });
    const r2 = await h.service.submitInputs(started.attempt.id, inputs, { submissionId: 'same' });
    if (!r1.ok || !r2.ok) throw new Error();
    expect(r1.attempt).toMatchObject({ versionNumber: 1, outcome: 'not-verified' });
    expect(r2.attempt).toEqual(r1.attempt);
    expect(h.state.data.verificationAttempts.filter((a) => a.id === started.attempt.id)).toHaveLength(1);
    expect(await h.service.submitInputs(started.attempt.id, inputs, { submissionId: 'other' })).toMatchObject({ ok: false, code: 'not-in-progress' });
  });

  it('expires interrupted attempts, records cancellations, and never accepts an outcome from the caller', async () => {
    let t = new Date();
    const h = harness(asHalima(base()), { now: () => t });
    const act = activity(h.state, 'Visitor Identity Check');
    const a = h.service.startAttempt(ORG, act.id);
    if (!a.ok) throw new Error();
    t = new Date(t.getTime() + 16 * 60_000);
    expect(await h.service.submitInputs(a.attempt.id, { identifier: 'x' }, { submissionId: 'late' })).toMatchObject({ ok: false, code: 'expired' });
    expect(h.state.data.verificationAttempts.find((x) => x.id === a.attempt.id)!.status).toBe('expired');

    const b = h.service.startAttempt(ORG, act.id);
    if (!b.ok) throw new Error();
    h.service.cancelAttempt(b.attempt.id);
    const cancelled = h.state.data.verificationAttempts.find((x) => x.id === b.attempt.id)!;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.outcome).toBeUndefined();

    const c = h.service.startAttempt(ORG, act.id);
    if (!c.ok) throw new Error();
    const forged = applyCompleteAttempt(h.state, { attemptId: c.attempt.id, submissionId: 'f', at: t.toISOString(), client: h.service.client,
      checks: c.attempt.checks.map((x) => ({ ...x, status: x.requirement === 'required' ? 'failed' as const : 'passed' as const, explanation: 'x' })),
      ...({ outcome: 'verified' } as object) });
    expect(forged).toMatchObject({ ok: true, attempt: { outcome: 'not-verified' } });
  });
});

describe('Verifier Interface', () => {
  function renderApp(path: string, state: AppState) {
    render(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    return userEvent.setup();
  }

  it('lets the demo Organization Admin add the Verifier role, which opens nothing until they’re assigned', async () => {
    const s = base();
    const user = renderApp('/verify', s);
    expect(screen.getByRole('heading', { level: 1, name: 'My Verification Activities' })).toBeInTheDocument();
    expect(screen.getByText('Your role doesn’t include performing verifications')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up demo verifier access' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Set up access' }));
    expect(await screen.findByText('No activities assigned to you yet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your verification activities' })).toBeNull();
  });

  it('lets an assigned verifier verify someone', async () => {
    let s = base();
    const m = memberFor(s);
    const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
    s = reducer(s, { type: 'admins/roles', organizationId: ORG, adminId: me.id, roleIds: [...me.roleIds, 'verifier'], at: new Date().toISOString() });
    s = assign(s, me.id, [activity(s, 'Visitor Identity Check').id]);
    const user = renderApp('/verify', s);
    const list = await screen.findByRole('list', { name: 'Your verification activities' });
    expect(within(list).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Visitor Identity Check']);

    await user.click(within(list).getByRole('button', { name: 'Start verification: Visitor Identity Check' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Visitor Identity Check' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run verification' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Enter the person’s/);
    await user.type(screen.getAllByRole('textbox')[0], m.identifier!.value);
    await user.type(screen.getByLabelText('Full name'), statedDetails(m)['Full name']);
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: statedDetails(m)['Date of birth'] } });
    await user.click(screen.getByRole('button', { name: 'Run verification' }));
    const hero = await screen.findByRole('region', { name: 'Outcome' }, { timeout: 4000 });
    expect(hero).toHaveTextContent('Verified');
    expect(screen.getByRole('list', { name: 'Checks' })).toHaveTextContent('Identity Record Lookup');
    await user.click(screen.getByRole('button', { name: 'View Verification Details' }));
    expect(screen.getByText('Version 1')).toBeInTheDocument();
    expect(screen.queryByText(m.identifier!.value)).toBeNull();
  });

  it('refuses direct links: without the Verifier permission, and to activities the verifier isn’t assigned to', async () => {
    let s = base();
    const target = activity(s, 'Visitor Identity Check');
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/verify/activities/${target.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders initialState={s} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    unmount();
    const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
    s = reducer(s, { type: 'admins/roles', organizationId: ORG, adminId: me.id, roleIds: [...me.roleIds, 'verifier'], at: new Date().toISOString() });
    renderApp(`/verify/activities/${target.id}`, s);
    expect(await screen.findByRole('heading', { name: 'You can’t perform this verification' })).toBeInTheDocument();
    expect(screen.getByText('Not assigned to this activity.')).toBeInTheDocument();
  });

  it('shows a verifier only the activities assigned to them', async () => {
    let s = base();
    const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
    const other = halima(s);
    s = reducer(s, { type: 'admins/roles', organizationId: ORG, adminId: me.id, roleIds: [...me.roleIds, 'verifier'], at: new Date().toISOString() });
    s = assign(s, me.id, [activity(s, 'Membership Verification').id]);
    s = assign(s, other.id, [activity(s, 'Visitor Identity Check').id]);
    renderApp('/verify', s);
    await waitFor(() => expect(screen.getByRole('list', { name: 'Your verification activities' })).toBeInTheDocument());
    expect(within(screen.getByRole('list', { name: 'Your verification activities' })).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Membership Verification']);
  });
});
