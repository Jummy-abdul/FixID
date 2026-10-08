import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import { NEW_ORGANIZATION_ID } from '@/data/seed';
import { ID_SWITCH_STORAGE_KEY } from '@/services/mockIdSwitch';
import { selectOrgData } from '@/store/AppStore';
import { applyIdentifierConfig } from '@/store/operations';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

function renderApp(path: string, state: AppState = createInitialState(new Date())) {
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}

const YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric' }).format(new Date());
const org = () => selectOrgData(loadState()!, NEW_ORGANIZATION_ID);
const title = () => screen.getAllByRole('heading', { level: 2 })[0];
const button = (name: RegExp | string) => screen.getByRole('button', { name });

async function fill(user: UserEvent, label: RegExp | string, value?: string) {
  const el = screen.getByLabelText(label);
  await user.clear(el);
  if (value) await user.type(el, value);
}

async function fillPerson(user: UserEvent, p: { first: string; last: string; email?: string; phone?: string; id?: string }, idLabel?: RegExp) {
  await fill(user, /first name/i, p.first);
  await fill(user, /last name/i, p.last);
  await fill(user, /email address/i, p.email);
  await fill(user, /phone number/i, p.phone);
  if (idLabel) await fill(user, idLabel, p.id);
}

/** Matric Number with the default generated pattern STU/YYYY/#####. */
async function configureMatricNumber(user: UserEvent) {
  await user.click(button('Matric Number'));
  const drawer = await screen.findByRole('dialog', { name: 'Configure identifier' });
  expect(within(drawer).getByLabelText(/identifier name/i)).toHaveValue('Matric Number');
  expect(within(drawer).getByTestId('identifier-preview')).toHaveTextContent(`STU/${YEAR}/00001`);
  await user.click(within(drawer).getByRole('button', { name: 'Save identifier' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('radio', { name: /Matric Number/ })).toHaveAttribute('aria-checked', 'true');
}

async function createFirstUser(user: UserEvent, person = { first: 'Amara', last: 'Okonkwo', email: 'amara@crestfield.example' }) {
  await configureMatricNumber(user);
  await user.click(button(/^continue/i));
  expect(title()).toHaveTextContent('User information');
  await fillPerson(user, person);
  await user.click(button('Create user'));
  expect(await screen.findByRole('heading', { name: 'User added successfully' }, { timeout: 3000 })).toBeInTheDocument();
}

async function configureAndIssueStudentId(user: UserEvent) {
  await user.click(button('Issue digital ID'));
  expect(title()).toHaveTextContent('Issue a digital ID');
  await user.click(button('Configure credential'));
  const drawer = await screen.findByRole('dialog', { name: 'Configure credential' });
  expect(within(drawer).getByLabelText(/credential name/i)).toHaveValue('Student ID');
  expect(within(drawer).getByRole('radio', { name: /Matric Number/ })).toHaveAttribute('aria-checked', 'true');
  await user.click(within(drawer).getByRole('button', { name: 'Save credential' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('radio', { name: /Student ID/ })).toHaveAttribute('aria-checked', 'true');
  await user.click(button(/^review/i));
  expect(title()).toHaveTextContent('Review and issue');
  await user.click(button(/issue digital id/i));
  expect(await screen.findByRole('heading', { name: 'Digital ID issued successfully' }, { timeout: 3000 })).toBeInTheDocument();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Add users entry', () => {
  it('offers manual, select existing (planned) and bulk upload (planned)', async () => {
    const { user } = renderApp('/');
    await user.click(screen.getByRole('link', { name: /get started/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add users' })).toBeInTheDocument();
    expect(screen.getByText("Choose how you'd like to add people to your organization.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add manually/i })).toHaveAttribute('href', '/users/new/manual');
    expect(screen.getByText('Select existing')).toBeInTheDocument();
    expect(screen.getByText('Bulk upload')).toBeInTheDocument();
    expect(screen.getAllByText('Planned')).toHaveLength(2);
  });
});

describe('manual user creation', () => {
  it('Scenarios 1, 2, 5, 12: configure Matric Number, create the user, configure Student ID and issue', async () => {
    const { user } = renderApp('/users/new/manual');
    expect(title()).toHaveTextContent('Select identifier');
    await createFirstUser(user);
    expect(screen.getByText(`STU/${YEAR}/00001`)).toBeInTheDocument();
    expect(org().members).toHaveLength(1);
    expect(org().credentials).toHaveLength(0);

    await configureAndIssueStudentId(user);
    await waitFor(() => expect(screen.getByText('Available to the holder.')).toBeInTheDocument());
    const o = org();
    expect(o.credentials).toHaveLength(1);
    expect(o.credentials[0].identifier).toBe(`STU/${YEAR}/00001`);
    expect(o.members).toHaveLength(1);

    await user.click(screen.getByRole('link', { name: /return to dashboard/i }));
    expect(await screen.findByText('1 of 2 complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up verification' })).toHaveAttribute('href', '/activities');
  });

  it('Scenarios 4, 12: skipping issuance keeps the user and shows partial progress', async () => {
    const { user } = renderApp('/users/new/manual');
    await createFirstUser(user);
    await user.click(button("I'll do this later"));
    expect(screen.getByText("You can issue a digital ID for this user whenever you're ready.")).toBeInTheDocument();
    expect(org().members[0].status).toBe('active');
    expect(org().credentials).toHaveLength(0);

    await user.click(screen.getByRole('link', { name: /return to dashboard/i }));
    expect(await screen.findByText('0 of 2 complete')).toBeInTheDocument();
    expect(screen.getByText('First user added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up verification' })).toBeDisabled();
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(within(overview).getByText('Users').nextSibling).toHaveTextContent('1');
    expect(within(overview).getByText('Active credentials').nextSibling).toHaveTextContent('0');
    expect(screen.getByRole('link', { name: /issue digital id/i })).toHaveAttribute('href', `/users/${org().members[0].id}/issue`);
  });

  it('Scenario 3: a manual Staff ID is entered and validated for uniqueness', async () => {
    const { user } = renderApp('/users/new/manual');
    await user.click(button('Staff ID'));
    const drawer = await screen.findByRole('dialog', { name: 'Configure identifier' });
    await user.click(within(drawer).getByRole('radio', { name: /enter manually/i }));
    expect(within(drawer).queryByTestId('identifier-preview')).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: 'Save identifier' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(button(/^continue/i));

    await user.click(button('Create user'));
    expect(screen.getByText('Enter their first name.')).toBeInTheDocument();
    expect(screen.getByText('Enter their Staff ID.')).toBeInTheDocument();

    await fillPerson(user, { first: 'Kunle', last: 'Adebayo', email: 'kunle@crestfield.example', id: 'SF-0042' }, /^staff id/i);
    await user.click(button('Create user'));
    expect(await screen.findByRole('heading', { name: 'User added successfully' })).toBeInTheDocument();
    expect(org().members[0].identifier?.value).toBe('SF-0042');

    await user.click(button("I'll do this later"));
    await user.click(button(/add another user/i));
    await user.click(button(/^continue/i));
    await fillPerson(user, { first: 'Bisi', last: 'Lawal', phone: '0803 555 0199', id: 'sf-0042' }, /^staff id/i);
    await user.click(button('Create user'));
    expect(screen.getByText('sf-0042 is already assigned to another user.')).toBeInTheDocument();
    expect(org().members).toHaveLength(1);
  });

  it('Scenario 2: builds a custom pattern with static text, date, separators and a sequence', async () => {
    const { user } = renderApp('/users/new/manual');
    await user.click(button('Other'));
    const drawer = await screen.findByRole('dialog', { name: 'Configure identifier' });
    await user.type(within(drawer).getByLabelText(/identifier name/i), 'Employee Code');
    // Remove the suggested segments, then build EMP-YY-0001.
    while (within(drawer).queryAllByRole('button', { name: /^Remove/ }).length) {
      await user.click(within(drawer).getAllByRole('button', { name: /^Remove/ })[0]);
    }
    await user.click(within(drawer).getByRole('button', { name: 'Save identifier' }));
    expect(await within(drawer).findByText('Add at least one segment.')).toBeInTheDocument();
    for (const name of ['Static text', 'Separator', 'Date', 'Separator', 'Sequential number']) {
      await user.click(within(drawer).getByRole('button', { name }));
    }
    const text = within(drawer).getByPlaceholderText('e.g. STU');
    await user.clear(text);
    await user.type(text, 'emp');
    const [dateFormat, digits] = within(drawer).getAllByRole('combobox');
    await user.selectOptions(dateFormat, 'YY');
    await user.selectOptions(digits, '4');
    const yy = YEAR.slice(2);
    expect(within(drawer).getByTestId('identifier-preview')).toHaveTextContent(`EMP-${yy}-00001`.replace('-00001', '-0001'));
    await user.click(within(drawer).getByRole('button', { name: /Move Sequential number up/ }));
    expect(within(drawer).getByTestId('identifier-preview')).toHaveTextContent(`EMP-${yy}0001-`);
    await user.click(within(drawer).getByRole('button', { name: /Move Sequential number down/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Save identifier' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(button(/^continue/i));
    await fillPerson(user, { first: 'Efe', last: 'Mensah', email: 'efe@crestfield.example' });
    await user.click(button('Create user'));
    expect(await screen.findByRole('heading', { name: 'User added successfully' })).toBeInTheDocument();
    expect(org().members[0].identifier?.value).toBe(`EMP-${yy}-0001`);
  });

  it('Scenarios 7, 8: a second user reuses both configurations', async () => {
    const { user } = renderApp('/users/new/manual');
    await createFirstUser(user);
    await configureAndIssueStudentId(user);
    await user.click(button(/add another user/i));

    expect(title()).toHaveTextContent('Select identifier');
    expect(screen.getByRole('radio', { name: /Matric Number/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(button(/^continue/i));
    await fillPerson(user, { first: 'Tunde', last: 'Bello', phone: '0803 555 0101' });
    await user.click(button('Create user'));
    await screen.findByRole('heading', { name: 'User added successfully' });
    expect(screen.getByText(`STU/${YEAR}/00002`)).toBeInTheDocument();

    await user.click(button('Issue digital ID'));
    expect(screen.queryByRole('button', { name: 'Configure credential' })).toBeNull();
    expect(screen.getByRole('radio', { name: /Student ID/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(button(/^review/i));
    await user.click(button(/issue digital id/i));
    await screen.findByRole('heading', { name: 'Digital ID issued successfully' });

    const o = org();
    expect(o.identifierConfigs).toHaveLength(1);
    expect(o.credentialTypes).toHaveLength(1);
    expect(o.credentials.map((c) => c.identifier).sort()).toEqual([`STU/${YEAR}/00001`, `STU/${YEAR}/00002`]);
  });

  it('Scenario 6: issues a credential later from the user page, using the same experience', async () => {
    const first = renderApp('/users/new/manual');
    await createFirstUser(first.user);
    await first.user.click(button("I'll do this later"));
    const memberId = org().members[0].id;
    first.unmount();

    const { user } = renderApp(`/users/${memberId}`, loadState()!);
    expect(await screen.findByText('No credentials issued yet')).toBeInTheDocument();
    await user.click(screen.getAllByRole('link', { name: 'Issue credential' })[1]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Issue credential' })).toBeInTheDocument();
    await configureAndIssueStudentIdFromSelect(user);
    await user.click(screen.getByRole('link', { name: 'View user' }));
    expect(await screen.findByRole('region', { name: 'Digital ID preview' })).toHaveTextContent(`STU/${YEAR}/00001`);
  });

  async function configureAndIssueStudentIdFromSelect(user: UserEvent) {
    await user.click(button('Configure credential'));
    const drawer = await screen.findByRole('dialog', { name: 'Configure credential' });
    await user.click(within(drawer).getByRole('button', { name: 'Save credential' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(button(/^review/i));
    await user.click(button(/issue digital id/i));
    await screen.findByRole('heading', { name: 'Digital ID issued successfully' });
  }
});

describe('identity resolution and duplicates', () => {
  it('Scenario 10: links an existing ID Switch identity', async () => {
    const daniel = buildIdSwitchRegistry()[3];
    const { user } = renderApp('/users/new/manual');
    await createFirstUser(user, { first: daniel.givenName, last: daniel.familyName, email: daniel.email });
    expect(screen.getByText('Existing ID Switch identity linked')).toBeInTheDocument();
    expect(org().members[0]).toMatchObject({ idSwitchId: daniel.idSwitchId, resolution: 'linked-existing' });
    expect(JSON.parse(localStorage.getItem(ID_SWITCH_STORAGE_KEY) ?? '{"created":[]}').created).toHaveLength(0);
  });

  it('Scenarios 9, 10: blocks duplicates and unsafe matches, and requires confirmation for name-only matches', async () => {
    const { user } = renderApp('/users/new/manual');
    await createFirstUser(user);
    await user.click(button("I'll do this later"));
    await user.click(button(/add another user/i));
    await user.click(button(/^continue/i));

    await fillPerson(user, { first: 'Amara', last: 'Okonkwo', email: 'amara@crestfield.example' });
    await user.click(button('Create user'));
    expect(await screen.findByText('Amara Okonkwo is already a user in your organization')).toBeInTheDocument();
    expect(button('Create user')).toBeDisabled();

    await fillPerson(user, { first: 'Different', last: 'Person', email: 'amara@crestfield.example' });
    await user.click(button('Create user'));
    expect(await screen.findByText('These details belong to someone else')).toBeInTheDocument();
    expect(button('Create user')).toBeDisabled();

    await fillPerson(user, { first: 'Amara', last: 'Okonkwo', email: 'another.amara@crestfield.example' });
    await user.click(button('Create user'));
    expect(await screen.findByText('Possible matches found')).toBeInTheDocument();
    expect(button('Create user')).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /different person/i }));
    await user.click(button('Create user'));
    expect(await screen.findByRole('heading', { name: 'User added successfully' })).toBeInTheDocument();
    expect(org().members).toHaveLength(2);
  });

  it('an ID Switch outage shows an error and saves nothing', async () => {
    const configured = applyIdentifierConfig(createInitialState(new Date()), {
      organizationId: NEW_ORGANIZATION_ID, at: new Date().toISOString(), id: 'idc_1', name: 'Matric Number', mode: 'manual', segments: [],
    });
    if (!configured.ok) throw new Error('setup failed');
    localStorage.setItem(ID_SWITCH_STORAGE_KEY, JSON.stringify({ created: [], outage: true }));
    const { user } = renderApp('/users/new/manual', configured.state);
    await user.click(button(/^continue/i));
    await fillPerson(user, { first: 'Amara', last: 'Okonkwo', email: 'amara@crestfield.example', id: 'MAT/1' }, /^matric number/i);
    await user.click(button('Create user'));
    expect(await screen.findByText(/couldn't reach ID Switch/)).toBeInTheDocument();
    expect(title()).toHaveTextContent('User information');
    expect(org().members).toHaveLength(0);
  });
});

describe('persistence and cross-module visibility', () => {
  it('Scenario 11: records and configurations survive a refresh and show in every module', async () => {
    const first = renderApp('/users/new/manual');
    await createFirstUser(first.user);
    await configureAndIssueStudentId(first.user);
    first.unmount();

    const { user } = renderApp('/users', loadState()!);
    expect(await screen.findByText(`STU/${YEAR}/00001`)).toBeInTheDocument();
    await user.click(screen.getByText('Amara Okonkwo', { selector: 'span.font-medium' }));
    expect(await screen.findByRole('region', { name: 'Digital ID preview' })).toHaveTextContent(`STU/${YEAR}/00001`);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: 'Credentials' }));
    await user.click(await screen.findByText(`STU/${YEAR}/00001`));
    expect(screen.getByRole('link', { name: 'Amara Okonkwo' })).toBeInTheDocument();

    await user.click(within(nav).getByRole('link', { name: 'Templates' }));
    await user.click(await screen.findByRole('link', { name: 'Identifiers' }));
    expect((await screen.findAllByText('Matric Number')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('link', { name: 'Credential types' }));
    expect(await screen.findByText('Student ID')).toBeInTheDocument();

    await user.click(within(nav).getByRole('link', { name: 'Audit Log' }));
    for (const text of [/Created identifier "Matric Number"/, /Added Amara Okonkwo/, /Created credential "Student ID"/, /Issued Student ID/]) {
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });

  it('keeps an unfinished draft across navigation', async () => {
    const first = renderApp('/users/new/manual');
    await configureMatricNumber(first.user);
    await first.user.click(button(/^continue/i));
    await first.user.type(screen.getByLabelText(/first name/i), 'Amara');
    first.unmount();

    const { user } = renderApp('/users/new', loadState()!);
    await user.click(screen.getByRole('link', { name: /continue where you left off/i }));
    expect(await screen.findByLabelText(/first name/i)).toHaveValue('Amara');
  });
});
