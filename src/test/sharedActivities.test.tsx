import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { loadState } from '@/store/persistence';
import { cont, wizardToVerifiers } from './helpers/activityWizard';
import { AUTH_STORAGE_KEY } from '@/auth/authCore';
import { DEMO_PERSONAS, ORG_A, ORG_B, ORG_B1, ORG_C } from '@/data/demoPersonas';
import { DEMO_SHARED_ACTIVITY } from '@/data/seed';
import { defaultSettings, type VerificationSettings } from '@/domain/activitySettings';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import { getVerificationStatus } from '@/services/statusApi/statusApi';
import { applyActivate, applySaveActivity, type ActivityForm } from '@/store/activityOps';
import { applyApprovalDecision, exceptionFor, applyAssignException, applyExceptionNote, applyRequestInformation, applyResolveException, exceptionsVisibleTo } from '@/store/exceptionOps';
import { stageOf } from '@/domain/transactions';
import { ATTEMPT_TTL_MS } from '@/store/attemptOps';
import { sharedActivityTransactions, sharedResults, summarize } from '@/store/reporting';
import { activityFor, applyAssignSharedVerifiers, invitableOrganizations, applyRespondToInvitation, availableSources, configFromSettings, participation, sharedWith } from '@/store/sharingOps';
import { createInitialState, reducer, type Action, type AppState } from '@/store/state';
import { createVerificationService } from '@/verification/engine';

const AT = new Date().toISOString();
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string; problems?: string[] }).problems?.join(' ') ?? (r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };

function as(accountId: string, orgId: string, s: AppState): AppState {
  const p = DEMO_PERSONAS.find((x) => x.accountId === accountId);
  const admin = p ? { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner' as const, organizationIds: [orgId] } : { ...s.data.admin, id: accountId };
  return { ...s, data: { ...s.data, admin }, session: { ...s.session, currentOrganizationId: orgId } };
}
const JORDAN = 'acct_demo_c_admin';
const ESTHER = 'acct_demo_a_admin';
const HALIMA = `${ORG_C}_usr_4`;
const recordOf = (s: AppState, org: string, userId: string) => s.data.administrators.find((a) => a.organizationId === org && a.userId === userId)!.id;

function harness(initial: AppState) {
  let state = initial;
  const dispatch = (a: Action) => { state = reducer(state, a); };
  const service = createVerificationService({ getState: () => state, dispatch, idSwitch: createMockIdSwitch(), timeoutMs: 2000 });
  return { get state() { return state; }, set state(v: AppState) { state = v; }, service, actAs(id: string, org: string) { state = as(id, org, state); } };
}
type H = ReturnType<typeof harness>;
async function verify(h: H, org: string, activityId: string, reference: string, demo?: { liveness: 'passed' | 'failed'; match: string }) {
  const started = ok(h.service.startAttempt(org, activityId));
  await h.service.lookupExternal(started.attempt.id, reference);
  if (!demo) return ok(h.service.endExternal(started.attempt.id)).attempt;
  return ok(await h.service.completeExternal(started.attempt.id, { captured: true, demo }, { submissionId: `s-${started.attempt.id}` })).attempt;
}
const MATCH = { liveness: 'passed' as const, match: 'SIM-CAPTURE-MATCH' };

/** An activity form as the simplified editor builds it. */
function form(s: AppState, org: string, name: string, settings: VerificationSettings, extra: Partial<ActivityForm> = {}): ActivityForm {
  let n = 0;
  const gen = configFromSettings(settings, s.data.organizations.find((o) => o.id === org)!, () => `chk_${++n}`);
  return { name, description: '', purpose: '', verifierIds: [], type: gen.type, checks: gen.checks, outcome: gen.outcome, requirements: gen.requirements, customized: false, verification: settings, ...extra };
}
function create(s: AppState, org: string, id: string, f: ActivityForm): AppState {
  const saved = ok(applySaveActivity(s, { organizationId: org, ids: { activityId: id, versionId: `${id}_v1` }, form: f, at: AT }));
  return ok(applyActivate(saved.state, { organizationId: org, activityId: id, at: AT })).state;
}
const external = (integrationId: string, x: Partial<VerificationSettings> = {}): VerificationSettings => ({
  ...defaultSettings(), identitySource: { kind: 'external', integrationId }, eligibility: { approach: 'external-source', attribute: 'recordStatus', allowedValues: ['ACTIVE'] }, exceptions: 'review', ...x,
});

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('one concept: Verification Activities', () => {
  it('has no programme records; the demo shared activity is one record owned by B, run by B1 and B2, with C invited', () => {
    const s = createInitialState(new Date());
    expect('verificationProgrammes' in s.data).toBe(false);
    const a = s.data.activityConfigs.find((x) => x.id === DEMO_SHARED_ACTIVITY)!;
    expect(a.organizationId).toBe(ORG_B);
    expect(a.sharing!.participants.map((p) => [p.organizationId, p.status])).toEqual([[ORG_B1, 'active'], [`${ORG_B}_eastgate`, 'active'], [ORG_C, 'invited']]);
    // Participants never have their own copy of it.
    expect(s.data.activityConfigs.filter((x) => x.name === a.name)).toHaveLength(1);
    // Its transactions are recorded in the performing organization, linked to the owner.
    const b1tx = s.data.verificationAttempts.filter((x) => x.organizationId === ORG_B1 && x.activityId === a.id);
    expect(b1tx.length).toBeGreaterThan(0);
    expect(b1tx.every((x) => x.activityOwnerId === ORG_B)).toBe(true);
  });

  it('offers only sources available to the organization, and none of FixID records for a shared activity', () => {
    const s = createInitialState(new Date());
    expect(availableSources(s, ORG_C, 'own').map((x) => x.id)).toEqual(['local', 'int_c_delegates']);
    expect(availableSources(s, ORG_C, 'shared').map((x) => x.id)).toEqual(['int_c_delegates']);
    // Organization A has no connected source: FixID records only (preselected by the editor when it's the only one).
    expect(availableSources(s, ORG_A, 'own').map((x) => x.id)).toEqual(['local']);
    expect(availableSources(s, ORG_A, 'shared')).toEqual([]);
  });
});

describe('end-to-end: own and shared activities', () => {
  it('1–2: an organization creates an activity for its own use and verifies people with an identifier', async () => {
    const s0 = as(JORDAN, ORG_C, createInitialState(new Date()));
    const s1 = create(s0, ORG_C, 'own_desk', form(s0, ORG_C, 'Front Desk Check', external('int_c_delegates'), { verifierIds: [recordOf(s0, ORG_C, JORDAN)] }));
    const a = s1.data.activityConfigs.find((x) => x.id === 'own_desk')!;
    expect(a).toMatchObject({ status: 'active', organizationId: ORG_C });
    expect(a.sharing).toBeUndefined();
    const h = harness(s1);
    // Success, not found, mismatch, and the identity source unavailable.
    expect(await verify(h, ORG_C, a.id, 'DEMO-10001', MATCH)).toMatchObject({ decision: 'allow', match: { status: 'match' } });
    const notFound = await verify(h, ORG_C, a.id, 'DEMO-20001');
    expect(notFound.lookup?.status).toBe('NOT_FOUND');
    expect(notFound.decision).not.toBe('allow');
    expect(await verify(h, ORG_C, a.id, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' })).toMatchObject({ decision: 'pending-review', match: { status: 'no-match' } });
    const down = await verify(h, ORG_C, a.id, 'DEMO-50001');
    expect(down.lookup?.status).toBe('UNAVAILABLE');
    // A service failure is never treated as proof the identity is invalid.
    expect(down.decision === 'deny' || down.decision === 'allow').toBe(false);
  });

  it('3–8: a shared activity is accepted, run and reviewed without merging workspaces', async () => {
    let s = as(JORDAN, ORG_C, createInitialState(new Date()));
    // 3. Organization C creates a shared activity and invites Organization A (an independent organization).
    s = create(s, ORG_C, 'shared_visit', form(s, ORG_C, 'Partner Visitor Check', external('int_c_delegates'), { audience: 'shared', participantIds: [ORG_A] }));
    const shared = s.data.activityConfigs.find((x) => x.id === 'shared_visit')!;
    expect(shared.sharing!.participants).toEqual([expect.objectContaining({ organizationId: ORG_A, status: 'invited' })]);
    expect(s.data.audit.some((e) => e.action === 'verification-activity.participants-invited' && e.organizationId === ORG_C)).toBe(true);

    // 4. A sees it in its own existing workspace (no second registration) and accepts.
    s = as(ESTHER, ORG_A, s);
    expect(sharedWith(s, ORG_A).map((x) => x.id)).toContain('shared_visit');
    const h = harness(s);
    expect(h.service.startAttempt(ORG_A, 'shared_visit')).toMatchObject({ ok: false });
    h.state = ok(applyRespondToInvitation(h.state, { organizationId: ORG_A, activityId: 'shared_visit', accept: true, at: AT })).state;
    expect(participation(h.state.data.activityConfigs.find((x) => x.id === 'shared_visit')!, ORG_A)).toBe('active');
    // It assigns its own staff; another organization's staff can't be assigned.
    expect(applyAssignSharedVerifiers(h.state, { organizationId: ORG_A, activityId: 'shared_visit', verifierIds: [recordOf(h.state, ORG_C, HALIMA)], at: AT })).toMatchObject({ ok: false });
    h.state = ok(applyAssignSharedVerifiers(h.state, { organizationId: ORG_A, activityId: 'shared_visit', verifierIds: [recordOf(h.state, ORG_A, ESTHER)], at: AT })).state;

    // 5. An authorized user in A verifies with the same shared activity.
    const allowed = await verify(h, ORG_A, 'shared_visit', 'DEMO-10001', MATCH);
    expect(allowed).toMatchObject({ organizationId: ORG_A, activityId: 'shared_visit', activityOwnerId: ORG_C, integrationId: 'int_c_delegates', decision: 'allow' });
    const mismatch = await verify(h, ORG_A, 'shared_visit', 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' });
    expect(mismatch.decision).toBe('pending-review');
    await verify(h, ORG_A, 'shared_visit', 'DEMO-20001');
    await verify(h, ORG_A, 'shared_visit', 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-UNAVAILABLE' });

    // 6. The owner sees this activity's results and the exception (it reviews it).
    const owner = as(JORDAN, ORG_C, h.state);
    const act = owner.data.activityConfigs.find((x) => x.id === 'shared_visit')!;
    expect(sharedActivityTransactions(owner, act).filter((x) => x.organizationId === ORG_A)).toHaveLength(4);
    expect(sharedResults(owner, act).rows.find((r) => r.organizationId === ORG_A)!.summary).toMatchObject({ attempts: 4, allowed: 1, pendingReview: 1 });
    const exc = exceptionsVisibleTo(owner, ORG_C).find((e) => e.transactionId === mismatch.id)!;
    expect(exc).toMatchObject({ route: 'owner', reviewOrganizationId: ORG_C, organizationId: ORG_A });
    expect(getVerificationStatus(owner, { clientId: `client_${ORG_C}`, transactionId: mismatch.id }).httpStatus).toBe(200);

    // 7. The participant can't access the owner's unrelated data or weaken the shared activity.
    const a = as(ESTHER, ORG_A, h.state);
    expect(activityFor(a, ORG_A, `${ORG_C}_va_visitor_checkin`)).toBeUndefined();
    expect(exceptionsVisibleTo(a, ORG_A).every((e) => e.organizationId === ORG_A)).toBe(true);
    expect(getVerificationStatus(a, { clientId: `client_${ORG_A}`, transactionId: a.data.verificationAttempts.find((x) => x.organizationId === ORG_C)!.id }).httpStatus).toBe(404);
    expect(applySaveActivity(a, { organizationId: ORG_A, activityId: 'shared_visit', ids: { activityId: 'x', versionId: 'y' }, at: AT, form: form(a, ORG_A, 'Partner Visitor Check', external('int_c_delegates', { liveness: 'optional' })) })).toMatchObject({ ok: false });
    expect(a.data.activityConfigs.find((x) => x.id === 'shared_visit')!.verification!.liveness).toBe('required');
    // The owner sees nothing else of A: not its own activities' transactions or exceptions.
    expect(exceptionsVisibleTo(owner, ORG_C).some((e) => e.organizationId === ORG_A && e.activityId !== 'shared_visit')).toBe(false);

    // 13–14. The owner reviews the exception; the decision updates both organizations' figures and the original result stays.
    const before = sharedResults(owner, act).rows.find((r) => r.organizationId === ORG_A)!.summary;
    const reviewer = recordOf(owner, ORG_C, JORDAN);
    let reviewed = ok(applyAssignException(owner, { organizationId: ORG_C, exceptionId: exc.id, reviewerId: reviewer, at: AT })).state;
    expect(applyResolveException(reviewed, { organizationId: ORG_C, exceptionId: exc.id, outcome: 'verification-confirmed', reason: 'Looks fine', at: AT })).toMatchObject({ ok: false });
    reviewed = ok(applyResolveException(reviewed, { organizationId: ORG_C, exceptionId: exc.id, outcome: 'verification-not-confirmed', reason: 'Face did not match.', at: AT })).state;
    // Brightwater requires approval: a second administrator approves the decision.
    expect(exceptionFor(reviewed, exc.id)).toMatchObject({ status: 'pending-approval' });
    reviewed = ok(applyApprovalDecision(as('usr_tobyson', ORG_C, reviewed), { organizationId: ORG_C, exceptionId: exc.id, decision: 'approve', reason: '', at: AT })).state;
    const after = sharedResults(reviewed, act).rows.find((r) => r.organizationId === ORG_A)!.summary;
    expect([after.pendingReview, after.denied]).toEqual([before.pendingReview - 1, before.denied + 1]);
    const tx = reviewed.data.verificationAttempts.find((x) => x.id === mismatch.id)!;
    expect(tx).toMatchObject({ decision: 'pending-review', match: { status: 'no-match' }, reviewDisposition: { decision: 'deny', outcome: 'verification-not-confirmed' } });
    // The participant sees the reviewed outcome of its own transaction, but can't review it.
    expect(exceptionsVisibleTo(as(ESTHER, ORG_A, reviewed), ORG_A).find((e) => e.id === exc.id)).toMatchObject({ status: 'resolved' });
    expect(applyResolveException(as(ESTHER, ORG_A, h.state), { organizationId: ORG_A, exceptionId: exc.id, outcome: 'verification-not-confirmed', reason: 'x', at: AT })).toMatchObject({ ok: false });

    // 8. A still creates and uses its own independent activity, with its own FixID records.
    const own = create(a, ORG_A, 'a_own', form(a, ORG_A, 'Reception Check', { ...defaultSettings(), method: 'record', liveness: 'not-applicable' }, { verifierIds: [recordOf(a, ORG_A, ESTHER)] }));
    expect(own.data.activityConfigs.find((x) => x.id === 'a_own')).toMatchObject({ organizationId: ORG_A, status: 'active' });
    expect(activityFor(as(JORDAN, ORG_C, own), ORG_C, 'a_own')).toBeUndefined();
  });

  it('only verifiers the participating organization assigned can verify, even with the activity URL', async () => {
    // Lina is an administrator of a participating organization but isn't assigned as a verifier.
    const h = harness(as('acct_demo_b1_admin', ORG_B1, createInitialState(new Date())));
    expect(h.service.startAttempt(ORG_B1, DEMO_SHARED_ACTIVITY)).toMatchObject({ ok: false, code: 'not-assigned' });
    // An organization that hasn't accepted can't verify, assign staff or see the owner's transactions.
    const c = as(JORDAN, ORG_C, createInitialState(new Date()));
    expect(applyAssignSharedVerifiers(c, { organizationId: ORG_C, activityId: DEMO_SHARED_ACTIVITY, verifierIds: [recordOf(c, ORG_C, HALIMA)], at: AT })).toMatchObject({ ok: false });
    expect(reducer(c, { type: 'sharing/assignVerifiers', organizationId: ORG_C, activityId: DEMO_SHARED_ACTIVITY, verifierIds: [recordOf(c, ORG_C, HALIMA)], at: AT })).toBe(c);
  });

  it('the owner suspends a participant: new verifications stop, history stays', async () => {
    const h = harness(as('acct_demo_b1_verifier', ORG_B1, createInitialState(new Date())));
    expect(h.service.authorize(ORG_B1, DEMO_SHARED_ACTIVITY).ok).toBe(true);
    const before = h.state.data.verificationAttempts.filter((x) => x.organizationId === ORG_B1).length;
    h.state = as('acct_demo_b_admin', ORG_B, h.state);
    h.state = reducer(h.state, { type: 'sharing/participant', organizationId: ORG_B, activityId: DEMO_SHARED_ACTIVITY, participantId: ORG_B1, status: 'suspended', at: AT });
    h.actAs('acct_demo_b1_verifier', ORG_B1);
    expect(h.service.startAttempt(ORG_B1, DEMO_SHARED_ACTIVITY)).toMatchObject({ ok: false });
    expect(h.state.data.verificationAttempts.filter((x) => x.organizationId === ORG_B1)).toHaveLength(before);
  });

  it('a declined invitation gives no access; only the invited organization can respond', () => {
    let s = createInitialState(new Date());
    // A can't respond to an invitation addressed to C.
    expect(applyRespondToInvitation(as(ESTHER, ORG_A, s), { organizationId: ORG_A, activityId: DEMO_SHARED_ACTIVITY, accept: true, at: AT })).toMatchObject({ ok: false });
    s = ok(applyRespondToInvitation(as(JORDAN, ORG_C, s), { organizationId: ORG_C, activityId: DEMO_SHARED_ACTIVITY, accept: false, at: AT })).state;
    expect(activityFor(s, ORG_C, DEMO_SHARED_ACTIVITY)).toBeUndefined();
  });
});

describe('final shared-activity rules', () => {
  /** C owns a shared activity run by A (no relationship between them), with one transaction sent for review. */
  async function setup() {
    let s = as(JORDAN, ORG_C, createInitialState(new Date()));
    s = create(s, ORG_C, 'shared_visit', form(s, ORG_C, 'Partner Visitor Check', external('int_c_delegates'), { audience: 'shared', participantIds: [ORG_A] }));
    const h = harness(as(ESTHER, ORG_A, s));
    h.state = ok(applyRespondToInvitation(h.state, { organizationId: ORG_A, activityId: 'shared_visit', accept: true, at: AT })).state;
    h.state = ok(applyAssignSharedVerifiers(h.state, { organizationId: ORG_A, activityId: 'shared_visit', verifierIds: [recordOf(h.state, ORG_A, ESTHER)], at: AT })).state;
    return h;
  }

  it('any active registered organization can be invited, without a parent-child relationship', async () => {
    const s = createInitialState(new Date());
    const related = (x: string, y: string) => (s.data.organizationRelationships ?? []).some((r) => [r.parentOrganizationId, r.childOrganizationId].sort().join() === [x, y].sort().join());
    expect(related(ORG_C, ORG_A)).toBe(false);
    expect(invitableOrganizations(s, ORG_C).map((o) => o.id)).toEqual(expect.arrayContaining([ORG_A, ORG_B, ORG_B1]));
    expect(invitableOrganizations(s, ORG_C).map((o) => o.id)).not.toContain(ORG_C);
    const h = await setup();
    expect(participation(h.state.data.activityConfigs.find((x) => x.id === 'shared_visit')!, ORG_A)).toBe('active');
  });

  it('the owner decides; the participant sees the decision and can only answer an information request', async () => {
    const h = await setup();
    const tx = await verify(h, ORG_A, 'shared_visit', 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' });
    const a = as(ESTHER, ORG_A, h.state);
    const exc = exceptionsVisibleTo(a, ORG_A).find((e) => e.transactionId === tx.id)!;
    expect(exc).toMatchObject({ route: 'owner', reviewOrganizationId: ORG_C });
    // No decision, assignment or information request from the participant; no information before it's requested.
    expect(applyResolveException(a, { organizationId: ORG_A, exceptionId: exc.id, outcome: 'verification-confirmed', reason: 'x', at: AT })).toMatchObject({ ok: false });
    expect(applyAssignException(a, { organizationId: ORG_A, exceptionId: exc.id, reviewerId: recordOf(a, ORG_A, ESTHER), at: AT })).toMatchObject({ ok: false });
    expect(applyRequestInformation(a, { organizationId: ORG_A, exceptionId: exc.id, comment: 'x', at: AT })).toMatchObject({ ok: false });
    expect(applyExceptionNote(a, { organizationId: ORG_A, exceptionId: exc.id, comment: 'x', at: AT })).toMatchObject({ ok: false });
    // The owner asks; the participant answers; the owner decides.
    let s = ok(applyRequestInformation(as(JORDAN, ORG_C, h.state), { organizationId: ORG_C, exceptionId: exc.id, comment: 'Was ID shown?', at: AT })).state;
    s = ok(applyExceptionNote(as(ESTHER, ORG_A, s), { organizationId: ORG_A, exceptionId: exc.id, comment: 'Yes, a staff card.', at: AT })).state;
    const answered = exceptionsVisibleTo(as(JORDAN, ORG_C, s), ORG_C).find((e) => e.id === exc.id)!;
    expect(answered.history.at(-1)).toMatchObject({ action: 'note-added', comment: 'Yes, a staff card.' });
    expect(applyResolveException(as(ESTHER, ORG_A, s), { organizationId: ORG_A, exceptionId: exc.id, outcome: 'verification-confirmed', reason: 'x', at: AT })).toMatchObject({ ok: false });
    s = ok(applyResolveException(as(JORDAN, ORG_C, s), { organizationId: ORG_C, exceptionId: exc.id, outcome: 'verification-not-confirmed', reason: 'Face did not match.', at: AT })).state;
    s = ok(applyApprovalDecision(as('usr_tobyson', ORG_C, s), { organizationId: ORG_C, exceptionId: exc.id, decision: 'approve', reason: '', at: AT })).state;
    expect(exceptionsVisibleTo(as(ESTHER, ORG_A, s), ORG_A).find((e) => e.id === exc.id)!.resolution).toMatchObject({ outcome: 'verification-not-confirmed' });
  });

  it('an interrupted attempt is recorded, times out as Incomplete and isn’t counted as an outcome; starting again doesn’t duplicate it', async () => {
    const h = await setup();
    const first = ok(h.service.startAttempt(ORG_A, 'shared_visit')).attempt;
    // A repeated start (double click, retry) resumes the same untouched attempt.
    expect(ok(h.service.startAttempt(ORG_A, 'shared_visit')).attempt.id).toBe(first.id);
    await h.service.lookupExternal(first.id, 'DEMO-10001');
    h.state = reducer(h.state, { type: 'verify/expire', at: new Date(Date.now() + ATTEMPT_TTL_MS + 60_000).toISOString() });
    const expired = h.state.data.verificationAttempts.find((x) => x.id === first.id)!;
    expect(expired.status).toBe('expired');
    expect(stageOf(expired)).toBe('incomplete');
    expect(expired.decision).toBeUndefined();
    const sum = summarize(h.state, [expired]);
    expect(sum).toMatchObject({ attempts: 1, incomplete: 1, allowed: 0, denied: 0, pendingReview: 0, unableToComplete: 0, completed: 0 });
    const owner = as(JORDAN, ORG_C, h.state);
    expect(sharedResults(owner, owner.data.activityConfigs.find((x) => x.id === 'shared_visit')!).summary).toMatchObject({ incomplete: 1, unableToComplete: 0 });
    expect(getVerificationStatus(owner, { clientId: `client_${ORG_C}`, transactionId: first.id }).body).toMatchObject({ status: 'INCOMPLETE' });
    // It can't be finished later, and a new attempt is separate.
    expect(await h.service.completeExternal(first.id, { captured: true, demo: MATCH }, { submissionId: 'late' })).toMatchObject({ ok: false });
    const next = await verify(h, ORG_A, 'shared_visit', 'DEMO-10001', MATCH);
    expect(next.id).not.toBe(first.id);
    expect(next.decision).toBe('allow');
  });
});

function renderAs(path: string, accountId: string) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={createInitialState(new Date())}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('screens', () => {
  it('navigation has one Verification Activities section and old programme links redirect to it', async () => {
    renderAs('/programmes', 'acct_demo_b_admin');
    expect(await screen.findByRole('heading', { name: 'Verification Activities' }, { timeout: 4000 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).queryByText(/Programmes/)).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Verification Activities/ })).toBeInTheDocument();
  });

  it('creates an activity for the organization’s own use without choosing technical methods', async () => {
    const user = renderAs('/verification-activities/new', JORDAN);
    await screen.findByRole('heading', { name: 'Create activity' }, { timeout: 4000 });
    // No activity types or audience question: the wizard starts with the details.
    expect(screen.queryByRole('heading', { name: 'What do you want to do?' })).not.toBeInTheDocument();
    await wizardToVerifiers(user, { name: 'Front Desk Check', source: 'Brightwater Identity Service' });
    expect(screen.queryByText(/Local eligible population|External source eligibility|Reference list eligibility|Match the person’s face/)).not.toBeInTheDocument();
    await cont(user);
    expect(screen.getByRole('region', { name: 'Identity source' })).toHaveTextContent('SourceBrightwater Identity Service');
    await user.click(screen.getByRole('button', { name: 'Create activity' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Front Desk Check/ }, { timeout: 4000 })).toBeInTheDocument();
    const saved = loadState()!.data.activityConfigs.find((a) => a.name === 'Front Desk Check')!;
    expect(saved.sharing).toBeUndefined();
    // The portrait baseline, from the source: never a record lookup alone, and nothing goes to human review.
    expect(saved.verification).toMatchObject({ identitySource: { kind: 'external', integrationId: 'int_c_delegates' }, method: 'face', liveness: 'required', exceptions: 'unsuccessful', eligibility: { approach: 'external-source' } });
  });

  it('delegates an activity to a sub-organization, which needs a connected identity source', async () => {
    const user = renderAs('/verification-activities/new', 'acct_demo_b_admin');
    await screen.findByRole('heading', { name: 'Create activity' }, { timeout: 4000 });
    await wizardToVerifiers(user, { name: 'Partner Check', source: 'Group Identity Service' });
    await user.click(within(screen.getByRole('group', { name: 'Authorised sub-organizations' })).getByRole('checkbox', { name: /Meridian Harbourside/ }));
    // FixID records can't be used once a sub-organization verifies: it would see the owner's records.
    await user.click(screen.getByRole('button', { name: /Step 3/ }));
    expect(screen.getByRole('radio', { name: 'FixID records' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Step 4/ }));
    await cont(user);
    expect(screen.getByRole('region', { name: 'Verifiers' })).toHaveTextContent('Authorised sub-organizationsMeridian Harbourside');
    await user.click(screen.getByRole('button', { name: 'Create activity' }));
    // The owner's Overview, calculated from stored records (none yet), with results by organization.
    const summary = await screen.findByRole('region', { name: 'Verification summary' }, { timeout: 4000 });
    await waitFor(() => expect(summary).toHaveTextContent('Total attempts0'));
    expect(screen.getByText('Results by organization')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Configuration' }));
    const row = screen.getAllByRole('row').find((r) => within(r).queryAllByText('Meridian Harbourside').length > 0)!;
    expect(within(row).getByText('Invited')).toBeInTheDocument();
  });

  it('the invited organization accepts in its own workspace, assigns its verifiers, and can’t edit the activity', async () => {
    const user = renderAs('/verification-activities', JORDAN);
    await user.click(await screen.findByRole('tab', { name: /Invited Activities/ }, { timeout: 4000 }));
    const row = screen.getAllByRole('row').find((r) => within(r).queryAllByText('Group Staff Entry').length > 0)!;
    expect(row).toHaveTextContent('Meridian Group');
    expect(row).toHaveTextContent('Invited');
    await user.click(within(row).getByRole('button', { name: /Accept/ }));
    await user.click(await screen.findByRole('link', { name: /Assign verifiers/ }));
    expect(await screen.findByText('Set by Meridian Group.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Verifiers' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your results' })).toHaveTextContent('Total attempts0');
  });
  it('the owner’s Overview counts every organization’s records, and Participants filters them', async () => {
    const user = renderAs(`/verification-activities/${DEMO_SHARED_ACTIVITY}`, 'acct_demo_b_admin');
    const summary = await screen.findByRole('region', { name: 'Verification summary' }, { timeout: 4000 });
    // Seeded records: B1 three (a match, a mismatch, a match whose record isn't eligible), B2 two (a match, an outage).
    await waitFor(() => expect(summary).toHaveTextContent('Total attempts5'));
    expect(summary).toHaveTextContent('Verified3');
    expect(summary).toHaveTextContent('Unsuccessful1');
    expect(summary).toHaveTextContent('Pending or incomplete1');
    // The Overview's only table: results by organization.
    expect(screen.getByText('Results by organization')).toBeInTheDocument();
    const harbourside = screen.getAllByRole('row').find((r) => r.textContent?.includes('Meridian Harbourside'))!;
    expect(within(harbourside).getAllByRole('cell').map((c) => c.textContent).slice(1)).toEqual(['3', '2', '1', '0']);
    await user.click(screen.getByRole('tab', { name: 'Participants' }));
    await user.selectOptions(screen.getByLabelText('Verification status'), 'unsuccessful');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Unsuccessful');
    // Identifiers are masked.
    expect(document.body.textContent).not.toContain('DEMO-10001');
  });

  it('earlier tab links open the tab that now holds that information', async () => {
    const user = renderAs(`/verification-activities/${DEMO_SHARED_ACTIVITY}?tab=transactions`, 'acct_demo_b_admin');
    const tabs = await screen.findAllByRole('tab', {}, { timeout: 4000 });
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Participants', 'Configuration']);
    expect(screen.getByRole('tab', { name: 'Participants' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });
});
