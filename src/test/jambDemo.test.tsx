import { vi } from 'vitest';
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
  accessDisabled, activitiesFor, escalateToJamb, escalationFor, escalationStatus, jambResponse, rejectEscalation, requestInformation, respondToEscalation, confirmClearance, countsOf, recordExistingClearance, exceptionsForReg, getJambState, inviteUser, lookupForClearance, nationalCounts, officerFor,
  escalationsOf, nyscComparisons, nyscStatuses, recordNyscVerification, recordOf, assignCase, caseTypeOf, closeCase, comparisonsFor, exceptionById, priorClearanceOf, raiseAdmissionInquiry, referForInvestigation, CASE_DECISIONS, recordUniversityVerification, referToJamb, reloadJambState, resolveException, setUserStatus, usersOf,
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
    expect(n.cleared + n.pending).toBe(n.admitted);
    expect(n.verified).toBeGreaterThanOrEqual(n.cleared);
    expect(INSTITUTIONS).toHaveLength(25);
    expect(SESSIONS).toEqual(['2022/2023', '2023/2024', '2024/2025', '2025/2026']);
    for (const inst of INSTITUTIONS) for (const c of BASE_COUNTS[inst.code]) {
      expect(c.failed + c.exceptions + c.verifiedAwaiting).toBeLessThanOrEqual(c.admitted - c.cleared);
    }
    for (const s of SESSIONS) {
      const recs = baseRecords(UNILAG, s);
      const c = countsOf('UNILAG', s);
      expect(recs).toHaveLength(c.admitted);
      expect(recs.filter((r) => r.clearance === 'cleared')).toHaveLength(c.cleared);
      // Nobody is cleared without a successful identity verification.
      expect(recs.some((r) => r.clearance === 'cleared' && r.verification !== 'verified')).toBe(false);
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

  it('B: live capture matches NIN but not the JAMB examination record; clearance is held; the officer escalates; JAMB can lift it', () => {
    const v = verifyUni(B);
    expect(v.ok && v.value).toMatchObject({ outcome: 'exam-mismatch', checks: { face: 'no-match', nin: 'match' } });
    expect(recordOf(B)).toMatchObject({ blocked: 'exam-mismatch', verification: 'exception' });
    expect(confirmClearance(B, uni).ok).toBe(false);
    // Nothing reaches JAMB until the officer escalates.
    expect(exceptionsForReg(B)).toHaveLength(0);
    const esc = escalateToJamb({ reg: B, officer: uni, category: 'exam-impersonation', comment: 'Live portrait matches NIN but not the JAMB examination record.', evidence: ['Identity comparison results'] });
    expect(esc.ok && esc.value).toMatchObject({ id: expect.stringMatching(/^ESC-\d{4}-\d{5}$/), status: 'open', raisedBy: 'Tolulope Adebayo', escalation: { institution: 'UNILAG', comparisons: [{ label: 'JAMB examination record vs Live Capture', result: 'mismatch' }, { label: 'NIN identity record vs Live Capture', result: 'match' }] } });
    expect(exceptionsForReg(B)[0]).toMatchObject({ category: 'exam-impersonation' });
    expect(recordOf(B)!.verification).toBe('escalated');
    expect(escalateToJamb({ reg: B, officer: uni, category: 'exam-impersonation', comment: 'again', evidence: [] }).ok).toBe(false);
    const [exc] = exceptionsForReg(B);
    // JAMB's response reaches the university.
    expect(requestInformation(exc.id, jamb, 'Send the NIN slip.').ok).toBe(true);
    expect(escalationStatus(escalationFor(B)!)).toBe('awaiting-information');
    expect(jambResponse(escalationFor(B)!)?.comment).toBe('Send the NIN slip.');
    expect(respondToEscalation(exc.id, uni, 'NIN slip attached.').ok).toBe(true);
    expect(escalationStatus(escalationFor(B)!)).toBe('in-review');
    expect(resolveException(exc.id, jamb, 'identity-confirmed', 'Examination record reviewed; candidate identity confirmed.').ok).toBe(true);
    expect(recordOf(B)!.blocked).toBeUndefined();
    // Verifying again after JAMB's decision doesn't recreate the block (the examination-record mismatch is still reported).
    const again = verifyUni(B);
    expect(again.ok && again.value).toMatchObject({ outcome: 'identity-confirmed', checks: { face: 'no-match', nin: 'match' } });
    expect(exceptionsForReg(B)).toHaveLength(1);
    expect(confirmClearance(B, uni).ok).toBe(true);
  });

  it('C: an existing clearance at another institution blocks clearance; only JAMB can release it', () => {
    // Found from the record at lookup: no capture and no biometric result.
    expect(recordExistingClearance(C, uni).ok).toBe(true);
    expect(recordOf(C)!.blocked).toBe('duplicate-clearance');
    expect(activitiesFor(C)[0]).toMatchObject({ outcome: 'duplicate-clearance' });
    expect(activitiesFor(C)[0].checks).toBeUndefined();
    expect(confirmClearance(C, uni).ok).toBe(false);
    const esc = escalateToJamb({ reg: C, officer: uni, category: 'duplicate-clearance', reason: 'Student wishes to decline or withdraw the existing admission', comment: 'Existing clearance found.', evidence: ['Previous clearance record'] });
    expect(esc.ok && esc.value.escalation).toMatchObject({ reason: 'Student wishes to decline or withdraw the existing admission', comparisons: [] });
    const [exc] = exceptionsForReg(C);
    expect(exc).toMatchObject({ category: 'duplicate-clearance' });
    expect(exc.evidence.map((e) => e.value)).toEqual(expect.arrayContaining(['University of Benin', 'JCL-UNIBEN-2025-418306, Osagie Igbinedion', '2025/2026']));
    // The university can't decide; JAMB rejects, then (escalated again) releases.
    expect(resolveException(exc.id, uni, 'release-authorised', 'x').ok).toBe(false);
    expect(rejectEscalation(exc.id, jamb, 'Attach the admission letter and escalate again.').ok).toBe(true);
    expect(escalationStatus(exceptionsForReg(C)[0])).toBe('closed');
    expect(recordOf(C)!.blocked).toBe('duplicate-clearance');
    const again = escalateToJamb({ reg: C, officer: uni, category: 'duplicate-clearance', comment: 'Admission letter attached.', evidence: [] });
    expect(again.ok).toBe(true);
    expect(resolveException(again.ok ? again.value.id : '', jamb, 'release-authorised', 'Previous admission withdrawn by the candidate.').ok).toBe(true);
    expect(recordOf(C)!.blocked).toBeUndefined();
    expect(verifyUni(C).ok && recordOf(C)!.verification).toBe('verified');
    expect(confirmClearance(C, uni).ok).toBe(true);
  });
});

describe('Scenario 4 and the JAMB case lifecycle', () => {
  const D = '20250190104KE';
  it('D: a valid JAMB registration with no admission record stops clearance; nothing is created', () => {
    const r = lookupForClearance(D, uni);
    expect(r).toMatchObject({ ok: false, outcome: 'admission-not-found', session: '2025/2026', registrant: { firstName: 'Kelechi', lastName: 'Eze' } });
    // Not a student record: no admission list, no clearance, no biometric result.
    expect(recordOf(D)).toBeUndefined();
    expect(lookupForClearance(D, uni, '2024/2025')).toMatchObject({ outcome: 'admission-not-found', session: '2024/2025' });
    const a = recordUniversityVerification({ entered: D, officer: uni, captureMode: 'demo', outcome: 'admission-not-found', session: '2025/2026' });
    expect(a.ok && a.value).toMatchObject({ outcome: 'admission-not-found', reg: undefined });
    expect(a.ok && a.value.checks).toBeUndefined();
    // Existing lookups are unchanged.
    expect(lookupForClearance(A, uni).ok).toBe(true);
  });

  it('admission record inquiry: JAMB assigns, requests information, the university responds, JAMB records the located admission and closes', () => {
    expect(raiseAdmissionInquiry({ reg: D, session: '2025/2026', officer: uni, reason: 'Other', comment: '  ' }).ok).toBe(false);
    const x = raiseAdmissionInquiry({ reg: D, session: '2025/2026', officer: uni, reason: 'Candidate holds an admission offer from this institution', comment: 'Admission letter presented.' });
    expect(x.ok && x.value).toMatchObject({ category: 'admission-inquiry', institution: 'UNILAG', session: '2025/2026', status: 'open', escalation: { comparisons: [] } });
    const id = x.ok ? x.value.id : '';
    expect(caseTypeOf(exceptionById(id)!)).toBe('admission-inquiry');
    expect(escalationStatus(exceptionById(id)!)).toBe('open');
    expect(raiseAdmissionInquiry({ reg: D, session: '2025/2026', officer: uni, reason: 'Other', comment: 'again' }).ok).toBe(false);
    // Only JAMB can manage the case.
    expect(assignCase(id, uni).ok).toBe(false);
    expect(assignCase(id, jamb).ok && exceptionById(id)).toMatchObject({ assignedTo: 'Aisha Danjuma', status: 'in-review', assignedAt: expect.any(String) });
    expect(requestInformation(id, jamb, 'Send the admission letter.').ok).toBe(true);
    expect(escalationStatus(exceptionById(id)!)).toBe('awaiting-information');
    expect(respondToEscalation(id, uni, 'Admission letter attached.').ok).toBe(true);
    expect(escalationStatus(exceptionById(id)!)).toBe('in-review');
    expect(referForInvestigation(id, jamb, 'JAMB Admissions Records Unit', '').ok).toBe(false);
    expect(referForInvestigation(id, jamb, 'JAMB Admissions Records Unit', 'Check CAPS.').ok && exceptionById(id)!.referredTo).toBe('JAMB Admissions Records Unit');
    // A decision needs an explanation, and a located admission needs the institution and session.
    expect(resolveException(id, jamb, 'admission-located', '').ok).toBe(false);
    expect(resolveException(id, jamb, 'admission-located', 'Found in CAPS.').ok).toBe(false);
    expect(closeCase(id, jamb).ok).toBe(false);
    const done = resolveException(id, jamb, 'admission-located', 'Admission found in CAPS under the 2024/2025 session.', { institution: 'UNILAG', session: '2024/2025', reference: 'CAPS-COR-2026-0042', instructions: 'Check the 2024/2025 session.' });
    expect(done.ok && done.value).toMatchObject({ status: 'resolved', resolution: { outcome: 'admission-located', details: { institution: 'UNILAG', session: '2024/2025', reference: 'CAPS-COR-2026-0042' } } });
    // No admission or clearance is created by the decision.
    expect(recordOf(D)).toBeUndefined();
    expect(resolveException(id, jamb, 'no-admission-confirmed', 'x').ok).toBe(false);
    expect(closeCase(id, jamb).ok && escalationStatus(exceptionById(id)!)).toBe('closed');
    // Nothing is overwritten: every step is in the history.
    expect(exceptionById(id)!.history.map((h) => h.action)).toEqual(['created', 'assigned', 'information-requested', 'note-added', 'escalated', 'resolution-recorded', 'closed']);
  });

  it('decisions depend on the case type; existing clearance has no revoke action', () => {
    expect(CASE_DECISIONS['identity-discrepancy']).toEqual(['identity-confirmed', 'identity-discrepancy-confirmed']);
    expect(CASE_DECISIONS['existing-clearance']).toEqual(['existing-record-confirmed', 'withdrawal-confirmed', 'next-step-authorised']);
    expect(CASE_DECISIONS['existing-clearance']).not.toContain('previous-clearance-revoked');
    expect(CASE_DECISIONS['admission-inquiry']).toEqual(['no-admission-confirmed', 'admission-located', 'institution-session-corrected', 'record-discrepancy-identified']);
    // Two comparisons only, everywhere.
    expect(comparisonsFor('nin-mismatch').map((c) => c.label)).toEqual(['JAMB vs Live Capture', 'NIN vs Live Capture']);
  });

  it('identity discrepancy confirmed keeps clearance on hold; authorising the next step on an existing clearance lifts the block without touching the previous record', () => {
    verifyUni(B);
    const b = escalateToJamb({ reg: B, officer: uni, category: 'exam-impersonation', comment: 'Live matches NIN only.', evidence: [] });
    expect(resolveException(b.ok ? b.value.id : '', jamb, 'identity-discrepancy-confirmed', 'The examination record shows a different person.').ok).toBe(true);
    expect(recordOf(B)!.blocked).toBe('exam-mismatch');
    recordExistingClearance(C, uni);
    const c = escalateToJamb({ reg: C, officer: uni, category: 'duplicate-clearance', comment: 'Existing clearance found.', evidence: [] });
    expect(resolveException(c.ok ? c.value.id : '', jamb, 'next-step-authorised', 'Withdrawal from UNIBEN verified; the candidate may proceed at UNILAG.').ok).toBe(true);
    expect(recordOf(C)!.blocked).toBeUndefined();
    expect(priorClearanceOf(C)).toMatchObject({ reference: 'JCL-UNIBEN-2025-418306' });
  });
});

describe('Candidate C identity timeline', () => {
  it('separates the previous University of Benin clearance from the current record; three stages, no matriculation', () => {
    recordExistingClearance(C, uni);
    const stages = journeyOf(recordOf(C)!, activitiesFor(C));
    const clearance = stages.find((s) => s.n === 3)!;
    expect(clearance.entries.map((e) => [e.activity, e.organisation])).toEqual(expect.arrayContaining([
      ['Previous clearance record (another institution)', 'University of Benin'],
      ['Clearance for the current admission record', 'University of Lagos'],
    ]));
    expect(clearance.entries.at(-1)!.activity).toBe('Clearance for the current admission record');
    expect(stages.map((s) => s.title)).toEqual(['JAMB Registration', 'JAMB Examination Verification', 'University Admission Clearance']);
  });
});

describe('NYSC verification scenarios and shared data', () => {
  it('A confirmed, B face mismatch (referable to JAMB), C admission clearance not confirmed', () => {
    const a = recordNyscVerification({ entered: NA, officer: nysc, captureMode: 'demo', record: recordOf(NA) });
    expect(a.ok && a.value).toMatchObject({ outcome: 'confirmed', checks: { face: 'match', nin: 'match' } });
    expect(nyscComparisons(a.ok ? a.value : {})).toEqual([{ label: 'JAMB vs Live Capture', result: 'match' }, { label: 'NIN vs Live Capture', result: 'match' }]);
    expect(nyscStatuses(a.ok ? a.value : { outcome: 'invalid' })).toEqual({ identity: 'confirmed', clearance: 'confirmed' });
    // Historical clearance comes from the shared record; NYSC creates no clearance of its own.
    expect(recordOf(NA)).toMatchObject({ clearance: 'cleared', clearanceRef: 'JCL-UI-2022-771205', clearedBy: 'Kehinde Adeleke' });

    const b = recordNyscVerification({ entered: NB, officer: nysc, captureMode: 'demo', record: recordOf(NB) });
    expect(b.ok && b.value).toMatchObject({ outcome: 'face-mismatch', checks: { face: 'no-match', nin: 'match' } });
    expect(nyscComparisons(b.ok ? b.value : {})).toEqual([{ label: 'JAMB vs Live Capture', result: 'mismatch' }, { label: 'NIN vs Live Capture', result: 'match' }]);
    expect(nyscStatuses(b.ok ? b.value : { outcome: 'invalid' }).identity).toBe('not-confirmed');
    expect(referToJamb(b.ok ? b.value.ref : '', nysc, '  ').ok).toBe(false);
    const ref = referToJamb(b.ok ? b.value.ref : '', nysc, 'Live capture matches NIN but not the JAMB profile.');
    // An identity exception for JAMB, not a fraud classification.
    expect(ref.ok && ref.value).toMatchObject({ category: 'nysc-identity-discrepancy', raisedByOrganisation: 'National Youth Service Corps', escalation: { source: 'nysc', comment: 'Live capture matches NIN but not the JAMB profile.', comparisons: [{ label: 'JAMB vs Live Capture', result: 'mismatch' }, { label: 'NIN vs Live Capture', result: 'match' }] } });
    expect(escalationsOf().some((e) => e.id === (ref.ok && ref.value.id))).toBe(true);
    expect(referToJamb(b.ok ? b.value.ref : '', nysc, 'again').ok).toBe(false);

    const c = recordNyscVerification({ entered: NC, officer: nysc, captureMode: 'demo', record: recordOf(NC) });
    expect(c.ok && c.value).toMatchObject({ outcome: 'clearance-not-confirmed', checks: { face: 'match', nin: 'match' } });
    expect(nyscStatuses(c.ok ? c.value : { outcome: 'invalid' })).toEqual({ identity: 'confirmed', clearance: 'not-confirmed' });
    const cr = referToJamb(c.ok ? c.value.ref : '', nysc, 'No clearance record.');
    expect(cr.ok && cr.value.category).toBe('nysc-clearance-not-confirmed');
    // NYSC never creates a university clearance.
    expect(recordOf(NC)!.clearance).toBe('pending');
    // Deterministic: the same number always gives the same scenario.
    const again = recordNyscVerification({ entered: NB, officer: nysc, captureMode: 'demo', record: recordOf(NB) });
    expect(again.ok && again.value.outcome).toBe('face-mismatch');
  });

  it('a university clearance reaches NYSC', () => {
    const first = recordNyscVerification({ entered: A, officer: nysc, captureMode: 'demo', record: recordOf(A) });
    expect(first.ok && first.value.outcome).toBe('clearance-not-confirmed');
    verifyUni(A); confirmClearance(A, uni);
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
    for (const label of ['Home', 'Verification Events', 'Verification Activity', 'Escalation Management', 'Student Records', 'Institutions', 'Reports', 'Users & Access', 'Audit Logs', 'Settings']) {
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

  it('university two-step clearance with a simulated Capture Face completes clearance (no device camera)', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const user = renderApp('/clearance/verify', 'acct_demo_unilag_clearance');
    await user.type(await screen.findByLabelText(/JAMB Registration Number/), A);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm and continue' }));
    expect(screen.getByText('Position student’s face within the frame')).toBeInTheDocument();
    expect(screen.queryByText(/Use Demo Face|Start camera/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Capture Face' }));
    expect(await screen.findByRole('heading', { name: 'Identity Verified' }, { timeout: 6000 })).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText('The captured face matches the student’s JAMB and NIN identity records.')).toBeInTheDocument();
    expect(screen.getByLabelText('Verification indicators')).toHaveTextContent('JAMB record: Match');
    expect(screen.getByLabelText('Verification indicators')).toHaveTextContent('NIN record: Match');
    // A simple result: no comparison analysis for a successful verification.
    expect(screen.queryByLabelText('Identity Verification Analysis')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Complete Clearance' }));
    expect(await screen.findByRole('heading', { name: 'Clearance Successful' })).toBeInTheDocument();
    for (const name of ['Print Clearance Certificate', 'View Clearance Details', 'Return to Student List']) expect(screen.getByRole('link', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify Another Student' })).toBeInTheDocument();
    // The registration portrait stays the only portrait; the capture is behind a deliberate action.
    expect(screen.queryByAltText('Captured face used for the verification')).not.toBeInTheDocument();
    await waitFor(() => expect(recordOf(A)!.clearance).toBe('cleared'));
  }, 15000);

  it('university scenario B shows the three-image analysis and escalates to JAMB', async () => {
    const user = renderApp(`/clearance/verify?reg=${B}`, 'acct_demo_unilag_clearance');
    await user.click(await screen.findByRole('button', { name: 'Confirm and continue' }));
    await user.click(screen.getByRole('button', { name: 'Capture Face' }));
    expect(await screen.findByRole('heading', { name: 'Identity Discrepancy Detected' }, { timeout: 6000 })).toBeInTheDocument();
    const analysis = screen.getByLabelText('Identity Verification Analysis');
    for (const label of ['JAMB Examination Verification Record', 'NIN Identity Record']) expect(within(analysis).getByText(label)).toBeInTheDocument();
    // The live capture appears in each side-by-side pair.
    expect(within(analysis).getAllByText('Live Clearance Capture')).toHaveLength(2);
    const outcomes = screen.getByLabelText('Comparison outcomes');
    expect(within(outcomes).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['JAMB examination record vs Live Capture: Mismatch', 'NIN identity record vs Live Capture: Match']);
    expect(outcomes).not.toHaveTextContent(/JAMB vs NIN/);
    expect(screen.getByText('The captured face matches the NIN identity record but does not match the JAMB examination verification record. Further investigation is required.')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveTextContent('Verification:Escalation requiredClearance:Pending review');
    expect(document.body.textContent).not.toMatch(/fraud/i);
    expect(screen.queryByRole('button', { name: /Use Demo Face|Start Camera/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete Clearance' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Escalate to JAMB' }));
    const drawer = await screen.findByRole('dialog', { name: 'Escalate to JAMB' });
    expect((within(drawer).getByLabelText(/Description/) as HTMLTextAreaElement).value).toBe('The student’s live captured portrait matches the NIN identity record but differs from the face associated with the JAMB examination verification record. This raises a possible examination identity impersonation concern. Kindly investigate and advise on the appropriate next steps.');
    await user.click(within(drawer).getByRole('button', { name: 'Submit escalation' }));
    expect(await screen.findByRole('heading', { name: 'Escalated to JAMB' })).toBeInTheDocument();
    expect(recordOf(B)!.verification).toBe('escalated');
    expect(escalationFor(B)).toMatchObject({ category: 'exam-impersonation' });
  }, 15000);

  it('university scenario C shows the existing clearance at lookup and escalates with a reason', async () => {
    const user = renderApp(`/clearance/verify?reg=${C}`, 'acct_demo_unilag_clearance');
    expect(await screen.findByRole('heading', { name: 'Existing Clearance Record Found' })).toBeInTheDocument();
    expect(screen.getByText('This student already has an existing clearance record associated with another institution within the same admission session. Further review is required.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm and continue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Capture Face' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Escalate to JAMB' }));
    const drawer = await screen.findByRole('dialog', { name: 'Escalate to JAMB' });
    await user.selectOptions(within(drawer).getByLabelText(/Escalation reason/), 'Student wishes to proceed with another institution');
    await user.click(within(drawer).getByRole('button', { name: 'Submit escalation' }));
    await waitFor(() => expect(escalationFor(C)?.escalation?.reason).toBe('Student wishes to proceed with another institution'));
    expect(document.body.textContent).not.toMatch(/matriculat(ed|ion status|ion number)/i);
  }, 15000);

  it('NYSC officer confirms Candidate A and gets a printable report', async () => {
    const user = renderApp('/nysc/verify', 'acct_demo_nysc_officer');
    await user.type(await screen.findByLabelText(/JAMB Registration Number/), NA);
    await user.click(screen.getByRole('button', { name: 'Retrieve records' }));
    expect(await screen.findByLabelText('Historical admission clearance')).toHaveTextContent('JCL-UI-2022-771205');
    await user.click(await screen.findByRole('button', { name: 'Continue to face capture' }));
    await user.click(screen.getByRole('button', { name: 'Capture Face' }));
    expect(await screen.findByRole('heading', { name: 'Candidate Identity Confirmed' }, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Verification status')).toHaveTextContent('Identity AssuranceConfirmedInstitutional ClearanceConfirmed');
    expect(within(screen.getByLabelText('Comparison outcomes')).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['JAMB vs Live Capture: Match', 'NIN vs Live Capture: Match']);
    const history = screen.getByLabelText('Candidate Identity & Clearance History');
    for (const t of ['JAMB Registration', 'JAMB Examination Verification', 'University Admission Clearance', 'NYSC Identity Verification', 'Kehinde Adeleke', 'JCL-UI-2022-771205']) expect(history).toHaveTextContent(t);
    expect(document.body.textContent).not.toMatch(/matriculat(ed|ion status|ion number|ion event)/i);
    await user.click(screen.getByRole('link', { name: 'View Verification Report' }));
    const report = await screen.findByLabelText('NYSC verification report');
    for (const t of ['JCL-UI-2022-771205', 'Kehinde Adeleke', 'Final identity assurance result: Confirmed', 'University of Ibadan']) expect(report).toHaveTextContent(t);
    // No captured biometric in the report.
    expect(within(report).queryByAltText(/live/i)).not.toBeInTheDocument();
  }, 15000);

  it('NYSC Candidate B: identity not confirmed, referred to JAMB with a comment', async () => {
    const user = renderApp('/nysc/verify', 'acct_demo_nysc_officer');
    await user.type(await screen.findByLabelText(/JAMB Registration Number/), NB);
    await user.click(screen.getByRole('button', { name: 'Retrieve records' }));
    await user.click(await screen.findByRole('button', { name: 'Continue to face capture' }));
    await user.click(screen.getByRole('button', { name: 'Capture Face' }));
    expect(await screen.findByRole('heading', { name: 'Candidate Identity Could Not Be Confirmed' }, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByText('The captured face matches the NIN identity record but does not match the JAMB profile record. Further investigation is required.')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Comparison outcomes')).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['JAMB vs Live Capture: Mismatch', 'NIN vs Live Capture: Match']);
    expect(screen.queryByRole('link', { name: 'View Verification Report' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/fraud/i);
    await user.click(screen.getByRole('button', { name: 'Refer to JAMB' }));
    const drawer = await screen.findByRole('dialog', { name: 'Refer to JAMB' });
    await user.click(within(drawer).getByRole('button', { name: 'Submit referral' }));
    expect(await screen.findByLabelText('Referral to JAMB')).toHaveTextContent(/ESC-\d{4}-\d{5}/);
    expect(escalationsOf().find((e) => e.reg === NB)).toMatchObject({ category: 'nysc-identity-discrepancy' });
  }, 15000);

  it('NYSC Candidate C: identity confirmed but admission clearance not confirmed; no report', async () => {
    const user = renderApp('/nysc/verify', 'acct_demo_nysc_officer');
    await user.type(await screen.findByLabelText(/JAMB Registration Number/), NC);
    await user.click(screen.getByRole('button', { name: 'Retrieve records' }));
    expect(await screen.findByText('No confirmed admission clearance record found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue to face capture' }));
    await user.click(screen.getByRole('button', { name: 'Capture Face' }));
    expect(await screen.findByRole('heading', { name: 'Admission Clearance Not Confirmed' }, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Verification status')).toHaveTextContent('Identity AssuranceConfirmedInstitutional ClearanceNot Confirmed');
    expect(within(screen.getByLabelText('Comparison outcomes')).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['JAMB vs Live Capture: Match', 'NIN vs Live Capture: Match']);
    expect(screen.queryByRole('link', { name: 'View Verification Report' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refer for clearance review' })).toBeInTheDocument();
  }, 15000);
});
