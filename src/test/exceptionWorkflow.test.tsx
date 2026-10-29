import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_SESSION } from '@/auth/authCore';
import { ALL_PERSONAS, ORG_B, ORG_C } from '@/data/demoPersonas';
import { categoryOf, outcomesFor } from '@/domain/exceptions';
import {
  applyApprovalDecision, applyCloseException, applyEvidenceViewed, applyExceptionWorkflow, applyReopenException, applyResolveException, exceptionFor, exceptionsVisibleTo, resolutionProblem,
} from '@/store/exceptionOps';
import { createInitialState, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };
const err = (r: { ok: boolean }) => (r as { error?: string }).error;

function as(accountId: string, orgId: string, s = createInitialState(new Date())): AppState {
  const p = ALL_PERSONAS.find((x) => x.accountId === accountId);
  const admin = p ? { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner' as const, organizationIds: [orgId] } : { ...s.data.admin, id: accountId };
  return { ...s, data: { ...s.data, admin }, session: { ...s.session, currentOrganizationId: orgId } };
}
const jordan = (s?: AppState) => as('acct_demo_c_admin', ORG_C, s);
const tobyson = (s?: AppState) => as('usr_tobyson', ORG_C, s);
const victor = (s?: AppState) => as('acct_demo_b_admin', ORG_B, s);
const sam = (s?: AppState) => as('acct_demo_b_reviewer', ORG_B, s);
const txOf = (s: AppState, id: string) => s.data.verificationAttempts.find((a) => a.id === exceptionFor(s, id)!.transactionId)!;
const audit = (s: AppState, action: string) => s.data.audit.filter((a) => a.action === action);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('approval required (Brightwater)', () => {
  it('a final decision becomes a proposal; the proposer can’t approve it; a different approver makes it final', () => {
    let s = jordan();
    const before = txOf(s, 'EXC-00003');
    s = ok(applyResolveException(s, { organizationId: ORG_C, exceptionId: 'EXC-00003', outcome: 'verification-not-confirmed', reason: 'Face clearly differs from the reference.', at: AT })).state;
    expect(exceptionFor(s, 'EXC-00003')).toMatchObject({ status: 'pending-approval', proposal: { outcome: 'verification-not-confirmed', by: 'Jordan Blake' } });
    expect(exceptionFor(s, 'EXC-00003')!.resolution).toBeUndefined();
    expect(txOf(s, 'EXC-00003').reviewDisposition).toBeUndefined();
    // Separation of duties: no self-approval, and no second proposal while one is waiting.
    expect(err(applyApprovalDecision(s, { organizationId: ORG_C, exceptionId: 'EXC-00003', decision: 'approve', reason: '', at: AT }))).toMatch(/different approver/);
    expect(err(applyResolveException(s, { organizationId: ORG_C, exceptionId: 'EXC-00003', outcome: 'escalated', reason: 'x', at: AT }))).toMatch(/awaiting approval/);
    s = ok(applyApprovalDecision(tobyson(s), { organizationId: ORG_C, exceptionId: 'EXC-00003', decision: 'approve', reason: '', at: AT })).state;
    const e = exceptionFor(s, 'EXC-00003')!;
    expect(e).toMatchObject({ status: 'resolved', resolution: { outcome: 'verification-not-confirmed', disposition: 'deny', by: 'Jordan Blake' }, approval: { by: 'Tobyson TE' } });
    // The original outcome is kept beside the review disposition.
    const tx = txOf(s, 'EXC-00003');
    expect(tx.decision).toBe(before.decision);
    expect(tx.match).toEqual(before.match);
    expect(tx.reviewDisposition).toMatchObject({ decision: 'deny', outcome: 'verification-not-confirmed' });
    expect(audit(s, 'exception.proposal-submitted').length).toBeGreaterThan(audit(createInitialState(new Date()), 'exception.proposal-submitted').length);
    expect(audit(s, 'exception.proposal-approved')[0]).toMatchObject({ actor: 'Tobyson TE', resourceId: 'EXC-00003' });
  });

  it('reject and return need a reason and send the case back to the reviewer, who can resubmit', () => {
    let s = tobyson();
    expect(exceptionFor(s, 'EXC-00006')!.status).toBe('pending-approval');
    expect(err(applyApprovalDecision(s, { organizationId: ORG_C, exceptionId: 'EXC-00006', decision: 'return', reason: ' ', at: AT }))).toMatch(/reviewer should do next/);
    expect(err(applyApprovalDecision(s, { organizationId: ORG_C, exceptionId: 'EXC-00006', decision: 'reject', reason: '', at: AT }))).toMatch(/reason for rejecting/);
    s = ok(applyApprovalDecision(s, { organizationId: ORG_C, exceptionId: 'EXC-00006', decision: 'reject', reason: 'Request another attempt first.', at: AT })).state;
    expect(exceptionFor(s, 'EXC-00006')).toMatchObject({ status: 'returned' });
    expect(exceptionFor(s, 'EXC-00006')!.proposal ?? exceptionFor(s, 'EXC-00006')!.resolution).toBeUndefined();
    // A rejected proposal isn't an identity decision: the transaction is still pending review.
    expect(txOf(s, 'EXC-00006').reviewDisposition).toBeUndefined();
    s = ok(applyResolveException(jordan(s), { organizationId: ORG_C, exceptionId: 'EXC-00006', outcome: 'reverification-required', reason: 'Please come back for a new capture.', at: AT })).state;
    expect(exceptionFor(s, 'EXC-00006')).toMatchObject({ status: 'awaiting-information', reverificationRequested: { by: 'Jordan Blake' } });
    expect(exceptionFor(s, 'EXC-00006')!.history.map((h) => h.action)).toContain('proposal-rejected');
  });

  it('turning approval off is audited and never resolves decisions already awaiting approval', () => {
    let s = jordan();
    s = ok(applyExceptionWorkflow(s, { organizationId: ORG_C, approvalRequired: false, at: AT })).state;
    expect(s.data.organizations.find((o) => o.id === ORG_C)!.exceptionWorkflow).toMatchObject({ approvalRequired: false, updatedBy: 'Jordan Blake' });
    expect(exceptionFor(s, 'EXC-00006')!.status).toBe('pending-approval');
    const [changed] = audit(s, 'exception.workflow-changed');
    expect(changed.summary).toMatch(/1 decision already awaiting approval still needs an approver/);
    expect(changed.changes).toEqual([{ field: 'Exception decisions', from: 'Approval required', to: 'Approval not required' }]);
    // The waiting proposal still needs a different approver.
    expect(err(applyApprovalDecision(s, { organizationId: ORG_C, exceptionId: 'EXC-00006', decision: 'approve', reason: '', at: AT }))).toMatch(/different approver/);
    // New decisions resolve directly.
    s = ok(applyResolveException(s, { organizationId: ORG_C, exceptionId: 'EXC-00003', outcome: 'verification-not-confirmed', reason: 'Clear mismatch.', at: AT })).state;
    expect(exceptionFor(s, 'EXC-00003')).toMatchObject({ status: 'resolved' });
    expect(exceptionFor(s, 'EXC-00003')!.approval).toBeUndefined();
  });
});

describe('no approval (Meridian) and privileges', () => {
  it('a reviewer with Resolve decides directly; without it, only non-final steps are allowed until approval is turned on', () => {
    const base = createInitialState(new Date());
    expect(ok(applyResolveException(sam(base), { organizationId: ORG_B, exceptionId: 'EXC-00001', outcome: 'verification-not-confirmed', reason: 'Mismatch.', at: AT })).exception.status).toBe('resolved');

    const noResolve: AppState = { ...base, data: { ...base.data, customRoles: base.data.customRoles.map((r) => (r.name === 'Exception Reviewer' ? { ...r, permissions: r.permissions.filter((p) => p !== 'exceptions.resolve') } : r)) } };
    expect(err(applyResolveException(sam(noResolve), { organizationId: ORG_B, exceptionId: 'EXC-00001', outcome: 'verification-not-confirmed', reason: 'Mismatch.', at: AT }))).toMatch(/can’t resolve/);
    const escalated = ok(applyResolveException(sam(noResolve), { organizationId: ORG_B, exceptionId: 'EXC-00001', outcome: 'escalated', reason: 'Needs a second look.', at: AT })).state;
    expect(exceptionFor(escalated, 'EXC-00001')).toMatchObject({ status: 'in-review', escalation: { by: 'Sam Rivera' } });
    expect(exceptionFor(escalated, 'EXC-00001')!.resolution).toBeUndefined();

    // Configuring the workflow needs Configure; the reviewer can't, the administrator can.
    expect(err(applyExceptionWorkflow(sam(noResolve), { organizationId: ORG_B, approvalRequired: true, at: AT }))).toMatch(/can’t configure/);
    let s = ok(applyExceptionWorkflow(victor(noResolve), { organizationId: ORG_B, approvalRequired: true, at: AT })).state;
    s = ok(applyResolveException(sam(s), { organizationId: ORG_B, exceptionId: 'EXC-00001', outcome: 'verification-not-confirmed', reason: 'Mismatch.', at: AT })).state;
    expect(exceptionFor(s, 'EXC-00001')!.status).toBe('pending-approval');
    expect(err(applyApprovalDecision(sam(s), { organizationId: ORG_B, exceptionId: 'EXC-00001', decision: 'approve', reason: '', at: AT }))).toMatch(/can’t approve/);
    s = ok(applyApprovalDecision(victor(s), { organizationId: ORG_B, exceptionId: 'EXC-00001', decision: 'approve', reason: '', at: AT })).state;
    expect(exceptionFor(s, 'EXC-00001')).toMatchObject({ status: 'resolved', approval: { by: 'Victor Hale' } });
  });

  it('organization boundaries: Brightwater can’t see or act on Meridian’s exceptions', () => {
    const s = jordan();
    expect(exceptionsVisibleTo(s, ORG_C).some((e) => e.reviewOrganizationId === ORG_B)).toBe(false);
    expect(applyResolveException(s, { organizationId: ORG_C, exceptionId: 'EXC-00001', outcome: 'escalated', reason: 'x', at: AT }).ok).toBe(false);
    expect(applyApprovalDecision(tobyson(), { organizationId: ORG_C, exceptionId: 'EXC-00001', decision: 'approve', reason: '', at: AT }).ok).toBe(false);
  });
});

describe('reopen, evidence and technical cases', () => {
  it('reopening needs a reason, keeps the earlier resolution and returns the transaction to pending review', () => {
    let s = tobyson();
    expect(exceptionFor(s, 'EXC-00005')!.status).toBe('resolved');
    expect(err(applyReopenException(s, { organizationId: ORG_C, exceptionId: 'EXC-00005', reason: '', at: AT }))).toMatch(/reason for reopening/);
    const resolution = exceptionFor(s, 'EXC-00005')!.resolution;
    s = ok(applyReopenException(s, { organizationId: ORG_C, exceptionId: 'EXC-00005', reason: 'New information from the participant.', at: AT })).state;
    expect(exceptionFor(s, 'EXC-00005')).toMatchObject({ status: 'reopened', previousResolutions: [resolution] });
    expect(exceptionFor(s, 'EXC-00005')!.resolution).toBeUndefined();
    expect(txOf(s, 'EXC-00005').stage).toBe('pending-review');
    expect(txOf(s, 'EXC-00005').reviewDisposition).toBeUndefined();
    expect(audit(s, 'exception.reopened')[0]).toMatchObject({ resourceId: 'EXC-00005' });
    // Open cases can't be reopened or closed.
    expect(applyReopenException(s, { organizationId: ORG_C, exceptionId: 'EXC-00003', reason: 'x', at: AT }).ok).toBe(false);
    expect(applyCloseException(s, { organizationId: ORG_C, exceptionId: 'EXC-00003', at: AT }).ok).toBe(false);
  });

  it('viewing the portrait comparison is recorded once a minute; viewers without Review are refused', () => {
    let s = jordan();
    s = ok(applyEvidenceViewed(s, { organizationId: ORG_C, exceptionId: 'EXC-00003', at: AT })).state;
    s = ok(applyEvidenceViewed(s, { organizationId: ORG_C, exceptionId: 'EXC-00003', at: AT })).state;
    expect(exceptionFor(s, 'EXC-00003')!.history.filter((h) => h.action === 'evidence-viewed')).toHaveLength(1);
    expect(audit(s, 'exception.evidence-viewed')).toHaveLength(1);
    expect(applyEvidenceViewed(as('acct_demo_b1_verifier', 'org_meridian_harbourside', s), { organizationId: 'org_meridian_harbourside', exceptionId: 'EXC-00001', at: AT }).ok).toBe(false);
  });

  it('technical failures can be retried, escalated or left unresolved, but never adjudicate identity; failed matches can’t be confirmed', () => {
    expect(categoryOf('service-failure')).toBe('technical');
    expect(outcomesFor('technical')).not.toContain('verification-confirmed');
    expect(outcomesFor('technical')).not.toContain('verification-not-confirmed');
    const s = jordan();
    const e = exceptionFor(s, 'EXC-00003')!;
    expect(resolutionProblem(s, { ...e, reason: 'service-failure' }, 'verification-confirmed')).toMatch(/technical issue/);
    // A no-match result can't be turned into a confirmation without a successful new attempt.
    expect(err(applyResolveException(s, { organizationId: ORG_C, exceptionId: 'EXC-00003', outcome: 'verification-confirmed', reason: 'Looks fine to me.', at: AT }))).toMatch(/reverification/);
  });
});

function renderApp(path: string, state: AppState, accountId: string) {
  if (accountId !== 'usr_tobyson') localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} {...(accountId === 'usr_tobyson' ? { authSession: DEMO_SESSION } : {})}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('screens', () => {
  it('an approver finds the waiting proposal under Approvals and approves it', async () => {
    const user = renderApp('/exceptions', tobyson(), 'usr_tobyson');
    await user.click(await screen.findByRole('tab', { name: /Approvals/ }));
    const row = (await screen.findByText('EXC-00006')).closest('tr')!;
    expect(within(row).getByText('Pending Approval')).toBeInTheDocument();
    await user.click(within(row).getByRole('link', { name: 'EXC-00006' }));
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Approve/ }));
    expect((await screen.findAllByText('Resolved')).length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText('Resolution')).getByText(/Tobyson TE/)).toBeInTheDocument();
  });

  it('the proposer sees why they can’t approve their own decision', async () => {
    const user = renderApp('/exceptions/EXC-00006', createInitialState(new Date()), 'acct_demo_c_admin');
    expect(await screen.findByText(/a different approver must decide/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    void user;
  });

  it('workflow settings: an administrator turns approval off with a confirmation and a warning about waiting cases', async () => {
    const user = renderApp('/exceptions?view=settings', createInitialState(new Date()), 'acct_demo_c_admin');
    await user.click(await screen.findByRole('radio', { name: /^No/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/1 decision already awaiting approval still needs an approver/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Exception workflow saved')).toBeInTheDocument();
    expect(screen.getByText(/final when an authorised reviewer records them/)).toBeInTheDocument();
  });

  it('a reviewer reveals the simulated portrait comparison on demand', async () => {
    const user = renderApp('/exceptions/EXC-00003', createInitialState(new Date()), 'acct_demo_c_admin');
    await user.click(await screen.findByRole('button', { name: 'Show portrait comparison' }));
    expect(screen.getByRole('region', { name: 'Portrait comparison' })).toBeInTheDocument();
    expect(screen.getAllByText(/SIMULATED/).length).toBeGreaterThan(0);
  });

  it('integrations: the verifier sees “Submitted for review” with the reference; the activity shows its exception count and link', async () => {
    const state = createInitialState(new Date());
    const tx = txOf(state, 'EXC-00006');
    const user = renderApp(`/verify/attempts/${tx.id}`, state, 'acct_demo_c_admin');
    expect(await screen.findByText('Submitted for review.')).toBeInTheDocument();
    expect(screen.getByText('EXC-00006')).toBeInTheDocument();
    expect(screen.getByText(/needs further assessment by an authorised reviewer/)).toBeInTheDocument();
    void user;
  });

  it('activity details link to the activity’s exceptions', async () => {
    const state = createInitialState(new Date());
    const user = renderApp(`/verification-activities/${exceptionFor(state, 'EXC-00006')!.activityId}`, state, 'acct_demo_c_admin');
    expect(await screen.findByText(/open exceptions/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'View exceptions' }));
    expect(await screen.findByRole('heading', { name: 'Exceptions' })).toBeInTheDocument();
    expect(await screen.findByText('EXC-00006')).toBeInTheDocument();
  });
});
