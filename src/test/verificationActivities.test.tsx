import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { groupDependencies } from '@/domain/groups';
import type { ActivityCheck } from '@/domain/types';
import { authorizeVerifier, eligibleVerifiers, executionPlan, newCheck, rulesSummary, standardRequirementsFor, validateConfiguration } from '@/domain/verification';
import { adminsOf } from '@/store/adminOps';
import {
  activationProblems, applyActivate, applyDeactivate, applyDiscardDraft, applyDuplicate, applyRemoveDraft, applySaveActivity, validationContext, type ActivityForm,
} from '@/store/activityOps';
import { loadState } from '@/store/persistence';
import { authorizeAction, createInitialState, reducer, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const ORG = SAMPLE_ORGANIZATION_ID;

function sampleState(): AppState {
  const s = createInitialState(new Date());
  s.session.currentOrganizationId = ORG;
  return s;
}
const org = (s: AppState) => s.data.organizations.find((o) => o.id === ORG)!;
const verifierId = (s: AppState) => eligibleVerifiers(s.data, ORG)[0].id;
let n = 0;
const ids = () => ({ activityId: `va_t${++n}`, versionId: `vv_t${n}` });
const chk = (s: AppState, type: ActivityCheck['type'], extra: Partial<ActivityCheck> = {}) => newCheck(type, `c_${type}_${++n}`, org(s), extra);

function identityForm(s: AppState, over: Partial<ActivityForm> = {}): ActivityForm {
  const identifier = s.data.identifierConfigs.find((c) => c.organizationId === ORG)!;
  return {
    name: 'Front Desk Check', description: 'Who is at the desk', purpose: 'Confirm visitors', type: 'identity', outcome: { onRequiredFailure: 'not-verified', onInconclusive: 'unable-to-verify' },
    checks: [chk(s, 'identity-lookup', { params: { identifierConfigId: identifier.id } }), chk(s, 'attribute-match', { requirement: 'optional', params: { attributes: ['Full name'] } })],
    verifierIds: [verifierId(s)], ...over,
  };
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

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

describe('configuration rules', () => {
  it('validates dependencies, providers, alternatives and platform policies', () => {
    const s = sampleState();
    const ctx = validationContext(s, ORG);
    const msgs = (form: Pick<ActivityForm, 'type' | 'checks' | 'outcome'>) => validateConfiguration(form, ctx).blockers.map((b) => b.message).join(' | ');
    const outcome = { onRequiredFailure: 'not-verified' as const, onInconclusive: 'unable-to-verify' as const };

    expect(msgs({ type: 'identity', checks: [], outcome })).toMatch(/at least one verification check/);
    // Facial matching needs a reference and liveness. Without a provider it's a warning, not a blocker:
    // each verification then records Unable to Verify.
    const face = msgs({ type: 'identity', checks: [chk(s, 'face-match')], outcome });
    expect(face).toMatch(/needs Identity Record Lookup/);
    expect(face).toMatch(/needs Liveness Verification/);
    expect(face).not.toMatch(/not configured/);
    expect(validateConfiguration({ type: 'identity', checks: [chk(s, 'face-match')], outcome }, ctx).warnings.map((w) => w.message).join(' ')).toMatch(/Biometric verification isn’t connected/);
    // Other services that aren't configured block activation.
    expect(msgs({ type: 'identity', checks: [chk(s, 'identity-lookup'), chk(s, 'external-eligibility')], outcome })).toMatch(/not configured/);
    // A required check can't depend on an optional one.
    expect(msgs({ type: 'identity', checks: [chk(s, 'identity-lookup', { requirement: 'optional' }), chk(s, 'attribute-match', { params: { attributes: ['Full name'] } })], outcome }))
      .toMatch(/Identity Attribute Matching is required, so .* must be required too/);
    // Group membership needs a permitted group.
    expect(msgs({ type: 'identity', checks: [chk(s, 'identity-lookup'), chk(s, 'group-membership')], outcome })).toMatch(/permitted group/);
    // Credential activities must require authenticity (platform policy).
    expect(msgs({ type: 'credential', checks: [chk(s, 'credential-authenticity', { requirement: 'optional', locked: true, policySource: 'platform' })], outcome }))
      .toMatch(/must be a required check/);
    // A single alternative isn't a choice.
    expect(msgs({ type: 'identity', checks: [chk(s, 'identity-lookup'), chk(s, 'attribute-match', { requirement: 'alternative', params: { attributes: ['Full name'] } })], outcome }))
      .toMatch(/at least two checks/);
    // A valid identity configuration.
    expect(msgs(identityForm(s))).toBe('');
  });

  it('describes outcomes in plain language and never maps failures to Verified', () => {
    const s = sampleState();
    const lines = rulesSummary({ ...identityForm(s), outcome: { onRequiredFailure: 'pending-review', onInconclusive: 'unable-to-verify' } });
    expect(lines[0]).toBe('All required checks must pass: Identity Record Lookup.');
    expect(lines).toContain('If a required check fails, the outcome is Pending Review, and a reviewer decides. The original result is kept.');
    expect(lines.join(' ')).not.toMatch(/fails, the outcome is Verified/);
  });
});

describe('lifecycle and versions', () => {
  it('creates a draft, activates only when valid, and audits each step', () => {
    let s = sampleState();
    const id1 = ids();
    const bad = ok(applySaveActivity(s, { organizationId: ORG, ids: id1, form: identityForm(s, { checks: [], verifierIds: [] }), at: AT }));
    expect(bad.state.data.activityConfigs.find((a) => a.id === id1.activityId)).toMatchObject({ status: 'draft', draftVersionId: id1.versionId });
    expect(bad.state.data.audit[0]).toMatchObject({ action: 'verification-activity.created', summary: 'Tobyson TE created the Front Desk Check activity as a draft.' });
    expect(applyActivate(bad.state, { organizationId: ORG, activityId: id1.activityId, at: AT })).toMatchObject({ ok: false, problems: ['Add at least one verification check.'] });
    // An activity can be activated before verifiers are assigned; it says nobody can perform it yet.
    const unassigned = ok(applySaveActivity(s, { organizationId: ORG, ids: id1, form: identityForm(s, { verifierIds: [] }), at: AT }));
    expect(activationProblems(unassigned.state, ORG, unassigned.state.data.activityConfigs.find((a) => a.id === id1.activityId)!).warnings).toContain('No verifiers are assigned to this activity yet, so nobody can perform it. Assign verifiers in Participants & Verifiers.');

    s = ok(applySaveActivity(s, { organizationId: ORG, ids: id1, form: identityForm(s, { verifierIds: [] }), at: AT })).state;
    expect(s.data.verifierAssignments.some((v) => v.activityId === id1.activityId)).toBe(false);
    expect(applySaveActivity(s, { organizationId: ORG, ids: ids(), form: identityForm(s), at: AT })).toMatchObject({ ok: false, error: 'An activity with this name already exists.' });
    s = ok(applyActivate(s, { organizationId: ORG, activityId: id1.activityId, at: AT })).state;
    const activity = s.data.activityConfigs.find((a) => a.id === id1.activityId)!;
    expect(activity).toMatchObject({ status: 'active', activeVersionId: id1.versionId, draftVersionId: undefined });
    expect(s.data.audit[0]).toMatchObject({ action: 'verification-activity.activated', changes: [{ field: 'Status', from: 'Draft', to: 'Active (version 1)' }] });
    expect(executionPlan(s.data, ORG, activity.id)).toMatchObject({ versionNumber: 1, required: [expect.objectContaining({ type: 'identity-lookup' })], optional: [expect.objectContaining({ type: 'attribute-match' })] });
  });

  it('puts rule changes to an active activity in a new draft version and keeps the active one in use', () => {
    let s = sampleState();
    const id1 = ids();
    s = ok(applySaveActivity(s, { organizationId: ORG, ids: id1, form: identityForm(s), at: AT })).state;
    s = ok(applyActivate(s, { organizationId: ORG, activityId: id1.activityId, at: AT })).state;
    const v1 = s.data.activityVersions.find((v) => v.id === id1.versionId)!;

    const form = identityForm(s, { checks: v1.checks.map((c) => (c.type === 'attribute-match' ? { ...c, requirement: 'required' as const } : c)), outcome: { onRequiredFailure: 'pending-review', onInconclusive: 'unable-to-verify' } });
    const id2 = ids();
    s = ok(applySaveActivity(s, { organizationId: ORG, activityId: id1.activityId, ids: id2, form, at: AT })).state;
    let activity = s.data.activityConfigs.find((a) => a.id === id1.activityId)!;
    expect(activity).toMatchObject({ status: 'active', activeVersionId: id1.versionId, draftVersionId: id2.versionId });
    expect(s.data.activityVersions.find((v) => v.id === id1.versionId)).toEqual(v1);
    expect(s.data.activityVersions.find((v) => v.id === id2.versionId)).toMatchObject({ number: 2, status: 'draft' });
    expect(executionPlan(s.data, ORG, activity.id)!.versionNumber).toBe(1);
    const rules = s.data.audit.find((e) => e.action === 'verification-activity.rules-changed')!;
    expect(rules.summary).toMatch(/saved as draft version 2; version 1 stays in use/);
    expect(rules.changes).toEqual(expect.arrayContaining([{ field: 'Identity Attribute Matching', from: 'Optional', to: 'Required' }, { field: 'When a required check fails', from: 'Not Verified', to: 'Pending Review' }]));

    // Discard, then save again and activate: version 1 is superseded, not edited.
    expect(ok(applyDiscardDraft(s, { organizationId: ORG, activityId: activity.id, at: AT })).state.data.activityVersions.some((v) => v.id === id2.versionId)).toBe(false);
    s = ok(applyActivate(s, { organizationId: ORG, activityId: activity.id, at: AT })).state;
    activity = s.data.activityConfigs.find((a) => a.id === id1.activityId)!;
    expect(activity.activeVersionId).toBe(id2.versionId);
    expect(s.data.activityVersions.find((v) => v.id === id1.versionId)).toMatchObject({ status: 'superseded', checks: v1.checks });

    s = ok(applyDeactivate(s, { organizationId: ORG, activityId: activity.id, at: AT })).state;
    expect(s.data.activityConfigs.find((a) => a.id === activity.id)!.status).toBe('inactive');
    expect(executionPlan(s.data, ORG, activity.id)).toBeNull();
    expect(s.data.activityVersions.filter((v) => v.activityId === activity.id)).toHaveLength(2);
  });

  it('duplicates as a draft without verifiers, and only removes drafts that were never active', () => {
    let s = sampleState();
    const active = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.status === 'active')!;
    expect(applyRemoveDraft(s, { organizationId: ORG, activityId: active.id, at: AT })).toMatchObject({ ok: false });
    const copy = ids();
    s = ok(applyDuplicate(s, { organizationId: ORG, activityId: active.id, ids: copy, at: AT })).state;
    expect(s.data.activityConfigs.find((a) => a.id === copy.activityId)).toMatchObject({ name: `Copy of ${active.name}`, status: 'draft' });
    expect(s.data.verifierAssignments.some((v) => v.activityId === copy.activityId)).toBe(false);
    s = ok(applyRemoveDraft(s, { organizationId: ORG, activityId: copy.activityId, at: AT })).state;
    expect(s.data.activityConfigs.some((a) => a.id === copy.activityId)).toBe(false);
    expect(s.data.audit[0]).toMatchObject({ action: 'verification-activity.removed' });
  });

  it('blocks activation while a check needs a service that isn’t configured, but reports missing facial verification per verification', () => {
    let s = sampleState();
    const draft = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.status === 'draft')!;
    // Facial verification without a provider: a warning, so the camera journey can be tried; nobody can be verified.
    expect(activationProblems(s, ORG, draft).warnings.join(' ')).toMatch(/Biometric verification isn’t connected/);
    const v = s.data.activityVersions.find((x) => x.id === draft.draftVersionId)!;
    s = { ...s, data: { ...s.data, activityVersions: s.data.activityVersions.map((x) => (x.id === v.id ? { ...x, checks: [...x.checks, chk(s, 'external-eligibility')] } : x)) } };
    expect(activationProblems(s, ORG, draft).blockers.join(' ')).toMatch(/not configured/);
    expect(applyActivate(s, { organizationId: ORG, activityId: draft.id, at: AT })).toMatchObject({ ok: false });
  });

  it('keeps a group used by an activity from being removed', () => {
    const s = sampleState();
    expect(groupDependencies(s.data, ORG, `${ORG}_grp_volunteers`).map((d) => d.name)).toContain('Membership Verification');
  });
});

describe('permissions', () => {
  it('lets a Verification Manager manage activities; Viewers and Verifiers can’t change anything', () => {
    const s = sampleState();
    const as = (role: string): AppState => ({ ...s, data: { ...s.data, admin: { ...s.data.admin, id: adminsOf(s, ORG).find((a) => a.roleIds.includes(role) && a.status === 'active')!.userId! } } });
    expect(applySaveActivity(as('verification-manager'), { organizationId: ORG, ids: ids(), form: identityForm(s), at: AT })).toMatchObject({ ok: true });
    expect(applySaveActivity(as('credential-manager'), { organizationId: ORG, ids: ids(), form: identityForm(s), at: AT })).toMatchObject({ ok: false });
    expect(applySaveActivity(as('verifier'), { organizationId: ORG, ids: ids(), form: identityForm(s), at: AT })).toMatchObject({ ok: false });
    const preview = reducer(s, { type: 'preview/start', roleId: 'verification-manager' });
    expect(authorizeAction(preview, 'vactivities/save')).toMatch(/read-only/);
  });

  it('authorizes a verifier only for activities they’re assigned to; removing the assignment stops them', () => {
    let s = sampleState();
    const activity = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.status === 'active')!;
    const [vid] = eligibleVerifiers(s.data, ORG).map((a) => a.id);
    expect(authorizeVerifier(s.data, { organizationId: ORG, activityId: activity.id, administratorId: vid })).toMatchObject({ authorized: false, reason: 'Not assigned to this activity.' });
    const version = s.data.activityVersions.find((v) => v.id === activity.activeVersionId)!;
    const form = { name: activity.name, description: activity.description, purpose: activity.purpose, type: version.type, checks: version.checks, outcome: version.outcome };
    s = ok(applySaveActivity(s, { organizationId: ORG, activityId: activity.id, ids: ids(), at: AT, form: { ...form, verifierIds: [vid] } })).state;
    expect(s.data.audit[0]).toMatchObject({ action: 'verification-activity.verifier-assigned' });
    expect(authorizeVerifier(s.data, { organizationId: ORG, activityId: activity.id, administratorId: vid })).toEqual({ authorized: true });
    s = ok(applySaveActivity(s, { organizationId: ORG, activityId: activity.id, ids: ids(), at: AT, form: { ...form, verifierIds: [] } })).state;
    expect(authorizeVerifier(s.data, { organizationId: ORG, activityId: activity.id, administratorId: vid })).toMatchObject({ authorized: false });
    expect(s.data.audit[0]).toMatchObject({ action: 'verification-activity.verifier-removed' });
    expect(s.data.activityConfigs.find((a) => a.id === activity.id)!.draftVersionId).toBeUndefined();
  });
});

describe('screens', () => {
  it('lists activities with filters and offers lifecycle actions', async () => {
    const s = sampleState();
    const user = renderApp('/verification-activities', s);
    expect(screen.getByRole('heading', { level: 1, name: 'Verification Activities' })).toBeInTheDocument();
    expect(screen.getByText('Create and manage verification activities for your organization.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Visitor Identity Check' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Activity Name', 'Requirements', 'Eligible Participants', 'Status', 'Last Updated', 'Actions']);
    await user.selectOptions(screen.getByLabelText('Status'), 'draft');
    expect(screen.queryByRole('link', { name: 'Visitor Identity Check' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Event Access Verification' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Event Access Verification' }));
    await user.click(screen.getByRole('menuitem', { name: 'Activate' }));
    const dialog = screen.getByRole('dialog', { name: 'Activate Event Access Verification?' });
    expect(dialog).toHaveTextContent(/Biometric verification isn’t connected/);
  });

  it('creates an activity in three stages: details, participants & verifiers, review & activate', async () => {
    const s = sampleState();
    const user = renderApp('/verification-activities/new', s);
    expect(within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['1Activity Details', '2Participants & Verifiers', '3Review & Activate']);
    for (const t of [/Verification Requirements/, /Facial identity matching/, /Prevent multiple entries/, /Advanced configuration/]) expect(screen.queryByText(t)).toBeNull();
    // Location check is off by default, and nothing about location is asked.
    expect(screen.getByRole('switch', { name: /Enable Location Check/ })).not.toBeChecked();
    expect(screen.getByText(/Location does not automatically block verification or entry/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Location settings' })).toBeNull();
    expect(screen.queryByLabelText('Latitude')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter an activity name.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Activity Name/), 'Members Evening');
    await user.type(screen.getByLabelText(/Description/), 'Entry for registered members');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Participants: a group and a user who is also in it count once.
    const group = s.data.groups.find((g) => g.id === `${ORG}_grp_volunteers`)!;
    const inGroup = s.data.members.find((m) => s.data.groupMemberships.some((x) => x.groupId === group.id && x.memberId === m.id))!;
    await user.click(screen.getByRole('checkbox', { name: `Select group ${group.name}` }));
    await user.type(screen.getByLabelText('Search users to add'), inGroup.displayName.slice(0, 6));
    await user.click(screen.getByRole('button', { name: `Add ${inGroup.displayName}` }));
    const groupSize = new Set(s.data.groupMemberships.filter((x) => x.groupId === group.id).map((x) => x.memberId)).size;
    expect(screen.getByText(/unique eligible/)).toHaveTextContent(`${groupSize} unique eligible people right now · 1 group · 1 user`);
    // Verifiers: only administrators who can verify, searchable.
    const verifier = eligibleVerifiers(s.data, ORG)[0];
    const notVerifier = adminsOf(s, ORG).find((a) => a.name === 'Kwame Mensah')!;
    await user.type(screen.getByLabelText('Search verifiers'), verifier.name!.slice(0, 4));
    expect(screen.queryByRole('checkbox', { name: `Assign ${notVerifier.name}` })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: `Assign ${verifier.name}` }));
    expect(within(screen.getByRole('list', { name: 'Assigned verifiers' })).getByText(verifier.name!)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'Review & Activate' })).toBeInTheDocument();
    const review = screen.getByRole('heading', { name: 'Review & Activate' }).closest('section')!;
    expect(review).toHaveTextContent('Members Evening');
    expect(review).toHaveTextContent('Entry for registered members');
    expect(review).toHaveTextContent(`Groups: ${group.name}`);
    expect(review).toHaveTextContent(`Users: ${inGroup.displayName}`);
    expect(review).toHaveTextContent(`Assigned verifiers${verifier.name}`);
    expect(review).toHaveTextContent('Location checkOff');
    // Going back keeps what was entered.
    await user.click(screen.getByRole('button', { name: /Activity Details/ }));
    expect(screen.getByLabelText(/Activity Name/)).toHaveValue('Members Evening');
    await user.click(screen.getByRole('button', { name: /Review & Activate/ }));
    await user.click(screen.getByRole('button', { name: 'Create & Activate' }));

    expect(await screen.findByRole('heading', { level: 1, name: /Members Evening/ })).toBeInTheDocument();
    const after = loadState()!;
    const saved = after.data.activityConfigs.find((a) => a.name === 'Members Evening')!;
    expect(saved).toMatchObject({ status: 'active', description: 'Entry for registered members', participants: { groupIds: [group.id], memberIds: [inGroup.id] }, locationCheck: { enabled: false } });
    expect(after.data.verifierAssignments.filter((v) => v.activityId === saved.id && v.status === 'active').map((v) => v.administratorId)).toEqual([verifier.id]);
    expect(authorizeVerifier(after.data, { organizationId: ORG, activityId: saved.id, administratorId: verifier.id })).toEqual({ authorized: true });
    expect(screen.getByRole('list', { name: 'Assigned verifiers' })).toHaveTextContent(verifier.name!);
    expect(after.data.audit.slice(0, 3).map((e) => e.action)).toEqual(['verification-activity.activated', 'verification-activity.verifier-assigned', 'verification-activity.created']);
  });

  it('saves an incomplete activity as a draft and explains what blocks activation', async () => {
    const user = renderApp('/verification-activities/new', sampleState());
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));
    expect(screen.getByText('Enter an activity name.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Activity Name/), 'Unfinished Check');
    await user.click(screen.getByRole('button', { name: /Review & Activate/ }));
    expect(screen.getByRole('button', { name: 'Create & Activate' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one eligible group or user.');
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Unfinished Check/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
  });

  it('configures a location check by coordinates when no map provider is connected, and shows it on the activity', async () => {
    const user = renderApp('/verification-activities/new', sampleState());
    await user.type(screen.getByLabelText(/Activity Name/), 'Exam Hall Clearance');
    await user.click(screen.getByRole('switch', { name: /Enable Location Check/ }));
    const settings = screen.getByRole('region', { name: 'Location settings' });
    expect(settings).toHaveTextContent('Map and address search aren’t connected');
    expect(screen.queryByRole('application')).toBeNull();
    // A location is required once the check is on.
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Choose the activity’s location/);
    await user.type(within(settings).getByLabelText('Latitude'), '6.5174');
    await user.type(within(settings).getByLabelText('Longitude'), '3.3859');
    await user.click(within(settings).getByRole('button', { name: '250 m' }));
    expect(within(settings).getByLabelText('Selected location')).toHaveTextContent('6.51740, 3.38590 · within 250 m');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const review = screen.getByRole('heading', { name: 'Review & Activate' }).closest('section')!;
    expect(review).toHaveTextContent('Location checkOn6.51740, 3.38590 · within 250 m');
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Exam Hall Clearance/ })).toBeInTheDocument();
    expect(loadState()!.data.activityConfigs.find((a) => a.name === 'Exam Hall Clearance')!.locationCheck).toEqual({ enabled: true, lat: 6.5174, lng: 3.3859, radiusM: 250 });
    expect(screen.getByText('6.51740, 3.38590 · within 250 m')).toBeInTheDocument();
  });

  it('edits an existing activity without changing how it verifies, its entry rule or its history', async () => {
    const s = sampleState();
    const activity = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.name === 'Annual Staff Conference')!;
    const versionsBefore = s.data.activityVersions.filter((v) => v.activityId === activity.id);
    const user = renderApp(`/verification-activities/${activity.id}/edit`, s);
    expect(screen.getByLabelText(/Activity Name/)).toHaveValue(activity.name);
    await user.clear(screen.getByLabelText(/Description/));
    await user.type(screen.getByLabelText(/Description/), 'Staff conference entry');
    await user.click(screen.getByRole('button', { name: /Participants & Verifiers/ }));
    expect(screen.getAllByRole('checkbox', { checked: true }).length).toBe(activity.participants!.groupIds.length);
    await user.click(screen.getByRole('button', { name: /Review & Activate/ }));
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: /^Edit / })).toBeNull());
    const after = loadState()!;
    const saved = after.data.activityConfigs.find((a) => a.id === activity.id)!;
    expect(saved).toMatchObject({ status: 'active', description: 'Staff conference entry', location: 'Main Auditorium', schedule: activity.schedule, entryPolicy: 'deny', participants: activity.participants, activeVersionId: activity.activeVersionId });
    expect(saved.draftVersionId).toBeUndefined();
    expect(after.data.activityVersions.filter((v) => v.activityId === activity.id)).toEqual(versionsBefore);
    expect(after.data.audit[0]).toMatchObject({ action: 'verification-activity.updated' });
    expect(after.data.audit[0].changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'Description', to: 'Staff conference entry' })]));
  });

  it('keeps a customized or credential activity’s configuration when it’s edited', () => {
    let s = sampleState();
    const activity = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.name === 'Membership Verification')!;
    const v = s.data.activityVersions.find((x) => x.id === activity.activeVersionId)!;
    expect(v.checks.some((c) => c.type === 'credential-authenticity')).toBe(true);
    s = ok(applySaveActivity(s, { organizationId: ORG, activityId: activity.id, ids: ids(), at: AT,
      form: { name: activity.name, description: 'New text', purpose: 'New text', type: 'identity', checks: [], outcome: v.outcome, verifierIds: [], keepConfiguration: true } })).state;
    const now = s.data.activityConfigs.find((a) => a.id === activity.id)!;
    expect(now.draftVersionId).toBeUndefined();
    expect(s.data.activityVersions.find((x) => x.id === now.activeVersionId)).toEqual(v);
  });

  it('refuses to activate when identity can’t be verified, rather than weakening verification', async () => {
    const s = sampleState();
    const disconnected: AppState = { ...s, data: { ...s.data, organizations: s.data.organizations.map((o) => (o.id === ORG ? { ...o, integrations: { ...o.integrations, idSwitch: { ...o.integrations.idSwitch, connected: false } } } : o)) } };
    // New activities verify identity by face (1:1 against the enrolled portrait), whatever demonstration providers are on.
    const demo = { ...org(s), integrations: { ...org(s).integrations, verificationDemo: { enabled: true } } };
    expect(standardRequirementsFor(demo).identity).toBe('face');
    const user = renderApp('/verification-activities/new?step=review', disconnected);
    expect(screen.getByRole('alert')).toHaveTextContent(/can’t verify people’s identity for this organization yet/);
    expect(screen.getByRole('button', { name: 'Create & Activate' })).toBeDisabled();
    void user;
    const existing = disconnected.data.activityConfigs.find((a) => a.organizationId === ORG && a.name === 'Visitor Identity Check')!;
    expect(activationProblems(disconnected, ORG, { ...existing, status: 'inactive' }).blockers[0]).toMatch(/can’t verify people’s identity/);
  });

  it('only lets authorized administrators create or edit activities', async () => {
    const s = sampleState();
    const activity = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.status === 'active')!;
    renderApp(`/verification-activities/${activity.id}/edit`, reducer(s, { type: 'preview/start', roleId: 'viewer' }));
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    const asRole = (role: string): AppState => ({ ...s, data: { ...s.data, admin: { ...s.data.admin, id: adminsOf(s, ORG).find((a) => a.roleIds.includes(role) && a.status === 'active')!.userId! } } });
    for (const role of ['verifier', 'credential-manager']) {
      expect(applySaveActivity(asRole(role), { organizationId: ORG, activityId: activity.id, ids: ids(), at: AT, form: { ...identityForm(s), name: 'Renamed', keepConfiguration: true } })).toMatchObject({ ok: false });
      expect(applyActivate(asRole(role), { organizationId: ORG, activityId: activity.id, at: AT })).toMatchObject({ ok: false });
    }
    // Another organization's activity isn't found from this one.
    const other = s.data.activityConfigs.find((a) => a.organizationId !== ORG)!;
    if (other) expect(applySaveActivity(s, { organizationId: ORG, activityId: other.id, ids: ids(), at: AT, form: { ...identityForm(s), keepConfiguration: true } })).toMatchObject({ ok: false });
  });

  it('shows read-only details to a Viewer and hides the module from a Credential Manager', async () => {
    const s = sampleState();
    const activity = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.status === 'active')!;
    renderApp(`/verification-activities/${activity.id}`, reducer(s, { type: 'preview/start', roleId: 'viewer' }));
    expect(screen.getByRole('heading', { level: 1, name: new RegExp(activity.name) })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull();
  });

  it('blocks a role without verification access, even by direct link', () => {
    renderApp('/verification-activities', reducer(sampleState(), { type: 'preview/start', roleId: 'credential-manager' }));
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it('updates eligible participants from the Participants tab and audits the change', async () => {
    const s = sampleState();
    const activity = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.name === 'Annual Staff Conference')!;
    const user = renderApp(`/verification-activities/${activity.id}?tab=participants`, s);
    const removed = s.data.members.find((m) => m.id === activity.participants!.memberIds[0])!;
    expect(screen.getAllByRole('link', { name: removed.displayName }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Edit participants' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: `Remove ${removed.displayName}` }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save participants' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = loadState()!;
    expect(after.data.activityConfigs.find((a) => a.id === activity.id)!.participants!.memberIds).not.toContain(removed.id);
    expect(after.data.audit[0]).toMatchObject({ action: 'verification-activity.participants-changed' });
    // Participants aren't versioned: no draft version was created.
    expect(after.data.activityConfigs.find((a) => a.id === activity.id)!.draftVersionId).toBeUndefined();
  });
});
