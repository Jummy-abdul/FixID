import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY } from '@/auth/authCore';
import { ORG_A } from '@/data/demoPersonas';
import { CARD_BASE_PX, ID1_MM, PRINT_SCALE, PX_PER_MM, RENDERED_SHORT_MM, isPrintable, pdfFileName, printProblem } from '@/components/credentials/print/printing';
import { membershipsOfGroup } from '@/domain/groups';
import type { Credential } from '@/domain/types';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

const saveCardsPdf = vi.fn(async () => undefined);
vi.mock('@/components/credentials/print/pdf', () => ({ saveCardsPdf: (...a: unknown[]) => saveCardsPdf(...(a as [])) }));

const ESTHER = 'acct_demo_a_admin';
const AUDITOR = `${ORG_A}_usr_2`;

/** Jsdom never loads images, so photos would stay "loading"; treat every image as loaded. */
beforeAll(() => {
  Object.defineProperty(window.Image.prototype, 'src', {
    configurable: true,
    set(this: HTMLImageElement) { setTimeout(() => this.onload?.(new Event('load')), 0); },
  });
});
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); saveCardsPdf.mockClear(); });

function renderAs(path: string, accountId: string, state: AppState = createInitialState(new Date())) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
const credsOf = (s: AppState) => s.data.credentials.filter((c) => c.organizationId === ORG_A);
const snapshot = (s: AppState) => JSON.stringify(s.data.credentials);
const printPages = () => [...document.querySelectorAll<HTMLElement>('.fixid-print-root [data-print-page]')];

describe('print size and eligibility', () => {
  it('prints the card renderer at ID-1 size without changing its proportions', () => {
    expect(ID1_MM).toEqual({ long: 85.6, short: 53.98 });
    // The renderer's long edge becomes exactly 85.60 mm; the short edge keeps the design's own ratio.
    expect((CARD_BASE_PX.long * PRINT_SCALE) / PX_PER_MM).toBeCloseTo(85.6, 6);
    expect((CARD_BASE_PX.short * PRINT_SCALE) / PX_PER_MM).toBeCloseTo(RENDERED_SHORT_MM, 6);
    expect(RENDERED_SHORT_MM).toBeCloseTo(53.88, 2);
    expect(ID1_MM.short - RENDERED_SHORT_MM).toBeLessThan(0.11);
  });

  it('prints only active, current credentials', () => {
    const base: Pick<Credential, 'status' | 'expiresAt' | 'effectiveFrom'> = { status: 'active', expiresAt: '2999-01-01T00:00:00Z', effectiveFrom: '2020-01-01T00:00:00Z' };
    expect(isPrintable(base)).toBe(true);
    expect(isPrintable({ ...base, expiresAt: null })).toBe(true);
    expect(printProblem({ ...base, status: 'suspended' })).toBe('Credential suspended');
    expect(printProblem({ ...base, status: 'revoked' })).toBe('Credential revoked');
    expect(printProblem({ ...base, status: 'pending' })).toBe('Credential not yet active');
    expect(printProblem({ ...base, status: 'expired' })).toBe('Credential expired');
    expect(printProblem({ ...base, expiresAt: '2001-01-01T00:00:00Z' })).toBe('Credential expired');
    expect(printProblem({ ...base, effectiveFrom: '2999-01-01T00:00:00Z' })).toBe('Credential not yet active');
    expect(pdfFileName(['Aisha Chukwu', 'Member ID'])).toBe('aisha-chukwu-member-id.pdf');
  });
});

describe('printing from a user’s credentials', () => {
  it('prints one issued credential through the shared preview, without changing or duplicating it', async () => {
    const s = createInitialState(new Date());
    const credential = credsOf(s).find((c) => isPrintable(c))!;
    const before = snapshot(s);
    const user = renderAs(`/users/${credential.memberId}?tab=credentials`, ESTHER, s);
    const printButtons = await screen.findAllByRole('button', { name: /^Print / });
    const holderCreds = credsOf(s).filter((c) => c.memberId === credential.memberId);
    expect(printButtons).toHaveLength(holderCreds.filter((c) => isPrintable(c)).length);
    await user.click(screen.getByRole('button', { name: new RegExp(`^Print .*${credential.identifier}`) }));

    const dialog = screen.getByRole('dialog', { name: 'Print credential' });
    expect(dialog).toHaveTextContent('1 card · 2 pages at ID-1 card size (85.60 × 53.98 mm).');
    const cards = within(within(dialog).getByRole('list', { name: 'Cards to print' })).getAllByRole('img', { name: /, (front|back)$/ });
    expect(cards).toHaveLength(2);
    // The print-ready pages: front and back, at print scale, for this credential only.
    expect(printPages().map((p) => p.dataset.orientation)).toHaveLength(2);
    expect(printPages()[0]).toHaveTextContent(credential.identifier);

    // Front only halves the pages.
    await user.selectOptions(within(dialog).getByLabelText('Sides'), 'front');
    expect(dialog).toHaveTextContent('1 card · 1 page');
    expect(printPages()).toHaveLength(1);

    // Print opens the browser's print dialog with only the cards shown, then restores the page.
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.body).toHaveClass('fixid-printing');
      expect(document.head.querySelector('style')?.textContent).toMatch(/@page \{ size: (85\.6mm 53\.98mm|53\.98mm 85\.6mm); margin: 0; \}/);
    });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Print' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.body).not.toHaveClass('fixid-printing'));
    print.mockRestore();

    // Printing again is a reprint of the same record: no new credential, no status change.
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog', { name: 'Print credential' })).toBeNull();
    expect(printPages()).toHaveLength(0);
    const stored = loadState();
    expect(stored ? snapshot(stored) : before).toBe(before);
  });

  it('offers no print action for credentials that aren’t active, or to people who can’t issue credentials', async () => {
    const s = createInitialState(new Date());
    const inactive = credsOf(s).find((c) => c.status === 'suspended' || c.status === 'revoked')!;
    const onlyInactive = credsOf(s).filter((c) => c.memberId === inactive.memberId).every((c) => !isPrintable(c));
    renderAs(`/users/${inactive.memberId}?tab=credentials`, ESTHER, s);
    await screen.findByRole('heading', { name: 'Credentials' });
    if (onlyInactive) expect(screen.queryByRole('button', { name: /^Print / })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`^Print .*${inactive.identifier}`) })).toBeNull();
  });

  it('read-only roles can view credentials but not print them', async () => {
    const s = createInitialState(new Date());
    const credential = credsOf(s).find((c) => isPrintable(c))!;
    renderAs(`/credentials/${credential.id}`, AUDITOR, s);
    expect(await screen.findByRole('region', { name: 'Digital ID preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print credential' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
  });
});

describe('credential details', () => {
  it('Download PDF opens the same preview and saves ID-1 pages from the print-ready cards', async () => {
    const s = createInitialState(new Date());
    const credential = credsOf(s).find((c) => isPrintable(c))!;
    const member = s.data.members.find((m) => m.id === credential.memberId)!;
    const user = renderAs(`/credentials/${credential.id}`, ESTHER, s);
    await user.click(await screen.findByRole('button', { name: 'Download PDF' }));
    expect(screen.getByRole('dialog', { name: 'Print credential' })).toBeInTheDocument();
    await waitFor(() => expect(saveCardsPdf).toHaveBeenCalledTimes(1));
    const [pages, fileName] = saveCardsPdf.mock.calls[0] as unknown as [{ element: HTMLElement; orientation: string }[], string];
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.element.textContent?.includes(credential.identifier) || p.element.querySelector('[role="img"]'))).toBe(true);
    expect(fileName).toMatch(new RegExp(`^${member.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-.+\\.pdf$`));
    // Print credential is offered alongside it; the details page itself is unchanged.
    expect(screen.getByRole('button', { name: 'Print credential' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View User Profile/ })).toBeInTheDocument();
  });
});

describe('bulk printing from a group', () => {
  it('prints the selected members’ active credentials and lists anyone left out', async () => {
    let s = createInitialState(new Date());
    const group = s.data.groups.find((g) => g.organizationId === ORG_A && membershipsOfGroup(s.data, ORG_A, g.id).length >= 3)!;
    const memberIds = membershipsOfGroup(s.data, ORG_A, group.id).map((m) => m.memberId);
    // One member has no active credential: their credentials are suspended for this test.
    const without = memberIds.map((id) => s.data.members.find((m) => m.id === id)!).sort((a, b) => a.displayName.localeCompare(b.displayName))[0].id;
    s = { ...s, data: { ...s.data, credentials: s.data.credentials.map((c) => (c.memberId === without ? { ...c, status: 'suspended' as const } : c)) } };
    const before = snapshot(s);
    const expected = credsOf(s).filter((c) => memberIds.includes(c.memberId) && isPrintable(c));
    const withCards = new Set(expected.map((c) => c.memberId));
    const user = renderAs(`/groups/${group.id}`, ESTHER, s);
    await user.click(await screen.findByRole('checkbox', { name: 'Select all members on this page' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    // Selection covers the visible page (members sorted by name).
    const n = Number(/(\d+) selected/.exec(toolbar.textContent ?? '')![1]);
    const shown = memberIds.map((id) => s.data.members.find((m) => m.id === id)!).sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, n).map((m) => m.id);
    expect(shown).toContain(without);
    expect(toolbar).toHaveTextContent(`${shown.filter((id) => withCards.has(id)).length} of ${n} with an active credential`);
    // Existing group management stays available alongside.
    expect(within(toolbar).getByRole('button', { name: 'Remove from group' })).toBeInTheDocument();
    await user.click(within(toolbar).getByRole('button', { name: 'Print credentials' }));

    const dialog = screen.getByRole('dialog', { name: 'Print credentials' });
    const onPage = expected.filter((c) => shown.includes(c.memberId));
    expect(dialog).toHaveTextContent(`${onPage.length} cards · ${onPage.length * 2} pages`);
    const holderName = s.data.members.find((m) => m.id === without)!.displayName;
    expect(within(dialog).getByRole('list', { name: 'Not included' })).toHaveTextContent(`${holderName}: No active credential`);
    expect(printPages()).toHaveLength(onPage.length * 2);
    // Every print page is one of the selected, eligible credentials.
    expect(printPages().every((p) => onPage.some((c) => p.textContent?.includes(c.identifier) || !p.textContent))).toBe(true);
    // A card can be left out of this batch.
    const first = within(dialog).getAllByRole('checkbox', { name: /^Include / })[0];
    await user.click(first);
    expect(dialog).toHaveTextContent(`${onPage.length - 1} cards`);
    expect(printPages()).toHaveLength((onPage.length - 1) * 2);
    // Back returns to the group with the selection kept.
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toHaveTextContent(`${n} selected`);
    const stored = loadState();
    expect(stored ? snapshot(stored) : before).toBe(before);
  });

  it('doesn’t offer printing to people who can’t issue credentials', async () => {
    const s = createInitialState(new Date());
    const group = s.data.groups.find((g) => g.organizationId === ORG_A && membershipsOfGroup(s.data, ORG_A, g.id).length > 0)!;
    renderAs(`/groups/${group.id}`, AUDITOR, s);
    await screen.findByRole('heading', { name: 'Members' });
    expect(screen.queryByRole('checkbox', { name: 'Select all members on this page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print credentials' })).toBeNull();
  });
});
