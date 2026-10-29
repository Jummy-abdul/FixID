import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_SESSION } from '@/auth/authCore';
import { ALL_PERSONAS, ORG_C } from '@/data/demoPersonas';
import { activityCounts } from '@/domain/activityLifecycle';
import { loadState } from '@/store/persistence';
import { sharedActivityTransactions } from '@/store/reporting';
import { createInitialState, type AppState } from '@/store/state';

const HALIMA = `${ORG_C}_usr_4`;
const VISITOR = `${ORG_C}_va_visitor_checkin`;

function as(accountId: string, s = createInitialState(new Date())): AppState {
  const p = ALL_PERSONAS.find((x) => x.accountId === accountId);
  const admin = p ? { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner' as const, organizationIds: [ORG_C] } : s.data.admin;
  return { ...s, data: { ...s.data, admin }, session: { ...s.session, currentOrganizationId: ORG_C } };
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

/** Looks a reference up in the activity's simulated source and, when found, completes the simulated portrait match. */
async function verifyExternal(user: UserEvent, reference: string, match?: 'Match' | 'No match' | 'Inconclusive') {
  await user.type(await screen.findByLabelText(/External Reference ID/), reference);
  await user.click(screen.getByRole('button', { name: 'Find Identity' }));
  if (!match) return;
  const found = await screen.findByRole('region', { name: 'Identity found' });
  await user.click(within(found).getByRole('button', { name: 'Continue Verification' }));
  await user.click(screen.getByRole('button', { name: 'Use simulated capture' }));
  await user.click(screen.getByRole('radio', { name: 'Passed' }));
  await user.click(screen.getByRole('radio', { name: match }));
  await user.click(screen.getByRole('button', { name: 'Verify Identity' }));
  return screen.findByRole('region', { name: 'Result' }, { timeout: 4000 });
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('verifier landing', () => {
  it('shows only the verifier’s own assignments, grouped by status, with source, schedule and progress', async () => {
    renderApp('/verify', as(HALIMA), HALIMA);
    const active = await screen.findByRole('list', { name: 'Your verification activities' });
    expect(within(active).getAllByRole('heading').map((h) => h.textContent).sort()).toEqual(['Badge Collection', 'Restricted Lounge Access', 'Visitor Check-in']);
    // Activities she isn't assigned to never appear.
    expect(screen.queryByText('Graduation Ceremony Check-in')).toBeNull();
    expect(screen.queryByText('Spring Open Day Check-in')).toBeNull();
    const card = within(active).getByRole('heading', { name: 'Visitor Check-in' }).closest('li')!;
    expect(card).toHaveTextContent('Brightwater Identity Service');
    expect(card).toHaveTextContent('Weekly on Mon, Tue, Wed, Thu, Fri · 08:00–18:00');
    expect(card).toHaveTextContent('Main Reception');
    expect(card).toHaveTextContent('2 verified · 3 attempts');
    expect(within(card).getByRole('button', { name: 'Start verification: Visitor Check-in' })).toBeEnabled();
  });

  it('groups upcoming and completed activities, which can be opened but not started, and filters by search and status', async () => {
    const user = renderApp('/verify', as('usr_tobyson'), 'usr_tobyson');
    const upcoming = await screen.findByRole('list', { name: 'Upcoming activities' });
    const graduation = within(upcoming).getByRole('heading', { name: 'Graduation Ceremony Check-in' }).closest('li')!;
    expect(within(graduation).queryByRole('button', { name: /Start verification/ })).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Completed activities' })).getByText('Spring Open Day Check-in')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'completed');
    expect(screen.queryByRole('list', { name: 'Your verification activities' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await user.type(screen.getByLabelText('Search activities'), 'zzz');
    expect(screen.getByText('No activities match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await user.click(await screen.findByRole('link', { name: 'Open activity: Graduation Ceremony Check-in' }));
    expect(await screen.findByRole('status')).toHaveTextContent('This activity hasn’t started yet');
    expect(screen.queryByRole('button', { name: 'Start verification' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Verification instructions' })).toHaveTextContent('portrait match');
  });

  it('explains when nothing is assigned, and shows an activity once an administrator assigns it', async () => {
    const s = as(HALIMA);
    const none: AppState = { ...s, data: { ...s.data, verifierAssignments: s.data.verifierAssignments.filter((v) => v.administratorId !== `${ORG_C}_adm_4`) } };
    renderApp('/verify', none, HALIMA);
    expect(await screen.findByText('No verification activities assigned to you.')).toBeInTheDocument();
    expect(screen.getByText(/No verification activities are available to you right now/)).toBeInTheDocument();
  });

  it('shows a newly assigned activity, including one created by an administrator', async () => {
    const s = as(HALIMA);
    const at = new Date().toISOString();
    const assigned: AppState = { ...s, data: { ...s.data, verifierAssignments: [...s.data.verifierAssignments, { organizationId: ORG_C, activityId: `${ORG_C}_va_graduation`, administratorId: `${ORG_C}_adm_4`, status: 'active', assignedAt: at, assignedBy: 'Jordan Blake' }] } };
    renderApp('/verify', assigned, HALIMA);
    expect(await screen.findByRole('list', { name: 'Upcoming activities' })).toHaveTextContent('Graduation Ceremony Check-in');
  });

  it('refuses an activity the verifier isn’t assigned to', async () => {
    renderApp(`/verify/activities/${ORG_C}_va_graduation`, as(HALIMA), HALIMA);
    expect(await screen.findByRole('heading', { name: 'You can’t perform this verification' })).toBeInTheDocument();
    expect(screen.getByText('Not assigned to this activity.')).toBeInTheDocument();
  });
});

describe('continuous verification', () => {
  it('verifies several people in a row, keeps every record, and the administrator sees them', async () => {
    const s = as(HALIMA);
    const before = activityCounts(sharedActivityTransactions(s, s.data.activityConfigs.find((a) => a.id === VISITOR)!));
    const user = renderApp(`/verify/activities/${VISITOR}`, s, HALIMA);
    // The overview: status, source, instructions and progress, and nothing administrative.
    expect(await screen.findByRole('heading', { level: 1, name: 'Visitor Check-in' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Verification instructions' })).toHaveTextContent('Retrieve the person’s record from Brightwater Identity Service using their External Reference ID.');
    expect(screen.getByRole('region', { name: 'Verification progress' })).toHaveTextContent('Total attempts3');
    expect(screen.queryByText(/Assigned verifiers|Edit activity|Configuration/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start verification' }));

    // 1. A match: Verified.
    let result = (await verifyExternal(user, 'DEMO-10001', 'Match'))!;
    expect(result).toHaveTextContent('Verified');
    expect(result).toHaveTextContent('Sample Person A••••0001');
    expect(result).toHaveTextContent('Simulated');
    expect(document.querySelector('main img')).toBeNull();

    // 2. Next person, same activity: verified, but the record isn't eligible.
    await user.click(screen.getByRole('button', { name: 'Verify next person' }));
    expect(await screen.findByRole('heading', { name: 'Identify Person' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Visitor Check-in' })).toBeInTheDocument();
    result = (await verifyExternal(user, 'DEMO-10002', 'Match'))!;
    expect(result).toHaveTextContent('Identity verified, not eligible');

    // 3. A mismatch: Unsuccessful, never labelled fraud, and no override.
    await user.click(screen.getByRole('button', { name: 'Verify next person' }));
    result = (await verifyExternal(user, 'DEMO-10001', 'No match'))!;
    expect(result).toHaveTextContent('Unsuccessful');
    expect(result).toHaveTextContent('isn’t evidence of fraud');
    expect(screen.queryByRole('button', { name: /override|approve|accept anyway/i })).toBeNull();

    // 4. No record found: says so, and ends as Unable to complete.
    await user.click(screen.getByRole('button', { name: 'Verify next person' }));
    await verifyExternal(user, 'DEMO-20001');
    expect(await screen.findByText('No identity record was found for the reference provided.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'End Verification' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Verification' }));
    result = await screen.findByRole('region', { name: 'Result' });
    expect(result).toHaveTextContent('Unable to complete');

    // Back to the activity: progress and the verifier's own history include all four.
    await user.click(screen.getByRole('button', { name: 'Return to activity' }));
    expect(await screen.findByRole('region', { name: 'Verification progress' })).toHaveTextContent(`Total attempts${before.attempts + 4}`);
    await user.click(screen.getByRole('link', { name: 'View history for this activity' }));
    expect(await screen.findByRole('heading', { name: 'My Verification History' })).toBeInTheDocument();
    expect(screen.getByLabelText('Activity')).toHaveValue(VISITOR);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => within(r).getAllByRole('cell')[4].textContent)).toEqual(['Unable to complete', 'Unsuccessful', 'Identity verified, not eligible', 'Verified']);
    expect(document.body.textContent).not.toContain('DEMO-10001');

    // The administrator's dashboard counts the same records.
    const saved = loadState()!;
    const after = activityCounts(sharedActivityTransactions(saved, saved.data.activityConfigs.find((a) => a.id === VISITOR)!));
    expect(after).toEqual({ attempts: before.attempts + 4, verified: before.verified + 2, unsuccessful: before.unsuccessful + 1, pending: before.pending, unable: before.unable + 1 });
  }, 30_000);

  it('the administrator’s activity page reflects a verifier’s new record', async () => {
    const s = as(HALIMA);
    const user = renderApp(`/verify/activities/${VISITOR}`, s, HALIMA);
    await user.click(await screen.findByRole('button', { name: 'Start verification' }));
    await verifyExternal(user, 'DEMO-10001', 'Match');
    const saved = loadState()!;
    document.body.innerHTML = '';
    localStorage.clear();
    renderApp(`/verification-activities/${VISITOR}?tab=participants`, as('usr_tobyson', { ...saved, data: { ...saved.data, admin: s.data.admin } }), 'usr_tobyson');
    await waitFor(() => expect(screen.getAllByRole('row').some((r) => r.textContent?.includes('Sample Person A') && r.textContent.includes('Halima Bello'))).toBe(true));
  }, 20_000);

  it('retrieves a FixID record with a simulated QR scan; an ineligible person is recorded without bypassing anything', async () => {
    const s = as(HALIMA);
    const user = renderApp(`/verify/activities/${ORG_C}_va_badge_collection`, s, HALIMA);
    await user.click(await screen.findByRole('button', { name: 'Start verification' }));
    await user.click(await screen.findByRole('button', { name: 'Scan QR code (simulated)' }));
    expect(screen.getByText(/no camera is used/)).toBeInTheDocument();
    const eligible = s.data.members.find((m) => m.id === `${ORG_C}_m_001`)!;
    await user.click(within(screen.getByRole('list', { name: 'Simulated credentials to scan' })).getByRole('button', { name: new RegExp(eligible.displayName) }));
    const found = await screen.findByRole('region', { name: 'Participant found' });
    expect(found).toHaveTextContent('EligibilityEligible');
    // The scan only fills in the identifier: the portrait step still follows.
    expect(within(found).getByRole('button', { name: 'Continue to face verification' })).toBeInTheDocument();
    await user.click(within(found).getByRole('button', { name: 'Find a different participant' }));
    await user.click(screen.getByRole('button', { name: 'Scan QR code (simulated)' }));
    const outsider = s.data.members.find((m) => m.id === `${ORG_C}_m_002`)!;
    await user.click(within(screen.getByRole('list', { name: 'Simulated credentials to scan' })).getByRole('button', { name: new RegExp(outsider.displayName) }));
    const other = await screen.findByRole('region', { name: 'Participant found' });
    expect(other).toHaveTextContent('Not eligible');
    expect(within(other).queryByRole('button', { name: /Continue to face verification/ })).toBeNull();
    await user.click(within(other).getByRole('button', { name: 'Record as not eligible' }));
    const result = await screen.findByRole('region', { name: 'Result' }, { timeout: 4000 });
    expect(result).toHaveTextContent('Not eligible');
    expect(screen.getByRole('button', { name: 'Verify next person' })).toBeInTheDocument();
  }, 20_000);

  it('says plainly when an identifier finds no record', async () => {
    const user = renderApp(`/verify/activities/${ORG_C}_va_badge_collection`, as(HALIMA), HALIMA);
    await user.click(await screen.findByRole('button', { name: 'Start verification' }));
    await user.type(await screen.findByLabelText(/Participant/), 'PN-999999');
    await user.click(screen.getByRole('button', { name: 'Find Participant' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nobody has been verified.');
  });
});
