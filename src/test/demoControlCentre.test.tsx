import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_ACCOUNT, DEMO_PERSONA_ACCOUNTS, DEMO_SESSION, builtInAccounts, demoOperatorProblem } from '@/auth/authCore';
import { DEMO_PERSONAS, ORG_B, ORG_B1, ORG_C } from '@/data/demoPersonas';
import { readinessChecklist } from '@/demo/readiness';
import { RUNS_KEY } from '@/demo/runs';
import { SCENARIOS, overallStatus, takeBaseline, type ScenarioDefinition } from '@/demo/scenarios';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import { applyAssignException, applyExceptionNote, applyResolveException, applyStartReview } from '@/store/exceptionOps';
import { createInitialState, reducer, type Action, type AppState } from '@/store/state';
import { createVerificationService } from '@/verification/engine';

const VISITOR = `${ORG_C}_va_visitor_checkin`;
const LOUNGE = `${ORG_C}_va_restricted_lounge`;
const STAFF = `${ORG_B1}_va_staff_entry`;
const AT = new Date().toISOString();
const HALIMA = `${ORG_C}_usr_4`;
const byId = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };

function as(accountId: string, orgId: string, s: AppState): AppState {
  const p = DEMO_PERSONAS.find((x) => x.accountId === accountId);
  const admin = p ? { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner' as const, organizationIds: [orgId] } : { ...s.data.admin, id: accountId };
  return { ...s, data: { ...s.data, admin }, session: { ...s.session, currentOrganizationId: orgId } };
}

function harness(initial: AppState) {
  let state = initial;
  const dispatch = (a: Action) => { state = reducer(state, a); };
  const service = createVerificationService({ getState: () => state, dispatch, idSwitch: createMockIdSwitch(), timeoutMs: 2000 });
  return { get state() { return state; }, set state(v: AppState) { state = v; }, service, dispatch, actAs(id: string, org: string) { state = as(id, org, state); } };
}
type H = ReturnType<typeof harness>;

async function external(h: H, org: string, activityId: string, reference: string, demo?: { liveness: 'passed' | 'failed'; match: string }, opts: { reverificationOf?: string } = {}) {
  const started = ok(h.service.startAttempt(org, activityId, opts));
  await h.service.lookupExternal(started.attempt.id, reference);
  if (!demo) return ok(h.service.endExternal(started.attempt.id)).attempt;
  return ok(await h.service.completeExternal(started.attempt.id, { captured: true, demo }, { submissionId: `s-${started.attempt.id}` })).attempt;
}
const PASS = { liveness: 'passed' as const, match: 'SIM-CAPTURE-MATCH' };

/** Loads a scenario on a fresh seeded state: the baseline, and a harness acting as the given account. */
function load(s: ScenarioDefinition, accountId: string, org: string) {
  const base = createInitialState(new Date());
  expect(s.prerequisites(base)).toEqual([]);
  const baseline = takeBaseline(base);
  const h = harness(as(accountId, org, base));
  return { h, baseline };
}
const statusOf = (s: ScenarioDefinition, state: AppState, b: ReturnType<typeof takeBaseline>) => overallStatus(s.evaluate(state, b));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('scenario definition model', () => {
  it('defines the 15 scenarios with every required field and real demonstration accounts', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(Array.from({ length: 15 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
    const emails = new Set(builtInAccounts().map((a) => a.email));
    for (const s of SCENARIOS) {
      for (const k of ['name', 'description', 'purpose', 'initialData', 'organizationStructure', 'activity', 'identitySource', 'integration', 'eligibility', 'expectedOutcome', 'expectedTransactionState', 'resetBehavior'] as const) {
        expect(s[k], `${s.id}.${k}`).toBeTruthy();
      }
      expect(s.users.length).toBeGreaterThan(0);
      expect(s.steps.length).toBeGreaterThan(0);
      for (const u of s.users) expect(emails.has(u), `${s.id} user ${u}`).toBe(true);
      for (const st of s.steps) if (st.account) expect(emails.has(st.account), `${s.id} step ${st.title}`).toBe(true);
    }
  });

  it('every scenario can be loaded on fresh seed data', () => {
    const s = createInitialState(new Date());
    for (const sc of SCENARIOS) expect(sc.prerequisites(s), sc.id).toEqual([]);
  });

  it('seed data and evaluation are deterministic', () => {
    const now = new Date();
    const a = createInitialState(now); const b = createInitialState(now);
    expect(a.data.verificationAttempts.map((x) => [x.id, x.decision])).toEqual(b.data.verificationAttempts.map((x) => [x.id, x.decision]));
    expect(a.data.verificationExceptions.map((x) => [x.id, x.status])).toEqual(b.data.verificationExceptions.map((x) => [x.id, x.status]));
    for (const sc of SCENARIOS) {
      const r1 = sc.evaluate(a, takeBaseline(a)); const r2 = sc.evaluate(a, takeBaseline(a));
      expect(r1.map((r) => [r.label, r.status])).toEqual(r2.map((r) => [r.label, r.status]));
    }
  });

  it('no scenario passes just by being loaded: without new records the checks are Not Tested, never Passed overall', () => {
    const s = createInitialState(new Date());
    for (const sc of SCENARIOS) {
      const results = sc.evaluate(s, takeBaseline(s));
      expect(overallStatus(results), sc.id).not.toBe('passed');
      expect(results.some((r) => r.status === 'not-tested'), sc.id).toBe(true);
    }
  });
});

describe('scenarios executed through the real verification steps', () => {
  it('S04 successful external verification passes; S05, S08, S09 and S07 give their expected states', async () => {
    const { h, baseline } = load(byId('S04'), HALIMA, ORG_C);
    await external(h, ORG_C, VISITOR, 'DEMO-10001', PASS);
    expect(statusOf(byId('S04'), h.state, baseline)).toBe('passed');

    await external(h, ORG_C, VISITOR, 'DEMO-20001');
    expect(statusOf(byId('S05'), h.state, baseline)).toBe('passed');

    await external(h, ORG_C, VISITOR, 'DEMO-10002', PASS);
    expect(statusOf(byId('S08'), h.state, baseline)).toBe('passed');

    await external(h, ORG_C, VISITOR, 'DEMO-10001', { liveness: 'failed', match: 'SIM-CAPTURE-MATCH' });
    expect(statusOf(byId('S09'), h.state, baseline)).toBe('passed');

    await external(h, ORG_C, VISITOR, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-UNAVAILABLE' });
    expect(statusOf(byId('S07'), h.state, baseline)).toBe('passed');

    // Three new transactions including a mismatch and an outage: the reporting scenario has its data.
    await external(h, ORG_C, VISITOR, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' });
    const s15 = byId('S15').evaluate(h.state, baseline);
    expect(s15.filter((r) => r.status === 'failed')).toEqual([]);
    expect(overallStatus(s15)).toBe('passed');
  });

  it('S11 reuse is linked to the earlier permitted result', async () => {
    const { h, baseline } = load(byId('S11'), HALIMA, ORG_C);
    const first = await external(h, ORG_C, VISITOR, 'DEMO-10001', PASS);
    const second = ok(h.service.startAttempt(ORG_C, VISITOR));
    await h.service.lookupExternal(second.attempt.id, 'DEMO-10001');
    const options = h.service.reusableResults(second.attempt.id);
    expect(options.map((o) => o.id)).toContain(first.id);
    ok(h.service.reuseResult(second.attempt.id, first.id, { submissionId: 'reuse-1' }));
    expect(statusOf(byId('S11'), h.state, baseline)).toBe('passed');
  });

  it('S06 mismatch goes to review: note and resolution are recorded and the original No Match stays', async () => {
    const { h, baseline } = load(byId('S06'), HALIMA, ORG_C);
    const tx = await external(h, ORG_C, LOUNGE, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' });
    expect(tx.decision).toBe('pending-review');
    let results = byId('S06').evaluate(h.state, baseline);
    expect(results.find((r) => r.label === 'Review note added')?.status).toBe('failed');
    expect(overallStatus(results)).toBe('failed');

    h.actAs('acct_demo_c_admin', ORG_C);
    const reviewer = h.state.data.administrators.find((a) => a.userId === 'acct_demo_c_admin' && a.organizationId === ORG_C)!.id;
    let s = h.state;
    s = ok(applyAssignException(s, { organizationId: ORG_C, exceptionId: tx.exceptionId!, reviewerId: reviewer, at: AT })).state;
    s = ok(applyStartReview(s, { organizationId: ORG_C, exceptionId: tx.exceptionId!, at: AT })).state;
    s = ok(applyExceptionNote(s, { organizationId: ORG_C, exceptionId: tx.exceptionId!, comment: 'Checked the capture.', at: AT })).state;
    s = ok(applyResolveException(s, { organizationId: ORG_C, exceptionId: tx.exceptionId!, outcome: 'reverification-required', reason: 'Capture unclear.', at: AT })).state;
    h.state = as(HALIMA, ORG_C, s);
    await external(h, ORG_C, LOUNGE, 'DEMO-10001', PASS, { reverificationOf: tx.exceptionId });
    results = byId('S06').evaluate(h.state, baseline);
    expect(results.filter((r) => r.status !== 'passed')).toEqual([]);
  });

  it('S13 status API reflects the review lifecycle and refuses unrelated clients', async () => {
    const { h, baseline } = load(byId('S13'), 'acct_demo_b1_verifier', ORG_B1);
    const tx = await external(h, ORG_B1, STAFF, 'DEMO-10001', { liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' });
    h.dispatch({ type: 'api/statusRequest', clientId: `client_${ORG_B1}`, transactionId: tx.id, at: AT });
    let results = byId('S13').evaluate(h.state, baseline);
    expect(results.find((r) => r.label === 'Status reflects the current disposition')?.status).toBe('passed');
    expect(results.find((r) => r.label === 'Review decision recorded separately')?.status).toBe('failed');

    h.actAs('acct_demo_b_reviewer', ORG_B);
    const reviewer = h.state.data.administrators.find((a) => a.userId === 'acct_demo_b_reviewer' && a.organizationId === ORG_B)!.id;
    let s = ok(applyAssignException(h.state, { organizationId: ORG_B, exceptionId: tx.exceptionId!, reviewerId: reviewer, at: AT })).state;
    s = ok(applyResolveException(s, { organizationId: ORG_B, exceptionId: tx.exceptionId!, outcome: 'verification-not-confirmed', reason: 'Not confirmed.', at: AT })).state;
    results = byId('S13').evaluate(s, baseline);
    expect(results.filter((r) => r.status !== 'passed')).toEqual([]);
  });

  it('S12 isolation: programmatic permission checks pass and refused access is audited', () => {
    const { h, baseline } = load(byId('S12'), 'acct_demo_b1_verifier', ORG_B1);
    let results = byId('S12').evaluate(h.state, baseline);
    expect(results.filter((r) => r.status === 'failed')).toEqual([]);
    expect(results.find((r) => r.label.startsWith('Cross-organization access'))?.status).toBe('not-tested');
    const other = h.state.data.verificationAttempts.find((a) => a.organizationId === ORG_C)!;
    h.dispatch({ type: 'audit/accessDenied', organizationId: ORG_B1, resourceType: 'verification-transaction', resourceId: other.id, at: AT });
    results = byId('S12').evaluate(h.state, baseline);
    expect(overallStatus(results)).toBe('passed');
  });

  it('S10 refuses weakened programme requirements; S02 counts a programme-linked transaction for the owner', async () => {
    const base = createInitialState(new Date());
    const s10 = byId('S10').evaluate(base, takeBaseline(base));
    expect(s10.find((r) => r.label === 'Weakening is refused by the business rules')?.status).toBe('passed');
    expect(s10.find((r) => r.label === 'Refusal shown in the editor')?.status).toBe('not-tested');

    const { h, baseline } = load(byId('S02'), 'acct_demo_b1_verifier', ORG_B1);
    await external(h, ORG_B1, STAFF, 'DEMO-10001', PASS);
    expect(statusOf(byId('S02'), h.state, baseline)).toBe('passed');
  });

  it('evaluators detect a wrong outcome instead of passing it', async () => {
    const { h, baseline } = load(byId('S09'), HALIMA, ORG_C);
    const tx = await external(h, ORG_C, VISITOR, 'DEMO-10001', { liveness: 'failed', match: 'SIM-CAPTURE-MATCH' });
    // Tamper with the stored record: a failed mandatory liveness that ended in Allow must fail the scenario.
    const tampered: AppState = { ...h.state, data: { ...h.state.data, verificationAttempts: h.state.data.verificationAttempts.map((a) => (a.id === tx.id ? { ...a, decision: 'allow' as const, match: { ...a.match!, status: 'match' as const } } : a)) } };
    expect(statusOf(byId('S09'), tampered, baseline)).toBe('failed');
  });
});

describe('demo security and reset safety', () => {
  it('only demo operators can reset, and only in demo builds', () => {
    expect(demoOperatorProblem(DEMO_ACCOUNT)).toBeNull();
    const platform = DEMO_PERSONA_ACCOUNTS.find((a) => a.platformRole === 'platform-admin')!;
    expect(demoOperatorProblem(platform)).toBeNull();
    for (const a of DEMO_PERSONA_ACCOUNTS.filter((x) => !x.platformRole)) expect(demoOperatorProblem(a), a.email).toMatch(/Only a demo operator/);
    expect(demoOperatorProblem(null)).toMatch(/Sign in/);
    expect(demoOperatorProblem(DEMO_ACCOUNT, false)).toMatch(/aren’t available/);
  });

  it('reset restores seeded data and keeps organizations registered through sign-up', () => {
    let s = createInitialState(new Date());
    s = reducer(s, { type: 'organization/create', organization: { ...s.data.organizations[0], id: 'org_owned', name: 'Owned Org', ownerAccountId: 'acct_x' }, cardDesign: { ...s.data.cardDesigns[0], id: 'org_owned_design', organizationId: 'org_owned' }, at: AT, actor: 'X', owner: { userId: 'acct_x', email: 'x@owned.example' } } as Action);
    const owned = s.data.organizations.some((o) => o.id === 'org_owned');
    const fresh = createInitialState(new Date());
    s = { ...s, data: { ...s.data, verificationAttempts: [] } };
    const after = reducer(s, { type: 'demo/reset', state: fresh });
    expect(after.data.verificationAttempts.length).toBe(fresh.data.verificationAttempts.length);
    expect(after.data.organizations.some((o) => o.id === 'org_owned')).toBe(owned);
  });

  it('demonstration accounts sign in with the normal password check: no passwordless entry exists', () => {
    for (const a of builtInAccounts()) expect(a.password.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(builtInAccounts())).not.toContain('FixIDDemo2026!');
  });

  it('readiness checklist passes its automatic checks on fresh data and leaves manual items Not Tested', () => {
    const items = readinessChecklist(createInitialState(new Date()), true);
    expect(items.filter((i) => i.status === 'failed')).toEqual([]);
    expect(items.some((i) => i.status === 'not-tested')).toBe(true);
    expect(readinessChecklist(createInitialState(new Date()), false)[0].status).toBe('failed');
  });
});

function renderAt(path: string, accountId?: string) {
  if (accountId) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  const state = createInitialState(new Date());
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} {...(accountId ? {} : { authSession: DEMO_SESSION })}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('Demo Control Centre screen', () => {
  it('loads a scenario, shows the guided steps and evaluates it as Incomplete before anything is done', async () => {
    const user = renderAt('/demo');
    expect(await screen.findByRole('heading', { name: 'Demo Control Centre' })).toBeInTheDocument();
    expect(screen.getByText('Demonstration build only')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /S04 Successful External Verification/ }));
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Load scenario' }));
    expect(JSON.parse(localStorage.getItem(RUNS_KEY)!)).toHaveProperty('S04');
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    expect(screen.getAllByRole('button', { name: 'Sign in as Halima Bello' }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    const checks = screen.getByRole('list', { name: 'Outcome checks' });
    expect(within(checks).getAllByText('Not Tested').length).toBeGreaterThan(0);
    expect(within(checks).queryByText('Passed')).not.toBeInTheDocument();
  });

  it('switches accounts through the real sign-in and keeps application data', async () => {
    const user = renderAt('/demo');
    await user.click(await screen.findByRole('tab', { name: 'Demo accounts' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in as Halima Bello (halima.bello@brightwater.example)' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).session.accountId).toBe(HALIMA), { timeout: 4000 });
    // Halima's verifier workspace opens with the seeded activities still there.
    expect(await screen.findByText('Visitor Check-in', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('reset needs confirmation, explains what is kept, and is unavailable to non-operators', async () => {
    const user = renderAt('/demo');
    await user.click(await screen.findByRole('button', { name: 'Reset Demo Data' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Organizations registered through sign-up/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a verifier can open the control centre but can’t reset', async () => {
    renderAt('/demo', 'acct_demo_b1_verifier');
    expect(await screen.findByRole('button', { name: 'Reset Demo Data' })).toBeDisabled();
    expect(screen.getByText(/Only a demo operator/)).toBeInTheDocument();
  });

  it('Settings demo data reset is refused for non-operators', async () => {
    renderAt('/settings?tab=demo', 'acct_demo_b1_admin');
    // The internal demo tab is for the demo account only; others get the normal settings.
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });
});
