import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEV_VERIFICATION_CODE, loadAuth } from '@/auth/authCore';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

function renderApp(path: string, state?: AppState) {
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state ?? loadState() ?? createInitialState(new Date())}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}

const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name }, { timeout: 3000 });

async function signUpTo(user: UserEvent, stage: 'verify' | 'password' | 'personal', email = 'ada@crestfield.example') {
  await heading('Create your FixID account');
  await user.type(screen.getByLabelText('Email address'), email);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await heading('Check your inbox');
  if (stage === 'verify') return;
  await user.click(screen.getByLabelText('Digit 1'));
  await user.paste(DEV_VERIFICATION_CODE);
  await heading('Secure your account');
  if (stage === 'password') return;
  await user.type(screen.getByLabelText('New password'), 'Crestfield2026!');
  await user.type(screen.getByLabelText('Confirm password'), 'Crestfield2026!');
  await user.click(screen.getByRole('button', { name: 'Create password' }));
  await heading('What should we call you?');
}

async function signIn(user: UserEvent, email: string, password: string) {
  await heading('Welcome back');
  const box = screen.getByLabelText('Email address');
  await user.clear(box);
  await user.type(box, email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('route protection', () => {
  it('sends unauthenticated visitors to Sign in, with links between the auth screens', async () => {
    const { user } = renderApp('/users');
    await heading('Welcome back');
    expect(screen.getByText('Sign in to your FixID account.')).toBeInTheDocument();
    expect(screen.queryByText(/demo@fixid|FixIDDemo/)).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Sign up' }));
    await heading('Create your FixID account');
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await user.click(await screen.findByRole('link', { name: 'Forgot password?' }));
    await heading('Forgot your password?');
    await user.click(screen.getByRole('link', { name: /Back to sign in/ }));
    await heading('Welcome back');
  });
});

describe('sign up and onboarding', () => {
  it('Scenarios 1, 4 and 11: a new administrator signs up and lands on their own first-time dashboard', async () => {
    const before = createInitialState(new Date());
    const sampleMembers = before.data.members.filter((m) => m.organizationId === SAMPLE_ORGANIZATION_ID).length;
    const { user } = renderApp('/signup', before);
    await signUpTo(user, 'verify');
    expect(screen.getByText('ada@crestfield.example')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Digit 1'));
    await user.paste(DEV_VERIFICATION_CODE);
    await heading('Secure your account');

    // Password validation.
    await user.click(screen.getByRole('button', { name: 'Create password' }));
    expect(screen.getByText('Create a password.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('New password'), 'weakpass');
    await user.type(screen.getByLabelText('Confirm password'), 'weakpass');
    await user.click(screen.getByRole('button', { name: 'Create password' }));
    expect(screen.getByText("This password doesn't meet the requirements below.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'Crestfield2026!');
    await user.click(screen.getByRole('button', { name: 'Create password' }));
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Confirm password'), 'Crestfield2026!');
    await user.click(screen.getByRole('button', { name: 'Show new password' }));
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Create password' }));

    // Personal information.
    await heading('What should we call you?');
    expect(screen.getByDisplayValue('ada@crestfield.example')).toHaveAttribute('readonly');
    expect(screen.getByText('Verified')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter your first name.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/first name/i), 'Tobyson');
    await user.type(screen.getByLabelText(/last name/i), 'Emmanuel');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Organization.
    await heading('Tell us about your organization');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(screen.getByText('Enter your organization name.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/organization name/i), 'Brightwater College');
    const country = screen.getByRole('combobox', { name: /country/i });
    expect(country).toHaveValue('Nigeria');
    await user.clear(country);
    await user.type(country, 'Gha');
    await user.click(screen.getByRole('option', { name: 'Ghana' }));
    await user.selectOptions(screen.getByLabelText('State / Region'), 'Greater Accra');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByRole('heading', { name: 'Welcome to FixID, Tobyson.' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu for Tobyson Emmanuel' })).toHaveTextContent('TE');
    expect(screen.queryByLabelText('Dashboard preview')).toBeNull();
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(within(overview).getByText('Users').nextSibling).toHaveTextContent('0');

    const state = loadState()!;
    const org = state.data.organizations.find((o) => o.name === 'Brightwater College')!;
    const account = loadAuth().accounts[0];
    expect(org).toMatchObject({ country: 'Ghana', region: 'Greater Accra', ownerAccountId: account.id, timezone: 'Africa/Accra' });
    expect(account).toMatchObject({ email: 'ada@crestfield.example', firstName: 'Tobyson', lastName: 'Emmanuel', organizationId: org.id, onboarding: 'complete', emailVerified: true });
    expect(JSON.stringify(account)).not.toContain('Crestfield2026!');
    expect(state.session.currentOrganizationId).toBe(org.id);
    expect(state.data.admin).toMatchObject({ id: account.id, name: 'Tobyson Emmanuel', role: 'Owner', organizationIds: [org.id] });
    // The demo organizations are untouched and not visible to this account.
    expect(state.data.members.filter((m) => m.organizationId === SAMPLE_ORGANIZATION_ID)).toHaveLength(sampleMembers);
    expect(state.data.members.filter((m) => m.organizationId === org.id)).toHaveLength(0);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: 'Settings' }));
    expect(await screen.findByText('Configuration for Brightwater College.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Demo data' })).toBeNull();
    await user.click(within(nav).getByRole('link', { name: 'Users' }));
    expect(await screen.findByText('No users yet')).toBeInTheDocument();
  });

  it('Scenario 2: an existing email is sent to Sign in instead of creating a duplicate', async () => {
    const { user } = renderApp('/signup');
    await heading('Create your FixID account');
    await user.type(screen.getByLabelText('Email address'), 'Demo@FixID.app');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('An account already exists with this email. Sign in to continue.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('alert')).getByRole('link', { name: 'Sign in' }));
    await heading('Welcome back');
    expect(screen.getByLabelText('Email address')).toHaveValue('Demo@FixID.app');
    expect(loadAuth().accounts).toHaveLength(0);
  });

  it('Scenario 3: wrong codes are rejected, resend works, and the right code continues', async () => {
    const { user } = renderApp('/signup');
    await signUpTo(user, 'verify');
    await user.click(screen.getByLabelText('Digit 1'));
    await user.keyboard('111111');
    expect(await screen.findByText("That code isn't correct. Please try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(screen.getByText('New code sent')).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 1')).toHaveValue('');
    expect(sessionStorage.getItem('fixid.auth.signup')).not.toContain(DEV_VERIFICATION_CODE);
    await user.click(screen.getByLabelText('Digit 1'));
    await user.keyboard('123456');
    await heading('Secure your account');
  });

  it('Change email returns to sign-up with the address kept', async () => {
    const { user } = renderApp('/signup');
    await signUpTo(user, 'verify', 'first@crestfield.example');
    await user.click(screen.getByRole('link', { name: 'Change email' }));
    await heading('Create your FixID account');
    expect(screen.getByLabelText('Email address')).toHaveValue('first@crestfield.example');
  });

  it('Scenario 6: leaving mid-onboarding and signing in later resumes setup', async () => {
    const first = renderApp('/signup');
    await signUpTo(first.user, 'personal', 'resume@crestfield.example');
    await first.user.type(screen.getByLabelText(/first name/i), 'Ngozi');
    await first.user.type(screen.getByLabelText(/last name/i), 'Eze');
    await first.user.click(screen.getByRole('button', { name: 'Continue' }));
    await heading('Tell us about your organization');
    first.unmount();
    // A new visit without a session.
    const stored = loadAuth();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...stored, session: null }));
    sessionStorage.clear();

    const { user } = renderApp('/');
    await signIn(user, 'resume@crestfield.example', 'Crestfield2026!');
    await heading('Tell us about your organization');
  }, 15_000);
});

describe('sign in, demo account, recovery and sign out', () => {
  it('Scenario 5: rejects wrong credentials without revealing whether the account exists', async () => {
    const { user } = renderApp('/signin');
    await signIn(user, 'nobody@crestfield.example', 'Whatever123');
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Password'));
    await signIn(user, 'demo@fixid.app', 'wrong-password');
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('Scenarios 7 and 9: the demo account opens the existing workspace; signing out protects it again', async () => {
    const seeded = createInitialState(new Date());
    const { user } = renderApp('/signin', seeded);
    await signIn(user, 'demo@fixid.app', 'FixIDDemo2026!');
    expect(await screen.findByRole('heading', { name: 'Welcome to FixID, Tobyson.' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Dashboard preview')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: 'Settings' }));
    await user.click(await screen.findByRole('tab', { name: 'Demo data' }));
    await user.selectOptions(screen.getByLabelText('Demo organization'), SAMPLE_ORGANIZATION_ID);
    await user.click(within(nav).getByRole('link', { name: 'Users' }));
    const sampleMembers = seeded.data.members.filter((m) => m.organizationId === SAMPLE_ORGANIZATION_ID).length;
    expect(await screen.findByText(String(sampleMembers), { selector: '.text-2xl' })).toBeInTheDocument();
    expect(loadState()!.data.members).toHaveLength(seeded.data.members.length);

    await user.click(screen.getByRole('button', { name: /Account menu for Tobyson TE/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await heading('Welcome back');
    expect(loadAuth().session).toBeNull();
  });

  it('Scenario 5: a returning administrator goes straight to the dashboard', async () => {
    const first = renderApp('/signup');
    await signUpTo(first.user, 'personal', 'back@crestfield.example');
    await first.user.type(screen.getByLabelText(/first name/i), 'Kemi');
    await first.user.type(screen.getByLabelText(/last name/i), 'Adeyemi');
    await first.user.click(screen.getByRole('button', { name: 'Continue' }));
    await heading('Tell us about your organization');
    await first.user.type(screen.getByLabelText(/organization name/i), 'Harbour Clinic');
    await first.user.click(screen.getByRole('button', { name: 'Create organization' }));
    await screen.findByRole('heading', { name: 'Welcome to FixID, Kemi.' }, { timeout: 3000 });
    await first.user.click(screen.getByRole('button', { name: /Account menu/ }));
    await first.user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await heading('Welcome back');
    first.unmount();

    const { user } = renderApp('/users');
    await signIn(user, 'back@crestfield.example', 'Crestfield2026!');
    expect(await screen.findByRole('heading', { level: 1, name: 'Users' }, { timeout: 3000 })).toBeInTheDocument();
    expect(loadState()!.data.organizations.find((o) => o.id === loadState()!.session.currentOrganizationId)?.name).toBe('Harbour Clinic');
    // Switching back to the demo account restores the demo workspace.
    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await signIn(user, 'demo@fixid.app', 'FixIDDemo2026!');
    await waitFor(() => expect(loadState()!.data.admin.id).toBe('usr_tobyson'), { timeout: 3000 });
    await waitFor(() => expect(loadState()!.session.currentOrganizationId).toBe(NEW_ORGANIZATION_ID));
  }, 20_000);

  it('Scenario 8: forgot password confirms without revealing whether the email is registered', async () => {
    const { user } = renderApp('/signin');
    await user.click(await screen.findByRole('link', { name: 'Forgot password?' }));
    await heading('Forgot your password?');
    await user.click(screen.getByRole('button', { name: /Send reset link/ }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email address'), 'someone@crestfield.example');
    await user.click(screen.getByRole('button', { name: /Send reset link/ }));
    await heading('Check your inbox');
    expect(screen.getByText("If an account exists for this email, you'll receive a password reset link shortly.")).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Back to sign in/ }));
    await heading('Welcome back');
  });
});
