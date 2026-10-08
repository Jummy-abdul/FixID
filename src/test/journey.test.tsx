import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import { NEW_ORGANIZATION_ID } from '@/data/seed';
import { ID_SWITCH_STORAGE_KEY } from '@/services/mockIdSwitch';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';
import { selectOrgData } from '@/store/AppStore';

function renderApp(path: string, state: AppState = createInitialState(new Date())) {
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}

const stepTitle = () => screen.getByRole('heading', { level: 2 });
const click = (user: UserEvent, name: RegExp | string) => user.click(screen.getByRole('button', { name }));

async function fillDetails(user: UserEvent, d: { first: string; last: string; email?: string; phone?: string; matric?: string }) {
  const set = async (label: string | RegExp, v?: string) => {
    const el = screen.getByLabelText(label);
    await user.clear(el);
    if (v) await user.type(el, v);
  };
  await set(/first name/i, d.first);
  await set(/last name/i, d.last);
  await set(/email address/i, d.email);
  await set(/phone number/i, d.phone);
  if (d.matric !== undefined) await set(/matric number/i, d.matric);
}

async function continueToIdentity(user: UserEvent) {
  await click(user, /^continue/i);
  await waitFor(() => expect(stepTitle()).toHaveTextContent('Check identity'));
}

async function issueFromIdentity(user: UserEvent) {
  await click(user, /continue to review/i);
  expect(stepTitle()).toHaveTextContent('Review and issue');
  await click(user, /issue digital id/i);
  expect(await screen.findByRole('heading', { name: 'Digital ID issued successfully' }, { timeout: 3000 })).toBeInTheDocument();
}

/** Scenario 1 up to the success screen. */
async function addFirstStudent(user: UserEvent) {
  await user.click(screen.getByRole('radio', { name: 'Student' }));
  await click(user, /^continue/i);
  expect(stepTitle()).toHaveTextContent('What will you issue to students?');
  expect(screen.getByLabelText(/credential name/i)).toHaveValue('Student ID');
  expect(screen.getByLabelText(/identifier name/i)).toHaveValue('Matric number');
  await click(user, /save and continue/i);
  await waitFor(() => expect(stepTitle()).toHaveTextContent('Who is this student?'));
  await fillDetails(user, { first: 'Amara', last: 'Okonkwo', email: 'amara@crestfield.example', matric: 'CFA/2026/0001' });
  await continueToIdentity(user);
  expect(screen.getByText('No existing identity found')).toBeInTheDocument();
  await issueFromIdentity(user);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('first-time user creation and issuance', () => {
  it('Scenario 1 + 6: first-ever user, first credential configuration, issuance and dashboard progress', async () => {
    const { user } = renderApp('/');
    await user.click(screen.getByRole('link', { name: /get started/i }));
    await user.click(await screen.findByRole('link', { name: /add manually/i }));
    await addFirstStudent(user);

    expect(screen.getByText('Amara Okonkwo now has a Student ID.')).toBeInTheDocument();
    expect(screen.getAllByText('CFA/2026/0001').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('Available to the holder.')).toBeInTheDocument());

    await user.click(screen.getByRole('link', { name: /return to dashboard/i }));
    expect(await screen.findByText('1 of 2 complete')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Your first digital ID is live.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up verification' })).toHaveAttribute('href', '/activities');
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(within(overview).getByText('Users').nextSibling).toHaveTextContent('1');
    expect(within(overview).getByText('Active credentials').nextSibling).toHaveTextContent('1');
  });

  it('Scenario 2: a second user reuses the saved configuration without repeating setup', async () => {
    const { user } = renderApp('/users/new/manual');
    await addFirstStudent(user);
    await click(user, /add another user/i);

    expect(screen.getByText('Ready')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Student.*Issues Student ID/ }));
    await click(user, /^continue/i);
    expect(stepTitle()).toHaveTextContent('Who is this student?');
    expect(screen.queryByLabelText(/credential name/i)).toBeNull();

    await fillDetails(user, { first: 'Tunde', last: 'Bello', phone: '0803 555 0101', matric: 'CFA/2026/0002' });
    await continueToIdentity(user);
    await issueFromIdentity(user);

    const state = loadState()!;
    const org = selectOrgData(state, NEW_ORGANIZATION_ID);
    expect(org.credentialTypes).toHaveLength(1);
    expect(org.userTypes).toHaveLength(1);
    expect(org.credentials.map((c) => c.identifier).sort()).toEqual(['CFA/2026/0001', 'CFA/2026/0002']);
  });

  it('Scenario 3: links an existing ID Switch identity instead of creating a new one', async () => {
    const daniel = buildIdSwitchRegistry()[3];
    const { user } = renderApp('/users/new/manual');
    await user.click(screen.getByRole('radio', { name: 'Staff' }));
    await click(user, /^continue/i);
    await click(user, /save and continue/i);
    await waitFor(() => expect(stepTitle()).toHaveTextContent('Who is this staff?'));
    await fillDetails(user, { first: daniel.givenName, last: daniel.familyName, email: daniel.email });
    await continueToIdentity(user);
    expect(screen.getByText('Existing identity found')).toBeInTheDocument();
    expect(screen.getByText(daniel.idSwitchId)).toBeInTheDocument();
    await issueFromIdentity(user);
    expect(screen.getAllByText('CFA-STF-000001').length).toBeGreaterThan(0);

    const org = selectOrgData(loadState()!, NEW_ORGANIZATION_ID);
    expect(org.members[0]).toMatchObject({ idSwitchId: daniel.idSwitchId, resolution: 'linked-existing' });
    const created = JSON.parse(localStorage.getItem(ID_SWITCH_STORAGE_KEY) ?? '{"created":[]}').created;
    expect(created).toHaveLength(0);
  });

  it('Scenario 4: prevents duplicate relationships, identifiers and unsafe merges', async () => {
    const { user } = renderApp('/users/new/manual');
    await addFirstStudent(user);
    await click(user, /add another user/i);
    await user.click(screen.getByRole('radio', { name: /Student.*Issues Student ID/ }));
    await click(user, /^continue/i);

    // Duplicate identifier (case-insensitive)
    await fillDetails(user, { first: 'Tunde', last: 'Bello', phone: '0803 555 0101', matric: 'cfa/2026/0001' });
    await click(user, /^continue/i);
    expect(screen.getByText('cfa/2026/0001 is already assigned to someone else.')).toBeInTheDocument();

    // Same person again: already holds a Student ID
    await fillDetails(user, { first: 'Amara', last: 'Okonkwo', email: 'amara@crestfield.example', matric: 'CFA/2026/0005' });
    await continueToIdentity(user);
    expect(screen.getByText('Amara Okonkwo already has a Student ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue to review/i })).toBeDisabled();

    // Someone else's email: conflict, never merged
    await click(user, /^back$/i);
    await fillDetails(user, { first: 'Different', last: 'Person', email: 'amara@crestfield.example', matric: 'CFA/2026/0005' });
    await continueToIdentity(user);
    expect(screen.getByText('These details belong to someone else')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue to review/i })).toBeDisabled();

    // Name-only match needs explicit confirmation
    await click(user, /edit details/i);
    await fillDetails(user, { first: 'Amara', last: 'Okonkwo', email: 'another.amara@crestfield.example', matric: 'CFA/2026/0005' });
    await continueToIdentity(user);
    expect(screen.getByText('Possible matches found')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: /continue to review/i });
    expect(next).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /different person/i }));
    expect(next).toBeEnabled();
  });

  it('Scenario 5: invalid details and an ID Switch outage prevent issuance', async () => {
    const { user } = renderApp('/users/new/manual');
    await user.click(screen.getByRole('radio', { name: 'Student' }));
    await click(user, /^continue/i);
    await user.clear(screen.getByLabelText(/credential name/i));
    await click(user, /save and continue/i);
    expect(await screen.findByText(/Enter a name for this credential/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/credential name/i), 'Student ID');
    await click(user, /save and continue/i);
    await waitFor(() => expect(stepTitle()).toHaveTextContent('Who is this student?'));

    await click(user, /^continue/i);
    expect(screen.getByText('Enter their first name.')).toBeInTheDocument();
    expect(screen.getByText('Add an email address or phone number.')).toBeInTheDocument();
    expect(screen.getByText('Enter their matric number.')).toBeInTheDocument();
    await fillDetails(user, { first: 'Amara', last: 'Okonkwo', email: 'not-an-email', matric: 'CFA/1' });
    await click(user, /^continue/i);
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    expect(stepTitle()).toHaveTextContent('Who is this student?');
    const org = selectOrgData(loadState()!, NEW_ORGANIZATION_ID);
    expect(org.members).toHaveLength(0);
    expect(org.credentials).toHaveLength(0);
  });

  it('Scenario 5b: ID Switch outage shows an error and nothing is issued', async () => {
    localStorage.setItem(ID_SWITCH_STORAGE_KEY, JSON.stringify({ created: [], outage: true }));
    const { user } = renderApp('/users/new/manual');
    await user.click(screen.getByRole('radio', { name: 'Student' }));
    await click(user, /^continue/i);
    await click(user, /save and continue/i);
    await waitFor(() => expect(stepTitle()).toHaveTextContent('Who is this student?'));
    await fillDetails(user, { first: 'Amara', last: 'Okonkwo', email: 'amara@crestfield.example', matric: 'CFA/2026/0001' });
    await click(user, /^continue/i);
    expect(await screen.findByText("We couldn't reach ID Switch")).toBeInTheDocument();
    expect(stepTitle()).toHaveTextContent('Who is this student?');
    const org = selectOrgData(loadState()!, NEW_ORGANIZATION_ID);
    expect(org.members).toHaveLength(0);
    expect(org.credentials).toHaveLength(0);
  });

  it('Scenario 7: records are visible across modules after a refresh', async () => {
    const first = renderApp('/users/new/manual');
    await addFirstStudent(first.user);
    first.unmount();

    // A "refresh": reload persisted state into a fresh app.
    const persisted = loadState()!;
    const { user } = renderApp('/users', persisted);
    await user.click(await screen.findByText('Amara Okonkwo', { selector: 'span.font-medium' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Amara Okonkwo/ })).toBeInTheDocument();
    expect(screen.getByText('User type')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Digital ID preview' })).toHaveTextContent('CFA/2026/0001');
    await waitFor(() => expect(screen.getByText('Legal name')).toBeInTheDocument());

    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Credentials' }));
    await user.click(await screen.findByText('CFA/2026/0001'));
    expect(await screen.findByRole('heading', { level: 1, name: 'CFA/2026/0001' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Amara Okonkwo' })).toBeInTheDocument();

    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Templates' }));
    await user.click(await screen.findByRole('link', { name: 'Credential types' }));
    expect(await screen.findByText('Student ID')).toBeInTheDocument();

    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Audit Log' }));
    expect(await screen.findByText('Issued Student ID CFA/2026/0001 to Amara Okonkwo')).toBeInTheDocument();
    expect(screen.getByText(/Added Amara Okonkwo as Student with new ID Switch identity/)).toBeInTheDocument();
  });

  it('keeps the draft when navigating away and back', async () => {
    const first = renderApp('/users/new/manual');
    await first.user.click(screen.getByRole('radio', { name: 'Student' }));
    await click(first.user, /^continue/i);
    await click(first.user, /save and continue/i);
    await waitFor(() => expect(stepTitle()).toHaveTextContent('Who is this student?'));
    await first.user.type(screen.getByLabelText(/first name/i), 'Amara');
    first.unmount();

    const { user } = renderApp('/users/new', loadState()!);
    await user.click(screen.getByRole('link', { name: /continue where you left off/i }));
    expect(await screen.findByLabelText(/first name/i)).toHaveValue('Amara');
  });
});
