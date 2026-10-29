import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY } from '@/auth/authCore';
import { ORG_C } from '@/data/demoPersonas';
import { createInitialState, type AppState } from '@/store/state';

let lastSearch = '';
function Spy() { lastSearch = useLocation().search; return null; }
function renderApp(path: string, state: AppState, accountId: string) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={{ ...state, session: { ...state.session, currentOrganizationId: ORG_C } }}><AppRoutes /><Spy /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); lastSearch = ''; });

describe('clean-sweep regressions', () => {
  it('a handler that clears several URL filters clears all of them (Users → Clear)', async () => {
    const user = renderApp('/users?q=zzzz&status=inactive', createInitialState(new Date()), 'acct_demo_c_admin');
    await user.click(await screen.findByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(lastSearch).toBe(''));
  });

  it('dashboard figures equal the Verification History rows they open', async () => {
    const user = renderApp('/', createInitialState(new Date()), 'acct_demo_c_admin');
    const ops = await screen.findByRole('region', { name: 'Verification operations' });
    const successful = within(ops).getByRole('link', { name: /Successful/ });
    const n = Number(successful.textContent!.match(/\d+/)![0]);
    await user.click(successful);
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(Number(summary.textContent!.match(/Total attempts(\d+)/)![1])).toBe(n);
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(n);
  });

  it('earlier sample records are listed only on request', async () => {
    const user = renderApp('/verification-history?range=all', createInitialState(new Date()), 'acct_demo_c_admin');
    const summary = await screen.findByRole('region', { name: 'Summary' });
    const before = Number(summary.textContent!.match(/Total attempts(\d+)/)![1]);
    await user.click(screen.getByRole('checkbox', { name: /Include earlier sample records/ }));
    await waitFor(() => expect(Number(screen.getByRole('region', { name: 'Summary' }).textContent!.match(/Total attempts(\d+)/)![1])).toBeGreaterThan(before));
  });
});
