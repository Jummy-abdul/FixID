import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, builtInAccounts } from '@/auth/authCore';
import { createInitialState } from '@/store/state';
import { IIV_PERSONAS } from '@/iiv/personas';
import { photoUrl } from '@/iiv/media';
import {
  addInstitution, closeEvent, compareIdentity, eventsFor, getIiv, importRecords, inviteExisting, lookupCandidate, publishEvent, recordByReg, resetIiv, saveEvent, saveRecord,
  setInstitutionStatus, submitVerification,
} from '@/iiv/store';

const officer = { name: 'Adebola Ogunyemi', email: 'clearance.officer@ui-demo.example', institution: 'UI' };
const NGOZI = '20250110421NE'; const MUSA = '20250110436MD';

function renderApp(path: string, accountId: string) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={createInitialState(new Date())}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetIiv(); });

describe('JAMB Institutional Identity Verification: accounts', () => {
  it('adds the JAMB Administrator and Institution Clearance Officer accounts without changing the existing ones', () => {
    const ids = builtInAccounts().map((a) => a.id);
    for (const id of ['acct_demo_jamb_officer', 'acct_demo_unilag_clearance', 'acct_demo_nysc_officer', 'acct_demo_iiv_admin', 'acct_demo_iiv_officer']) expect(ids).toContain(id);
    expect(builtInAccounts().find((a) => a.id === 'acct_demo_iiv_admin')).toMatchObject({ consoleRole: 'iiv-admin', email: 'jamb.admin@jamb-demo.example' });
    expect(IIV_PERSONAS[1]).toMatchObject({ institution: 'UI', organization: 'University of Ibadan' });
  });
});

describe('JAMB Institutional Identity Verification: store', () => {
  it('institutions: add, invite, activate and deactivate, with validation', () => {
    expect(addInstitution({ name: 'X', code: 'UI', type: 'Federal University', email: 'a@b.example', contactPerson: 'Y' }, 'add').ok).toBe(false);
    expect(addInstitution({ name: 'X', code: 'NEWU', type: 'Federal University', email: 'bad', contactPerson: 'Y' }, 'add').ok).toBe(false);
    const inv = addInstitution({ name: 'Federal University Oye-Ekiti', code: 'FUOYE', type: 'Federal University', email: 'admissions@fuoye.example', contactPerson: 'Dr. Ayo Ige' }, 'invite');
    expect(inv.ok && inv.value).toMatchObject({ status: 'invited', invitationRef: expect.stringMatching(/^INV-\d{4}-\d{5}$/) });
    expect(eventsFor('FUOYE')).toEqual([]);
    expect(setInstitutionStatus('FUOYE', 'active').ok).toBe(true);
    expect(eventsFor('FUOYE').map((e) => e.name)).toContain('2025/2026 Admission Clearance');
    expect(setInstitutionStatus('FUOYE', 'inactive').ok && inviteExisting('FUOYE').ok).toBe(true);
  });

  it('events: save as draft, publish, then close; published events reach the institution', () => {
    expect(saveEvent({ name: 'E', session: '2026/2027', institutions: 'all', startsAt: '2026-12-01', endsAt: '2026-11-01', description: '' }, false).ok).toBe(false);
    const d = saveEvent({ name: '2026/2027 Admission Clearance', session: '2026/2027', institutions: ['UI'], startsAt: '2026-12-01', endsAt: '2027-12-18', description: 'Clearance' }, false);
    expect(d.ok && d.value.status).toBe('draft');
    expect(eventsFor('UI').map((e) => e.name)).not.toContain('2026/2027 Admission Clearance');
    expect(publishEvent(d.ok ? d.value.id : '').ok).toBe(true);
    expect(eventsFor('UI').map((e) => e.name)).toContain('2026/2027 Admission Clearance');
    expect(eventsFor('LASU').map((e) => e.name)).not.toContain('2026/2027 Admission Clearance');
    expect(closeEvent(d.ok ? d.value.id : '').ok).toBe(true);
    expect(eventsFor('UI').map((e) => e.name)).not.toContain('2026/2027 Admission Clearance');
  });

  it('identity records: enrol, update, validate and batch import', () => {
    expect(saveRecord({ reg: '123', fullName: 'A', institution: 'UI', course: 'C', session: '2026/2027' }, 'H').ok).toBe(false);
    expect(saveRecord({ reg: NGOZI, fullName: 'A', institution: 'UI', course: 'C', session: '2026/2027' }, 'H').ok).toBe(false);
    const r = saveRecord({ reg: '20260110501TB', fullName: 'Tunde Adewale Bakare', dateOfBirth: '2007-02-03', institution: 'UI', course: 'B.Sc. Economics', session: '2026/2027', jambPhoto: photoUrl('nysc_a_jamb.jpg'), ninPhoto: photoUrl('nysc_a_nin.jpg') }, 'Halima Abubakar');
    expect(r.ok && r.value).toMatchObject({ reg: '20260110501TB', enrolledBy: 'Halima Abubakar' });
    expect(saveRecord({ ...recordByReg('20260110501TB')!, course: 'B.Sc. Accounting' }, 'Halima Abubakar', '20260110501TB').ok && recordByReg('20260110501TB')!.course).toBe('B.Sc. Accounting');
    const imp = importRecords('registration_number,full_name,date_of_birth,gender,state_of_origin,institution_code,course_of_study,admission_session,nin_last4\n20260110503OB,Oluwaseun Bayo Ogundipe,2007-03-14,Male,Oyo,UI,B.Sc. Economics,2026/2027,5521\nbad,Row,,,,UI,C,2026/2027,', 'H');
    expect(imp).toMatchObject({ added: 1, updated: 0 });
    expect(imp.errors).toHaveLength(1);
    expect(recordByReg('20260110503OB')).toMatchObject({ fullName: 'Oluwaseun Bayo Ogundipe', ninLast4: '5521', jambPhoto: undefined });
  });

  it('lookup: found, not found, other institution, other session, incomplete', () => {
    const ev = getIiv().events.find((e) => e.status === 'published')!;
    expect(lookupCandidate(NGOZI, officer, ev).ok).toBe(true);
    expect(lookupCandidate('20259999999ZZ', officer, ev)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(lookupCandidate('20250140318TA', officer, ev)).toMatchObject({ ok: false, reason: 'other-institution' });
    expect(lookupCandidate('abc', officer, ev)).toMatchObject({ ok: false, reason: 'invalid' });
    importRecords('registration_number,full_name,institution_code,course_of_study,admission_session\n20250110599XY,No Photo,UI,C,2025/2026', 'H');
    expect(lookupCandidate('20250110599XY', officer, ev)).toMatchObject({ ok: false, reason: 'incomplete' });
  });

  it('comparisons: success (NIN and JAMB match) and discrepancy (NIN matches, JAMB does not), for face and fingerprint', () => {
    expect(compareIdentity(recordByReg(NGOZI)!, 'face')).toMatchObject({ ninResult: 'match', jambResult: 'match', outcome: 'verified', capture: photoUrl('s1_live.jpg'), ninImage: photoUrl('s1_nin.jpg'), jambImage: photoUrl('s1_jamb.jpg') });
    expect(compareIdentity(recordByReg(MUSA)!, 'face')).toMatchObject({ ninResult: 'match', jambResult: 'mismatch', outcome: 'discrepancy', capture: photoUrl('s2_live.jpg') });
    expect(compareIdentity(recordByReg(MUSA)!, 'fingerprint')).toMatchObject({ ninResult: 'match', jambResult: 'mismatch', outcome: 'discrepancy' });
  });

  it('a submitted verification keeps the exact evidence for JAMB', () => {
    const ev = getIiv().events.find((e) => e.status === 'published')!;
    const v = submitVerification({ reg: MUSA, eventId: ev.id, method: 'face', officer, capturedAt: '2026-11-24T10:00:00.000Z', remarks: 'Candidate presented admission letter.' });
    expect(v.ok && v.value).toMatchObject({
      reg: MUSA, institution: 'UI', institutionName: 'University of Ibadan', eventName: '2025/2026 Admission Clearance', session: '2025/2026', officer: 'Adebola Ogunyemi', method: 'face',
      capture: photoUrl('s2_live.jpg'), ninImage: photoUrl('s2_nin.jpg'), jambImage: photoUrl('s2_jamb.jpg'), ninResult: 'match', jambResult: 'mismatch', outcome: 'discrepancy', capturedAt: '2026-11-24T10:00:00.000Z',
      candidate: { fullName: 'Musa Ibrahim Danladi', course: 'B.Sc. Electrical and Electronics Engineering' }, remarks: 'Candidate presented admission letter.',
    });
    expect(getIiv().verifications[0].ref).toBe(v.ok ? v.value.ref : '');
    expect(submitVerification({ reg: '20250140318TA', eventId: ev.id, method: 'face', officer, capturedAt: '' }).ok).toBe(false);
  });
});

describe('JAMB Institutional Identity Verification: portals', () => {
  it('institution officer verifies a candidate (face, success) and JAMB sees the same record and evidence', async () => {
    const user = renderApp('/institution/verify', 'acct_demo_iiv_officer');
    await user.type(await screen.findByLabelText(/JAMB Registration Number/), NGOZI);
    await user.click(screen.getByRole('button', { name: 'Retrieve candidate' }));
    const card = await screen.findByLabelText('Candidate record');
    for (const t of ['Ngozi Amarachi Eze', NGOZI, 'University of Ibadan', 'B.Sc. Computer Science', '2025/2026']) expect(card).toHaveTextContent(t);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('radio', { name: /Face verification/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Continue to capture' }));
    await user.click(screen.getByRole('button', { name: 'Capture Face' }));
    await user.click(await screen.findByRole('button', { name: 'Verify Identity' }, { timeout: 4000 }));
    expect(await screen.findByText('Checking against National Identity Record…')).toBeInTheDocument();
    expect(await screen.findByText('Checking against JAMB Record…', {}, { timeout: 4000 })).toBeInTheDocument();
    const results = await screen.findByLabelText('Comparison results', {}, { timeout: 6000 });
    expect(within(results).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Captured face vs NIN record: Match', 'Captured face vs JAMB record: Match']);
    expect(screen.getByLabelText('Overall verification outcome')).toHaveTextContent('Identity Verified');
    await user.click(screen.getByRole('button', { name: 'Submit Verification' }));
    expect(await screen.findByLabelText('Verification submitted')).toHaveTextContent(/IVR-\d{4}-\d{6}/);
    const v = getIiv().verifications[0];
    expect(v).toMatchObject({ reg: NGOZI, outcome: 'verified', capture: photoUrl('s1_live.jpg') });
    expect(document.body.textContent).not.toMatch(/simulat|demo data|mock|POC\b|test environment|Demo environment/i);
  }, 20000);

  it('JAMB administrator opens the submitted record with the captured and reference images', async () => {
    const ev = getIiv().events.find((e) => e.status === 'published')!;
    const v = submitVerification({ reg: MUSA, eventId: ev.id, method: 'face', officer, capturedAt: '2026-11-24T10:00:00.000Z' });
    renderApp(`/admin/records/${v.ok ? v.value.ref : ''}`, 'acct_demo_iiv_admin');
    expect(await screen.findByLabelText('Overall verification outcome')).toHaveTextContent('Identity Discrepancy');
    const evidence = screen.getByLabelText('Identity evidence');
    for (const img of within(evidence).getAllByAltText('Captured face')) expect(img).toHaveAttribute('src', photoUrl('s2_live.jpg'));
    expect(within(evidence).getAllByAltText('NIN reference image')[0]).toHaveAttribute('src', photoUrl('s2_nin.jpg'));
    expect(within(evidence).getAllByAltText('JAMB reference image')[0]).toHaveAttribute('src', photoUrl('s2_jamb.jpg'));
    expect(screen.getByLabelText('Candidate')).toHaveTextContent('Musa Ibrahim Danladi');
    expect(document.body.textContent).not.toMatch(/simulat|demo data|mock|POC\b|test environment|Demo environment/i);
  });

  it('the enrollment facility is not in the institution officer’s navigation, and the officer can’t open the admin portal', async () => {
    renderApp('/admin/identity-records', 'acct_demo_iiv_officer');
    expect(await screen.findByRole('heading', { name: /Welcome, Adebola/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Identity Record Enrollment/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Verify Candidate/ }).length).toBeGreaterThan(0));
  });
});
