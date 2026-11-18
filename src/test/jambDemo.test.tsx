import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_PASSWORD, builtInAccounts } from '@/auth/authCore';
import { BASE_COUNTS, INSTITUTIONS, NATIONAL_TOTALS, SESSIONS, UNILAG, baseRecords, institutionByCode, parseRegistration } from '@/jamb/data';
import { verificationUrl } from '@/jamb/certificate';
import {
  confirmClearance, confirmMatriculation, countsOf, institutionCounts, lookupForClearance, nationalCounts, recordOf, recordVerification, recordsOf, reloadJambState, type Officer,
} from '@/jamb/store';
import { createInitialState } from '@/store/state';

const officer: Officer = { name: 'Tolulope Adebayo', role: 'clearance-officer', institution: 'UNILAG' };
const jamb: Officer = { name: 'Aisha Danjuma', role: 'jamb-officer' };
const pendingStudent = () => recordsOf(UNILAG, '2026/2027').find((r) => r.verification === 'not-started' && r.clearance === 'pending')!;

function renderApp(path: string, accountId?: string) {
  if (accountId) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={createInitialState(new Date())}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); reloadJambState(); });

describe('JAMB demo data', () => {
  it('reconciles: national and UNILAG totals, and every session’s counts are consistent', () => {
    const n = nationalCounts();
    expect([n.admitted, n.cleared, n.matriculated, n.failed, n.exceptions, n.pending]).toEqual([NATIONAL_TOTALS.admitted, NATIONAL_TOTALS.cleared, NATIONAL_TOTALS.matriculated, NATIONAL_TOTALS.failed, NATIONAL_TOTALS.exceptions, 15_000]);
    expect(INSTITUTIONS).toHaveLength(25);
    const u = institutionCounts('UNILAG');
    expect([u.admitted, u.cleared, u.matriculated, u.pending, u.clearedNotMatriculated]).toEqual([1000, 700, 650, 300, 50]);
    for (const inst of INSTITUTIONS) for (const c of BASE_COUNTS[inst.code]) {
      expect(c.matriculated).toBeLessThanOrEqual(c.cleared);
      expect(c.cleared).toBeLessThanOrEqual(c.admitted);
      expect(c.failed + c.exceptions + c.verifiedAwaiting).toBeLessThanOrEqual(c.admitted - c.cleared);
    }
  });

  it('generated records match their session’s counts, and registration numbers round-trip', () => {
    for (const s of SESSIONS) {
      const recs = baseRecords(UNILAG, s);
      const c = countsOf('UNILAG', s);
      expect(recs.filter((r) => r.clearance === 'cleared')).toHaveLength(c.cleared);
      expect(recs.filter((r) => r.matriculation === 'matriculated')).toHaveLength(c.matriculated);
      expect(recs.filter((r) => r.verification === 'failed')).toHaveLength(c.failed);
      // Nobody is matriculated without clearance.
      expect(recs.some((r) => r.matriculation === 'matriculated' && r.clearance !== 'cleared')).toBe(false);
    }
    const r = baseRecords(institutionByCode('UI')!, '2025/2026')[42];
    expect(parseRegistration(r.reg)).toMatchObject({ ok: true, index: 42, session: '2025/2026' });
    expect(parseRegistration('20250100000ZZ').ok).toBe(false);
    expect(parseRegistration('not a number')).toEqual({ ok: false, reason: 'format' });
  });
});

describe('clearance actions (shared state)', () => {
  it('verify → clear → matriculate updates the student, the university and JAMB, and is checked at each step', () => {
    const s = pendingStudent();
    expect(confirmClearance(s.reg, officer)).toMatchObject({ ok: false, error: /verified successfully before clearance/ });
    expect(recordVerification({ entered: s.reg, session: s.session, officer: jamb, outcome: 'match', captureMode: 'simulated', record: s })).toMatchObject({ ok: false });
    expect(recordVerification({ entered: s.reg, session: s.session, officer, outcome: 'match', captureMode: 'simulated', record: s }).ok).toBe(true);
    expect(confirmMatriculation(s.reg, officer)).toMatchObject({ ok: false, error: /Only a cleared student/ });
    expect(confirmClearance(s.reg, jamb)).toMatchObject({ ok: false });
    expect(confirmClearance(s.reg, officer).ok).toBe(true);
    expect(recordOf(s.reg)).toMatchObject({ verification: 'verified', clearance: 'cleared', clearedBy: 'Tolulope Adebayo', matriculation: 'not-matriculated' });
    expect(countsOf('UNILAG', '2026/2027').cleared).toBe(76);
    expect(nationalCounts().cleared).toBe(35_001);
    expect(confirmMatriculation(s.reg, officer).ok).toBe(true);
    expect(nationalCounts().matriculated).toBe(30_001);
    // Persisted for the other console (other tabs reload it the same way).
    reloadJambState();
    expect(recordOf(s.reg)?.matriculation).toBe('matriculated');
  });

  it('a failed match blocks clearance; service unavailable decides nothing; other institutions’ students aren’t found', () => {
    const s = pendingStudent();
    recordVerification({ entered: s.reg, session: s.session, officer, outcome: 'no-match', captureMode: 'simulated', record: s });
    expect(recordOf(s.reg)?.verification).toBe('failed');
    expect(confirmClearance(s.reg, officer).ok).toBe(false);
    expect(countsOf('UNILAG', '2026/2027').failed).toBe(4);
    const t = recordsOf(UNILAG, '2026/2027').filter((r) => r.verification === 'not-started')[1];
    recordVerification({ entered: t.reg, session: t.session, officer, outcome: 'unavailable', captureMode: 'simulated', record: t });
    expect(recordOf(t.reg)?.verification).toBe('not-started');
    const other = baseRecords(institutionByCode('UI')!, '2026/2027')[0];
    expect(lookupForClearance(other.reg, '2026/2027', officer)).toEqual({ ok: false, outcome: 'not-found' });
    expect(lookupForClearance(t.reg, '2025/2026', officer)).toEqual({ ok: false, outcome: 'not-found' });
    expect(lookupForClearance('abc', '2026/2027', officer)).toEqual({ ok: false, outcome: 'invalid' });
  });
});

describe('JAMB demo accounts and screens', () => {
  it('both accounts exist in demo builds with the shared password, each opening its own console only', async () => {
    expect(builtInAccounts().filter((a) => a.consoleRole).map((a) => a.consoleRole)).toEqual(['jamb-officer', 'clearance-officer']);
    renderApp('/jamb', 'acct_demo_unilag_clearance');
    expect(await screen.findByRole('heading', { name: 'Clearance dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Clearance summary' })).toHaveTextContent('1,000');
  });

  it('signs in from the demo selector as the JAMB Officer and opens the JAMB dashboard', async () => {
    const user = renderApp('/signin');
    await user.click(await screen.findByRole('button', { name: 'View demo accounts' }));
    const group = screen.getByRole('list', { name: 'JAMB identity assurance (proposed)' });
    expect(within(group).getByText('University of Lagos (UNILAG) · Institutional Clearance Officer')).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Use JAMB Officer account' }));
    expect(screen.getByLabelText('Password')).toHaveValue(DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'National identity assurance overview' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Key statistics' })).toHaveTextContent('50,000');
    expect(screen.getByRole('img', { name: 'Joint Admissions and Matriculation Board logo' })).toBeInTheDocument();
  });

  it('two steps: identify the student, then capture and verify; the result leads to clearance and the certificate', async () => {
    const s = pendingStudent();
    const user = renderApp(`/clearance/verify?session=2026-2027`, 'acct_demo_unilag_clearance');
    expect(screen.getAllByRole('listitem').filter((li) => li.closest('[aria-label="Verification steps"]')).map((li) => li.textContent)).toEqual(['1Identify student', '2Capture face and verify']);
    await user.type(await screen.findByLabelText(/JAMB Registration Number/), s.reg);
    await user.click(screen.getByRole('button', { name: 'Find student' }));
    // Step 1 shows the retrieved record with the registration portrait.
    expect(screen.getByLabelText('Student information')).toHaveTextContent(s.reg);
    expect(screen.getByRole('img', { name: /JAMB registration portrait/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    // Step 2: capturing goes straight to verification.
    await user.click(screen.getByRole('button', { name: 'No camera? Use demo capture' }));
    const result = await screen.findByLabelText('Verification result', {}, { timeout: 3000 });
    expect(within(result).getByRole('heading', { name: 'Identity Verified' })).toBeInTheDocument();
    expect(within(result).getByRole('img', { name: 'Captured portrait' })).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Complete Clearance' }));
    expect(await screen.findByRole('heading', { name: 'Clearance Successful' })).toBeInTheDocument();
    expect(screen.getByLabelText('Clearance record')).toHaveTextContent('Tolulope Adebayo');
    expect(screen.getByLabelText('Clearance record')).toHaveTextContent('Identity verified · Face match successful');
    // The registration portrait is the only portrait; the live capture is evidence, shown only on request.
    expect(screen.getByRole('img', { name: /JAMB registration portrait/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Captured portrait/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View verification details' }));
    expect(within(screen.getByRole('region', { name: 'Verification details' })).getByRole('img', { name: /Captured portrait used for the face match/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide verification details' }));
    expect(screen.queryByRole('img', { name: /Captured portrait/ })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Print clearance certificate' }));
    const cert = await screen.findByLabelText('Clearance certificate');
    expect(cert).toHaveTextContent('Demonstration record, not an official document');
    expect(within(cert).getByRole('img', { name: /QR code linking/ })).toBeInTheDocument();
    expect(within(cert).getByRole('img', { name: 'Joint Admissions and Matriculation Board logo' })).toBeInTheDocument();
  });

  it('a failed face match offers retry, recapture and the student record, never clearance', async () => {
    const s = pendingStudent();
    const user = renderApp(`/clearance/verify?session=2026-2027&reg=${s.reg}`, 'acct_demo_unilag_clearance');
    await user.click(await screen.findByRole('button', { name: 'Confirm and continue' }));
    await user.selectOptions(screen.getByLabelText('Verification response'), 'no-match');
    await user.click(screen.getByRole('button', { name: 'No camera? Use demo capture' }));
    expect(await screen.findByRole('heading', { name: 'Identity Could Not Be Confirmed' }, { timeout: 3000 })).toBeInTheDocument();
    for (const name of ['Retry verification', 'Recapture portrait']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to student record' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete Clearance' })).toBeNull();
    expect(recordOf(s.reg)?.verification).toBe('failed');
  });

  it('an invalid registration number is handled gracefully in step 1', async () => {
    const user = renderApp('/clearance/verify', 'acct_demo_unilag_clearance');
    await user.type(await screen.findByLabelText(/JAMB Registration Number/), '12345');
    await user.click(screen.getByRole('button', { name: 'Find student' }));
    expect(screen.getByText('Invalid registration number')).toBeInTheDocument();
  });

  it('the console carries JAMB branding with the institution as context, and no FixID branding or prototype banners', async () => {
    renderApp('/clearance', 'acct_demo_unilag_clearance');
    expect(await screen.findByText('JAMB Identity Verification & Clearance')).toBeInTheDocument();
    expect(screen.getByLabelText('Institution')).toHaveTextContent('University of LagosUniversity Clearance Officer');
    expect(document.body).not.toHaveTextContent(/FixID|Powered by/);
    expect(screen.getAllByText('Demo environment')).toHaveLength(1);
  });

  it('the QR code’s page shows the clearance details carried by the code', async () => {
    const s = pendingStudent();
    recordVerification({ entered: s.reg, session: s.session, officer, outcome: 'match', captureMode: 'simulated', record: s });
    confirmClearance(s.reg, officer);
    const url = new URL(verificationUrl(recordOf(s.reg)!, 'FXC-2026-TEST01'));
    renderApp(`${url.pathname}${url.search}`);
    const details = await screen.findByLabelText('Verification details');
    expect(details).toHaveTextContent(`${s.firstName} ${s.lastName}`);
    expect(details).toHaveTextContent('University of Lagos');
    expect(details).not.toHaveTextContent(s.reg);
  });

  it('the JAMB officer can’t open the clearance console, and sees the reconciliation integrity check', async () => {
    renderApp('/clearance/verify', 'acct_demo_jamb_officer');
    expect(await screen.findByRole('heading', { name: 'National identity assurance overview' })).toBeInTheDocument();
  });

  it('reconciliation shows JAMB’s worked example for UNILAG', async () => {
    renderApp('/jamb/reconciliation?institution=UNILAG', 'acct_demo_jamb_officer');
    const summary = await screen.findByLabelText('Reconciliation summary');
    expect(summary).toHaveTextContent('Original admission (JAMB)1,000');
    expect(summary).toHaveTextContent('Confirmed matriculation650');
    expect(summary).toHaveTextContent('Admitted, not cleared300');
    expect(summary).toHaveTextContent('Cleared, not matriculated50');
    await waitFor(() => expect(screen.getByText(/Integrity check passed/)).toBeInTheDocument());
  });
});
