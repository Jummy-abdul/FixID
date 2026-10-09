import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { toE164 } from '@/data/countries';
import { ID_SWITCH_STORAGE_KEY } from '@/services/mockIdSwitch';
import { selectOrgData } from '@/store/AppStore';
import { applyIdentifierConfig } from '@/store/operations';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

function renderApp(path: string, state: AppState) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

function withIdentifiers(names: { name: string; mode: 'manual' | 'generated' }[]): AppState {
  let state = createInitialState(new Date());
  names.forEach((n, i) => {
    const r = applyIdentifierConfig(state, {
      organizationId: NEW_ORGANIZATION_ID, at: new Date().toISOString(), id: `idc_${i}`, name: n.name, mode: n.mode,
      segments: n.mode === 'generated' ? [{ id: 's1', kind: 'static', value: 'EMP' }, { id: 's2', kind: 'separator', value: '-' }, { id: 's3', kind: 'sequence', start: 1, digits: 4, zeroPad: true }] : [],
    });
    if (!r.ok) throw new Error('setup failed');
    state = r.state;
  });
  return state;
}

function sampleState(): AppState {
  const state = createInitialState(new Date());
  state.session.currentOrganizationId = SAMPLE_ORGANIZATION_ID;
  return state;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('identifier selection', () => {
  it('shows saved identifiers as cards, hides them from suggestions, and offers + Other only', async () => {
    const user = renderApp('/users/new/manual', withIdentifiers([
      { name: 'Staff ID', mode: 'manual' }, { name: 'Employee Number', mode: 'generated' }, { name: 'Matric Number', mode: 'manual' },
    ]));
    const cards = within(screen.getByRole('radiogroup', { name: 'Your identifiers' })).getAllByRole('radio');
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Staff ID'), expect.stringContaining('Employee Number'), expect.stringContaining('Matric Number'),
    ]);
    expect(cards[0]).toHaveTextContent('Manual');
    expect(cards[0]).toHaveTextContent('Entered for each user.');
    expect(cards[1]).toHaveTextContent('Generated');
    expect(cards[1]).toHaveTextContent('Next likely value: EMP-0001');
    expect(screen.queryByRole('button', { name: /create new identifier/i })).toBeNull();
    for (const configured of ['Staff ID', 'Employee Number', 'Matric Number']) {
      expect(screen.queryByRole('button', { name: configured })).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Membership Number' })).toBeInTheDocument();

    await user.click(cards[1]);
    expect(cards[1]).toHaveAttribute('aria-checked', 'true');
    expect(cards[0]).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByRole('button', { name: 'Other' }));
    const drawer = await screen.findByRole('dialog', { name: 'Configure identifier' });
    expect(within(drawer).getByLabelText(/identifier name/i)).toHaveValue('');
  });
});

describe('Personal Information', () => {
  const state = () => withIdentifiers([{ name: 'Matric Number', mode: 'generated' }]);

  it('requires first name, last name and email; phone, country, region and gender are optional', async () => {
    const user = renderApp('/users/new/manual', state());
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    expect(screen.getByRole('group', { name: 'Personal Information' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main.textContent).not.toMatch(/ID Switch|shared identity|canonical|Add at least an email/i);
    expect(screen.queryByLabelText(/upload photo/i)).toBeNull();
    expect(screen.getByLabelText('Country calling code')).toHaveValue('NG');

    await user.click(screen.getByRole('button', { name: 'Create user' }));
    expect(screen.getByText('Enter their first name.')).toBeInTheDocument();
    expect(screen.getByText('Enter their last name.')).toBeInTheDocument();
    expect(screen.getByText('Enter their email address.')).toBeInTheDocument();
    expect(screen.queryByText(/phone/i, { selector: 'p.text-red-600' })).toBeNull();

    await user.type(screen.getByLabelText(/first name/i), 'Ada');
    await user.type(screen.getByLabelText(/last name/i), 'Obi');
    await user.type(screen.getByLabelText(/email address/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create user' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/email address/i));
    await user.type(screen.getByLabelText(/email address/i), 'ada.obi@crestfield.example');
    await user.click(screen.getByRole('button', { name: 'Create user' }));
    expect(await screen.findByRole('dialog', { name: 'User created successfully' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('stores the phone in international format with the country, region and gender', async () => {
    const user = renderApp('/users/new/manual', state());
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    await user.type(screen.getByLabelText(/first name/i), 'Kofi');
    await user.type(screen.getByLabelText(/last name/i), 'Mensah');
    await user.type(screen.getByLabelText(/email address/i), 'kofi@crestfield.example');
    await user.selectOptions(screen.getByLabelText('Country calling code'), 'GH');
    await user.type(screen.getByLabelText(/phone number/i), '024 123 4567');
    await user.selectOptions(screen.getByLabelText('Country'), 'GH');
    await user.selectOptions(screen.getByLabelText('Region/State'), 'Greater Accra');
    await user.selectOptions(screen.getByLabelText('Gender'), 'Male');
    await user.click(screen.getByRole('button', { name: 'Create user' }));
    await screen.findByRole('dialog', { name: 'User created successfully' }, { timeout: 3000 });
    const created = JSON.parse(localStorage.getItem(ID_SWITCH_STORAGE_KEY)!).created[0];
    expect(created).toMatchObject({ phone: '+233241234567', country: 'Ghana', region: 'Greater Accra', gender: 'Male' });
  });

  it('normalizes phone numbers to E.164', () => {
    expect(toE164('+234', '0803 555 0101')).toBe('+2348035550101');
    expect(toE164('+234', '+234 803 555 0101')).toBe('+2348035550101');
    expect(toE164('+44', '07700 900123')).toBe('+447700900123');
    expect(toE164('+234', '123')).toBeNull();
  });
});

describe('bulk actions', () => {
  const kpi = (label: string) => within(screen.getByRole('region', { name: 'User summary' })).getByText(label).closest('.rounded-xl')!.querySelector('.text-2xl')!;
  const org = () => selectOrgData(loadState()!, SAMPLE_ORGANIZATION_ID);

  it('shows a toolbar with counts for mixed selections and deactivates only eligible users after confirmation', async () => {
    const state = sampleState();
    const inactive = state.data.members.find((m) => m.organizationId === SAMPLE_ORGANIZATION_ID && m.status === 'inactive')!;
    const user = renderApp('/users', state);
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: /search name/i }), 'a');
    await user.click(screen.getByRole('checkbox', { name: 'Select all users on this page' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    const rows = screen.getAllByRole('row').slice(1);
    expect(toolbar).toHaveTextContent(`${rows.length} selected`);

    const activeIds = rows.map((r) => within(r).getAllByRole('link')[0].textContent!)
      .map((name) => state.data.members.find((m) => m.organizationId === SAMPLE_ORGANIZATION_ID && m.displayName === name)!)
      .filter((m) => m.status === 'active').map((m) => m.id);
    const activeBefore = Number(kpi('Active Users').textContent);

    await user.click(within(toolbar).getByRole('button', { name: /^Deactivate Users/ }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate users?' });
    expect(dialog).toHaveTextContent(`${activeIds.length} users will be deactivated.`);
    if (activeIds.length < rows.length) expect(dialog).toHaveTextContent('Skipped');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(org().members.filter((m) => activeIds.includes(m.id)).every((m) => m.status === 'active')).toBe(true);

    await user.click(within(toolbar).getByRole('button', { name: /^Deactivate Users/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate Users' }));
    expect(await screen.findByText(`${activeIds.length} users deactivated`)).toBeInTheDocument();
    expect(kpi('Active Users')).toHaveTextContent(String(activeBefore - activeIds.length));
    expect(org().members.filter((m) => activeIds.includes(m.id)).every((m) => m.status === 'inactive')).toBe(true);
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();
    expect(org().memberById.get(inactive.id)!.status).toBe('inactive');
  });

  it('sends enrollment links to eligible users and skips enrolled ones', async () => {
    const state = sampleState();
    const sample = state.data.members.filter((m) => m.organizationId === SAMPLE_ORGANIZATION_ID).sort((a, b) => a.displayName.localeCompare(b.displayName));
    const firstPage = sample.slice(0, 15);
    const eligible = firstPage.filter((m) => m.status === 'active' && m.faceEnrollment.status !== 'enrolled');
    const enrolled = firstPage.filter((m) => m.faceEnrollment.status === 'enrolled');
    const user = renderApp('/users', state);
    await user.click(screen.getByRole('checkbox', { name: 'Select all users on this page' }));
    await user.click(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: /^Send Enrollment Link/ }));
    const dialog = screen.getByRole('dialog', { name: 'Send enrollment links?' });
    expect(await within(dialog).findByText(`Enrollment links will be sent to ${eligible.length} selected users.`)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(`Already enrolled: ${enrolled.length} user`);
    await user.click(within(dialog).getByRole('button', { name: 'Send Links' }));
    expect(await screen.findByText('Enrollment invitations sent', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(`Enrollment invitations have been sent to ${eligible.length} users.`)).toBeInTheDocument();
    const after = org();
    expect(eligible.every((m) => after.memberById.get(m.id)!.faceEnrollment.status === 'pending')).toBe(true);
    expect(enrolled.every((m) => after.memberById.get(m.id)!.faceEnrollment.status === 'enrolled' && !after.memberById.get(m.id)!.faceEnrollment.invitation)).toBe(true);
  });
});

describe('navigation and content', () => {
  it('has no Templates item or prototype footer, and no technical wording on key pages', async () => {
    const state = sampleState();
    const member = state.data.members.find((m) => m.organizationId === SAMPLE_ORGANIZATION_ID && m.status === 'active')!;
    for (const path of ['/', '/users', `/users/${member.id}`, '/credentials', '/settings?tab=integrations', '/audit', '/profile']) {
      localStorage.clear();
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppProviders initialState={sampleState()} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
        </MemoryRouter>,
      );
      const nav = screen.getByRole('navigation', { name: 'Primary' });
      expect(within(nav).queryByRole('link', { name: 'Templates' })).toBeNull();
      expect(within(nav).getByRole('link', { name: 'Verification Events' })).toBeInTheDocument();
      await waitFor(() => expect(document.querySelector('.animate-pulse')).toBeNull());
      expect(document.body.textContent).not.toMatch(/ID Switch|canonical|simulated|prototype|milestone \d/i);
      unmount();
    }
  });
});
