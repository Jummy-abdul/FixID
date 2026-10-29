import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_PASSWORD } from '@/auth/authCore';
import { ALL_PERSONAS, DEMO_PERSONAS, FEATURED_DEMO_ACCOUNTS, personaById } from '@/data/demoPersonas';
import { createInitialState } from '@/store/state';

function renderSignIn() {
  render(
    <MemoryRouter initialEntries={['/signin']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={createInitialState(new Date())}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('sign-in demo accounts dialog', () => {
  it('keeps the sign-in page clean: no account list or shared password until the dialog is opened', async () => {
    renderSignIn();
    await screen.findByRole('heading', { level: 1, name: 'Welcome back' });
    for (const name of ['Sign in', 'View demo accounts']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sign in with SSO/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Demonstration accounts' })).not.toBeInTheDocument();
    expect(screen.queryByText(DEMO_PASSWORD)).not.toBeInTheDocument();
  });

  it('lists every demo account in an accessible dialog that closes with the close button and Escape', async () => {
    const user = renderSignIn();
    const trigger = await screen.findByRole('button', { name: 'View demo accounts' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Demo accounts' });
    expect(within(dialog).getByText(/Prototype only/)).toBeInTheDocument();
    expect(within(dialog).getByText(DEMO_PASSWORD)).toBeInTheDocument();
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(DEMO_PERSONAS.length + 1);
    for (const p of DEMO_PERSONAS) expect(within(dialog).getByRole('button', { name: `Use ${p.persona} account` })).toBeInTheDocument();
    // Focus starts inside the dialog and stays there when tabbing past the end.
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < rows.length + 4; i++) await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Use fills in the form and closes the dialog; signing in still goes through the password check', async () => {
    const user = renderSignIn();
    const verifier = ALL_PERSONAS.find((p) => p.accountId === 'org_lts_usr_4')!;
    await user.click(await screen.findByRole('button', { name: 'View demo accounts' }));
    await user.click(screen.getByRole('button', { name: `Use ${verifier.persona} account` }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveValue(verifier.email);
    // A wrong password is still refused.
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/incorrect|didn’t match|doesn't match|isn’t right/i, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? '{}').session ?? null).toBeNull();
    // With the account's details it signs in normally.
    await user.click(screen.getByRole('button', { name: 'View demo accounts' }));
    await user.click(screen.getByRole('button', { name: `Use ${verifier.persona} account` }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).session.accountId).toBe(verifier.accountId), { timeout: 4000 });
  });

  it('features one administrator and one verifier first, and keeps every other account', async () => {
    const user = renderSignIn();
    await user.click(await screen.findByRole('button', { name: 'View demo accounts' }));
    const dialog = screen.getByRole('dialog', { name: 'Demo accounts' });
    const featured = within(dialog).getByRole('list', { name: 'Start here' });
    const admin = personaById('acct_demo_c_admin')!;
    const verifier = personaById(FEATURED_DEMO_ACCOUNTS[1].accountId)!;
    const rows = within(featured).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Administrator'), expect.stringContaining('Verifier')]);
    expect(rows[0]).toHaveTextContent(`${admin.firstName} ${admin.lastName}`);
    expect(rows[1]).toHaveTextContent(`${verifier.firstName} ${verifier.lastName}`);
    expect(within(featured).getByRole('button', { name: `Use ${admin.persona} account` })).toBeInTheDocument();
    expect(within(featured).getByRole('button', { name: `Use ${verifier.persona} account` })).toBeInTheDocument();
    // Every other account is listed once, grouped: platform administration, administrators, verifiers.
    const others = within(dialog).getByRole('region', { name: 'Demonstration accounts' });
    expect(within(others).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Platform administration', 'Administrators']);
    expect(within(others).getAllByRole('listitem')).toHaveLength(DEMO_PERSONAS.length + 1 - 2);
    expect(within(within(others).getByRole('list', { name: 'Administrators' })).getByText('demo@fixid.app', { exact: false })).toBeInTheDocument();
    // Removed sample-workspace accounts aren't offered.
    for (const email of ['victor.hale@meridian.example', 'lina.ford@harbourside.example', 'esther.lawal@northbridge.example', 'tomi.okon@harbourside.example']) expect(within(dialog).queryByText(email, { exact: false })).toBeNull();
    expect(dialog).not.toHaveTextContent(/multi-workspace|shared activity|sub-organization/i);
  });

  it('the featured administrator opens Brightwater as Organization Admin', async () => {
    const user = renderSignIn();
    await user.click(await screen.findByRole('button', { name: 'View demo accounts' }));
    await user.click(screen.getByRole('button', { name: `Use ${personaById('acct_demo_c_admin')!.persona} account` }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('region', { name: 'Workspace' }, { timeout: 4000 })).toHaveTextContent('Brightwater Collective');
    expect(screen.getByRole('region', { name: 'Workspace' })).toHaveTextContent('Organization Admin');
  });

  it('the featured verifier sees only the activities assigned to them', async () => {
    const user = renderSignIn();
    const verifier = personaById(FEATURED_DEMO_ACCOUNTS[1].accountId)!;
    await user.click(await screen.findByRole('button', { name: 'View demo accounts' }));
    await user.click(screen.getByRole('button', { name: `Use ${verifier.persona} account` }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('region', { name: 'Workspace' }, { timeout: 4000 })).toHaveTextContent('Brightwater Collective');
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'My Verification Activities' }));
    for (const name of ['Visitor Check-in', 'Restricted Lounge Access', 'Badge Collection']) expect(await screen.findByText(name)).toBeInTheDocument();
    for (const name of ['Annual Staff Conference', 'Visitor Identity Check', 'Membership Verification']) expect(screen.queryByText(name)).toBeNull();
  });
});
