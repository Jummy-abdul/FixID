import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_SESSION } from '@/auth/authCore';
import { DEMO_PERSONAS, ORG_A, ORG_B, ORG_B1, ORG_B2, ORG_C } from '@/data/demoPersonas';
import { DEMO_SHARED_ACTIVITY } from '@/data/seed';
import { permissionsFor } from '@/domain/roles';
import { getVerificationStatus } from '@/services/statusApi/statusApi';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import {
  applyAssignException, applyCloseException, applyExceptionNote, applyResolveException, applyStartReview, exceptionFor, exceptionsVisibleTo,
} from '@/store/exceptionOps';
import { loadState } from '@/store/persistence';
import { sharedActivityTransactions, sharedResults, toCsv } from '@/store/reporting';
import { createInitialState, reducer, type Action, type AppState } from '@/store/state';
import { createVerificationService } from '@/verification/engine';

const AT = new Date().toISOString();
const STAFF = DEMO_SHARED_ACTIVITY;
const DELEGATE = `${ORG_C}_va_visitor_checkin`;
const SPEAKER = `${ORG_C}_va_restricted_lounge`;
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };

function as(accountId: string, orgId: string, s = createInitialState(new Date())): AppState {
  const p = DEMO_PERSONAS.find((x) => x.accountId === accountId);
  const admin = p ? { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner' as const, organizationIds: [orgId] } : { ...s.data.admin, id: accountId };
  return { ...s, data: { ...s.data, admin }, session: { ...s.session, currentOrganizationId: orgId } };
}
const tobyson = (s?: AppState) => as('usr_tobyson', ORG_C, s);
const victor = (s?: AppState) => as('acct_demo_b_admin', ORG_B, s);
const tomi = (s?: AppState) => as('acct_demo_b1_verifier', ORG_B1, s);
const exc = (s: AppState, reason: string, org: string) => s.data.verificationExceptions.find((e) => e.reason === reason && e.organizationId === org)!;
const reviewerId = (s: AppState, org: string, userId: string) => s.data.administrators.find((a) => a.organizationId === org && a.userId === userId)!.id;

function harness(initial: AppState) {
  let state = initial;
  const dispatch = (a: Action) => { state = reducer(state, a); };
  const service = createVerificationService({ getState: () => state, dispatch, idSwitch: createMockIdSwitch(), timeoutMs: 2000 });
  return { get state() { return state; }, set state(v: AppState) { state = v; }, service, dispatch };
}
type H = ReturnType<typeof harness>;
async function external(h: H, org: string, activityId: string, reference: string, demo: { liveness: 'passed' | 'failed'; match: string }, opts: { reverificationOf?: string } = {}) {
  const started = h.service.startAttempt(org, activityId, opts);
  if (!started.ok) throw new Error(started.error);
  await h.service.lookupExternal(started.attempt.id, reference);
  const done = await h.service.completeExternal(started.attempt.id, { captured: true, demo }, { submissionId: `s-${started.attempt.id}` });
  if (!done.ok) throw new Error(done.error);
  return done.attempt;
}

function renderApp(path: string, state: AppState, accountId: string) {
  if (accountId !== 'usr_tobyson') localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} {...(accountId === 'usr_tobyson' ? { authSession: DEMO_SESSION } : {})}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('exception creation and routing', () => {
  it('review-required transactions get linked exceptions; definitive failures and outages without review don’t', () => {
    const s = createInitialState(new Date());
    const byKey = (k: string) => s.data.verificationAttempts.find((a) => a.id.endsWith(k))!;
    expect(byKey('D02')).toMatchObject({ decision: 'pending-review', exceptionId: expect.stringMatching(/^EXC-/) });
    expect(byKey('D07').decision).toBe('deny');
    expect(byKey('D09')).toMatchObject({ decision: 'unable-to-decide', stage: 'unable-to-complete' });
    expect(byKey('D05').decision).toBe('unable-to-decide');
    for (const k of ['D07', 'D09', 'D05', 'D06']) expect(byKey(k).exceptionId).toBeUndefined();
  });

  it('routes by owner: shared activities’ exceptions go to the owner’s reviewers; own activities stay local', () => {
    const s = createInitialState(new Date());
    expect(exc(s, 'identity-mismatch', ORG_B1)).toMatchObject({ route: 'owner', reviewOrganizationId: ORG_B, activityOwnerId: ORG_B, status: 'open' });
    expect(exc(s, 'identity-mismatch', ORG_C)).toMatchObject({ route: 'local', reviewOrganizationId: ORG_C, status: 'open' });
    expect(exc(s, 'eligibility-not-met', ORG_B1)).toMatchObject({ status: 'in-review', assignedReviewerName: 'Victor Hale' });
  });

  it('a verifier’s Submit for Review raises a disputed exception', async () => {
    const h = harness(tobyson());
    const a = await external(h, ORG_C, DELEGATE, 'DEMO-10002', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' });
    expect(a.decision).toBe('deny');
    expect(a.exceptionId).toBeUndefined();
    expect(h.service.referForReview(a.id, 'Says the record is wrong').ok).toBe(true);
    const linked = h.state.data.verificationAttempts.find((x) => x.id === a.id)!;
    expect(exceptionFor(h.state, linked.exceptionId!)).toMatchObject({ reason: 'disputed', route: 'local', status: 'open' });
    // The original decision stays Deny.
    expect(linked.decision).toBe('deny');
  });
});

describe('review workflow', () => {
  it('only authorized reviewers in the reviewing organization can act; participants and auditors are read-only', () => {
    const s = createInitialState(new Date());
    const e = exc(s, 'identity-mismatch', ORG_B1);
    // The participant can see the exception from its own transaction but not resolve it.
    const b1 = as('acct_demo_b1_admin', ORG_B1, s);
    expect(exceptionsVisibleTo(b1, ORG_B1).map((x) => x.id)).toContain(e.id);
    expect(applyResolveException(b1, { organizationId: ORG_B1, exceptionId: e.id, outcome: 'verification-not-confirmed', reason: 'x', at: AT })).toMatchObject({ ok: false });
    // An unrelated organization sees nothing.
    expect(exceptionsVisibleTo(as('acct_demo_a_admin', ORG_A, s), ORG_A)).toEqual([]);
    expect(exceptionsVisibleTo(as('acct_demo_b2_admin', ORG_B2, s), ORG_B2).some((x) => x.organizationId === ORG_B1)).toBe(false);
    // Verifiers can't review; auditors can view only.
    expect(permissionsFor(['verifier']).has('exceptions.review')).toBe(false);
    expect(permissionsFor(['auditor']).has('exceptions.view')).toBe(true);
    expect(permissionsFor(['auditor']).has('exceptions.review')).toBe(false);
    const tomiState = tomi(s);
    expect(reducer(tomiState, { type: 'exceptions/close', organizationId: ORG_B1, exceptionId: e.id, at: AT })).toBe(tomiState);
  });

  it('assignment, notes and resolution are recorded and audited without changing the original evidence', () => {
    let s = victor();
    const e = exc(s, 'identity-mismatch', ORG_B1);
    const original = s.data.verificationAttempts.find((a) => a.id === e.transactionId)!;
    s = ok(applyAssignException(s, { organizationId: ORG_B, exceptionId: e.id, reviewerId: reviewerId(s, ORG_B, 'acct_demo_b_admin'), at: AT })).state;
    s = ok(applyStartReview(s, { organizationId: ORG_B, exceptionId: e.id, at: AT })).state;
    s = ok(applyExceptionNote(s, { organizationId: ORG_B, exceptionId: e.id, comment: 'Reviewed the transaction steps.', evidenceRefs: ['DOC-1'], at: AT })).state;
    // A No Match can't be confirmed without a successful reverification.
    expect(applyResolveException(s, { organizationId: ORG_B, exceptionId: e.id, outcome: 'verification-confirmed', reason: 'Looks fine', at: AT })).toMatchObject({ ok: false, error: expect.stringMatching(/can’t be overridden/) });
    s = ok(applyResolveException(s, { organizationId: ORG_B, exceptionId: e.id, outcome: 'verification-not-confirmed', reason: 'Identity not confirmed.', at: AT })).state;
    s = ok(applyCloseException(s, { organizationId: ORG_B, exceptionId: e.id, at: AT })).state;
    const after = exceptionFor(s, e.id)!;
    expect(after.history.map((h) => h.action)).toEqual(['created', 'assigned', 'review-started', 'note-added', 'resolution-recorded', 'closed']);
    expect(after).toMatchObject({ status: 'closed', resolution: { outcome: 'verification-not-confirmed', disposition: 'deny' } });
    const tx = s.data.verificationAttempts.find((a) => a.id === e.transactionId)!;
    // Original evidence unchanged; the disposition is recorded beside it.
    expect(tx.match).toEqual(original.match);
    expect(tx.decision).toBe('pending-review');
    expect(tx.reviewDisposition).toMatchObject({ decision: 'deny', outcome: 'verification-not-confirmed', exceptionId: e.id });
    const audit = s.data.audit.filter((x) => x.resourceId === e.id).map((x) => x.action);
    expect(audit).toEqual(expect.arrayContaining(['exception.assigned', 'exception.review-started', 'exception.note-added', 'exception.resolved', 'exception.closed']));
    // Filed in the reviewing organization (with the target) and in the transaction's organization.
    expect(s.data.audit.find((x) => x.action === 'exception.resolved' && x.organizationId === ORG_B)).toMatchObject({ actorOrganizationId: ORG_B, targetOrganizationId: ORG_B1, correlationId: e.transactionId });
    expect(s.data.audit.some((x) => x.action === 'exception.resolved' && x.organizationId === ORG_B1)).toBe(true);
  });

  it('Scenario C: reverification creates a new linked transaction, keeps the original, and allows confirmation only after it succeeds', async () => {
    const h = harness(tobyson());
    const e = exc(h.state, 'identity-mismatch', ORG_C);
    const original = h.state.data.verificationAttempts.find((a) => a.id === e.transactionId)!;
    // No reverification until a reviewer requires it.
    expect(h.service.startAttempt(ORG_C, SPEAKER, { reverificationOf: e.id })).toMatchObject({ ok: false });
    h.state = ok(applyResolveException(h.state, { organizationId: ORG_C, exceptionId: e.id, outcome: 'reverification-required', reason: 'Capture quality was poor.', at: AT })).state;
    expect(exceptionFor(h.state, e.id)).toMatchObject({ status: 'awaiting-information', reverificationRequested: { by: 'Tobyson TE' } });
    const again = await external(h, ORG_C, SPEAKER, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' }, { reverificationOf: e.id });
    expect(again).toMatchObject({ reverificationOf: e.id, decision: 'allow' });
    expect(again.exceptionId).toBeUndefined();
    const updated = exceptionFor(h.state, e.id)!;
    expect(updated).toMatchObject({ status: 'in-review', reverificationTransactionIds: [again.id] });
    expect(updated.history.slice(-2).map((x) => x.action)).toEqual(['reverification-started', 'reverification-completed']);
    expect(h.state.data.verificationAttempts.find((a) => a.id === original.id)).toEqual(original);
    h.state = ok(applyResolveException(h.state, { organizationId: ORG_C, exceptionId: e.id, outcome: 'verification-confirmed', reason: 'Reverification matched.', at: AT })).state;
    expect(h.state.data.verificationAttempts.find((a) => a.id === original.id)!).toMatchObject({ match: { status: 'no-match' }, decision: 'pending-review', reviewDisposition: { decision: 'allow' } });
  });

  it('an eligibility question can be confirmed by the reviewer, because identity evidence supports it', () => {
    let s = victor();
    const e = exc(s, 'eligibility-not-met', ORG_B1);
    s = ok(applyResolveException(s, { organizationId: ORG_B, exceptionId: e.id, outcome: 'verification-confirmed', reason: 'Suspension was lifted; confirmed with the record owner.', at: AT })).state;
    expect(exceptionFor(s, e.id)!.resolution).toMatchObject({ disposition: 'allow' });
  });
});

describe('Verification Status API (simulated)', () => {
  it('Scenarios A, D and H: completed, unable and pending statuses; review updates the disposition but not the evidence', () => {
    let s = victor();
    const tx = (k: string) => s.data.verificationAttempts.find((a) => a.id.endsWith(k))!;
    const as = (client: string, k: string) => getVerificationStatus(s, { clientId: client, transactionId: tx(k).id });
    expect(as(`client_${ORG_C}`, 'D06')).toMatchObject({ httpStatus: 200, body: { status: 'COMPLETED', identityMatch: 'MATCH', eligibility: 'ELIGIBLE', decision: 'ALLOW', simulated: true, simulatedEvidence: true } });
    expect(as(`client_${ORG_B2}`, 'D05')).toMatchObject({ httpStatus: 200, body: { status: 'UNABLE_TO_COMPLETE', decision: 'UNABLE_TO_DECIDE' } });
    const pending = as(`client_${ORG_B1}`, 'D02');
    expect(pending).toMatchObject({ httpStatus: 200, body: { status: 'PENDING_REVIEW', decision: 'PENDING_REVIEW', identityMatch: 'NO_MATCH' } });
    expect(JSON.stringify(pending.body)).not.toMatch(/DEMO-10001|Sample Person/);
    // The shared activity owner's client can read transactions of its shared activity.
    expect(as(`client_${ORG_B}`, 'D02').httpStatus).toBe(200);
    const e = exc(s, 'identity-mismatch', ORG_B1);
    s = ok(applyResolveException(s, { organizationId: ORG_B, exceptionId: e.id, outcome: 'verification-not-confirmed', reason: 'Not confirmed.', at: AT })).state;
    expect(as(`client_${ORG_B1}`, 'D02')).toMatchObject({ body: { status: 'COMPLETED', decision: 'DENY', originalDecision: 'PENDING_REVIEW', identityMatch: 'NO_MATCH', review: { outcome: 'VERIFICATION_NOT_CONFIRMED' } } });
  });

  it('refuses unauthenticated and unrelated clients without revealing whether the transaction exists', () => {
    const s = createInitialState(new Date());
    const id = s.data.verificationAttempts.find((a) => a.id.endsWith('D02'))!.id;
    expect(getVerificationStatus(s, { transactionId: id })).toMatchObject({ httpStatus: 401 });
    expect(getVerificationStatus(s, { clientId: `client_${ORG_C}`, transactionId: id })).toMatchObject({ httpStatus: 404, body: { error: 'NOT_FOUND' } });
    expect(getVerificationStatus(s, { clientId: `client_${ORG_B2}`, transactionId: id })).toMatchObject({ httpStatus: 404 });
    expect(getVerificationStatus(s, { clientId: `client_${ORG_C}`, transactionId: 'VER-NOPE' })).toEqual(getVerificationStatus(s, { clientId: `client_${ORG_C}`, transactionId: 'VER-NOPE' }));
    const audited = reducer(s, { type: 'api/statusRequest', clientId: `client_${ORG_C}`, transactionId: id, at: AT });
    expect(audited.data.audit[0]).toMatchObject({ action: 'api.status-denied', result: 'denied', organizationId: ORG_C });
  });

  it('never returns ALLOW while a review is unresolved', () => {
    const s = createInitialState(new Date());
    for (const a of s.data.verificationAttempts) {
      const r = getVerificationStatus(s, { clientId: `client_${a.organizationId}`, transactionId: a.id });
      if (r.httpStatus === 200 && r.body.status === 'PENDING_REVIEW') expect(r.body.decision).toBe('PENDING_REVIEW');
    }
  });
});

describe('shared activity results and reporting', () => {
  it('Scenario E: the owner’s results count only its shared activity, by organization', () => {
    const s = createInitialState(new Date());
    const act = s.data.activityConfigs.find((a) => a.id === STAFF)!;
    const o = sharedResults(s, act);
    expect(o.rows.filter((r) => r.summary.attempts > 0).map((r) => [r.organizationId, r.summary.attempts, r.summary.completed, r.summary.pendingReview])).toEqual([[ORG_B1, 3, 1, 2], [ORG_B2, 2, 1, 0]]);
    expect(o.summary.unableToComplete).toBe(1);
    // Transactions of the participants' own activities are excluded.
    expect(sharedActivityTransactions(s, act).every((a) => a.activityId === STAFF)).toBe(true);
  });

  it('a suspended participant doesn’t start new verification attempts', () => {
    let s = victor();
    s = reducer(s, { type: 'sharing/participant', organizationId: ORG_B, activityId: STAFF, participantId: ORG_B1, status: 'suspended', at: AT });
    const h = harness(tomi(s));
    expect(h.service.startAttempt(ORG_B1, STAFF)).toMatchObject({ ok: false });
  });

  it('CSV export holds aggregates only', () => {
    expect(toCsv([['Decision: Allow', 2], ['Name, with comma', 1]])).toBe('Decision: Allow,2\n"Name, with comma",1');
  });
});

describe('screens', () => {
  it('lists exceptions for the programme owner with the required columns and filters, and resolves one', async () => {
    const user = renderApp('/exceptions', victor(), 'acct_demo_b_admin');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Exception', 'Transaction', 'Activity', 'Organization', 'Reviewed by', 'Reason', 'Status', 'Assigned Reviewer', 'Created', 'Last Updated', 'Actions']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    await user.selectOptions(screen.getByLabelText('Reason'), 'identity-mismatch');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    await user.click(within(screen.getByRole('table')).getByRole('link', { name: /^EXC-/ }));
    expect(await screen.findByLabelText('Verification information')).toHaveTextContent('Identity match resultNo match');
    await user.click(screen.getByRole('button', { name: 'Assign to me' }));
    await user.click(screen.getByRole('button', { name: 'Start Review' }));
    expect(screen.getByLabelText('Exception overview')).toHaveTextContent('In Review');
    await user.selectOptions(screen.getByLabelText('Decision'), 'verification-confirmed');
    expect(screen.getByText(/can’t be overridden/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Decision'), 'verification-not-confirmed');
    await user.type(screen.getByLabelText('Reason'), 'Identity could not be confirmed.');
    await user.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(screen.getByLabelText('Resolution')).toHaveTextContent('Reject'));
    expect(screen.getByLabelText('Verification information')).toHaveTextContent('Identity match resultNo match');
    expect(loadState()!.data.audit.some((a) => a.action === 'exception.resolved')).toBe(true);
  });

  it('Scenario F: an Auditor sees history, exceptions and audit read-only', async () => {
    const s = as(`${ORG_A}_usr_2`, ORG_A);
    renderApp('/exceptions', s, `${ORG_A}_usr_2`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Exceptions' })).toBeInTheDocument();
    cleanupAndRender(`/audit`, s, `${ORG_A}_usr_2`);
    expect(await screen.findByText(/not tamper-resistant audit evidence/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit|Delete/ })).toBeNull();
  });

  it('Scenario F: an auditor in the reviewing organization can open an exception without any review actions', async () => {
    let s = victor();
    // Give Meridian an Auditor (read-only) and sign in as them.
    const auditor = { ...s.data.administrators.find((a) => a.organizationId === ORG_B && a.userId === 'acct_demo_b_admin')!, id: 'adm_b_auditor', userId: 'acct_b_auditor', roleIds: ['auditor'], name: 'Read Only' };
    s = { ...s, data: { ...s.data, administrators: [...s.data.administrators, auditor] } };
    s = as('acct_b_auditor', ORG_B, s);
    const id = exc(s, 'identity-mismatch', ORG_B1).id;
    expect(exceptionsVisibleTo(s, ORG_B).some((e) => e.id === id)).toBe(true);
    expect(applyResolveException(s, { organizationId: ORG_B, exceptionId: id, outcome: 'unable-to-resolve', reason: 'x', at: AT })).toMatchObject({ ok: false, error: 'Your role can’t review exceptions.' });
  });

  it('Scenario G: opening another organization’s transaction is refused and audited', async () => {
    const s = as('acct_demo_a_admin', ORG_A);
    const foreign = s.data.verificationAttempts.find((a) => a.organizationId === ORG_C)!;
    renderApp(`/verification-history/${foreign.id}`, s, 'acct_demo_a_admin');
    await waitFor(() => expect(loadState()?.data.audit.some((a) => a.action === 'access.denied' && a.resourceId === foreign.id && a.organizationId === ORG_A)).toBe(true));
    expect(document.body.textContent).not.toContain('Visitor Check-in');
  });

  it('the owner sees its shared activity’s results by organization; a participant sees only its own', async () => {
    renderApp(`/verification-activities/${STAFF}?tab=organizations`, victor(), 'acct_demo_b_admin');
    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('Meridian Harbourside');
    // No people, references or other activities.
    expect(screen.getByRole('main')).not.toHaveTextContent(/DEMO-1000|Sample Person|Visitor Identity Check|Annual Staff Conference/);
    // A participant's administrator sees the requirements and its own verifications, nothing about the sibling organization.
    cleanupAndRender(`/verification-activities/${STAFF}`, as('acct_demo_b1_admin', ORG_B1), 'acct_demo_b1_admin');
    expect(await screen.findByText(/Set by Meridian Group/)).toBeInTheDocument();
    expect(screen.getByRole('main')).not.toHaveTextContent('Meridian Eastgate');
  });

  it('the dashboard shows verification operations from stored records', async () => {
    renderApp('/', tobyson(), 'usr_tobyson');
    const ops = await screen.findByRole('region', { name: 'Verification operations' });
    // Brightwater's four recorded transactions in the last 30 days.
    expect(ops).toHaveTextContent('Verification Attempts4');
    expect(within(ops).getByLabelText('Recent exceptions')).toHaveTextContent('Identity mismatch');
  });

  it('the status API demo shows a simulated response', async () => {
    const s = tobyson();
    const user = renderApp('/developer/status-api', s, 'usr_tobyson');
    await user.click(await screen.findByRole('button', { name: 'Request status' }));
    expect(screen.getByText('Simulated response')).toBeInTheDocument();
    expect(screen.getByLabelText('Response body')).toHaveTextContent('"simulated": true');
  });
});

/** Renders a second screen in the same test after clearing the first. */
function cleanupAndRender(path: string, state: AppState, accountId: string) {
  document.body.innerHTML = '';
  localStorage.clear();
  return renderApp(path, state, accountId);
}
