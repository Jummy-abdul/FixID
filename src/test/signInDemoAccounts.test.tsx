import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_PASSWORD } from '@/auth/authCore';
import { DEMO_PERSONAS } from '@/data/demoPersonas';
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
    expect(screen.queryByRole('list', { name: 'Demonstration accounts' })).not.toBeInTheDocument();
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
    const verifier = DEMO_PERSONAS.find((p) => p.accountId === 'acct_demo_b1_verifier')!;
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
});
