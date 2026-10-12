import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY } from '@/auth/authCore';
import { DEMO_PERSONAS, ORG_A, ORG_B, ORG_B1, ORG_B2, ORG_C } from '@/data/demoPersonas';
import { DEMO_PROGRAMME_B } from '@/data/seed';
import {
  decide, defaultProgrammeRequirements, defaultSettings, effectiveSettings, settingsProblems, weakeningProblems, type ProgrammeRequirements, type VerificationSettings,
} from '@/domain/programmes';
import { permissionsFor } from '@/domain/roles';
import { activationProblems, applySaveActivity, type ActivityForm } from '@/store/activityOps';
import {
  activityPolicy, applyParticipantStatus, applyProgrammeTransition, applySaveProgramme, canRunUnder, executionUnavailable, linkableProgrammes, programmeActivities,
  programmeFor, programmeProblems, programmesVisibleTo,
} from '@/store/programmeOps';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const persona = (id: string) => DEMO_PERSONAS.find((p) => p.accountId === id)!;
function as(accountId: string, s = createInitialState(new Date())): AppState {
  const p = persona(accountId);
  return { ...s, data: { ...s.data, admin: { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner', organizationIds: [p.organizationId!] } }, session: { ...s.session, currentOrganizationId: p.organizationId! } };
}
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };
const activity = (s: AppState, id: string) => s.data.activityConfigs.find((a) => a.id === id)!;
const programme = (s: AppState) => s.data.verificationProgrammes.find((p) => p.id === DEMO_PROGRAMME_B)!;
const B1_ACTIVITY = `${ORG_B1}_va_staff_entry`;
const B2_ACTIVITY = `${ORG_B2}_va_contractor_check`;

/** A minimal new-activity form under a given programme with the given settings. */
const form = (verification: VerificationSettings, programmeId?: string): ActivityForm => ({
  name: 'Test Activity', description: '', purpose: '', type: 'identity', checks: [], verifierIds: [],
  outcome: { onRequiredFailure: 'pending-review', onInconclusive: 'pending-review' }, verification, ...(programmeId ? { programmeId } : {}),
});
const external = (over: Partial<VerificationSettings> = {}): VerificationSettings => ({
  ...defaultSettings(), identitySource: { kind: 'external', integrationId: 'int_b_identity' }, exceptions: 'review', eligibility: { approach: 'external-source' }, ...over,
});

function renderApp(path: string, state: AppState, accountId: string) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('demonstration scenarios (fictional data)', () => {
  it('A: Northbridge runs an independent activity on local records, with a verifier and no programme', () => {
    const s = createInitialState(new Date());
    const a = activity(s, `${ORG_A}_va_site_access`);
    expect(a.status).toBe('active');
    expect(a.programmeId).toBeUndefined();
    const policy = activityPolicy(s, a);
    expect(policy.programme).toBeUndefined();
    expect(policy.effective).toMatchObject({ identitySource: { kind: 'local' }, method: 'face', liveness: 'required', eligibility: { approach: 'local-population' } });
    expect(executionUnavailable(s, a)).toBeNull();
    expect(s.data.verifierAssignments.some((v) => v.activityId === a.id && v.status === 'active')).toBe(true);
    expect(programmesVisibleTo(s, ORG_A)).toEqual([]);
  });

  it('B: Meridian’s programme uses its external service and applies to both sub-organizations; each has its own linked activity', () => {
    const s = createInitialState(new Date());
    const p = programme(s);
    expect(p).toMatchObject({ ownerOrganizationId: ORG_B, status: 'active', scope: 'sub-organizations', requirements: { identitySource: { kind: 'external', integrationId: 'int_b_identity' }, liveness: 'required', exceptions: 'review', escalateToProgramme: true } });
    expect(p.participants.map((x) => [x.organizationId, x.status])).toEqual([[ORG_B1, 'active'], [ORG_B2, 'active']]);
    expect(activity(s, B1_ACTIVITY).programmeId).toBe(p.id);
    expect(activity(s, B2_ACTIVITY).programmeId).toBe(p.id);
    expect(activityPolicy(s, activity(s, B1_ACTIVITY)).effective.eligibility.approach).toBe('external-source');
    expect(activityPolicy(s, activity(s, B2_ACTIVITY)).effective.eligibility).toEqual({ approach: 'reference-list', referenceList: ['DEMO-10001', 'CTR-1001', 'CTR-1002'] });
    // The sub-organization uses the owner's service as metadata only; it doesn't own or configure it.
    expect(activityPolicy(s, activity(s, B1_ACTIVITY)).integration).toMatchObject({ id: 'int_b_identity', organizationId: ORG_B });
  });

  it('C and D: Brightwater’s independent activities use its own external service, without enrolling anyone locally', () => {
    const s = createInitialState(new Date());
    const c = activityPolicy(s, activity(s, `${ORG_C}_va_delegate_checkin`));
    const d = activityPolicy(s, activity(s, `${ORG_C}_va_speaker_lounge`));
    expect(c.programme).toBeUndefined();
    expect(c.effective).toMatchObject({ identitySource: { kind: 'external', integrationId: 'int_c_delegates' }, eligibility: { approach: 'external-source' } });
    expect(d.effective.eligibility).toEqual({ approach: 'reference-list', referenceList: ['DEMO-10001', 'SPK-2001', 'SPK-2002', 'SPK-2003'] });
    // No local participant list or eligibility check is needed for either.
    for (const id of [`${ORG_C}_va_delegate_checkin`, `${ORG_C}_va_speaker_lounge`]) {
      const v = s.data.activityVersions.find((x) => x.id === activity(s, id).activeVersionId)!;
      expect(v.requirements?.eligibility).toBeNull();
      expect(v.checks.some((ch) => ch.params.useParticipants)).toBe(false);
    }
  });

  it('E: a programme that requires liveness can’t have it disabled by an activity', () => {
    let s = as('acct_demo_b1_admin');
    const r = applySaveActivity(s, { organizationId: ORG_B1, ids: { activityId: 'va_e', versionId: 'vv_e' }, at: AT, form: form(external({ liveness: 'optional' }), DEMO_PROGRAMME_B) });
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).toContain('Liveness is required by the programme and can’t be disabled.');
    // The effective setting stays required whatever the activity asks for.
    expect(effectiveSettings(external({ liveness: 'optional' }), programme(s).requirements).liveness).toBe('required');
    s = ok(applySaveActivity(s, { organizationId: ORG_B1, ids: { activityId: 'va_e', versionId: 'vv_e' }, at: AT, form: form(external(), DEMO_PROGRAMME_B) })).state;
    expect(activity(s, 'va_e')).toMatchObject({ programmeId: DEMO_PROGRAMME_B, verification: { liveness: 'required' } });
  });
});

describe('programme management (store)', () => {
  it('creates a Draft owned by the active workspace, with explicitly selected sub-organizations only', () => {
    let s = as('acct_demo_b_admin');
    const base = { organizationId: ORG_B, id: 'prog_new', name: 'Visitor Programme', description: '', purpose: 'Visitors', scope: 'sub-organizations' as const, requirements: defaultProgrammeRequirements(), at: AT };
    // An unrelated organization can never be selected, even in a Draft.
    expect(applySaveProgramme(s, { ...base, participantIds: [ORG_B1, ORG_A] })).toMatchObject({ ok: false, error: 'Only your organization’s own sub-organizations can take part.' });
    // A Draft can be incomplete, but it can't be activated until it's valid: local records can't allow external eligibility approaches.
    s = ok(applySaveProgramme(s, { ...base, participantIds: [ORG_B1] })).state;
    expect(applyProgrammeTransition(s, { organizationId: ORG_B, programmeId: 'prog_new', transition: 'activate', at: AT })).toMatchObject({ ok: false });
    const local: ProgrammeRequirements = { ...defaultProgrammeRequirements(), allowedEligibility: ['local-population'] };
    s = ok(applySaveProgramme(s, { ...base, participantIds: [ORG_B1], requirements: local })).state;
    const p = s.data.verificationProgrammes.find((x) => x.id === 'prog_new')!;
    expect(p).toMatchObject({ ownerOrganizationId: ORG_B, status: 'draft', participants: [{ organizationId: ORG_B1, status: 'invited' }] });
    // A Draft isn't visible to its participants and can't be used.
    expect(programmesVisibleTo(s, ORG_B1).some((x) => x.id === p.id)).toBe(false);
    expect(linkableProgrammes(s, ORG_B1).some((x) => x.id === p.id)).toBe(false);
    s = ok(applyProgrammeTransition(s, { organizationId: ORG_B, programmeId: p.id, transition: 'activate', at: AT })).state;
    const active = s.data.verificationProgrammes.find((x) => x.id === 'prog_new')!;
    expect(active).toMatchObject({ status: 'active', participants: [{ status: 'active' }] });
    expect(linkableProgrammes(s, ORG_B1).some((x) => x.id === p.id)).toBe(true);
    expect(linkableProgrammes(s, ORG_B2).some((x) => x.id === p.id)).toBe(false);
    expect(s.data.audit.slice(0, 3).map((e) => e.action)).toEqual(['programme.activated', 'programme.updated', 'programme.created']);
  });

  it('refuses an external identity service the owner doesn’t own, or one without the capabilities the method needs', () => {
    const s = as('acct_demo_b_admin');
    const base = { organizationId: ORG_B, name: 'X', scope: 'own' as const, participantIds: [] };
    // B1's integration belongs to B1, and Brightwater's to Brightwater, not to Meridian.
    for (const integrationId of ['int_d_hospital', 'int_c_delegates']) {
      const problems = programmeProblems(s, { ...base, requirements: { ...defaultProgrammeRequirements(), identitySource: { kind: 'external', integrationId } } });
      expect(problems).toContain('The identity service isn’t available to this organization.');
      const saved = ok(applySaveProgramme(s, { ...base, id: `prog_${integrationId}`, description: '', purpose: '', at: AT, requirements: { ...defaultProgrammeRequirements(), identitySource: { kind: 'external', integrationId } } })).state;
      expect(applyProgrammeTransition(saved, { organizationId: ORG_B, programmeId: `prog_${integrationId}`, transition: 'activate', at: AT })).toMatchObject({ ok: false });
    }
    // Its own service is accepted.
    expect(programmeProblems(s, { ...base, requirements: { ...defaultProgrammeRequirements(), identitySource: { kind: 'external', integrationId: 'int_b_identity' } } })).toEqual([]);
  });

  it('suspending a participant or the programme stops new programme-linked verification; history and activities are kept', () => {
    let s = as('acct_demo_b_admin');
    // The programme's simulated external service can be used (Phase 4).
    expect(executionUnavailable(s, activity(s, B1_ACTIVITY))).toBeNull();
    s = ok(applyParticipantStatus(s, { organizationId: ORG_B, programmeId: DEMO_PROGRAMME_B, participantId: ORG_B1, status: 'suspended', at: AT })).state;
    expect(canRunUnder(programme(s), ORG_B1)).toMatch(/participation is suspended/);
    expect(executionUnavailable(s, activity(s, B1_ACTIVITY))).toMatch(/participation is suspended/);
    expect(activationProblems(s, ORG_B1, activity(s, B1_ACTIVITY)).blockers.join(' ')).toMatch(/participation is suspended/);
    expect(canRunUnder(programme(s), ORG_B2)).toBeNull();
    s = ok(applyProgrammeTransition(s, { organizationId: ORG_B, programmeId: DEMO_PROGRAMME_B, transition: 'suspend', at: AT })).state;
    expect(executionUnavailable(s, activity(s, B2_ACTIVITY))).toMatch(/suspended/);
    expect(activity(s, B2_ACTIVITY).status).toBe('active');
  });

  it('only the owner manages a programme; participants and other roles can’t', () => {
    const b1 = as('acct_demo_b1_admin');
    expect(applyParticipantStatus(b1, { organizationId: ORG_B1, programmeId: DEMO_PROGRAMME_B, participantId: ORG_B1, status: 'removed', at: AT })).toMatchObject({ ok: false });
    expect(applyProgrammeTransition(b1, { organizationId: ORG_B1, programmeId: DEMO_PROGRAMME_B, transition: 'suspend', at: AT })).toMatchObject({ ok: false });
    expect(permissionsFor(['auditor']).has('programmes.view')).toBe(true);
    expect(permissionsFor(['auditor']).has('programmes.manage')).toBe(false);
    expect(permissionsFor(['verifier']).has('programmes.manage')).toBe(false);
    expect(permissionsFor(['organization-admin']).has('programmes.manage')).toBe(true);
  });
});

describe('inheritance and weakening', () => {
  it('a programme-linked activity inherits the source and exception handling, and can only be stricter', () => {
    const req = createInitialState(new Date()).data.verificationProgrammes.find((p) => p.id === DEMO_PROGRAMME_B)!.requirements;
    expect(weakeningProblems(external({ identitySource: { kind: 'local' } }), req)).toContain('The identity source is set by the programme and can’t be replaced.');
    expect(weakeningProblems(external({ method: 'record', liveness: 'not-applicable' }), req)).toContain('The programme requires face verification.');
    expect(weakeningProblems(external({ exceptions: 'unsuccessful' }), req)).toContain('Exception handling is set by the programme.');
    expect(weakeningProblems(external({ reverification: { mode: 'reuse-within', days: 30 } }), req).length).toBe(1);
    expect(weakeningProblems(external({ eligibility: { approach: 'local-population' } }), req).join(' ')).toMatch(/doesn’t allow local eligible population/);
    expect(weakeningProblems(external({ eligibility: { approach: 'none' } }), req).join(' ')).toMatch(/doesn’t allow|requires eligibility/);
    expect(weakeningProblems(external(), req)).toEqual([]);
    // A stricter reuse period than the programme's is kept.
    const lenient: ProgrammeRequirements = { ...req, reverification: { mode: 'reuse-within', days: 30 } };
    expect(effectiveSettings(external({ reverification: { mode: 'reuse-within', days: 7 } }), lenient).reverification).toEqual({ mode: 'reuse-within', days: 7 });
  });

  it('only participating organizations can create activities under a programme', () => {
    expect(applySaveActivity(as('acct_demo_a_admin'), { organizationId: ORG_A, ids: { activityId: 'va_x', versionId: 'vv_x' }, at: AT, form: form(external(), DEMO_PROGRAMME_B) })).toMatchObject({ ok: false });
    // The owner of a sub-organization programme doesn't run activities under it.
    expect(applySaveActivity(as('acct_demo_b_admin'), { organizationId: ORG_B, ids: { activityId: 'va_x', versionId: 'vv_x' }, at: AT, form: form(external(), DEMO_PROGRAMME_B) })).toMatchObject({ ok: false });
  });

  it('validates reference lists and sources', () => {
    expect(settingsProblems({ ...defaultSettings(), eligibility: { approach: 'reference-list', referenceList: [] } }).join(' ')).toMatch(/external/i);
    expect(settingsProblems(external({ eligibility: { approach: 'reference-list', referenceList: [] } })).length).toBeGreaterThan(0);
    expect(settingsProblems(external({ eligibility: { approach: 'reference-list', referenceList: ['x'] } })).length).toBeGreaterThan(0);
    expect(settingsProblems(external({ eligibility: { approach: 'reference-list', referenceList: ['CTR-1001'] } }))).toEqual([]);
    expect(settingsProblems(external({ method: 'record', liveness: 'required' })).length).toBeGreaterThan(0);
  });
});

describe('decision model', () => {
  const review = { decisionRules: { onInconclusiveMatch: 'pending-review' as const, onServiceUnavailable: 'unable-to-decide' as const }, exceptions: 'review' as const };
  it('keeps identity, eligibility and the decision separate: a match alone never allows', () => {
    expect(decide('match', 'eligible', review)).toBe('allow');
    expect(decide('match', 'not-required', review)).toBe('allow');
    expect(decide('match', 'ineligible', review)).toBe('pending-review');
    expect(decide('match', 'ineligible', { ...review, exceptions: 'unsuccessful' })).toBe('deny');
    expect(decide('match', 'unknown', review)).toBe('pending-review');
    expect(decide('no-match', 'eligible', { ...review, exceptions: 'unsuccessful' })).toBe('deny');
    expect(decide('inconclusive', 'eligible', review)).toBe('pending-review');
    expect(decide('unavailable', 'eligible', review)).toBe('unable-to-decide');
  });
});

describe('isolation and security', () => {
  it('a participant sees the programme and only its own linked activities; unrelated organizations see nothing', () => {
    const s = createInitialState(new Date());
    const p = programme(s);
    expect(programmeActivities(s, ORG_B, p).map((a) => a.id).sort()).toEqual([B1_ACTIVITY, B2_ACTIVITY].sort());
    expect(programmeActivities(s, ORG_B1, p).map((a) => a.id)).toEqual([B1_ACTIVITY]);
    expect(programmeFor(s, ORG_A, p.id)).toBeUndefined();
    expect(programmeFor(s, ORG_C, p.id)).toBeUndefined();
  });

  it('stores no secrets, tokens or passwords in programmes or activity settings', () => {
    const s = createInitialState(new Date());
    const text = JSON.stringify([s.data.verificationProgrammes, s.data.activityConfigs.map((a) => a.verification)]);
    expect(text).not.toMatch(/secret|password|token|apiKey|clientId/i);
  });
});

describe('screens', () => {
  it('lists the owner’s programme with its columns, and shows participants and every linked activity', async () => {
    const { user } = renderApp('/programmes', createInitialState(new Date()), 'acct_demo_b_admin');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Programme Name', 'Owning Organization', 'Participating Organizations', 'Verification Source', 'Status', 'Date Created', 'Actions']);
    const row = within(table).getByRole('link', { name: 'Group Staff Verification' }).closest('tr')!;
    expect(row).toHaveTextContent('Group Identity Service');
    expect(row).toHaveTextContent('Active');
    expect(screen.getByRole('button', { name: 'Create Programme' })).toBeInTheDocument();
    await user.click(within(table).getByRole('link', { name: 'Group Staff Verification' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Group Staff Verification' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Harbourside Staff Entry');
    expect(screen.getByRole('main')).toHaveTextContent('Eastgate Contractor Check');
    expect(screen.getByLabelText('Programme requirements')).toHaveTextContent('Assurance policy not yet defined.');
  });

  it('a participant sees the requirements read-only and only its own activities; another organization can’t open it', () => {
    const s = createInitialState(new Date());
    const { unmount } = renderApp(`/programmes/${DEMO_PROGRAMME_B}`, s, 'acct_demo_b1_admin');
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('Mandatory, set by the programme owner. Read-only.');
    expect(main).toHaveTextContent('Harbourside Staff Entry');
    expect(main).not.toHaveTextContent('Eastgate Contractor Check');
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit programme/ })).toBeNull();
    unmount();
    localStorage.clear();
    renderApp(`/programmes/${DEMO_PROGRAMME_B}`, s, 'acct_demo_a_admin');
    expect(screen.getByRole('heading', { name: 'Programme not available' })).toBeInTheDocument();
  });

  it('creates a programme through the four-step wizard, selecting sub-organizations explicitly', async () => {
    const { user } = renderApp('/programmes', createInitialState(new Date()), 'acct_demo_b_admin');
    await user.click(await screen.findByRole('button', { name: 'Create Programme' }));
    await user.type(screen.getByLabelText(/Programme Name/), 'Contractor Programme');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /Selected Sub-organizations/ }));
    const subs = screen.getByRole('list', { name: 'Sub-organizations' });
    expect(within(subs).getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    await user.click(within(subs).getAllByRole('checkbox')[1]);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /External Identity Service/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Contractor Programme' })).toBeInTheDocument();
    const saved = loadState()!.data.verificationProgrammes.find((p) => p.name === 'Contractor Programme')!;
    expect(saved).toMatchObject({ ownerOrganizationId: ORG_B, status: 'draft', scope: 'sub-organizations', participants: [{ organizationId: ORG_B2, status: 'invited' }], requirements: { identitySource: { kind: 'external', integrationId: 'int_b_identity' } } });
  });

  it('the activity editor shows inherited requirements locked, and offers only the programme’s eligibility approaches', async () => {
    const { user } = renderApp(`/verification-activities/new?programme=${DEMO_PROGRAMME_B}`, createInitialState(new Date()), 'acct_demo_b1_admin');
    expect(await screen.findByLabelText('Verification Programme')).toHaveValue(DEMO_PROGRAMME_B);
    await user.type(screen.getByLabelText(/Activity Name/), 'Night Shift Entry');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('Group Identity Service');
    expect(main).toHaveTextContent('It can’t be replaced.');
    expect(screen.queryByRole('radio', { name: /FixID Local Records/ })).toBeNull();
    expect(screen.getByLabelText('Liveness')).toBeDisabled();
    expect(main).toHaveTextContent('Liveness is required by the programme Group Staff Verification and can’t be disabled.');
    expect(screen.getByLabelText('Exception handling')).toBeDisabled();
    expect(main).toHaveTextContent('Assurance policy not yet defined.');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const approaches = within(screen.getByRole('group', { name: 'Eligibility approach' })).getAllByRole('radio');
    expect(approaches.map((r) => r.closest('label')!.querySelector('span span')!.textContent)).toEqual(['External source eligibility', 'Reference list eligibility']);
    await user.click(screen.getByRole('radio', { name: /Reference list eligibility/ }));
    await user.type(screen.getByLabelText(/Permitted external references/), 'NS-0001{enter}NS-0002');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const review = screen.getByRole('heading', { name: 'Review & Activate' }).closest('section')!;
    expect(review).toHaveTextContent('Verification programmeGroup Staff Verification');
    expect(within(review).getByLabelText('Verification settings')).toHaveTextContent('Not required: externally referenced identities are supported');
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));
    await waitFor(() => expect(loadState()!.data.activityConfigs.some((a) => a.name === 'Night Shift Entry')).toBe(true));
    const saved = loadState()!.data.activityConfigs.find((a) => a.name === 'Night Shift Entry')!;
    expect(saved).toMatchObject({ organizationId: ORG_B1, programmeId: DEMO_PROGRAMME_B, verification: { liveness: 'required', eligibility: { approach: 'reference-list', referenceList: ['NS-0001', 'NS-0002'] } } });
  });

  it('the verifier sees the programme-linked external activity and can start it; the source isn’t theirs to choose', async () => {
    renderApp(`/verify/activities/${B1_ACTIVITY}`, createInitialState(new Date()), 'acct_demo_b1_verifier');
    expect(await screen.findByRole('button', { name: 'Start Verification' })).toBeEnabled();
    expect(screen.getByRole('main')).toHaveTextContent('Group Staff Verification');
    expect(screen.getByRole('main')).toHaveTextContent('Group Identity Service');
  });


  it('the Auditor can view programmes but not create them', async () => {
    renderApp('/programmes', createInitialState(new Date()), `${ORG_A}_usr_2`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Verification Programmes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Programme' })).toBeNull();
  });
});
