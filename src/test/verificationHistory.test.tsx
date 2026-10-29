import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY } from '@/auth/authCore';
import { DEMO_PERSONAS, ORG_B, ORG_C } from '@/data/demoPersonas';
import { originalResultOf, reviewOutcomeOf } from '@/domain/history';
import { applyApprovalDecision, exceptionFor } from '@/store/exceptionOps';
import { createInitialState, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };
function as(accountId: string, orgId: string, s = createInitialState(new Date())): AppState {
  const p = DEMO_PERSONAS.find((x) => x.accountId === accountId);
  const admin = p ? { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner' as const, organizationIds: [orgId] } : { ...s.data.admin, id: accountId };
  return { ...s, data: { ...s.data, admin }, session: { ...s.session, currentOrganizationId: orgId } };
}
const tx = (s: AppState, suffix: string) => s.data.verificationAttempts.find((a) => a.id.endsWith(suffix))!;

function renderApp(path: string, state: AppState, accountId: string) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('original results and review outcomes', () => {
  it('classifies the original result from the attempt itself, never from the review', () => {
    const s = createInitialState(new Date());
    expect(originalResultOf(tx(s, 'D06'))).toBe('successful');
    expect(originalResultOf(tx(s, 'D07'))).toBe('unsuccessful');
    expect(originalResultOf(tx(s, 'D09'))).toBe('incomplete');
    // Reviewed and approved: the original stays "Referred for review"; the review is read from the exception.
    const d16 = tx(s, 'D16');
    expect(d16.reviewDisposition).toBeDefined();
    expect(originalResultOf(d16)).toBe('review');
    expect(reviewOutcomeOf(exceptionFor(s, d16.exceptionId!))).toMatchObject({ key: 'verification-confirmed', label: 'Identity confirmed', detail: 'Approved by Tobyson TE' });
    expect(reviewOutcomeOf(exceptionFor(s, tx(s, 'D17').exceptionId!))).toMatchObject({ key: 'pending-approval' });
    expect(originalResultOf({ status: 'cancelled' })).toBe('incomplete');
    expect(originalResultOf({ status: 'in-progress' })).toBeUndefined();
  });

  it('approving a review decision adds no attempt and leaves the original result alone', () => {
    const s = as('usr_tobyson', ORG_C);
    const before = s.data.verificationAttempts.length;
    const d17 = tx(s, 'D17');
    const after = ok(applyApprovalDecision(s, { organizationId: ORG_C, exceptionId: d17.exceptionId!, decision: 'approve', reason: '', at: AT })).state;
    expect(after.data.verificationAttempts).toHaveLength(before);
    expect(originalResultOf(tx(after, 'D17'))).toBe('review');
    expect(tx(after, 'D17').decision).toBe(d17.decision);
    expect(reviewOutcomeOf(exceptionFor(after, d17.exceptionId!)).detail).toBe('Approved by Tobyson TE');
  });
});

describe('Verification History screens', () => {
  it('shows summary cards, the spec’s columns, and filters that keep the totals consistent', async () => {
    const user = renderApp('/verification-history?range=all', createInitialState(new Date()), 'acct_demo_c_admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Verification History' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Participant', 'Identifier', 'Verification activity', 'Original result', 'Final review outcome', 'Verifier', 'Date & time', 'Exception', 'Action']);
    const summary = screen.getByRole('region', { name: 'Summary' });
    for (const l of ['Total attempts', 'Successful', 'Unsuccessful', 'Incomplete']) expect(within(summary).getByText(l)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Activity'), 'Restricted Lounge Access');
    await waitFor(() => expect(summary).toHaveTextContent('Total attempts66 referred for reviewSuccessful0Unsuccessful0Incomplete0'));
    await user.selectOptions(screen.getByLabelText('Final review outcome'), 'Awaiting approval');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Referred for review');
    expect(rows[0]).toHaveTextContent('Awaiting approval');
    expect(within(rows[0]).getByRole('link', { name: 'EXC-00006' })).toHaveAttribute('href', '/exceptions/EXC-00006');
    expect(rows[0]).toHaveTextContent('••••0001');
  });

  it('search finds an attempt by exception reference; clearing filters restores everything; no portraits anywhere', async () => {
    const user = renderApp('/verification-history?range=all', createInitialState(new Date()), 'acct_demo_c_admin');
    await user.type(await screen.findByLabelText('Search verification history'), 'EXC-00008');
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    await user.type(screen.getByLabelText('Search verification history'), 'zzz');
    expect(await screen.findByText('No records match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('row').length).toBeGreaterThan(10);
    expect(document.querySelector('img, svg[aria-label*="portrait" i]')).toBeNull();
    expect(screen.queryByText(/Show portrait comparison/)).toBeNull();
  });

  it('the details show attempt, review and activity context separately, with the original result kept', async () => {
    const s = createInitialState(new Date());
    renderApp(`/verification-history/${tx(s, 'D16').id}`, s, 'acct_demo_c_admin');
    const info = await screen.findByLabelText('Attempt information');
    expect(info).toHaveTextContent('Referred for review');
    expect(info).toHaveTextContent('Tobyson TE');
    const review = screen.getByLabelText('Review information');
    expect(review).toHaveTextContent('Eligibility not met');
    expect(review).toHaveTextContent('Identity confirmed');
    expect(review).toHaveTextContent('Approved by Tobyson TE');
    // Confirming identity didn't make the person eligible.
    expect(review).toHaveTextContent('Not verified');
    expect(within(review).getByRole('link', { name: 'EXC-00005' })).toHaveAttribute('href', '/exceptions/EXC-00005');
    expect(within(screen.getByLabelText('Activity context')).getByRole('link', { name: 'Restricted Lounge Access' })).toBeInTheDocument();
    expect(screen.queryByText(/Show portrait comparison/)).toBeNull();
  });

  it('an attempt without an exception says so and invents no review', async () => {
    const s = createInitialState(new Date());
    renderApp(`/verification-history/${tx(s, 'D07').id}`, s, 'acct_demo_c_admin');
    expect(await screen.findByText(/No exception was raised for this attempt/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Review information')).toBeNull();
    expect(screen.getByLabelText('Attempt information')).toHaveTextContent('Unsuccessful');
  });

  it('respects organization scope: Meridian sees none of Brightwater’s attempts', async () => {
    const s = createInitialState(new Date());
    renderApp('/verification-history?range=all&q=Restricted', as('acct_demo_b_admin', ORG_B, s), 'acct_demo_b_admin');
    expect(await screen.findByText('No records match')).toBeInTheDocument();
  });

  it('without exception permissions the history shows that an exception exists, but no link to it', async () => {
    let s = createInitialState(new Date());
    s = { ...s, data: { ...s.data, customRoles: [...s.data.customRoles, { id: 'role_history_only', organizationId: ORG_C, name: 'History Reader', description: 'Reads verification history only.', permissions: ['verification.results.view'], system: false, createdAt: AT, createdBy: 'Test', updatedAt: AT, updatedBy: 'Test' }] } };
    // Jordan holds only this role here.
    s = { ...s, data: { ...s.data, administrators: s.data.administrators.map((a) => (a.userId === 'acct_demo_c_admin' ? { ...a, roleIds: ['role_history_only'] } : a)) } };
    renderApp('/verification-history?range=all&q=D17', s, 'acct_demo_c_admin');
    const row = (await screen.findAllByRole('row'))[1];
    expect(row).toHaveTextContent('Exception raised');
    expect(within(row).queryByRole('link', { name: /EXC-/ })).toBeNull();
  });

  it('activity details link to that activity’s history', async () => {
    const s = createInitialState(new Date());
    const user = renderApp(`/verification-activities/${tx(s, 'D16').activityId}`, s, 'acct_demo_c_admin');
    await user.click(await screen.findByRole('link', { name: 'View verification history' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Verification History' })).toBeInTheDocument();
    expect(screen.getByLabelText('Activity')).toHaveValue(tx(s, 'D16').activityId);
    expect(screen.getAllByRole('row').slice(1).every((r) => r.textContent?.includes('Restricted Lounge Access'))).toBe(true);
  });
});
