import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, builtInAccounts } from '@/auth/authCore';
import { BASE_COUNTS, EVENTS, GENERATED_TOTALS, INSTITUTIONS, SESSIONS, UNILAG, baseRecords, institutionByCode, parseRegistration } from '@/jamb/data';
import { SCENARIO_CANDIDATES } from '@/jamb/scenarios';
import { journeyOf } from '@/jamb/journey';
import {
  accessDisabled, activitiesFor, confirmClearance, confirmMatriculation, countsOf, exceptionsForReg, getJambState, inviteUser, lookupForClearance, nationalCounts, officerFor,
  recordNyscVerification, recordOf, recordUniversityVerification, referToJamb, reloadJambState, resolveException, setUserStatus, usersOf,
} from '@/jamb/store';
import { createInitialState } from '@/store/state';

const uni = officerFor('clearance.officer@unilag-demo.example');
const jamb = officerFor('jamb.officer@jamb-demo.example');
const nysc = officerFor('nysc.officer@nysc-demo.example');
const A = '20250190101CN'; const B = '20250190102IA'; const C = '20250190103OA';
const NA = '20220290101EO'; const NB = '20220490102FB'; const NC = '20220690103TO';

function renderApp(path: string, accountId?: string) {
  if (accountId) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={createInitialState(new Date())}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
const verifyUni = (reg: string) => recordUniversityVerification({ entered: reg, officer: uni, captureMode: 'demo', record: recordOf(reg) });

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); reloadJambState(); });

describe('shared demonstration records', () => {
  it('reconcile: generated totals plus the six test candidates, every session consistent', () => {
    const n = nationalCounts();
    expect(n.admitted).toBe(GENERATED_TOTALS.admitted + 6);
    expect(n.cleared).toBe(GENERATED_TOTALS.cleared + 2);
    expect(n.matriculated).toBe(GENERATED_TOTALS.matriculated + 2);
    expect(n.cleared + n.pending).toBe(n.admitted);
    expect(n.matriculated + n.clearedNotMatriculated).toBe(n.cleared);
    expect(INSTITUTIONS).toHaveLength(25);
    expect(SESSIONS).toEqual(['2022/2023', '2023/2024', '2024/2025', '2025/2026']);
    for (const inst of INSTITUTIONS) for (const c of BASE_COUNTS[inst.code]) {
      expect(c.matriculated).toBeLessThanOrEqual(c.cleared);
      expect(c.failed + c.exceptions + c.verifiedAwaiting).toBeLessThanOrEqual(c.admitted - c.cleared);
    }
    for (const s of SESSIONS) {
      const recs = baseRecords(UNILAG, s);
      const c = countsOf('UNILAG', s);
      expect(recs).toHaveLength(c.admitted);
      expect(recs.filter((r) => r.clearance === 'cleared')).toHaveLength(c.cleared);
      expect(recs.some((r) => r.matriculation === 'matriculated' && r.clearance !== 'cleared')).toBe(false);
    }
  });

  it('events: historical admission events expired, 2025/2026 active, NYSC active with no end date', () => {
    const byName = Object.fromEntries(EVENTS.map((e) => [e.name, e]));
    for (const n of ['2022/2023 Admission Clearance', '2023/2024 Admission Clearance', '2024/2025 Admission Clearance']) expect(byName[n].status).toBe('expired');
    expect(byName['2025/2026 Admission Clearance'].status).toBe('active');
    expect(byName['NYSC Identity Verification'].status).toBe('active');
    expect(byName['NYSC Identity Verification'].endsAt).toBeUndefined();
  });

  it('registration numbers round-trip, including the test candidates', () => {
    const r = baseRecords(institutionByCode('UI')!, '2025/2026')[42];
    expect(parseRegistration(r.reg).ok).toBe(true);
    for (const c of SCENARIO_CANDIDATES) expect(recordOf(c.reg)).toMatchObject({ reg: c.reg, institution: c.institution, session: c.session });
    expect(parseRegistration('not a number')).toEqual({ ok: false, reason: 'format' });
    // A clearance officer never sees other institutions' records.
    expect(lookupForClearance(NA, uni)).toEqual({ ok: false, outcome: 'not-found' });
    expect(lookupForClearance(A, uni).ok).toBe(true);
  });
});

describe('university clearance scenarios', () => {
  it('A: identity verified (JAMB and NIN match), clearance completes and JAMB sees it', () => {
    const before = countsOf('UNILAG', '2025/2026').cleared;
    const v = verifyUni(A);
    expect(v.ok && v.value).toMatchObject({ outcome: 'identity-confirmed', checks: { face: 'match', nin: 'match' } });
    expect(confirmClearance(A, uni).ok).toBe(true);
    const r = recordOf(A)!;
    expect(r).toMatchObject({ clearance: 'cleared', clearedBy: 'Tolulope Adebayo' });
    expect(r.clearanceRef).toMatch(/^JCL-UNILAG-/);
    expect(countsOf('UNILAG', '2025/2026').cleared).toBe(before + 1);
    expect(activitiesFor(A).map((a) => a.outcome)).toEqual(expect.arrayContaining(['identity-confirmed', 'clearance-completed']));
  });

  it('B: JAMB match but NIN mismatch blocks clearance and raises an exception; JAMB can lift it', () => {
    const v = verifyUni(B);
    expect(v.ok && v.value).toMatchObject({ outcome: 'nin-mismatch', checks: { face: 'match', nin: 'mismatch' } });
    expect(recordOf(B)).toMatchObject({ blocked: 'nin-mismatch', verification: 'exception' });
    expect(confirmClearance(B, uni).ok).toBe(false);
    const [exc] = exceptionsForReg(B);
    expect(exc).toMatchObject({ category: 'jamb-nin-discrepancy', status: 'open', raisedBy: 'Tolulope Adebayo' });
    expect(resolveException(exc.id, jamb, 'identity-confirmed', 'Candidate attended JAMB with valid NIN.').ok).toBe(true);
    expect(recordOf(B)!.blocked).toBeUndefined();
    // Verifying again after JAMB's decision doesn't recreate the block (the NIN response is still reported).
    const again = verifyUni(B);
    expect(again.ok && again.value).toMatchObject({ outcome: 'identity-confirmed', checks: { nin: 'mismatch' } });
    expect(exceptionsForReg(B)).toHaveLength(1);
    expect(confirmClearance(B, uni).ok).toBe(true);
  });

  it('C: a previous clearance at another institution blocks the duplicate', () => {
    const v = verifyUni(C);
    expect(v.ok && v.value.outcome).toBe('duplicate-clearance');
    expect(recordOf(C)!.blocked).toBe('duplicate-clearance');
    expect(confirmClearance(C, uni).ok).toBe(false);
    expect(exceptionsForReg(C)[0]).toMatchObject({ category: 'duplicate-clearance' });
    expect(exceptionsForReg(C)[0].evidence.map((e) => e.value)).toContain('JCL-UNIBEN-2025-418306');
  });
});

describe('Candidate C identity timeline', () => {
  it('separates the previous University of Benin clearance from the current record and unconfirmed matriculation', () => {
    verifyUni(C);
    const stages = journeyOf(recordOf(C)!, activitiesFor(C));
    const clearance = stages.find((s) => s.n === 3)!;
    expect(clearance.entries.map((e) => [e.activity, e.organisation])).toEqual(expect.arrayContaining([
      ['Previous clearance record (another institution)', 'University of Benin'],
      ['Clearance for the current admission record', 'University of Lagos'],
    ]));
    expect(clearance.entries.at(-1)!.activity).toBe('Clearance for the current admission record');
    const matric = stages.find((s) => s.n === 4)!;
    expect(matric.entries).toHaveLength(0);
    expect(matric.empty).toMatch(/Not confirmed/);
  });
});

describe('NYSC verification scenarios and shared data', () => {
  it('A confirmed, B face mismatch (referable to JAMB), C matriculation not confirmed', () => {
    const a = recordNyscVerification({ entered: NA, officer: nysc, captureMode: 'demo', record: recordOf(NA) });
    expect(a.ok && a.value.outcome).toBe('confirmed');
    const b = recordNyscVerification({ entered: NB, officer: nysc, captureMode: 'demo', record: recordOf(NB) });
    expect(b.ok && b.value.outcome).toBe('face-mismatch');
    const ref = referToJamb(b.ok ? b.value.ref : '', nysc);
    expect(ref.ok && ref.value).toMatchObject({ category: 'potential-fraud', raisedByOrganisation: 'National Youth Service Corps' });
    const c = recordNyscVerification({ entered: NC, officer: nysc, captureMode: 'demo', record: recordOf(NC) });
    expect(c.ok && c.value.outcome).toBe('matriculation-not-confirmed');
  });

  it('a university clearance and matriculation confirmation reach NYSC', () => {
    const first = recordNyscVerification({ entered: A, officer: nysc, captureMode: 'demo', record: recordOf(A) });
    expect(first.ok && first.value.outcome).toBe('matriculation-not-confirmed');
    verifyUni(A); confirmClearance(A, uni); confirmMatriculation(A, uni);
    const second = recordNyscVerification({ entered: A, officer: nysc, captureMode: 'demo', record: recordOf(A) });
    expect(second.ok && second.value.outcome).toBe('confirmed');
  });

  it('only the right roles can act', () => {
    expect(recordNyscVerification({ entered: NA, officer: uni, captureMode: 'demo', record: recordOf(NA) }).ok).toBe(false);
    expect(recordUniversityVerification({ entered: A, officer: nysc, captureMode: 'demo', record: recordOf(A) }).ok).toBe(false);
    expect(confirmClearance(A, jamb).ok).toBe(false);
  });
});

describe('users and access', () => {
  it('JAMB invites officers and can disable access, which blocks the workspace', async () => {
    const u = inviteUser(jamb, { name: 'Ada Obi', email: 'ada.obi@ui-demo.example', organisation: 'UI', role: 'clearance-officer' });
    expect(u.ok).toBe(true);
    expect(inviteUser(jamb, { name: 'X', email: 'x@nysc-demo.example', organisation: 'NYSC', role: 'jamb-admin' }).ok).toBe(false);
    const tolu = usersOf().find((x) => x.email === 'clearance.officer@unilag-demo.example')!;
    expect(setUserStatus(jamb, tolu.id, 'disabled').ok).toBe(true);
    expect(accessDisabled('clearance.officer@unilag-demo.example')).toBe(true);
    expect(getJambState().audit[0].action).toBe('Access disabled');
    renderApp('/clearance', 'acct_demo_unilag_clearance');
    expect(await screen.findByRole('heading', { name: 'Your access has been disabled' })).toBeInTheDocument();
  });
});

describe('workspaces', () => {
  it('three JAMB platform accounts exist alongside the existing accounts', () => {
    const ids = builtInAccounts().map((a) => a.id);
    for (const id of ['acct_demo_jamb_officer', 'acct_demo_unilag_clearance', 'acct_demo_nysc_officer']) expect(ids).toContain(id);
  });

  it('JAMB uses the FixID sidebar with JAMB navigation and branding only', async () => {
    renderApp('/jamb', 'acct_demo_jamb_officer');
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    for (const label of ['Home', 'Verification Events', 'Verification Activity', 'Exceptions', 'Student Records', 'Institutions', 'Reports', 'Users & Access', 'Audit Logs', 'Settings']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    for (const g of ['Verification', 'Institutions', 'Users & Access', 'Administration']) expect(within(nav).getAllByText(g).length).toBeGreaterThan(0);
    expect(within(nav).queryByText(/Issuance|Credentials/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/FixID/);
    expect(screen.getAllByAltText('Joint Admissions and Matriculation Board logo').length).toBeGreaterThan(0);
  });

  it('each account opens only its own workspace', async () => {
    renderApp('/jamb', 'acct_demo_nysc_officer');
    expect(await screen.findByRole('heading', { name: /Welcome, Hadiza/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users & Access' })).not.toBeInTheDocument();
  });

  it('university two-step clearance with Use Demo Face completes clearance', async () => {
    const user = renderApp('/clearance/verify', 'acct_demo_unilag_clearance');
    await user.type(await screen.findByLabelText(/JAMB Registration Number/), A);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm and continue' }));
    await user.click(screen.getByRole('button', { name: 'Use Demo Face' }));
    await user.click(screen.getByRole('button', { name: 'Verify identity' }));
    expect(await screen.findByRole('heading', { name: 'Identity Successfully Verified' }, { timeout: 3000 })).toBeInTheDocument();
    const checks = screen.getByLabelText('Identity checks');
    expect(within(checks).getByText('JAMB identity')).toBeInTheDocument();
    expect(within(checks).getByText('NIN verification')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Complete Clearance' }));
    expect(await screen.findByRole('heading', { name: 'Clearance Successful' })).toBeInTheDocument();
    for (const name of ['Print Clearance Certificate', 'View Clearance Details', 'Return to Student List']) expect(screen.getByRole('link', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify Another Student' })).toBeInTheDocument();
    // The registration portrait stays the only portrait; the capture is behind a deliberate action.
    expect(screen.queryByAltText('Captured face used for the verification')).not.toBeInTheDocument();
    await waitFor(() => expect(recordOf(A)!.clearance).toBe('cleared'));
  });

  it('university scenario B shows the discrepancy and no clearance action', async () => {
    const user = renderApp(`/clearance/verify?reg=${B}`, 'acct_demo_unilag_clearance');
    await user.click(await screen.findByRole('button', { name: 'Confirm and continue' }));
    await user.click(screen.getByRole('button', { name: 'Use Demo Face' }));
    await user.click(screen.getByRole('button', { name: 'Verify identity' }));
    expect(await screen.findByRole('heading', { name: 'Identity Discrepancy Detected' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('The candidate’s identity could not be fully confirmed. Please contact JAMB for further review.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete Clearance' })).not.toBeInTheDocument();
  });

  it('NYSC officer confirms Candidate A and gets a printable report', async () => {
    const user = renderApp('/nysc/verify', 'acct_demo_nysc_officer');
    await user.type(await screen.findByLabelText(/JAMB Registration Number/), NA);
    await user.click(screen.getByRole('button', { name: 'Retrieve JAMB record' }));
    await user.click(await screen.findByRole('button', { name: 'Continue to face capture' }));
    await user.click(screen.getByRole('button', { name: 'Use Demo Face' }));
    await user.click(screen.getByRole('button', { name: 'Verify identity' }));
    expect(await screen.findByRole('heading', { name: 'Candidate Identity Confirmed' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Educational identity timeline')).toHaveTextContent('Kehinde Adeleke');
    await user.click(screen.getByRole('link', { name: 'View Verification Report' }));
    expect(await screen.findByLabelText('NYSC verification report')).toHaveTextContent('UI/22/4817');
  });
});
