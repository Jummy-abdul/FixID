import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_SESSION } from '@/auth/authCore';
import { DEMO_PERSONAS, ORG_A, ORG_B, ORG_B1, ORG_C } from '@/data/demoPersonas';
import { DEMO_LOCAL_PEOPLE, DEMO_SHARED_ACTIVITY, buildSeed } from '@/data/seed';
import { defaultSettings } from '@/domain/activitySettings';
import { evaluateDecision, externalEligibility, stageOf } from '@/domain/transactions';
import { loadState } from '@/store/persistence';
import { createInitialState, reducer, type Action, type AppState } from '@/store/state';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import { createVerificationService } from '@/verification/engine';
import { CAPTURE } from './helpers/faceVerification';

const DELEGATE = `${ORG_C}_va_visitor_checkin`;
const SPEAKER = `${ORG_C}_va_restricted_lounge`;
const BADGE = `${ORG_C}_va_badge_collection`;
const STAFF = DEMO_SHARED_ACTIVITY;
let seq = 0;

/** Signed in as an account, in its organization (Tobyson for Brightwater). */
function as(accountId: string, orgId: string, s = createInitialState(new Date())): AppState {
  const p = DEMO_PERSONAS.find((x) => x.accountId === accountId);
  const admin = p ? { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner' as const, organizationIds: [orgId] } : s.data.admin;
  return { ...s, data: { ...s.data, admin }, session: { ...s.session, currentOrganizationId: orgId } };
}
const tobyson = (s?: AppState) => as('usr_tobyson', ORG_C, s);
const tomi = (s?: AppState) => as('acct_demo_b1_verifier', ORG_B1, s);

function harness(initial: AppState) {
  let state = initial;
  const dispatch = (a: Action) => { state = reducer(state, a); };
  const service = createVerificationService({ getState: () => state, dispatch, idSwitch: createMockIdSwitch(), timeoutMs: 2000 });
  return { get state() { return state; }, service };
}
type H = ReturnType<typeof harness>;

async function external(h: H, org: string, activityId: string, reference: string, demo?: { liveness?: 'passed' | 'failed' | 'inconclusive' | 'unavailable'; match?: string }) {
  const started = h.service.startAttempt(org, activityId);
  if (!started.ok) throw new Error(started.error);
  const id = started.attempt.id;
  const found = await h.service.lookupExternal(id, reference);
  if (!found.ok) throw new Error(found.error);
  if (found.attempt.status !== 'in-progress' || !demo) return found.attempt;
  const done = await h.service.completeExternal(id, { captured: true, demo }, { submissionId: `s${++seq}` });
  if (!done.ok) throw new Error(done.error);
  return done.attempt;
}

async function local(h: H, identifier: string, face: { match?: 'match' | 'no-match' | 'poor-capture' | 'unavailable'; liveness?: 'passed' | 'failed' | 'inconclusive' | 'unavailable' }) {
  const started = h.service.startAttempt(ORG_C, BADGE);
  if (!started.ok) throw new Error(started.error);
  const r = await h.service.submitInputs(started.attempt.id, { identifier, face: { image: CAPTURE, capturedAt: new Date().toISOString() }, demo: { face } }, { submissionId: `l${++seq}` });
  if (!r.ok) throw new Error(r.error);
  return r.attempt;
}

function renderApp(path: string, state: AppState, accountId: string) {
  // Tobyson is the built-in demonstration session; the others are demo persona accounts.
  if (accountId !== 'usr_tobyson') localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} {...(accountId === 'usr_tobyson' ? { authSession: DEMO_SESSION } : {})}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('Journey A: local identity verification', () => {
  it('Scenario 1: an enrolled, eligible person is matched and allowed (labelled simulated)', async () => {
    const h = harness(tobyson());
    const a = await local(h, DEMO_LOCAL_PEOPLE[0], { match: 'match', liveness: 'passed' });
    expect(a).toMatchObject({ identitySource: 'local', decision: 'allow', eligibilityStatus: 'eligible', match: { status: 'match', simulated: true }, liveness: { status: 'passed', simulated: true }, simulated: true });
    expect(a.decisionExplanation).toBe('Identity confirmed and eligibility requirements satisfied.');
    expect(stageOf(a)).toBe('completed');
    // Simulated checks never claim a real comparison.
    expect(a.checks.find((c) => c.type === 'face-match')!.explanation).toMatch(/Simulated matching result: match\. No faces were compared/);
  });

  it('Scenario 2: identity matches but the person isn’t eligible; the configured policy (mark unsuccessful) denies', async () => {
    const h = harness(tobyson());
    const a = await local(h, DEMO_LOCAL_PEOPLE[1], { match: 'match', liveness: 'passed' });
    expect(a).toMatchObject({ decision: 'deny', match: { status: 'match' }, eligibilityStatus: 'ineligible' });
    expect(a.decisionExplanation).toBe('Identity confirmed, but eligibility requirements were not met.');
  });

  it('enrollment is enforced: a person without an enrolled reference can’t be matched, and verification never enrolls them', async () => {
    const h = harness(tobyson());
    const started = h.service.startAttempt(ORG_C, BADGE);
    if (!started.ok) throw new Error(started.error);
    const found = await h.service.lookupParticipant(started.attempt.id, DEMO_LOCAL_PEOPLE[2]);
    expect(found).toMatchObject({ ok: true, eligibility: 'eligible', enrollment: 'not-enrolled', portrait: 'missing' });
    const a = await local(h, DEMO_LOCAL_PEOPLE[2], { match: 'match', liveness: 'passed' });
    expect(a.decision).not.toBe('allow');
    expect(h.state.data.members.find((m) => m.identifier?.value === DEMO_LOCAL_PEOPLE[2])!.faceEnrollment.status).toBe('not-enrolled');
  });

  it('a successful match never bypasses eligibility, and mandatory liveness failure can’t allow', async () => {
    const h = harness(tobyson());
    expect((await local(h, DEMO_LOCAL_PEOPLE[1], { match: 'match', liveness: 'passed' })).decision).not.toBe('allow');
    const live = await local(h, DEMO_LOCAL_PEOPLE[0], { match: 'match', liveness: 'failed' });
    expect(live.decision).not.toBe('allow');
    expect(live.match?.status).toBe('not-evaluated');
  });

  it('organizations without a facial provider or the demonstration setting still can’t produce a match', () => {
    const h = harness(as('acct_demo_a_admin', ORG_A));
    expect(h.service.faceMode(ORG_A)).toBe('unavailable');
    expect(h.service.faceMode(ORG_C)).toBe('simulated');
  });
});

describe('Journey B: external identity verification', () => {
  it('Scenarios 3 and 9: found, liveness passed, match, eligible → Allow, without any local record or enrollment', async () => {
    const h = harness(tobyson());
    const membersBefore = h.state.data.members.length;
    const a = await external(h, ORG_C, DELEGATE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' });
    expect(a).toMatchObject({
      identitySource: 'external', integrationId: 'int_c_delegates', serviceName: 'Brightwater Identity Service', decision: 'allow', eligibilityStatus: 'eligible',
      lookup: { status: 'FOUND', reference: 'DEMO-10001', referenceId: 'REF-10001', attributes: { displayName: 'Sample Person A', recordStatus: 'ACTIVE' } },
      liveness: { status: 'passed', simulated: true }, match: { status: 'match', simulated: true, providerTransactionId: expect.stringMatching(/^SIM-TXN-/) }, simulated: true,
    });
    // The provider's score is kept as given (it was genuinely supplied), with its own scale.
    expect(a.match).toMatchObject({ score: 0.96, scoreScale: '0_TO_1', threshold: 0.85 });
    expect(a.subject?.memberId).toBeUndefined();
    expect(h.state.data.members.length).toBe(membersBefore);
    // Unpermitted provider attributes never reach the transaction.
    expect(a.lookup!.attributes).not.toHaveProperty('recordType');
    // No raw capture anywhere in the stored data.
    expect(JSON.stringify(h.state.data.verificationAttempts)).not.toContain('data:image');
  });

  it('Scenario 4: not found stops progression; ending records the unresolved lookup and nobody is enrolled', async () => {
    const h = harness(tobyson());
    const a = await external(h, ORG_C, DELEGATE, 'DEMO-20001');
    expect(a).toMatchObject({ status: 'in-progress', lookup: { status: 'NOT_FOUND' } });
    const blocked = await h.service.completeExternal(a.id, { captured: true, demo: { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' } }, { submissionId: 'x' });
    expect(blocked).toMatchObject({ ok: false, error: 'Find the identity before continuing.' });
    const ended = h.service.endExternal(a.id);
    expect(ended).toMatchObject({ ok: true, attempt: { decision: 'deny', stage: 'failed', failureReason: 'No identity record was found for the reference provided.', match: { status: 'not-evaluated' } } });
  });

  it('the reference can be corrected after Not Found; each lookup is counted on the same transaction', async () => {
    const h = harness(tobyson());
    const a = await external(h, ORG_C, DELEGATE, 'DEMO-20001');
    const again = await h.service.lookupExternal(a.id, 'DEMO-10001');
    expect(again).toMatchObject({ ok: true, attempt: { id: a.id, lookup: { status: 'FOUND', count: 2 } } });
  });

  it('multiple matches are never auto-selected: the transaction goes to review', async () => {
    const h = harness(tobyson());
    const a = await external(h, ORG_C, DELEGATE, 'DEMO-30001');
    expect(a).toMatchObject({ status: 'completed', decision: 'pending-review', stage: 'pending-review', match: { status: 'not-evaluated' } });
  });

  it('Scenario 5: no match under a shared activity requiring review → Pending Review, not Deny', async () => {
    const h = harness(tomi());
    const a = await external(h, ORG_B1, STAFF, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' });
    expect(a).toMatchObject({ activityOwnerId: ORG_B, integrationId: 'int_b_identity', decision: 'pending-review', stage: 'pending-review', match: { status: 'no-match' } });
    expect(a.decisionExplanation).toBe('Identity could not be confirmed. Identity verification requires further review.');
    expect(a.review?.status).toBe('pending');
  });

  it('Scenario 6: the service is unavailable (lookup or matching) → Unable to Decide, no fallback', async () => {
    const h = harness(tobyson());
    const lookupDown = await external(h, ORG_C, DELEGATE, 'DEMO-50001');
    expect(lookupDown).toMatchObject({ status: 'in-progress', lookup: { status: 'UNAVAILABLE' } });
    expect(lookupDown.diagnostics?.[0]).toMatchObject({ step: 'lookup' });
    expect(h.service.endExternal(lookupDown.id)).toMatchObject({ ok: true, attempt: { decision: 'unable-to-decide', stage: 'unable-to-complete' } });
    const matchDown = await external(h, ORG_C, DELEGATE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-UNAVAILABLE' });
    expect(matchDown).toMatchObject({ decision: 'unable-to-decide', stage: 'unable-to-complete', match: { status: 'unavailable' }, eligibilityStatus: 'not-evaluated' });
    expect(matchDown.decisionExplanation).toBe('Verification could not be completed because the identity service is unavailable.');
    expect(matchDown.match?.score).toBeUndefined();
  });

  it('inconclusive matching is never a match, and eligibility isn’t evaluated', async () => {
    const h = harness(tobyson());
    const a = await external(h, ORG_C, DELEGATE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-INCONCLUSIVE' });
    expect(a).toMatchObject({ match: { status: 'inconclusive' }, eligibilityStatus: 'not-evaluated' });
    expect(a.decision).not.toBe('allow');
  });

  it('Scenario 7: match with eligibility failure follows the policy, keeping identity and eligibility separate', async () => {
    const h = harness(tobyson());
    // Visitor Check-in marks failures unsuccessful; Sample Person B's record is SUSPENDED.
    const deny = await external(h, ORG_C, DELEGATE, 'DEMO-10002', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' });
    expect(deny).toMatchObject({ match: { status: 'match' }, eligibilityStatus: 'ineligible', decision: 'deny' });
    // The shared activity requires review instead.
    const review = await external(harness(tomi()), ORG_B1, STAFF, 'DEMO-10002', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' });
    expect(review).toMatchObject({ match: { status: 'match' }, eligibilityStatus: 'ineligible', decision: 'pending-review' });
    // Reference-list eligibility: listed vs not listed.
    expect((await external(h, ORG_C, SPEAKER, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' })).eligibilityStatus).toBe('eligible');
    expect((await external(h, ORG_C, SPEAKER, 'DEMO-10002', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' })).eligibilityStatus).toBe('ineligible');
  });

  it('Scenario 8: mandatory liveness failure stops matching and can’t allow; the shared activity’s review policy applies', async () => {
    const h = harness(tomi());
    const a = await external(h, ORG_B1, STAFF, 'DEMO-10001', { liveness: 'failed', match: 'SIM-CAPTURE-MATCH' });
    expect(a).toMatchObject({ liveness: { status: 'failed', required: true }, match: { status: 'not-evaluated' }, decision: 'pending-review' });
    // Matching was never requested, so no provider transaction exists.
    expect(a.match?.providerTransactionId).toBeUndefined();
  });

  it('Scenario 10: the shared activity’s source and liveness come from the owner’s configuration, never the verifier', async () => {
    const h = harness(tomi());
    const started = h.service.startAttempt(ORG_B1, STAFF);
    if (!started.ok) throw new Error(started.error);
    expect(started.attempt).toMatchObject({ identitySource: 'external', integrationId: 'int_b_identity', activityOwnerId: ORG_B, organizationId: ORG_B1 });
    await h.service.lookupExternal(started.attempt.id, 'DEMO-10001');
    const skip = await h.service.completeExternal(started.attempt.id, { captured: true, demo: { liveness: 'unavailable', match: 'SIM-CAPTURE-MATCH' } }, { submissionId: 'p' });
    expect(skip).toMatchObject({ ok: true, attempt: { liveness: { required: true }, match: { status: 'not-evaluated' } } });
    expect((skip as { attempt: { decision: string } }).attempt.decision).not.toBe('allow');
  });

  it('Scenario 11: a successful result is reused within the validity period, linked and clearly marked', async () => {
    const h = harness(tobyson());
    const first = await external(h, ORG_C, DELEGATE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' });
    const second = await external(h, ORG_C, DELEGATE, 'DEMO-10001');
    expect(h.service.reusableResults(second.id).map((x) => x.id)).toEqual([first.id]);
    const reused = h.service.reuseResult(second.id, first.id, { submissionId: 'r1' });
    expect(reused).toMatchObject({ ok: true, attempt: { reusedFrom: first.id, decision: 'allow', eligibilityStatus: 'eligible' } });
    // A failed or reused result is never reusable.
    const failed = await external(h, ORG_C, DELEGATE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' });
    const third = await external(h, ORG_C, DELEGATE, 'DEMO-10001');
    expect(h.service.reusableResults(third.id).map((x) => x.id)).toEqual([first.id]);
    expect(h.service.reuseResult(third.id, failed.id, { submissionId: 'r2' })).toMatchObject({ ok: false });
    // An activity that verifies every time never reuses.
    const fresh = await external(h, ORG_C, SPEAKER, 'DEMO-10001');
    expect(h.service.reusableResults(fresh.id)).toEqual([]);
  });

  it('Scenario 12: another organization’s activity or transaction is refused, revealing nothing', async () => {
    const own = await external(harness(tobyson()), ORG_C, DELEGATE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' });
    const h = harness(tomi());
    expect(h.service.startAttempt(ORG_C, DELEGATE)).toMatchObject({ ok: false });
    expect(h.service.startAttempt(ORG_B1, DELEGATE)).toMatchObject({ ok: false });
    expect(h.service.getAttempt(own.id)).toBeUndefined();
  });

  it('duplicate submissions are idempotent and finished transactions can’t be changed', async () => {
    const h = harness(tobyson());
    const a = await external(h, ORG_C, DELEGATE, 'DEMO-10001');
    const once = await h.service.completeExternal(a.id, { captured: true, demo: { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' } }, { submissionId: 'same' });
    const twice = await h.service.completeExternal(a.id, { captured: true, demo: { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' } }, { submissionId: 'same' });
    expect(twice).toEqual(once);
    expect(await h.service.completeExternal(a.id, { captured: true, demo: { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' } }, { submissionId: 'other' })).toMatchObject({ ok: false, code: 'not-in-progress' });
    expect(await h.service.lookupExternal(a.id, 'DEMO-10002')).toMatchObject({ ok: false });
    // Two concurrent lookups for one transaction: the second is refused.
    const b = h.service.startAttempt(ORG_C, DELEGATE);
    if (!b.ok) throw new Error(b.error);
    const [x, y] = await Promise.all([h.service.lookupExternal(b.attempt.id, 'DEMO-10001'), h.service.lookupExternal(b.attempt.id, 'DEMO-10001')]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
  });

  it('a retry is a new linked transaction; the earlier result is kept', async () => {
    const h = harness(tobyson());
    const first = await external(h, ORG_C, DELEGATE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-UNAVAILABLE' });
    const retry = h.service.startAttempt(ORG_C, DELEGATE, { retryOf: first.id });
    expect(retry).toMatchObject({ ok: true, attempt: { retryOf: first.id } });
    expect(h.state.data.verificationAttempts.find((x) => x.id === first.id)!.decision).toBe('unable-to-decide');
  });
});

describe('decision evaluator and eligibility', () => {
  const s = defaultSettings();
  const review = { ...s, exceptions: 'review' as const };
  it('never allows on a failed mandatory check, unavailable service, inconclusive or unknown eligibility', () => {
    const base = { liveness: 'passed' as const, livenessRequired: true, eligibility: 'eligible' as const, settings: s };
    expect(evaluateDecision({ ...base, match: 'match' }).decision).toBe('allow');
    expect(evaluateDecision({ ...base, match: 'match', liveness: 'failed' }).decision).toBe('deny');
    expect(evaluateDecision({ ...base, match: 'match', liveness: 'failed', settings: review }).decision).toBe('pending-review');
    expect(evaluateDecision({ ...base, match: 'unavailable' }).decision).toBe('unable-to-decide');
    expect(evaluateDecision({ ...base, match: 'error' }).decision).toBe('unable-to-decide');
    expect(evaluateDecision({ ...base, match: 'inconclusive' }).decision).toBe('pending-review');
    expect(evaluateDecision({ ...base, match: 'match', eligibility: 'unknown' }).decision).toBe('pending-review');
    expect(evaluateDecision({ ...base, match: 'no-match', settings: review }).decision).toBe('pending-review');
    expect(evaluateDecision({ ...base, match: 'match', eligibility: 'not-required' }).explanation).toMatch(/doesn’t require an eligibility check/);
  });

  it('external eligibility uses only the configured approach; no predefined population is Not Required, never Eligible', () => {
    const lookup = { reference: 'DEMO-10001', referenceId: 'REF-10001', attributes: { recordStatus: 'ACTIVE', recordType: 'SAMPLE' } };
    expect(externalEligibility({ eligibility: { approach: 'none' } }, lookup).status).toBe('not-required');
    expect(externalEligibility({ eligibility: { approach: 'external-source' } }, lookup).status).toBe('eligible');
    expect(externalEligibility({ eligibility: { approach: 'external-source', attribute: 'membership' } }, lookup).status).toBe('unknown');
    expect(externalEligibility({ eligibility: { approach: 'reference-list', referenceList: ['ref-10001'] } }, lookup).status).toBe('eligible');
    expect(externalEligibility({ eligibility: { approach: 'reference-list', referenceList: ['OTHER-1'] } }, lookup).status).toBe('ineligible');
  });
});

describe('demonstration data', () => {
  it('pins the local scenario people so the scenarios are reproducible on any day', () => {
    for (const d of [new Date('2026-01-05T08:00:00Z'), new Date('2026-10-12T18:30:00Z')]) {
      const seed = buildSeed(d);
      expect(DEMO_LOCAL_PEOPLE.map((v) => seed.members.find((m) => m.identifier?.value === v)?.faceEnrollment.status)).toEqual(['enrolled', 'enrolled', 'not-enrolled']);
    }
  });
});

describe('screens', () => {
  it('runs the external journey: Identify Person, Capture Face (simulated), result with separate identity and eligibility', async () => {
    const user = renderApp(`/verify/activities/${DELEGATE}`, tobyson(), 'usr_tobyson');
    const reqs = await screen.findByLabelText('Verification requirements');
    expect(reqs).toHaveTextContent('Identity SourceBrightwater Identity Service');
    expect(reqs).toHaveTextContent('Required ChecksIdentifier, face match, liveness');
    await user.click(screen.getByRole('button', { name: 'Start Verification' }));
    expect(await screen.findByRole('heading', { name: 'Identify Person' })).toBeInTheDocument();
    expect(screen.getByText('Enter the reference provided for this verification.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter reference ID')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/External Reference ID/), 'DEMO-20001');
    await user.click(screen.getByRole('button', { name: 'Find Identity' }));
    expect(await screen.findByText('No identity record was found for the reference provided.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/External Reference ID/));
    await user.type(screen.getByLabelText(/External Reference ID/), 'DEMO-10001');
    await user.click(screen.getByRole('button', { name: 'Find Identity' }));
    const found = await screen.findByRole('region', { name: 'Identity found' });
    expect(found).toHaveTextContent('Sample Person A');
    expect(found).toHaveTextContent('Record StatusACTIVE');
    await user.click(within(found).getByRole('button', { name: 'Continue Verification' }));
    expect(screen.getByRole('heading', { name: 'Capture Face' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify Identity' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Use simulated capture' }));
    await user.click(screen.getByRole('radio', { name: 'Passed' }));
    await user.click(screen.getByRole('radio', { name: 'Match' }));
    await user.click(screen.getByRole('button', { name: 'Verify Identity' }));
    const outcome = await screen.findByRole('region', { name: 'Verification outcome' }, { timeout: 4000 });
    expect(outcome).toHaveTextContent('Verified');
    expect(outcome).toHaveTextContent('Simulated Result');
    expect(outcome).toHaveTextContent('Identity VerificationIdentity matched');
    expect(outcome).toHaveTextContent('EligibilityEligible');
    expect(outcome).toHaveTextContent('Verification SourceBrightwater Identity Service');
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(loadState()!.data.members.some((m) => m.displayName === 'Sample Person A')).toBe(false);
  });

  it('shows Pending Review in violet, never green, and offers Submit for Review only where it applies', async () => {
    const h = harness(tomi());
    const a = await external(h, ORG_B1, STAFF, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' });
    renderApp(`/verify/attempts/${a.id}`, h.state, 'acct_demo_b1_verifier');
    const outcome = await screen.findByRole('region', { name: 'Verification outcome' });
    expect(outcome).toHaveTextContent('Pending review');
    // The outcome banner itself is violet; green is reserved for Allow.
    expect(outcome.firstElementChild!.className).toMatch(/violet/);
    expect(outcome.firstElementChild!.className).not.toMatch(/emerald/);
    expect(outcome).toHaveTextContent('Identity could not be confirmed.');
  });

  it('lists local and external transactions in Verification History with details, never raw biometrics', async () => {
    const h = harness(tobyson());
    const ext = await external(h, ORG_C, DELEGATE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' });
    await local(h, DEMO_LOCAL_PEOPLE[1], { match: 'match', liveness: 'passed' });
    const user = renderApp('/verification-history', h.state, 'usr_tobyson');
    const rows = await screen.findAllByRole('row');
    const extRow = rows.find((r) => r.textContent?.includes(ext.id))!;
    expect(extRow).toHaveTextContent('Brightwater Identity Service');
    expect(extRow).toHaveTextContent('Verified');
    expect(rows.some((r) => r.textContent?.includes('FixID Local Records') && r.textContent.includes('Not verified'))).toBe(true);
    await user.click(within(extRow).getByRole('link', { name: `View details for ${ext.id}` }));
    const tx = await screen.findByLabelText('Verification transaction');
    expect(tx).toHaveTextContent('External Reference IDDEMO-10001');
    expect(tx).toHaveTextContent('Provider transaction');
    expect(tx).toHaveTextContent('Simulated');
    expect(document.body.innerHTML).not.toContain('data:image');
  });

  it('a participant’s verifier can’t open another organization’s transaction by URL', async () => {
    const own = await external(harness(tobyson()), ORG_C, DELEGATE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' });
    const h = harness(tobyson());
    h.state.data.verificationAttempts.push(own);
    renderApp(`/verify/attempts/${own.id}`, tomi(h.state), 'acct_demo_b1_verifier');
    expect(await screen.findByRole('heading', { name: 'Verification not available' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('DEMO-10001');
  });

  it('the shared activity owner sees counts by organization, not participants’ references', async () => {
    const h = harness(tomi());
    await external(h, ORG_B1, STAFF, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-MATCH' });
    renderApp(`/verification-activities/${STAFF}`, as('acct_demo_b_admin', ORG_B, h.state), 'acct_demo_b_admin');
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row').find((r) => r.textContent?.includes('Meridian Harbourside'))!;
    // Three seeded demonstration transactions plus this one: total, verified, unsuccessful, pending or incomplete.
    // Identity results only: a verified person who isn't eligible still counts as verified.
    expect(within(row).getAllByRole('cell').map((c) => c.textContent).slice(1, 5)).toEqual(['4', '3', '1', '0']);
    expect(document.body.textContent).not.toContain('DEMO-10001');
  });
});
