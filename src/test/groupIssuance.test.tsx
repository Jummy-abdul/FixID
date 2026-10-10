import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { membershipsOfGroup } from '@/domain/groups';
import type { CredentialType, Member } from '@/domain/types';
import { adminsOf } from '@/store/adminOps';
import { applyGroupIssuance } from '@/store/groupIssuance';
import { applyAddMembers, applyCreateGroup } from '@/store/groupOps';
import { HOLDING, issuanceEligibility } from '@/store/operations';
import { loadState } from '@/store/persistence';
import { authorizeAction, createInitialState, reducer, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const ORG = SAMPLE_ORGANIZATION_ID;
const GROUP = 'grp_test';

/** A group with two eligible members, one who already holds the credential, and one inactive user. */
function fixture() {
  let s = createInitialState(new Date());
  s.session.currentOrganizationId = ORG;
  const type = s.data.credentialTypes.find((t) => t.organizationId === ORG && t.status === 'active' && t.effectiveDate === 'on-issue' && t.validity.kind === 'no-expiry')!;
  const members = s.data.members.filter((m) => m.organizationId === ORG);
  const holds = (m: Member) => s.data.credentials.some((c) => c.memberId === m.id && c.credentialTypeId === type.id && HOLDING.includes(c.status));
  const eligible = members.filter((m) => m.status === 'active' && !holds(m)).slice(0, 2);
  const holder = members.find((m) => m.status === 'active' && holds(m))!;
  const inactive = members.find((m) => m.id !== holder.id && !eligible.includes(m))!;
  s = { ...s, data: { ...s.data, members: s.data.members.map((m) => (m.id === inactive.id ? { ...m, status: 'inactive' as const } : m)) } };
  s = ok(applyCreateGroup(s, { organizationId: ORG, id: GROUP, name: 'Project Alpha', description: '', at: AT })).state;
  s = ok(applyAddMembers(s, { organizationId: ORG, groupId: GROUP, memberIds: [...eligible, holder, inactive].map((m) => m.id), at: AT })).state;
  return { s, type, eligible, holder, inactive };
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error((r as unknown as { error: string }).error);
  return r as Extract<T, { ok: true }>;
}

const run = (s: AppState, type: CredentialType, memberIds: string[], batchId = 'iss_1') =>
  applyGroupIssuance(s, { organizationId: ORG, groupId: GROUP, batchId, credentialTypeId: type.id, memberIds, at: AT });

function renderApp(path: string, state: AppState) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('eligibility', () => {
  it('classifies users by the existing issuance rules', () => {
    const { s, type, eligible, holder, inactive } = fixture();
    expect(issuanceEligibility(s, eligible[0].id, type)).toEqual({ status: 'eligible' });
    expect(issuanceEligibility(s, holder.id, type)).toMatchObject({ status: 'ineligible', reason: expect.stringMatching(/Already holds/) });
    expect(issuanceEligibility(s, inactive.id, type)).toMatchObject({ status: 'ineligible', reason: expect.stringMatching(/inactive/) });
    const pending = { ...s, data: { ...s.data, members: s.data.members.map((m) => (m.id === eligible[0].id ? { ...m, status: 'pending' as const } : m)) } };
    expect(issuanceEligibility(pending, eligible[0].id, type)).toMatchObject({ status: 'attention' });
    // A credential that uses an identifier configuration needs the user to have that identifier.
    const linked = { ...type, identifierConfigId: eligible[0].identifier!.configId };
    expect(issuanceEligibility(s, eligible[0].id, linked)).toEqual({ status: 'eligible' });
    const noId = { ...s, data: { ...s.data, members: s.data.members.map((m) => (m.id === eligible[0].id ? { ...m, identifier: undefined } : m)) } };
    expect(issuanceEligibility(noId, eligible[0].id, linked)).toMatchObject({ status: 'attention', reason: expect.stringMatching(/has no/) });
    const other = s.data.identifierConfigs.find((c) => c.organizationId === ORG && c.id !== linked.identifierConfigId);
    if (other) expect(issuanceEligibility(s, eligible[0].id, { ...type, identifierConfigId: other.id })).toMatchObject({ status: 'ineligible' });
  });
});

describe('group issuance', () => {
  it('issues to eligible members through the ordinary issuance operation and records a partial run', () => {
    const { s, type, eligible, holder, inactive } = fixture();
    const ids = [...eligible, holder, inactive].map((m) => m.id);
    const r = ok(run(s, type, ids));
    expect(r.batch).toMatchObject({ groupId: GROUP, groupName: 'Project Alpha', credentialTypeId: type.id, status: 'partial', initiatedBy: 'Tobyson TE' });
    expect(r.batch.results.filter((x) => x.outcome === 'issued').map((x) => x.memberId).sort()).toEqual(eligible.map((m) => m.id).sort());
    expect(r.batch.results.find((x) => x.memberId === holder.id)).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/Already holds/) });
    expect(r.batch.results.find((x) => x.memberId === inactive.id)).toMatchObject({ outcome: 'skipped' });

    // Credentials are ordinary records owned by each person, tagged with the run.
    const created = r.state.data.credentials.filter((c) => c.issuanceBatchId === 'iss_1');
    expect(created.map((c) => c.memberId).sort()).toEqual(eligible.map((m) => m.id).sort());
    expect(created.every((c) => c.credentialTypeId === type.id && c.organizationId === ORG)).toBe(true);
    expect(r.state.data.audit.filter((e) => e.action === 'credential.issued')).toHaveLength(s.data.audit.filter((e) => e.action === 'credential.issued').length + 2);

    // Nothing else changes: no new users, same membership.
    expect(r.state.data.members).toBe(s.data.members);
    expect(r.state.data.groupMemberships).toBe(s.data.groupMemberships);

    const [completed, started] = r.state.data.audit;
    expect(started).toMatchObject({ action: 'issuance.batch-started', resourceType: 'group', resourceId: GROUP, summary: `Tobyson TE started issuing ${type.name} to 4 members of the Project Alpha group.` });
    expect(completed).toMatchObject({ action: 'issuance.batch-completed', result: 'partial', summary: `${type.name}: 2 credentials issued successfully; 2 recipients skipped.` });

    // Running the same request again changes nothing.
    expect(ok(run(r.state, type, ids)).state).toBe(r.state);
  });

  it('records a run where nobody was eligible as failed, and skips people no longer in the group', () => {
    const { s, type, holder, inactive } = fixture();
    const outsider = s.data.members.find((m) => m.organizationId === ORG && !membershipsOfGroup(s.data, ORG, GROUP).some((x) => x.memberId === m.id))!;
    const r = ok(run(s, type, [holder.id, inactive.id, outsider.id]));
    expect(r.batch.status).toBe('failed');
    expect(r.batch.results.find((x) => x.memberId === outsider.id)).toMatchObject({ outcome: 'skipped', reason: 'No longer a member of this group.' });
    expect(r.state.data.audit[0]).toMatchObject({ result: 'failure' });
    expect(r.state.data.credentials).toBe(s.data.credentials);
  });

  it('needs credentials.issue; managing groups alone is not enough, and Role Preview stays read-only', () => {
    const { s, type, eligible } = fixture();
    const vm = adminsOf(s, ORG).find((a) => a.roleIds.includes('verification-manager'))!;
    const asVm: AppState = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: vm.userId! } } };
    expect(run(asVm, type, [eligible[0].id])).toMatchObject({ ok: false, error: "You don't have permission to issue credentials." });
    const cm = adminsOf(s, ORG).find((a) => a.roleIds.includes('credential-manager') && a.status === 'active')!;
    expect(run({ ...s, data: { ...s.data, admin: { ...s.data.admin, id: cm.userId! } } }, type, [eligible[0].id])).toMatchObject({ ok: true });
    // Switching role views never adds a permission: the Viewer view can't issue.
    const viewer = reducer(s, { type: 'preview/start', roleId: 'viewer' });
    expect(authorizeAction(viewer, 'issuance/group')).toBe("You don't have permission to do this.");
  });
});

describe('Group Details tabs', () => {
  it('opens on Members and issues credentials to the group with eligibility, review and results', async () => {
    const { s, type, eligible, holder } = fixture();
    const user = renderApp(`/groups/${GROUP}`, s);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Members4', 'Credentials0', 'Activity']);
    expect(screen.getByRole('tab', { name: /Members/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 1, name: 'Project Alpha' })).toBeInTheDocument();
    expect(screen.getByText('4 members')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Credentials/ }));
    expect(screen.getByText('No credentials have been issued through this group yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Project Alpha' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Issue Credentials' }));
    const drawer = screen.getByRole('dialog', { name: 'Issue credentials' });
    expect(within(drawer).getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.click(within(drawer).getByRole('radio', { name: new RegExp(type.name) }));
    await user.click(within(drawer).getByRole('button', { name: 'Continue' }));
    expect(within(drawer).getByText('4 recipients selected')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('radio', { name: /Select specific members/ }));
    expect(within(drawer).getByText('0 recipients selected')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('radio', { name: /All current members/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Continue' }));

    const list = within(drawer).getByRole('list', { name: 'Eligibility' });
    expect(within(list).getAllByText('Eligible')).toHaveLength(2);
    expect(within(list).getAllByText('Not eligible')).toHaveLength(2);
    expect(list).toHaveTextContent(`${holder.displayName}Already holds`);
    await user.click(within(drawer).getByRole('button', { name: 'Continue' }));

    expect(drawer).toHaveTextContent('Expected to be issued2');
    expect(drawer).toHaveTextContent('Will be skipped2');
    const issue = within(drawer).getByRole('button', { name: 'Issue 2 credentials' });
    expect(issue).toBeDisabled();
    await user.click(within(drawer).getByRole('checkbox', { name: /I confirm issuing/ }));
    await user.click(issue);

    expect(await within(drawer).findByText(/2 of 4 recipients received/)).toBeInTheDocument();
    expect(within(drawer).getAllByRole('link', { name: /View credential/ })).toHaveLength(2);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    const row = (await screen.findByText(type.name, { selector: 'td span' })).closest('tr')!;
    expect(row).toHaveTextContent('Partially completed');
    expect(row).toHaveTextContent('0 / 2');
    const saved = loadState()!;
    expect(saved.data.credentials.filter((c) => c.issuanceBatchId).map((c) => c.memberId).sort()).toEqual(eligible.map((m) => m.id).sort());

    await user.click(screen.getByRole('tab', { name: /Activity/ }));
    expect(screen.getByText(`${type.name}: 2 credentials issued successfully; 2 recipients skipped.`)).toBeInTheDocument();
    expect(screen.getByText('Tobyson TE added 4 users to the Project Alpha group.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Activity type'), 'membership');
    expect(screen.queryByText(/credentials issued successfully/)).toBeNull();
    expect(screen.getByText('Tobyson TE added 4 users to the Project Alpha group.')).toBeInTheDocument();
  });

  it('opens a run from its link and shows each recipient', async () => {
    const { s, type, eligible } = fixture();
    const r = ok(run(s, type, eligible.map((m) => m.id)));
    renderApp(`/groups/${GROUP}?tab=credentials&batch=iss_1`, r.state);
    const drawer = await screen.findByRole('dialog', { name: `${type.name} issuance` });
    expect(within(drawer).getByText(/All 2 credentials were issued/)).toBeInTheDocument();
    expect(within(drawer).getByRole('list', { name: 'Recipients' })).toHaveTextContent(eligible[0].displayName);
  });

  it('shows only the tabs and actions a role allows', async () => {
    const { s } = fixture();
    const viewer = reducer(s, { type: 'preview/start', roleId: 'viewer' });
    const user = renderApp(`/groups/${GROUP}`, viewer);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Members4', 'Credentials0', 'Activity']);
    expect(screen.queryByRole('button', { name: 'Add Members' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Group' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /Credentials/ }));
    expect(screen.queryByRole('button', { name: 'Issue Credentials' })).toBeNull();
  });

  it('hides Credentials and Activity from a role without those permissions, even by direct link', async () => {
    const { s } = fixture();
    const vm = reducer(s, { type: 'preview/start', roleId: 'verification-manager' });
    renderApp(`/groups/${GROUP}?tab=activity`, vm);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Members4']);
    expect(screen.getByText("You don't have access to that tab, so Members is shown.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/added 4 users/)).toBeNull());
  });

  it('lets a Credential Manager issue but not change membership', async () => {
    const { s } = fixture();
    const cm = reducer(s, { type: 'preview/start', roleId: 'credential-manager' });
    const user = renderApp(`/groups/${GROUP}`, cm);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Members4', 'Credentials0']);
    expect(screen.queryByRole('button', { name: 'Add Members' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /Credentials/ }));
    expect(screen.getByRole('button', { name: 'Issue Credentials' })).toBeInTheDocument();
  });
});
