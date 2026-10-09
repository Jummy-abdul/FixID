import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { eligibleParticipants } from '@/domain/verification';
import type { Member } from '@/domain/types';
import { adminsOf } from '@/store/adminOps';
import { loadState } from '@/store/persistence';
import { createInitialState, reducer, type Action, type AppState } from '@/store/state';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import { createVerificationService } from '@/verification/engine';
import { statedDetails } from './helpers/identity';

const ORG = SAMPLE_ORGANIZATION_ID;
const AT = new Date().toISOString();
let seq = 0;

function harness(initial: AppState, opts: { outage?: boolean } = {}) {
  let state = initial;
  const dispatch = (a: Action) => { state = reducer(state, a); };
  const idSwitch = createMockIdSwitch();
  if (opts.outage) (idSwitch as unknown as { simulation: { setOutage: (v: boolean) => void } }).simulation.setOutage(true);
  const service = createVerificationService({ getState: () => state, dispatch, idSwitch, timeoutMs: 600 });
  return { get state() { return state; }, set state(s: AppState) { state = s; }, dispatch, service };
}

const base = () => { const s = createInitialState(new Date()); s.session.currentOrganizationId = ORG; return s; };
const halima = (s: AppState) => adminsOf(s, ORG).find((a) => a.roleIds.includes('verifier') && a.status === 'active')!;
const asHalima = (s: AppState): AppState => ({ ...s, data: { ...s.data, admin: { ...s.data.admin, id: halima(s).userId! } } });
/** The demo Organization Admin, also given the Verifier role (portal access and verification). */
const adminVerifier = (s: AppState): AppState => {
  const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
  return reducer(s, { type: 'admins/roles', organizationId: ORG, adminId: me.id, roleIds: [...me.roleIds, 'verifier'], at: AT });
};
const conference = (s: AppState) => s.data.activityConfigs.find((a) => a.organizationId === ORG && a.name === 'Annual Staff Conference')!;
const withPolicy = (s: AppState, entryPolicy: 'off' | 'flag' | 'deny'): AppState => ({ ...s, data: { ...s.data, activityConfigs: s.data.activityConfigs.map((a) => (a.id === conference(s).id ? { ...a, entryPolicy } : a)) } });
const people = (s: AppState) => {
  const eligible = eligibleParticipants(s.data, ORG, conference(s).participants);
  const withId = s.data.members.filter((m) => m.organizationId === ORG && m.status === 'active' && m.identifier);
  return {
    insider: withId.find((m) => eligible.has(m.id) && !conference(s).participants!.memberIds.includes(m.id))!,
    listed: withId.find((m) => conference(s).participants!.memberIds.includes(m.id)),
    outsider: withId.find((m) => !eligible.has(m.id))!,
  };
};

async function verify(h: ReturnType<typeof harness>, m: Member) {
  const started = h.service.startAttempt(ORG, conference(h.state).id);
  if (!started.ok) throw new Error(started.error);
  const r = await h.service.submitInputs(started.attempt.id, { identifier: m.identifier!.value, attributes: statedDetails(m) }, { submissionId: `s${++seq}` });
  if (!r.ok) throw new Error(r.error);
  return r.attempt;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('physical access: eligibility and access decision', () => {
  it('separates identity, eligibility, access and entry, and never records entry automatically', async () => {
    const h = harness(asHalima(base()));
    const { insider, outsider } = people(h.state);
    const ok = await verify(h, insider);
    expect(ok).toMatchObject({ outcome: 'verified', verificationResult: 'verified', eligibilityResult: 'eligible', accessDecision: 'permitted' });
    expect(ok.entry).toBeUndefined();
    expect(ok.checks.map((c) => c.type)).toEqual(expect.arrayContaining(['identity-lookup', 'group-membership']));
    expect(ok.checks.some((c) => c.type.startsWith('credential'))).toBe(false);

    const no = await verify(h, outsider);
    expect(no).toMatchObject({ outcome: 'not-verified', verificationResult: 'verified', eligibilityResult: 'not-eligible', accessDecision: 'not-permitted' });
    expect(no.checks.find((c) => c.type === 'group-membership')!.explanation).toBe('Not an eligible participant for this activity.');
  });

  it('treats specifically added users as eligible and uses current group membership at verification time', async () => {
    const h = harness(asHalima(base()));
    const { listed, outsider } = people(h.state);
    if (listed) expect((await verify(h, listed)).eligibilityResult).toBe('eligible');
    const groupId = conference(h.state).participants!.groupIds[0];
    h.state = { ...h.state, data: { ...h.state.data, groupMemberships: [...h.state.data.groupMemberships, { organizationId: ORG, groupId, memberId: outsider.id, addedAt: AT, addedBy: 'x' } as AppState['data']['groupMemberships'][number]] } };
    expect(await verify(h, outsider)).toMatchObject({ eligibilityResult: 'eligible', accessDecision: 'permitted' });
  });

  it('needs review, not a refusal, when the identity service can’t be reached', async () => {
    const h = harness(asHalima(base()), { outage: true });
    const a = await verify(h, people(h.state).insider);
    expect(a).toMatchObject({ outcome: 'unable-to-verify', accessDecision: 'review-required' });
    expect(a.entry).toBeUndefined();
    expect(h.service.recordEntry(a.id)).toMatchObject({ ok: false, error: 'Entry can only be recorded after access was permitted.' });
  });
});

describe('physical access: entry recording and duplicate entries', () => {
  it('records entry only on request, audits it, and refuses a second entry under a deny policy', async () => {
    const h = harness(asHalima(base()));
    const { insider } = people(h.state);
    const first = await verify(h, insider);
    expect(h.service.recordEntry(first.id)).toEqual({ ok: true });
    const saved = h.state.data.verificationAttempts.find((a) => a.id === first.id)!;
    expect(saved.entry).toMatchObject({ status: 'entered', recordedBy: halima(h.state).name });
    expect(h.state.data.audit[0]).toMatchObject({ action: 'verification.entry-recorded', result: 'success' });
    expect(h.state.data.audit[0].summary).not.toContain(insider.identifier!.value);
    // Recording twice is harmless.
    expect(h.service.recordEntry(first.id)).toEqual({ ok: true });

    // A verification is not an entry: verifying again is fine, but access is refused because they already entered.
    const again = await verify(h, insider);
    expect(again).toMatchObject({ outcome: 'verified', accessDecision: 'not-permitted' });
    expect(again.accessReasons![0]).toMatch(/Already entered/);
    expect(h.service.recordEntry(again.id)).toMatchObject({ ok: false });
  });

  it('flags a second entry for review under a flag policy, and ignores entries with the policy off', async () => {
    const flag = harness(asHalima(withPolicy(base(), 'flag')));
    const p = people(flag.state).insider;
    flag.service.recordEntry((await verify(flag, p)).id);
    expect(await verify(flag, p)).toMatchObject({ outcome: 'verified', accessDecision: 'review-required' });

    const off = harness(asHalima(withPolicy(base(), 'off')));
    off.service.recordEntry((await verify(off, p)).id);
    expect(await verify(off, p)).toMatchObject({ accessDecision: 'permitted' });
  });

  it('lets only verifiers record entry', async () => {
    const h = harness(asHalima(base()));
    const a = await verify(h, people(h.state).insider);
    const admin = harness({ ...h.state, data: { ...h.state.data, admin: base().data.admin } });
    expect(admin.service.recordEntry(a.id)).toMatchObject({ ok: false, error: 'Only verifiers can record entry.' });
    expect(admin.state.data.verificationAttempts.find((x) => x.id === a.id)!.entry).toBeUndefined();
  });
});

describe('screens', () => {
  function renderApp(path: string, state: AppState) {
    render(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    return userEvent.setup();
  }

  it('shows attempts in Verification History and records entry from the detail page', async () => {
    const h = harness(adminVerifier(base()));
    const a = await verify(h, people(h.state).insider);
    const user = renderApp('/verification-history', h.state);
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Date & time', 'Activity', 'Subject', 'Verifier', 'Identity', 'Eligibility', 'Outcome', 'Access', 'Entry']);
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Annual Staff Conference'))!;
    expect(row).toHaveTextContent('Permitted');
    expect(row).toHaveTextContent('Not recorded');
    await user.click(row);
    expect(await screen.findByRole('heading', { level: 1, name: a.id })).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'Access and entry' });
    expect(panel).toHaveTextContent('Access decision');
    expect(panel).toHaveTextContent('Permitted');
    await user.click(within(panel).getByRole('button', { name: 'Record Entry' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record Entry' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Access and entry' })).getByText('Entered')).toBeInTheDocument());
    expect(loadState()!.data.verificationAttempts.find((x) => x.id === a.id)!.entry).toBeDefined();
  });

  it('shows a Viewer the decision without a Record Entry action', async () => {
    const h = harness(adminVerifier(base()));
    const a = await verify(h, people(h.state).insider);
    renderApp(`/verification-history/${a.id}`, reducer(h.state, { type: 'preview/start', roleId: 'viewer' }));
    expect(screen.getByRole('region', { name: 'Access and entry' })).toHaveTextContent('Permitted');
    expect(screen.queryByRole('button', { name: 'Record Entry' })).toBeNull();
  });

  it('lets an officer verify and record entry in the Verifier Interface', async () => {
    const s = adminVerifier(base());
    const { insider } = people(s);
    const user = renderApp('/verify', s);
    const list = await screen.findByRole('list', { name: 'Your verification activities' });
    const card = within(list).getByRole('heading', { name: 'Annual Staff Conference' }).closest('li')!;
    expect(card).toHaveTextContent('Main Auditorium');
    await user.click(within(card).getByRole('button', { name: 'Start verification: Annual Staff Conference' }));
    await user.click(await screen.findByRole('button', { name: 'Run verification' }));
    // The identifier alone can't verify anyone: the stated details are needed too.
    await user.type(screen.getAllByRole('textbox')[0], insider.identifier!.value);
    const details = statedDetails(insider);
    await user.type(screen.getByLabelText('Full name'), details['Full name']);
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: details['Date of birth'] } });
    await user.click(screen.getByRole('button', { name: 'Run verification' }));
    expect(await screen.findByRole('region', { name: 'Outcome' }, { timeout: 4000 })).toHaveTextContent('Verified');
    const panel = screen.getByRole('region', { name: 'Access and entry' });
    expect(panel).toHaveTextContent('Permitted');
    expect(panel).toHaveTextContent('Not recorded');
    await user.click(within(panel).getByRole('button', { name: 'Record Entry' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record Entry' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Access and entry' })).getByText('Entered')).toBeInTheDocument());
  });

  it('redirects old Verification Events links', async () => {
    const s = base();
    renderApp('/activities', s);
    expect(await screen.findByRole('heading', { level: 1, name: 'Verification Activities' })).toBeInTheDocument();
  });

  it('keeps earlier event records in Verification History', async () => {
    const s = base();
    const legacy = s.data.activities.find((a) => a.organizationId === ORG && s.data.transactions.some((t) => t.activityId === a.id))!;
    renderApp(`/activities/${legacy.id}`, s);
    expect(await screen.findByRole('heading', { level: 1, name: 'Verification History' })).toBeInTheDocument();
    expect(screen.getByLabelText('Activity')).toHaveValue(legacy.id);
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
  });
});
