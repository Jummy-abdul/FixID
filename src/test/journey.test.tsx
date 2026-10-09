import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
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
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
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
  return userCreatedModal();
}

async function userCreatedModal() {
  const modal = await screen.findByRole('dialog', { name: 'User created successfully' }, { timeout: 3000 });
  expect(within(modal).getByText('Would you like to issue a digital ID for this user?')).toBeInTheDocument();
  return modal;
}

async function notNow(user: UserEvent) {
  await user.click(button('Not now'));
  expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
}

async function yesIssueId(user: UserEvent, name = 'Amara Okonkwo') {
  await user.click(button('Yes, issue ID'));
  expect(await screen.findByRole('heading', { level: 1, name: 'Issue credential' })).toBeInTheDocument();
  expect(screen.getByLabelText('Recipient')).toHaveTextContent(`Continuing for ${name}`);
}

/** Add another user through the normal entry point. */
async function startAnotherUser(user: UserEvent) {
  await user.click(screen.getAllByRole('link', { name: /add user/i })[0]);
  await user.click(await screen.findByRole('link', { name: /add manually/i }));
}

/** From Credential Management with a recipient selected: create Student ID, assign now, review, issue. */
async function createStudentIdAndAssign(user: UserEvent) {
  expect(screen.getByRole('heading', { name: 'No credentials configured yet' })).toBeInTheDocument();
  await user.click(button('Create credential'));
  await chooseDefaultTemplate(user);
  const drawer = await screen.findByRole('dialog', { name: 'Configure credential' });
  expect(within(drawer).getByLabelText(/credential name/i)).toHaveValue('Student ID');
  expect(within(drawer).getByRole('radio', { name: /Matric Number/ })).toHaveAttribute('aria-checked', 'true');
  await user.click(within(drawer).getByRole('button', { name: 'Save credential' }));
  const created = await screen.findByRole('dialog', { name: 'Credential created successfully' });
  expect(within(created).getByText('Student ID is ready to be assigned to users.')).toBeInTheDocument();
  expect(org().credentialTypes).toHaveLength(1);
  expect(org().credentials).toHaveLength(0);
  await user.click(within(created).getByRole('button', { name: 'Assign now' }));
  await reviewAndIssue(user);
}

/** Step 1 of the credential drawer: four starter templates, the default preselected. */
async function chooseDefaultTemplate(user: UserEvent) {
  const gallery = await screen.findByRole('dialog', { name: 'Choose template' });
  expect(within(gallery).getAllByRole('radio')).toHaveLength(4);
  expect(within(gallery).getByRole('radio', { name: /Classic Landscape/ })).toHaveAttribute('aria-checked', 'true');
  await user.click(within(gallery).getByRole('button', { name: /Next: Configure credential/ }));
}

/** On a user's page: open the Credentials tab and the shared issued credential details. */
async function previewCredential(user: UserEvent, identifier: string) {
  await user.click(await screen.findByRole('tab', { name: /Credentials/ }));
  await user.click(screen.getByRole('link', { name: new RegExp(`View Details .*${identifier.replace(/\//g, '\\/')}`) }));
  return screen.findByRole('region', { name: 'Digital ID preview' });
}

async function reviewAndIssue(user: UserEvent) {
  expect(await screen.findByRole('heading', { name: 'Review and issue' })).toBeInTheDocument();
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
  it('Scenario A: first user without a credential', async () => {
    const { user } = renderApp('/users/new/manual');
    expect(title()).toHaveTextContent('Select identifier');
    expect(screen.getByRole('navigation', { name: 'Progress' })).toHaveTextContent(/Identifier.*User information.*Create user/);
    await configureMatricNumber(user);
    await user.click(button(/^continue/i));
    expect(screen.queryByLabelText(/upload photo/i)).toBeNull();
    await fillPerson(user, { first: 'Amara', last: 'Okonkwo', email: 'amara@crestfield.example' });
    await user.click(button('Create user'));
    const modal = await userCreatedModal();
    expect(within(modal).getByText('Amara Okonkwo has been added to your organization.')).toBeInTheDocument();
    expect(within(modal).getByText('Matric Number')).toBeInTheDocument();
    expect(within(modal).getByText(`STU/${YEAR}/00001`)).toBeInTheDocument();
    // Saved before the continuation is offered.
    expect(org().members).toHaveLength(1);

    await notNow(user);
    const row = (await screen.findByText(`STU/${YEAR}/00001`)).closest('tr')!;
    expect(row).toHaveTextContent('Amara Okonkwo');
    expect(row).toHaveTextContent('Active');
    expect(row).toHaveTextContent('Not Enrolled');
    expect(await within(row).findByText('amara@crestfield.example')).toBeInTheDocument();
    expect(org().members[0]).toMatchObject({ status: 'active', faceEnrollment: { status: 'not-enrolled' } });
    expect(org().credentials).toHaveLength(0);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByText('0 of 2 complete')).toBeInTheDocument();
    expect(screen.getByText('First user added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up verification' })).toBeDisabled();
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(within(overview).getByText('Users').nextSibling).toHaveTextContent('1');
    expect(within(overview).getByText('Active credentials').nextSibling).toHaveTextContent('0');
    expect(screen.getByRole('link', { name: /issue digital id/i })).toHaveAttribute('href', `/credentials/issue?recipients=${org().members[0].id}&from=user`);
  });

  it('Scenario B: first user and first credential, connected through Credential Management', async () => {
    const { user } = renderApp('/users/new/manual');
    await createFirstUser(user);
    await yesIssueId(user);
    expect(screen.getByLabelText('Recipient')).toHaveTextContent(`STU/${YEAR}/00001`);
    expect(screen.getByText('Select or create a credential to issue to this user.')).toBeInTheDocument();

    await createStudentIdAndAssign(user);
    await waitFor(() => expect(screen.getByText('Available to the holder.')).toBeInTheDocument());
    const o = org();
    expect(o.credentials).toHaveLength(1);
    expect(o.credentials[0]).toMatchObject({ identifier: `STU/${YEAR}/00001`, memberId: o.members[0].id, credentialTypeId: o.credentialTypes[0].id });
    expect(o.members[0].identifier?.value).toBe(`STU/${YEAR}/00001`);

    await user.click(screen.getByRole('link', { name: 'View user' }));
    expect(await previewCredential(user, `STU/${YEAR}/00001`)).toHaveTextContent(`STU/${YEAR}/00001`);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: 'Credentials' }));
    expect(await screen.findByText('1 issued')).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByText('1 of 2 complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up verification' })).toHaveAttribute('href', '/verification-activities');
  });

  it('Scenario C: a subsequent user reuses the identifier and credential configurations', async () => {
    const { user } = renderApp('/users/new/manual');
    await createFirstUser(user);
    await yesIssueId(user);
    await createStudentIdAndAssign(user);
    await user.click(screen.getByRole('link', { name: /add another user/i }));

    expect(title()).toHaveTextContent('Select identifier');
    expect(screen.getByRole('radio', { name: /Matric Number/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(button(/^continue/i));
    await fillPerson(user, { first: 'Tunde', last: 'Bello', email: 'tunde@crestfield.example', phone: '0803 555 0101' });
    await user.click(button('Create user'));
    const modal = await userCreatedModal();
    expect(within(modal).getByText(`STU/${YEAR}/00002`)).toBeInTheDocument();

    await yesIssueId(user, 'Tunde Bello');
    expect(screen.queryByRole('heading', { name: 'No credentials configured yet' })).toBeNull();
    expect(screen.getByRole('radio', { name: /Student ID/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(button(/^continue/i));
    await reviewAndIssue(user);

    const o = org();
    expect(o.identifierConfigs).toHaveLength(1);
    expect(o.credentialTypes).toHaveLength(1);
    expect(o.credentials.map((c) => c.identifier).sort()).toEqual([`STU/${YEAR}/00001`, `STU/${YEAR}/00002`]);
  });

  it('Scenario D: a credential configured without assignment is saved and available later', async () => {
    const first = renderApp('/users/new/manual');
    await createFirstUser(first.user);
    await notNow(first.user);
    first.unmount();

    const { user } = renderApp('/credentials', loadState()!);
    expect(await screen.findByRole('heading', { name: 'No credentials configured yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create credential' }));
    await chooseDefaultTemplate(user);
    const drawer = await screen.findByRole('dialog', { name: 'Configure credential' });
    await user.click(within(drawer).getByRole('button', { name: 'Save credential' }));
    const created = await screen.findByRole('dialog', { name: 'Credential created successfully' });
    await user.click(within(created).getByRole('button', { name: "I'll do this later" }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(org().credentialTypes).toHaveLength(1);
    expect(org().credentials).toHaveLength(0);
    const row = screen.getByRole('link', { name: 'Student ID' }).closest('tr')!;
    expect(row).toHaveTextContent('Matric Number');
    expect(row).toHaveTextContent('0 issued');

    // Available for future assignment: Issued To → Issue credential → choose a user → review → issue.
    await user.click(screen.getByRole('link', { name: 'Student ID' }));
    await user.click(await screen.findByRole('tab', { name: /Issued To/ }));
    expect(screen.getByText('This credential is ready to be issued to users.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Issue credential' }));
    expect(await screen.findByRole('heading', { name: 'Select recipient' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Amara Okonkwo/ }));
    await user.click(button(/^review/i));
    await reviewAndIssue(user);
    expect(org().credentials).toHaveLength(1);
  });

  it('Scenario E: issues a credential to an existing user from their page', async () => {
    const first = renderApp('/users/new/manual');
    await createFirstUser(first.user);
    await yesIssueId(first.user);
    await createStudentIdAndAssign(first.user);
    await first.user.click(screen.getByRole('link', { name: /add another user/i }));
    await first.user.click(button(/^continue/i));
    await fillPerson(first.user, { first: 'Tunde', last: 'Bello', email: 'tunde@crestfield.example', phone: '0803 555 0101' });
    await first.user.click(button('Create user'));
    await userCreatedModal();
    await notNow(first.user);
    const tunde = org().members.find((m) => m.displayName === 'Tunde Bello')!;
    first.unmount();

    const { user } = renderApp(`/users/${tunde.id}`, loadState()!);
    // Issue Credential lives in the Credentials tab, not the page header.
    expect(screen.queryByRole('link', { name: 'Issue Credential' })).toBeNull();
    await user.click(await screen.findByRole('tab', { name: /Credentials/ }));
    expect(screen.getByText('No credentials issued yet')).toBeInTheDocument();
    expect(screen.getByText("You can issue a digital ID to this user whenever you're ready.")).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Issue Credential' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Issue credential' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recipient')).toHaveTextContent('Issuing to Tunde Bello');
    await user.click(button(/^continue/i));
    await reviewAndIssue(user);
    await user.click(screen.getByRole('link', { name: 'View user' }));
    expect(await previewCredential(user, `STU/${YEAR}/00002`)).toHaveTextContent(`STU/${YEAR}/00002`);
    expect(org().credentialTypes).toHaveLength(1);
  });

  it('a manual Staff ID is entered and validated for uniqueness', async () => {
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
    await userCreatedModal();
    expect(org().members[0].identifier?.value).toBe('SF-0042');

    await notNow(user);
    await startAnotherUser(user);
    await user.click(button(/^continue/i));
    await fillPerson(user, { first: 'Bisi', last: 'Lawal', email: 'bisi@crestfield.example', phone: '0803 555 0199', id: 'sf-0042' }, /^staff id/i);
    await user.click(button('Create user'));
    expect(screen.getByText('sf-0042 is already assigned to another user.')).toBeInTheDocument();
    expect(org().members).toHaveLength(1);
  });

  it('builds a custom pattern with static text, date, separators and a sequence', async () => {
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
    expect(within(drawer).getByTestId('identifier-preview')).toHaveTextContent(`EMP-${yy}-0001`);
    await user.click(within(drawer).getByRole('button', { name: /Move Sequential number up/ }));
    expect(within(drawer).getByTestId('identifier-preview')).toHaveTextContent(`EMP-${yy}0001-`);
    await user.click(within(drawer).getByRole('button', { name: /Move Sequential number down/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Save identifier' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(button(/^continue/i));
    await fillPerson(user, { first: 'Efe', last: 'Mensah', email: 'efe@crestfield.example' });
    await user.click(button('Create user'));
    await userCreatedModal();
    expect(org().members[0].identifier?.value).toBe(`EMP-${yy}-0001`);
  });
});

describe('identity resolution and duplicates', () => {
  it('Scenario 10: links an existing ID Switch identity', async () => {
    const daniel = buildIdSwitchRegistry()[3];
    const { user } = renderApp('/users/new/manual');
    await createFirstUser(user, { first: daniel.givenName, last: daniel.familyName, email: daniel.email });
    expect(org().members[0]).toMatchObject({ idSwitchId: daniel.idSwitchId, resolution: 'linked-existing' });
    expect(JSON.parse(localStorage.getItem(ID_SWITCH_STORAGE_KEY) ?? '{"created":[]}').created).toHaveLength(0);
  });

  it('Scenarios 9, 10: blocks duplicates and unsafe matches, and requires confirmation for name-only matches', async () => {
    const { user } = renderApp('/users/new/manual');
    await createFirstUser(user);
    await notNow(user);
    await startAnotherUser(user);
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
    await userCreatedModal();
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
    expect(await screen.findByText(/couldn't check for existing records/)).toBeInTheDocument();
    expect(title()).toHaveTextContent('User information');
    expect(org().members).toHaveLength(0);
  });
});

describe('persistence and cross-module visibility', () => {
  it('Scenario F: users, configurations, issued credentials and metrics stay consistent after refresh', async () => {
    const first = renderApp('/users/new/manual');
    await createFirstUser(first.user);
    await yesIssueId(first.user);
    // Refresh in the middle of the connected journey: the recipient context is kept.
    const memberId = org().members[0].id;
    first.unmount();
    const mid = renderApp(`/credentials/issue?recipients=${memberId}&from=new-user`, loadState()!);
    expect(await screen.findByLabelText('Recipient')).toHaveTextContent('Continuing for Amara Okonkwo');
    await createStudentIdAndAssign(mid.user);
    mid.unmount();

    const { user } = renderApp('/users', loadState()!);
    expect(await screen.findByText(`STU/${YEAR}/00001`)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Amara Okonkwo' }));
    expect(await previewCredential(user, `STU/${YEAR}/00001`)).toHaveTextContent(`STU/${YEAR}/00001`);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: 'Credentials' }));
    expect(await screen.findByText('1 issued')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Student ID' }));
    expect(await screen.findByText('Classic Landscape (Landscape)')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Issued To/ }));
    await user.click(screen.getByRole('button', { name: /View Details for Amara Okonkwo/ }));
    expect(await screen.findByRole('region', { name: 'Digital ID preview' })).toHaveTextContent(`STU/${YEAR}/00001`);
    expect(screen.getByRole('link', { name: 'Back to Student ID' })).toHaveAttribute('href', `/credentials/configurations/${org().credentialTypes[0].id}?tab=issued`);

    await user.click(within(nav).getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByText('1 of 2 complete')).toBeInTheDocument();
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(within(overview).getByText('Active credentials').nextSibling).toHaveTextContent('1');

    await user.click(within(nav).getByRole('link', { name: 'Audit Log' }));
    for (const text of [/Created identifier "Matric Number"/, /Added Amara Okonkwo/, /Created credential "Student ID"/, /Issued Student ID/]) {
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
    const o = org();
    expect([o.members.length, o.credentialTypes.length, o.credentials.length]).toEqual([1, 1, 1]);
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
