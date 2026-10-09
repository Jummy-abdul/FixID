import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { findGroup, groupDependencies, groupsForMember, groupsOf, isGroupMember, membershipsOfGroup } from '@/domain/groups';
import { adminsOf } from '@/store/adminOps';
import { applyAddMembers, applyCreateGroup, applyRemoveGroup, applyRemoveMembers, applyUpdateGroup } from '@/store/groupOps';
import { loadState, saveState } from '@/store/persistence';
import { createInitialState, reducer, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const ORG = SAMPLE_ORGANIZATION_ID;

function sampleState(): AppState {
  const s = createInitialState(new Date());
  s.session.currentOrganizationId = ORG;
  return s;
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error((r as unknown as { error: string }).error);
  return r as Extract<T, { ok: true }>;
};

function renderApp(path: string, state: AppState) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const membersOf = (s: AppState, org = ORG) => s.data.members.filter((m) => m.organizationId === org).sort((a, b) => a.displayName.localeCompare(b.displayName));
const asRole = (s: AppState, role: string): AppState => {
  const rec = adminsOf(s, ORG).find((a) => a.roleIds.includes(role) && a.status === 'active')!;
  return { ...s, data: { ...s.data, admin: { ...s.data.admin, id: rec.userId! } } };
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('group rules', () => {
  it('creates a group without members, validating the name', () => {
    const s = sampleState();
    const existing = groupsOf(s.data, ORG)[0];
    const create = (name: string, description = '') => applyCreateGroup(s, { organizationId: ORG, id: 'grp_new', name, description, at: AT });
    expect(create('  ')).toMatchObject({ ok: false, errors: { name: 'Enter a group name.' } });
    expect(create(existing.name.toUpperCase())).toMatchObject({ ok: false, errors: { name: 'A group with this name already exists.' } });
    expect(create('x'.repeat(81))).toMatchObject({ ok: false });
    expect(create('Project Alpha', 'y'.repeat(301))).toMatchObject({ ok: false, errors: { description: expect.stringMatching(/under 300/) } });
    const r = ok(create('  Project Alpha ', 'Cross-team project.'));
    expect(findGroup(r.state.data, ORG, 'grp_new')).toMatchObject({ name: 'Project Alpha', description: 'Cross-team project.', createdBy: 'Tobyson TE' });
    expect(membershipsOfGroup(r.state.data, ORG, 'grp_new')).toHaveLength(0);
    expect(r.state.data.audit[0]).toMatchObject({ action: 'group.created', summary: 'Tobyson TE created the Project Alpha group.', resourceType: 'group', organizationId: ORG, result: 'success' });
    // The same name is fine in another organization.
    expect(applyCreateGroup(s, { organizationId: NEW_ORGANIZATION_ID, id: 'grp_other', name: existing.name, description: '', at: AT })).toMatchObject({ ok: true });
  });

  it('keeps the ID and memberships when a group is renamed', () => {
    const s = sampleState();
    const g = groupsOf(s.data, ORG).find((x) => membershipsOfGroup(s.data, ORG, x.id).length > 0)!;
    const before = membershipsOfGroup(s.data, ORG, g.id);
    const other = groupsOf(s.data, ORG).find((x) => x.id !== g.id)!;
    expect(applyUpdateGroup(s, { organizationId: ORG, groupId: g.id, name: other.name, description: '', at: AT })).toMatchObject({ ok: false });
    expect(ok(applyUpdateGroup(s, { organizationId: ORG, groupId: g.id, name: g.name, description: g.description, at: AT })).state).toBe(s);
    const r = ok(applyUpdateGroup(s, { organizationId: ORG, groupId: g.id, name: 'Engineering', description: 'Renamed.', at: AT }));
    expect(findGroup(r.state.data, ORG, g.id)).toMatchObject({ name: 'Engineering', updatedAt: AT });
    expect(membershipsOfGroup(r.state.data, ORG, g.id)).toEqual(before);
    expect(r.state.data.audit[0]).toMatchObject({ action: 'group.updated', summary: `Tobyson TE renamed the ${g.name} group to Engineering.`, changes: expect.arrayContaining([{ field: 'Name', from: g.name, to: 'Engineering' }]) });
  });

  it('adds existing users only, never duplicating memberships or creating anything else', () => {
    const s = sampleState();
    const g = ok(applyCreateGroup(s, { organizationId: ORG, id: 'grp_a', name: 'Lagos Office', description: '', at: AT })).state;
    const [a, b, c] = membersOf(g);
    const outsider = membersOf(g, 'org_meridian')[0];
    const r = ok(applyAddMembers(g, { organizationId: ORG, groupId: 'grp_a', memberIds: [a.id, b.id, a.id, outsider.id], at: AT }));
    expect(r.added).toBe(2);
    expect(membershipsOfGroup(r.state.data, ORG, 'grp_a').map((m) => m.memberId).sort()).toEqual([a.id, b.id].sort());
    expect(r.state.data.audit[0]).toMatchObject({ action: 'group.members-added', summary: 'Tobyson TE added 2 users to the Lagos Office group.', related: expect.arrayContaining([{ id: a.id, name: a.displayName }]) });
    // Users, credentials and administrators are untouched.
    expect(r.state.data.members).toBe(s.data.members);
    expect(r.state.data.credentials).toBe(s.data.credentials);
    expect(r.state.data.administrators).toBe(s.data.administrators);
    // Already members: refused, nothing recorded.
    expect(applyAddMembers(r.state, { organizationId: ORG, groupId: 'grp_a', memberIds: [a.id, b.id], at: AT })).toMatchObject({ ok: false, error: 'The selected users are already in this group.' });
    const one = ok(applyAddMembers(r.state, { organizationId: ORG, groupId: 'grp_a', memberIds: [b.id, c.id], at: AT }));
    expect(one.added).toBe(1);
    expect(one.state.data.audit[0].summary).toBe(`Tobyson TE added ${c.displayName} to the Lagos Office group.`);
  });

  it('lets a user belong to several groups and answers membership by ID within the organization', () => {
    let s = sampleState();
    const user = membersOf(s)[3];
    for (const [id, name] of [['grp_x', 'Engineering'], ['grp_y', 'Lagos Office'], ['grp_z', 'Project Alpha']]) {
      s = ok(applyCreateGroup(s, { organizationId: ORG, id, name, description: '', at: AT })).state;
      s = ok(applyAddMembers(s, { organizationId: ORG, groupId: id, memberIds: [user.id], at: AT })).state;
    }
    expect(groupsForMember(s.data, ORG, user.id).map((x) => x.group.name)).toEqual(expect.arrayContaining(['Engineering', 'Lagos Office', 'Project Alpha']));
    expect(isGroupMember(s.data, ORG, 'grp_y', user.id)).toBe(true);
    expect(isGroupMember(s.data, 'org_meridian', 'grp_y', user.id)).toBe(false);
    s = ok(applyRemoveMembers(s, { organizationId: ORG, groupId: 'grp_y', memberIds: [user.id], at: AT })).state;
    expect(isGroupMember(s.data, ORG, 'grp_y', user.id)).toBe(false);
    expect(isGroupMember(s.data, ORG, 'grp_x', user.id)).toBe(true);
  });

  it('removes memberships and groups without touching users or credentials', () => {
    const s = sampleState();
    const g = groupsOf(s.data, ORG).find((x) => membershipsOfGroup(s.data, ORG, x.id).length > 2 && groupDependencies(s.data, ORG, x.id).length === 0)!;
    const ids = membershipsOfGroup(s.data, ORG, g.id).map((m) => m.memberId);
    const r = ok(applyRemoveMembers(s, { organizationId: ORG, groupId: g.id, memberIds: ids.slice(0, 2), at: AT }));
    expect(membershipsOfGroup(r.state.data, ORG, g.id)).toHaveLength(ids.length - 2);
    expect(r.state.data.members).toBe(s.data.members);
    expect(r.state.data.audit[0]).toMatchObject({ action: 'group.members-removed', summary: `Tobyson TE removed 2 users from the ${g.name} group.` });

    const gone = ok(applyRemoveGroup(r.state, { organizationId: ORG, groupId: g.id, at: AT }));
    expect(findGroup(gone.state.data, ORG, g.id)).toBeUndefined();
    expect(gone.state.data.groupMemberships.some((m) => m.groupId === g.id)).toBe(false);
    expect(gone.state.data.members).toBe(s.data.members);
    expect(gone.state.data.credentials).toBe(s.data.credentials);
    expect(gone.state.data.audit[0]).toMatchObject({ action: 'group.removed', subject: { id: g.id, name: g.name } });
  });

  it('refuses to remove a group a verification activity depends on', () => {
    const s = sampleState();
    const g = groupsOf(s.data, ORG)[0];
    const activity = s.data.activities.find((a) => a.organizationId === ORG)!;
    const linked: AppState = { ...s, data: { ...s.data, activities: s.data.activities.map((a) => (a.id === activity.id ? { ...a, eligibility: { ...a.eligibility, groupIds: [g.id] } } : a)) } };
    expect(applyRemoveGroup(linked, { organizationId: ORG, groupId: g.id, at: AT })).toMatchObject({ ok: false, error: expect.stringContaining(activity.name) });
  });

  it('needs groups.manage to change anything; other roles can only view', () => {
    const s = sampleState();
    const g = groupsOf(s.data, ORG)[0];
    const user = membersOf(s)[0];
    for (const role of ['credential-manager', 'verification-manager']) {
      const as = asRole(s, role);
      expect(applyCreateGroup(as, { organizationId: ORG, id: 'g', name: 'New', description: '', at: AT })).toMatchObject({ ok: false, error: "You don't have permission to manage groups." });
      expect(applyAddMembers(as, { organizationId: ORG, groupId: g.id, memberIds: [user.id], at: AT })).toMatchObject({ ok: false });
      expect(reducer(as, { type: 'groups/remove', organizationId: ORG, groupId: g.id, at: AT })).toBe(as);
    }
  });

  it('adds sample groups to saved data from before Groups', () => {
    const s = sampleState();
    const { groups: _g, groupMemberships: _m, ...rest } = s.data;
    saveState({ ...s, data: rest as AppState['data'] });
    const loaded = loadState()!;
    expect(groupsOf(loaded.data, ORG).length).toBeGreaterThan(0);
    expect(groupsOf(loaded.data, NEW_ORGANIZATION_ID)).toHaveLength(0);
  });
});

describe('Groups screens', () => {
  it('lists, searches, creates a group, and adds members in bulk', async () => {
    const s = sampleState();
    const user = renderApp('/groups', s);
    expect(screen.getByRole('heading', { level: 1, name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByText('Organize and manage users within your organization.')).toBeInTheDocument();
    const volunteers = await screen.findByRole('link', { name: 'Volunteers' });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Group Name', 'Description', 'Members', 'Date Created', 'Last Updated', 'Actions']);
    expect(volunteers.closest('tr')!).toHaveTextContent(String(membershipsOfGroup(s.data, ORG, `${ORG}_grp_volunteers`).length));
    await user.type(screen.getByRole('searchbox', { name: /search groups/i }), 'cohort is confirmed');
    expect(screen.queryByRole('link', { name: 'Volunteers' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Onboarding Cohort' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create Group' }));
    const dialog = screen.getByRole('dialog', { name: 'Create group' });
    await user.click(within(dialog).getByRole('button', { name: 'Create group' }));
    expect(within(dialog).getByText('Enter a group name.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/group name/i), 'Volunteers');
    await user.click(within(dialog).getByRole('button', { name: 'Create group' }));
    expect(within(dialog).getByText('A group with this name already exists.')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText(/group name/i));
    await user.type(within(dialog).getByLabelText(/group name/i), 'Project Alpha');
    await user.type(within(dialog).getByLabelText(/description/i), 'Cross-team project.');
    await user.click(within(dialog).getByRole('button', { name: 'Create group' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Project Alpha' })).toBeInTheDocument();
    expect(screen.getByText('No members yet')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add Members' })[0]);
    const drawer = screen.getByRole('dialog', { name: 'Add members' });
    const [first, second] = membersOf(s);
    await user.click(within(drawer).getByRole('checkbox', { name: `Select ${first.displayName}` }));
    await user.click(within(drawer).getByRole('checkbox', { name: `Select ${second.displayName}` }));
    expect(within(drawer).getByText('2 selected')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Add 2 users' }));
    expect(await screen.findByText('Members added')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Members/ })).toHaveTextContent('Members2');
    expect(screen.getByText('2 members')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: first.displayName })).toBeInTheDocument();
    // The picker no longer offers people already in the group.
    await user.click(screen.getByRole('button', { name: 'Add Members' }));
    expect(within(screen.getByRole('dialog', { name: 'Add members' })).queryByRole('checkbox', { name: `Select ${first.displayName}` })).toBeNull();
    expect(screen.getByText('2 users are already in this group and not shown.')).toBeInTheDocument();
  });

  it('keeps group pages and user profiles in step', async () => {
    const s = sampleState();
    const g = groupsOf(s.data, ORG).find((x) => x.id === `${ORG}_grp_volunteers`)!;
    const member = s.data.members.find((m) => m.id === membershipsOfGroup(s.data, ORG, g.id)[0].memberId)!;
    const user = renderApp(`/users/${member.id}`, s);
    const card = await screen.findByRole('list', { name: `Groups for ${member.displayName}` });
    expect(within(card).getByRole('link', { name: 'Volunteers' })).toBeInTheDocument();
    const count = groupsForMember(s.data, ORG, member.id).length;
    expect(screen.getByRole('heading', { level: 2, name: /^Groups/ })).toHaveTextContent(`(${count})`);

    // Add from the profile to the empty group.
    await user.click(screen.getByRole('button', { name: 'Add to group' }));
    const modal = screen.getByRole('dialog', { name: 'Add to groups' });
    await user.click(within(modal).getByRole('checkbox', { name: /Onboarding Cohort/ }));
    await user.click(within(modal).getByRole('button', { name: 'Add to groups' }));
    expect(await within(card).findByRole('link', { name: 'Onboarding Cohort' })).toBeInTheDocument();
    expect(isGroupMember(loadState()!.data, ORG, `${ORG}_grp_onboarding`, member.id)).toBe(true);

    // Remove from the profile.
    await user.click(within(card).getByRole('button', { name: 'Remove from Volunteers' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Remove from Volunteers?' })).getByRole('button', { name: 'Remove Member' }));
    await waitFor(() => expect(within(card).queryByRole('link', { name: 'Volunteers' })).toBeNull());
    const saved = loadState()!;
    expect(isGroupMember(saved.data, ORG, g.id, member.id)).toBe(false);
    expect(saved.data.members.find((m) => m.id === member.id)).toBeTruthy();
  });

  it('removes a member from the group page and records it in the Audit Log', async () => {
    const s = sampleState();
    const g = groupsOf(s.data, ORG).find((x) => x.id === `${ORG}_grp_volunteers`)!;
    const before = membershipsOfGroup(s.data, ORG, g.id).length;
    const member = s.data.members.find((m) => m.id === membershipsOfGroup(s.data, ORG, g.id)[0].memberId)!;
    const user = renderApp(`/groups/${g.id}`, s);
    expect(await screen.findByRole('link', { name: member.displayName })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim()).slice(1)).toEqual(['User Name', 'Primary Identifier', 'Email', 'User Status', 'Date Added', 'Actions']);
    await user.click(screen.getByRole('button', { name: `Actions for ${member.displayName}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove Member' }));
    await user.click(within(screen.getByRole('dialog', { name: `Remove ${member.displayName}?` })).getByRole('button', { name: 'Remove Member' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Members/ })).toHaveTextContent(`Members${before - 1}`));
    const saved = loadState()!;
    expect(saved.data.audit[0]).toMatchObject({ action: 'group.members-removed', summary: `Tobyson TE removed ${member.displayName} from the Volunteers group.` });
  });

  it('shows read-only groups to roles without groups.manage, and none to a Verifier', async () => {
    const viewer = reducer(sampleState(), { type: 'preview/start', roleId: 'viewer' });
    renderApp('/groups', viewer);
    expect(await screen.findByRole('link', { name: 'Volunteers' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Group' })).toBeNull();
  });

  it('hides management on a group for a Credential Manager and blocks Verifiers', async () => {
    const cm = reducer(sampleState(), { type: 'preview/start', roleId: 'credential-manager' });
    renderApp(`/groups/${ORG}_grp_volunteers`, cm);
    expect(await screen.findByRole('heading', { level: 1, name: 'Volunteers' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Members' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Group' })).toBeNull();
  });

  it('gives a Verification Manager view-only access', () => {
    const vm = reducer(sampleState(), { type: 'preview/start', roleId: 'verification-manager' });
    renderApp('/groups', vm);
    expect(screen.queryByText("You don't have access to this page")).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Group' })).toBeNull();
  });
});
