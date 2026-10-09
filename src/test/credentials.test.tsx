import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { NEW_ORGANIZATION_ID } from '@/data/seed';
import type { IdentifierSegment } from '@/domain/types';
import { selectOrgData } from '@/store/AppStore';
import { applyCreateUser, applyCredentialConfig, applyIdentifierConfig, applyIssuance, prepareCreateUser } from '@/store/operations';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

const ORG = NEW_ORGANIZATION_ID;
const AT = new Date().toISOString();
const YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric' }).format(new Date());
const PATTERN: IdentifierSegment[] = [
  { id: 's1', kind: 'static', value: 'STU' }, { id: 's2', kind: 'separator', value: '/' }, { id: 's3', kind: 'date', format: 'YYYY' },
  { id: 's4', kind: 'separator', value: '/' }, { id: 's5', kind: 'sequence', start: 1, digits: 5, zeroPad: true },
];

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { errors: unknown }).errors));
  return r as Extract<T, { ok: true }>;
}

/** A new organization with Matric Number and two users (no credentials). */
function baseState(): AppState {
  let s = ok(applyIdentifierConfig(createInitialState(new Date()), { organizationId: ORG, at: AT, id: 'idc_1', name: 'Matric Number', mode: 'generated', segments: PATTERN })).state;
  for (const [i, [given, family]] of [['Amara', 'Okonkwo'], ['Tunde', 'Bello']].entries()) {
    const p = prepareCreateUser(s, {
      requestId: `req_${i}`, organizationId: ORG, at: AT, identifierConfigId: 'idc_1', person: { givenName: given, familyName: family },
      identity: { idSwitchId: `IDS-T-${i}`, resolution: 'created-new' }, memberId: `mem_${i}`,
    }, () => 0.5);
    if (!p.ok) throw new Error('prepare failed');
    s = ok(applyCreateUser(s, p.prepared)).state;
  }
  return s;
}

function withStudentId(s: AppState, over: Partial<Parameters<typeof applyCredentialConfig>[1]> = {}) {
  return ok(applyCredentialConfig(s, {
    organizationId: ORG, at: AT, id: 'ct_1', name: 'Student ID', identifierConfigId: 'idc_1', templateId: 'classic-portrait',
    effectiveDate: 'on-issue', validity: { kind: 'duration', months: 24 }, renewable: false, ...over,
  })).state;
}

function renderApp(path: string, state: AppState) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const org = () => selectOrgData(loadState()!, ORG);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Credentials landing', () => {
  it('Scenario 1: shows one clean empty state with no tables, tabs or filters', () => {
    renderApp('/credentials', baseState());
    expect(screen.getByRole('heading', { level: 1, name: 'Credentials' }).nextElementSibling).toBeNull();
    expect(screen.getByRole('heading', { name: 'No credentials configured yet' })).toBeInTheDocument();
    expect(screen.getByText('Create a credential to start issuing digital IDs to your users.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Create credential' })).toHaveLength(1);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('main').textContent).not.toMatch(/wallet/i);
  });
});

async function openCreate(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Create credential' }));
  return screen.findByRole('dialog', { name: 'Choose template' });
}

describe('Create credential drawer', () => {
  it('Scenario 2: offers four templates (two landscape, two portrait) with front and back previews', async () => {
    const user = renderApp('/credentials', baseState());
    const gallery = await openCreate(user);
    const tiles = within(gallery).getAllByRole('radio');
    expect(tiles.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Classic Landscape'), expect.stringContaining('Modern Landscape'),
      expect.stringContaining('Classic Portrait'), expect.stringContaining('Modern Portrait'),
    ]);
    expect(tiles.filter((t) => /Landscape(?!.*Portrait)/.test(t.textContent ?? '') && t.textContent?.includes('Landscape')).length).toBeGreaterThanOrEqual(2);
    expect(within(gallery).getAllByText('Portrait', { selector: 'span' })).toHaveLength(2);
    expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
    expect(within(gallery).getAllByRole('img', { name: /, front$/ })).toHaveLength(4);
    await user.click(within(gallery).getByRole('button', { name: 'back' }));
    expect(within(gallery).getAllByRole('img', { name: /, back$/ })).toHaveLength(4);
    await user.click(tiles[3]);
    expect(tiles[3]).toHaveAttribute('aria-checked', 'true');
    expect(org().credentialTypes).toHaveLength(0);
  });

  it('Scenarios 3 and 4: configures Student ID, saves without issuing, and lists it', async () => {
    const user = renderApp('/credentials', baseState());
    const gallery = await openCreate(user);
    await user.click(within(gallery).getByRole('radio', { name: /Modern Portrait/ }));
    await user.click(within(gallery).getByRole('button', { name: /Next: Configure credential/ }));
    const drawer = screen.getByRole('dialog', { name: 'Configure credential' });
    const preview = within(drawer).getByRole('complementary', { name: 'Preview' });
    expect(within(preview).getByRole('img', { name: /Modern Portrait, front/ })).toHaveTextContent('Sample Holder');

    const name = within(drawer).getByLabelText(/credential name/i);
    await user.clear(name);
    await user.type(name, 'Student ID');
    await user.click(within(drawer).getByRole('radio', { name: /Matric Number/ }));
    expect(within(preview).getByRole('img')).toHaveTextContent('Student ID');
    expect(within(preview).getByRole('img')).toHaveTextContent('Matric Number');
    expect(within(preview).getByRole('img')).toHaveTextContent(`STU/${YEAR}/00003`);
    await user.click(within(drawer).getByRole('radio', { name: 'Valid for a specified duration' }));
    await user.clear(within(drawer).getByLabelText('Duration'));
    await user.type(within(drawer).getByLabelText('Duration'), '2');
    await user.click(within(drawer).getByRole('radio', { name: 'No' }));
    await user.click(within(drawer).getByRole('button', { name: 'back' }));
    expect(within(preview).getByRole('img', { name: /back$/ })).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Save credential' }));

    const created = await screen.findByRole('dialog', { name: 'Credential created successfully' });
    await user.click(within(created).getByRole('button', { name: "I'll do this later" }));
    const saved = org().credentialTypes[0];
    expect(saved).toMatchObject({ name: 'Student ID', identifierConfigId: 'idc_1', templateId: 'modern-portrait', validity: { kind: 'duration', months: 24 }, renewal: { allowed: false } });
    expect(org().credentials).toHaveLength(0);

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toEqual(['', 'SN', 'Credential Name', 'Identifier', 'Issued Count', 'Date Created', 'Actions']);
    const row = screen.getByRole('link', { name: 'Student ID' }).closest('tr')!;
    expect(row).toHaveTextContent('Matric Number');
    expect(row).toHaveTextContent('0 issued');
    await user.click(screen.getByRole('checkbox', { name: 'Select all credentials' }));
    expect(within(row).getByRole('checkbox')).toBeChecked();
  });

  it('validates a past expiry date and keeps the draft when creating an identifier', async () => {
    const user = renderApp('/credentials', baseState());
    const gallery = await openCreate(user);
    await user.click(within(gallery).getByRole('button', { name: /Next: Configure credential/ }));
    const drawer = screen.getByRole('dialog', { name: 'Configure credential' });
    await user.clear(within(drawer).getByLabelText(/credential name/i));
    await user.type(within(drawer).getByLabelText(/credential name/i), 'Visitor Pass');
    await user.click(within(drawer).getByRole('button', { name: /New identifier/ }));
    expect(await screen.findByRole('dialog', { name: 'Configure identifier' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to credential' }));
    expect(screen.getByLabelText(/credential name/i)).toHaveValue('Visitor Pass');
    await user.click(screen.getByRole('radio', { name: /Matric Number/ }));
    await user.click(screen.getByRole('radio', { name: 'Specific expiration date' }));
    await user.type(screen.getByLabelText('Expiration date'), '2020-01-01');
    await user.click(screen.getByRole('button', { name: 'Save credential' }));
    expect(await screen.findByText('The expiry date must be in the future.')).toBeInTheDocument();
    expect(org().credentialTypes).toHaveLength(0);
  });
});

describe('Configuration details, issuance and issued details', () => {
  it('Scenario 5: edit reuses the drawer with saved values and leaves issued credentials unchanged', async () => {
    let s = withStudentId(baseState());
    s = ok(applyIssuance(s, { requestId: 'r1', organizationId: ORG, at: AT, memberId: 'mem_0', credentialTypeId: 'ct_1', credentialId: 'cr_1' })).state;
    const before = s.data.credentials.find((c) => c.id === 'cr_1')!;
    const user = renderApp('/credentials', s);
    await user.click(screen.getByRole('button', { name: 'Actions for Student ID' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const drawer = await screen.findByRole('dialog', { name: 'Edit Student ID' });
    expect(within(drawer).getByLabelText(/credential name/i)).toHaveValue('Student ID');
    expect(within(drawer).getByRole('radio', { name: /Matric Number/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(drawer).getByRole('radio', { name: 'Valid for a specified duration' })).toHaveAttribute('aria-checked', 'true');
    expect(within(drawer).getByLabelText('Duration')).toHaveValue(2);
    expect(within(drawer).getByRole('radio', { name: 'No' })).toHaveAttribute('aria-checked', 'true');
    expect(within(drawer).getByText(/The 1 already issued keep their current details/)).toBeInTheDocument();
    expect(within(drawer).getByRole('img', { name: /Classic Portrait/ })).toBeInTheDocument();

    const name = within(drawer).getByLabelText(/credential name/i);
    await user.clear(name);
    await user.type(name, 'Student Card');
    await user.click(within(drawer).getByRole('button', { name: 'Change template' }));
    await user.click(screen.getByRole('radio', { name: /Modern Landscape/ }));
    await user.click(screen.getByRole('button', { name: /Next: Configure credential/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    expect(org().credentialTypes[0]).toMatchObject({ name: 'Student Card', templateId: 'modern-landscape' });
    const after = org().credentialById.get('cr_1')!;
    expect(after).toEqual(before);
    expect(after.snapshot).toEqual({ credentialName: 'Student ID', templateId: 'classic-portrait', identifierLabel: 'Matric Number' });
  });

  it('Scenarios 6–8: configuration tab, Issued To issuance, and the shared issued details page', async () => {
    const user = renderApp('/credentials/configurations/ct_1', withStudentId(baseState()));
    expect(screen.getByRole('heading', { level: 1, name: 'Student ID' })).toBeInTheDocument();
    const config = screen.getByRole('tabpanel', { name: 'Configuration' });
    for (const text of ['Matric Number', 'Effective from issuance date', 'Valid for 2 years', 'Classic Portrait (Portrait)', 'No']) {
      expect(within(config).getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(within(config).getByRole('img', { name: /Classic Portrait, front/ })).toBeInTheDocument();
    await user.click(within(config).getByRole('button', { name: 'back' }));
    expect(within(config).getByRole('img', { name: /Classic Portrait, back/ })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Issued To/ }));
    expect(screen.getByText('No credentials issued yet')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Issue credential' }));
    expect(await screen.findByRole('heading', { name: 'Select recipient' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Tunde Bello/ }));
    await user.click(screen.getByRole('button', { name: /^Review/ }));
    expect(await screen.findByRole('heading', { name: 'Review and issue' })).toBeInTheDocument();
    const issue = screen.getByRole('button', { name: /issue digital id/i });
    await user.click(issue);
    await user.dblClick(issue).catch(() => undefined);
    expect(await screen.findByRole('heading', { name: 'Digital ID issued successfully' }, { timeout: 3000 })).toBeInTheDocument();
    expect(org().credentials).toHaveLength(1);
    const cred = org().credentials[0];
    expect(cred).toMatchObject({ memberId: 'mem_1', credentialTypeId: 'ct_1', identifier: `STU/${YEAR}/00002` });

    await user.click(screen.getByRole('link', { name: 'Back to Student ID' }));
    const row = (await screen.findByRole('link', { name: 'Tunde Bello' })).closest('tr')!;
    expect(row).toHaveTextContent(`STU/${YEAR}/00002`);
    expect(row).toHaveTextContent('Active');
    await user.click(within(row).getByRole('button', { name: /View Details/ }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Student ID' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Digital ID preview' })).toHaveTextContent('Tunde Bello');
    expect(screen.getByRole('img', { name: /Classic Portrait, front/ })).toBeInTheDocument();
    expect(screen.getByText('Credential issued')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View User Profile/ })).toHaveAttribute('href', '/users/mem_1');
    expect(screen.getByRole('link', { name: 'Back to Student ID' })).toHaveAttribute('href', '/credentials/configurations/ct_1?tab=issued');
    expect(screen.getByRole('main').textContent).not.toContain(cred.id);
  });

  it('Scenario 11: configurations, templates and issued credentials persist after refresh', async () => {
    let s = withStudentId(baseState(), { templateId: 'modern-landscape' });
    s = ok(applyIssuance(s, { requestId: 'r1', organizationId: ORG, at: AT, memberId: 'mem_0', credentialTypeId: 'ct_1', credentialId: 'cr_1' })).state;
    renderApp('/credentials', s);
    await waitFor(() => expect(loadState()?.data.credentials.some((c) => c.id === 'cr_1')).toBe(true));
    const reloaded = loadState()!;
    expect(reloaded.data.credentialTypes.find((t) => t.id === 'ct_1')).toMatchObject({ templateId: 'modern-landscape', identifierConfigId: 'idc_1' });
    expect(reloaded.data.credentials.find((c) => c.id === 'cr_1')).toMatchObject({ memberId: 'mem_0', credentialTypeId: 'ct_1' });
  });

  it('Scenario 12: unknown records, required issuance dates and empty recipient lists are handled', async () => {
    const s = withStudentId(baseState(), { validity: { kind: 'set-at-issuance' } });
    const first = renderApp('/credentials/nope', s);
    expect(screen.getByText(/couldn't find|not found/i)).toBeInTheDocument();
    first.keyboard('{Escape}');

    // Expiry chosen at issuance: Issue stays disabled until a valid future date is given.
    expect(applyIssuance(s, { requestId: 'r1', organizationId: ORG, at: AT, memberId: 'mem_0', credentialTypeId: 'ct_1', credentialId: 'cr_x' }))
      .toMatchObject({ ok: false, errors: { form: 'Choose an expiry date before issuing.' } });
  });

  it('Scenario 12: asks for the expiry date before issuing when the rule requires it', async () => {
    const s = withStudentId(baseState(), { validity: { kind: 'set-at-issuance' } });
    const user = renderApp('/credentials/issue?recipients=mem_0&credential=ct_1&step=review&from=user', s);
    expect(await screen.findByRole('heading', { name: 'Review and issue' })).toBeInTheDocument();
    expect(screen.getByText('Choose an expiration date before issuing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /issue digital id/i })).toBeDisabled();
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    await user.type(screen.getByLabelText(/expiration date/i), next.toISOString().slice(0, 10));
    await user.click(screen.getByRole('button', { name: /issue digital id/i }));
    expect(await screen.findByRole('heading', { name: 'Digital ID issued successfully' }, { timeout: 3000 })).toBeInTheDocument();
    expect(org().credentials[0].expiresAt?.slice(0, 10)).toBe(next.toISOString().slice(0, 10));
  });

  it('shows an empty Issued To list when nobody can receive the credential yet', async () => {
    const s = withStudentId(ok(applyIdentifierConfig(createInitialState(new Date()), { organizationId: ORG, at: AT, id: 'idc_1', name: 'Matric Number', mode: 'generated', segments: PATTERN })).state);
    const user = renderApp('/credentials/configurations/ct_1?tab=issued', s);
    expect(screen.getByText('This credential is ready to be issued to users.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Issue credential' }));
    expect(await screen.findByText('No users can receive Student ID yet')).toBeInTheDocument();
  });
});
