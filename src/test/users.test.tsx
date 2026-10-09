import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import type { Member } from '@/domain/types';
import { selectOrgData } from '@/store/AppStore';
import { applyEnrollmentInvite, applyMemberStatus, enrollmentInviteEligibility } from '@/store/operations';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

const registry = buildIdSwitchRegistry();
const emailOf = (m: Member) => registry.find((r) => r.idSwitchId === m.idSwitchId)?.email ?? '';

function sampleState(): AppState {
  const state = createInitialState(new Date());
  state.session.currentOrganizationId = SAMPLE_ORGANIZATION_ID;
  return state;
}

function renderApp(path: string, state: AppState = sampleState()) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { state, user: userEvent.setup() };
}

const org = () => selectOrgData(loadState()!, SAMPLE_ORGANIZATION_ID);
const kpi = (label: string) => within(screen.getByRole('region', { name: 'User summary' })).getByText(label).closest('.rounded-xl')!.querySelector('.text-2xl')!;
const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr')!;

/** Narrows the Users table to one person. */
async function search(user: ReturnType<typeof userEvent.setup>, name: string) {
  const box = screen.getByRole('searchbox', { name: /search name/i });
  await user.clear(box);
  await user.type(box, name);
  await screen.findByRole('link', { name });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Users page', () => {
  it('shows only the heading, four KPI cards from real data, and the specified columns', async () => {
    const { state } = renderApp('/users');
    const heading = screen.getByRole('heading', { level: 1, name: 'Users' });
    expect(heading.nextElementSibling).toBeNull();
    expect(screen.getByRole('link', { name: /add user/i })).toBeInTheDocument();
    const members = state.data.members.filter((m) => m.organizationId === SAMPLE_ORGANIZATION_ID);
    expect(kpi('Total Users')).toHaveTextContent(String(members.length));
    expect(kpi('Active Users')).toHaveTextContent(String(members.filter((m) => m.status === 'active').length));
    expect(kpi('Inactive Users')).toHaveTextContent(String(members.filter((m) => m.status === 'inactive').length));
    expect(kpi('Portrait Enrolled')).toHaveTextContent(String(members.filter((m) => m.faceEnrollment.status === 'enrolled').length));

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toEqual(['', 'SN', 'Name', 'Identifier', 'Email', 'User Status', 'Portrait Enrollment', 'Actions']);
    expect(screen.queryByText(/ID Switch|canonical/i, { selector: 'main *' })).toBeNull();
  });

  it('numbers rows across pages and selects the visible page with select-all', async () => {
    const { user } = renderApp('/users');
    const rows = () => screen.getAllByRole('row').slice(1);
    expect(within(rows()[0]).getAllByRole('cell')[1]).toHaveTextContent('1');
    const selectAll = screen.getByRole('checkbox', { name: 'Select all users on this page' });
    await user.click(selectAll);
    expect(rows().every((r) => (within(r).getByRole('checkbox') as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(`${rows().length} selected`)).toBeInTheDocument();

    await user.click(within(rows()[0]).getByRole('checkbox'));
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);
    await user.click(selectAll);
    expect(rows().every((r) => (within(r).getByRole('checkbox') as HTMLInputElement).checked)).toBe(true);

    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(within(rows()[0]).getAllByRole('cell')[1]).toHaveTextContent('16');
    expect(rows().some((r) => (within(r).getByRole('checkbox') as HTMLInputElement).checked)).toBe(false);
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('deactivates and reactivates after confirmation, updating KPIs, the menu and persisted data', async () => {
    const { user, state } = renderApp('/users');
    const m = state.data.members.find((x) => x.organizationId === SAMPLE_ORGANIZATION_ID && x.status === 'active')!;
    const credsBefore = JSON.stringify(state.data.credentials.filter((c) => c.memberId === m.id));
    const active = Number(kpi('Active Users').textContent);
    const inactive = Number(kpi('Inactive Users').textContent);
    await search(user, m.displayName);

    await user.click(within(rowOf(m.displayName)).getByRole('button', { name: `Actions for ${m.displayName}` }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toContain('View Details');
    await user.click(within(menu).getByRole('menuitem', { name: 'Deactivate User' }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate user?' });
    expect(dialog).toHaveTextContent(`Are you sure you want to deactivate ${m.displayName}?`);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(org().memberById.get(m.id)!.status).toBe('active');

    await user.click(within(rowOf(m.displayName)).getByRole('button', { name: `Actions for ${m.displayName}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Deactivate User' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate User' }));
    expect(await screen.findByText(`${m.displayName} deactivated`)).toBeInTheDocument();
    expect(within(rowOf(m.displayName)).getByText('Inactive')).toBeInTheDocument();
    expect(kpi('Active Users')).toHaveTextContent(String(active - 1));
    expect(kpi('Inactive Users')).toHaveTextContent(String(inactive + 1));
    expect(org().memberById.get(m.id)!.status).toBe('inactive');
    expect(JSON.stringify(org().credentials.filter((c) => c.memberId === m.id))).toBe(credsBefore);

    await user.click(within(rowOf(m.displayName)).getByRole('button', { name: `Actions for ${m.displayName}` }));
    expect(screen.queryByRole('menuitem', { name: /enrollment link/i })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Activate User' }));
    expect(screen.getByRole('dialog', { name: 'Activate user?' })).toHaveTextContent(`Are you sure you want to activate ${m.displayName}?`);
    await user.click(screen.getByRole('button', { name: 'Activate User' }));
    expect(await screen.findByText(`${m.displayName} activated`)).toBeInTheDocument();
    expect(kpi('Active Users')).toHaveTextContent(String(active));
    expect(org().memberById.get(m.id)!.status).toBe('active');
  });

  it('sends an enrollment link, marks it Pending, and controls resends', async () => {
    const { user, state } = renderApp('/users');
    const m = state.data.members.find((x) => x.organizationId === SAMPLE_ORGANIZATION_ID && x.status === 'active' && x.faceEnrollment.status === 'not-enrolled')!;
    await search(user, m.displayName);
    expect(within(rowOf(m.displayName)).getByText('Not Enrolled')).toBeInTheDocument();
    await user.click(within(rowOf(m.displayName)).getByRole('button', { name: `Actions for ${m.displayName}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Send Enrollment Link' }));
    const dialog = screen.getByRole('dialog', { name: 'Send enrollment link?' });
    expect(await within(dialog).findByText(`An enrollment link will be sent to ${m.displayName} at ${emailOf(m)} to complete their portrait enrollment.`)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send Link' }));
    expect(await screen.findByText('Enrollment link sent')).toBeInTheDocument();
    expect(screen.getByText(`An enrollment invitation has been sent to ${emailOf(m)}.`)).toBeInTheDocument();
    expect(within(rowOf(m.displayName)).getByText('Pending')).toBeInTheDocument();
    const saved = org().memberById.get(m.id)!.faceEnrollment;
    expect(saved).toMatchObject({ status: 'pending', invitation: { sendCount: 1, simulated: true } });
    expect(saved.invitation!.sentTo).not.toBe(emailOf(m));

    // Resending straight away is held back rather than creating another invitation.
    await user.click(within(rowOf(m.displayName)).getByRole('button', { name: `Actions for ${m.displayName}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Resend Enrollment Link' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('less than a minute ago');
    expect(screen.queryByRole('button', { name: /resend link/i })).toBeNull();
    expect(org().memberById.get(m.id)!.faceEnrollment.invitation!.sendCount).toBe(1);
  });

  it('never offers an enrollment link to enrolled users', async () => {
    const { user, state } = renderApp('/users');
    const m = state.data.members.find((x) => x.organizationId === SAMPLE_ORGANIZATION_ID && x.status === 'active' && x.faceEnrollment.status === 'enrolled')!;
    await search(user, m.displayName);
    await user.click(within(rowOf(m.displayName)).getByRole('button', { name: `Actions for ${m.displayName}` }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['View Details', 'Deactivate User']);
    await user.click(screen.getByRole('menuitem', { name: 'View Details' }));
    expect(await screen.findByRole('heading', { level: 1, name: m.displayName })).toBeInTheDocument();
  });
});

describe('enrollment and lifecycle rules', () => {
  const base = () => {
    const s = sampleState();
    const m = s.data.members.find((x) => x.organizationId === SAMPLE_ORGANIZATION_ID && x.status === 'active' && x.faceEnrollment.status === 'not-enrolled')!;
    return { s, m };
  };
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 9, 12, 0, 0) + ms).toISOString();

  it('keeps one invitation, resends after the cooldown, and refuses missing email', () => {
    const { s, m } = base();
    const input = { organizationId: SAMPLE_ORGANIZATION_ID, memberId: m.id, invitationId: 'inv_1', sentTo: 'a••@x.example', at: at(0) };
    expect(applyEnrollmentInvite(s, { ...input, sentTo: '' })).toMatchObject({ ok: false });
    const first = applyEnrollmentInvite(s, input);
    if (!first.ok) throw new Error('send failed');
    // Same request again changes nothing.
    const again = applyEnrollmentInvite(first.state, input);
    expect(again.ok && again.state).toBe(first.state);
    expect(applyEnrollmentInvite(first.state, { ...input, invitationId: 'inv_2', at: at(30_000) })).toMatchObject({ ok: false });
    const resent = applyEnrollmentInvite(first.state, { ...input, invitationId: 'inv_3', at: at(90_000) });
    if (!resent.ok) throw new Error('resend failed');
    const inv = resent.state.data.members.find((x) => x.id === m.id)!.faceEnrollment.invitation!;
    expect(inv).toMatchObject({ id: 'inv_3', sendCount: 2, firstSentAt: at(0), sentAt: at(90_000) });
  });

  it('blocks invitations for enrolled or inactive users and leaves credentials alone on deactivation', () => {
    const { s, m } = base();
    expect(enrollmentInviteEligibility({ ...m, faceEnrollment: { status: 'enrolled' } })).toMatchObject({ ok: false });
    const r = applyMemberStatus(s, { organizationId: SAMPLE_ORGANIZATION_ID, memberId: m.id, status: 'inactive', at: at(0) });
    if (!r.ok) throw new Error('deactivate failed');
    expect(r.state.data.credentials).toBe(s.data.credentials);
    expect(enrollmentInviteEligibility(r.state.data.members.find((x) => x.id === m.id)!)).toMatchObject({ ok: false });
    expect(r.state.data.audit[0]).toMatchObject({ action: 'user.deactivated', resourceId: m.id });
  });
});

describe('User details', () => {
  const withManyCredentials = (s: AppState) => {
    const counts = new Map<string, number>();
    for (const c of s.data.credentials) counts.set(c.memberId, (counts.get(c.memberId) ?? 0) + 1);
    return s.data.members.find((m) => m.organizationId === SAMPLE_ORGANIZATION_ID && (counts.get(m.id) ?? 0) > 1)!;
  };

  it('shows the profile header and Profile Details without technical identity data', async () => {
    const state = sampleState();
    const m = state.data.members.find((x) => x.organizationId === SAMPLE_ORGANIZATION_ID && x.status === 'active')!;
    renderApp(`/users/${m.id}`, state);
    const profile = screen.getByRole('region', { name: 'User profile' });
    expect(within(profile).getByRole('heading', { level: 1, name: m.displayName })).toBeInTheDocument();
    expect(within(profile).getByText('Active')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Profile Details', expect.stringMatching(/^Credentials/), 'Recent Verifications']);
    expect(await screen.findByText(emailOf(m))).toBeInTheDocument();
    expect(screen.getByText('Record Information')).toBeInTheDocument();
    expect(screen.getByText('Tobyson TE')).toBeInTheDocument();
    expect(screen.getByRole('main').textContent).not.toMatch(/ID Switch|canonical|simulat|IDS-/i);
  });

  it('lists every issued credential, opens the shared details page, and keeps Issue Credential in the tab', async () => {
    const state = sampleState();
    const m = withManyCredentials(state);
    const creds = state.data.credentials.filter((c) => c.memberId === m.id);
    const { user } = renderApp(`/users/${m.id}?tab=credentials`, state);
    const panel = screen.getByRole('tabpanel', { name: 'Credentials' });
    expect(within(panel).getAllByRole('row')).toHaveLength(creds.length + 1);
    expect(within(panel).getAllByRole('columnheader').map((h) => h.textContent?.trim()))
      .toEqual(['SN', 'Credential Name', 'Identifier', 'Date Issued', 'Expiration Date', 'Credential Status', 'Actions']);
    if (m.status === 'active') {
      expect(within(panel).getByRole('link', { name: 'Issue Credential' })).toHaveAttribute('href', `/credentials/issue?recipients=${m.id}&from=user`);
    }
    const links = within(panel).getAllByRole('link', { name: /^View Details/ });
    expect(links).toHaveLength(creds.length);
    await user.click(links[0]);
    const preview = await screen.findByRole('region', { name: 'Digital ID preview' });
    expect(preview).toHaveTextContent(m.displayName);
    expect(screen.getByRole('link', { name: `Back to ${m.displayName}` })).toHaveAttribute('href', `/users/${m.id}?tab=credentials`);
  });

  it("shows only this user's verifications, newest first, and an empty state otherwise", async () => {
    const state = sampleState();
    const m = state.data.members.find((x) => x.organizationId === SAMPLE_ORGANIZATION_ID && state.data.transactions.filter((t) => t.memberId === x.id).length > 1)!;
    const tx = state.data.transactions.filter((t) => t.memberId === m.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    renderApp(`/users/${m.id}?tab=verifications`, state);
    const panel = screen.getByRole('tabpanel', { name: 'Recent Verifications' });
    const links = within(panel).getAllByRole('link', { name: /^View verification/ });
    expect(links.length).toBe(Math.min(25, tx.length));
    expect(links[0]).toHaveAttribute('href', `/verification-history/${tx[0].id}`);
    expect(links.every((l) => tx.some((t) => l.getAttribute('href') === `/verification-history/${t.id}`))).toBe(true);
  });

  it('shows empty states for a new user', async () => {
    const state = createInitialState(new Date());
    state.data.members.push({
      id: 'm_new', organizationId: NEW_ORGANIZATION_ID, idSwitchId: 'IDS-NONE', displayName: 'Ada Obi', relationship: '', unit: '',
      status: 'active', resolution: 'created-new', faceEnrollment: { status: 'not-enrolled' }, factors: { fingerprint: false }, joinedAt: new Date().toISOString(),
    });
    const { user } = renderApp('/users/m_new', state);
    await waitFor(() => expect(screen.getByRole('main').querySelector('.animate-pulse')).toBeNull());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: /Credentials/ }));
    expect(screen.getByText('No credentials issued yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Issue Credential' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Recent Verifications' }));
    expect(screen.getByText('No verification activity yet')).toBeInTheDocument();
    expect(screen.getByText('Verification activity for this user will appear here.')).toBeInTheDocument();
  });
});

describe('first-time dashboard', () => {
  it('mutes the setup button without restriction text, and Verification stays reachable', async () => {
    const state = createInitialState(new Date());
    const { user } = renderApp('/', state);
    expect(await screen.findByRole('button', { name: 'Set up verification' })).toBeDisabled();
    expect(screen.queryByText(/Available after your first digital ID/)).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: 'Verification Activities' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Verification Activities' })).toBeInTheDocument();
  });
});
