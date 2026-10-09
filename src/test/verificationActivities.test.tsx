import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { groupDependencies } from '@/domain/groups';
import type { ActivityCheck } from '@/domain/types';
import { authorizeVerifier, eligibleVerifiers, executionPlan, newCheck, rulesSummary, validateConfiguration } from '@/domain/verification';
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
    // Facial matching needs a reference and liveness, and its service isn't configured.
    const face = msgs({ type: 'identity', checks: [chk(s, 'face-match')], outcome });
    expect(face).toMatch(/needs Identity Record Lookup/);
    expect(face).toMatch(/needs Liveness Verification/);
    expect(face).toMatch(/not configured/);
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
    const bad = ok(applySaveActivity(s, { organizationId: ORG, ids: id1, form: identityForm(s, { verifierIds: [] }), at: AT }));
    expect(bad.state.data.activityConfigs.find((a) => a.id === id1.activityId)).toMatchObject({ status: 'draft', draftVersionId: id1.versionId });
    expect(bad.state.data.audit[0]).toMatchObject({ action: 'verification-activity.created', summary: 'Tobyson TE created the Front Desk Check activity as a draft.' });
    expect(applyActivate(bad.state, { organizationId: ORG, activityId: id1.activityId, at: AT })).toMatchObject({ ok: false, problems: ['Assign at least one verifier with the Verifier role.'] });

    s = ok(applySaveActivity(s, { organizationId: ORG, ids: id1, form: identityForm(s), at: AT })).state;
    expect(s.data.audit[0]).toMatchObject({ action: 'verification-activity.verifier-assigned' });
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

  it('blocks activation while a check needs a service that isn’t configured', () => {
    const s = sampleState();
    const draft = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.status === 'draft')!;
    const { blockers } = activationProblems(s, ORG, draft);
    expect(blockers.join(' ')).toMatch(/not configured/);
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

  it('removing a verifier assignment stops them performing the activity', () => {
    let s = sampleState();
    const activity = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.status === 'active')!;
    const vid = s.data.verifierAssignments.find((v) => v.activityId === activity.id && v.status === 'active')!.administratorId;
    expect(authorizeVerifier(s.data, { organizationId: ORG, activityId: activity.id, administratorId: vid })).toEqual({ authorized: true });
    const version = s.data.activityVersions.find((v) => v.id === activity.activeVersionId)!;
    s = ok(applySaveActivity(s, { organizationId: ORG, activityId: activity.id, ids: ids(), at: AT, form: { name: activity.name, description: activity.description, purpose: activity.purpose, type: version.type, checks: version.checks, outcome: version.outcome, verifierIds: [] } })).state;
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
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Activity Name', 'Verification Type', 'Checks', 'Assigned Verifiers', 'Status', 'Last Updated', 'Actions']);
    await user.selectOptions(screen.getByLabelText('Status'), 'draft');
    expect(screen.queryByRole('link', { name: 'Visitor Identity Check' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Event Access Verification' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Event Access Verification' }));
    await user.click(screen.getByRole('menuitem', { name: 'Activate' }));
    const dialog = screen.getByRole('dialog', { name: 'This activity can’t be activated yet' });
    expect(dialog).toHaveTextContent(/not configured/);
  });

  it('creates a credential activity through the guided flow and activates it', async () => {
    const s = sampleState();
    const user = renderApp('/verification-activities/new', s);
    expect(within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('button')).toHaveLength(6);
    await user.type(screen.getByLabelText(/Activity name/), 'Membership Card Check');
    await user.type(screen.getByLabelText(/Purpose/), 'Confirm members at the entrance');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /^Credential/ }));
    expect(screen.getByText(/Credential authenticity is added and required automatically/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const auth = screen.getByRole('group', { name: 'Credential Authenticity' });
    expect(within(auth).getByText('Required by platform policy')).toBeInTheDocument();
    expect(within(auth).getByRole('radio', { name: 'Optional' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove Credential Authenticity' })).toBeNull();
    const type = s.data.credentialTypes.find((t) => t.organizationId === ORG && t.status === 'active')!;
    await user.click(within(auth).getByRole('checkbox', { name: type.name }));
    await user.click(screen.getByRole('button', { name: 'Add Credential Status' }));
    await user.click(screen.getByRole('button', { name: 'Add Holder Binding' }));
    const binding = screen.getByRole('group', { name: 'Holder Binding' });
    expect(binding).toHaveTextContent(/isn’t configured|not configured/i);
    await user.click(screen.getByRole('button', { name: 'Remove Holder Binding' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.click(screen.getByRole('radio', { name: /Refer for review.*original failed result/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const verifier = eligibleVerifiers(s.data, ORG)[0];
    await user.click(screen.getByRole('checkbox', { name: `Assign ${verifier.name}` }));
    expect(screen.getByText('1 verifier assigned')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Ready to activate. All required configuration is complete.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Outcome rules' })).toHaveTextContent('If a required check fails, the outcome is Pending Review');
    await user.click(screen.getByRole('button', { name: 'Activate Activity' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Membership Card Check/ })).toBeInTheDocument();
    const saved = loadState()!.data.activityConfigs.find((a) => a.name === 'Membership Card Check')!;
    expect(saved.status).toBe('active');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Checks & Rules2', 'Verifiers1', 'Activity History']);
    await user.click(screen.getByRole('tab', { name: /Activity History/ }));
    expect(screen.getByText('Tobyson TE activated Membership Card Check (version 1).')).toBeInTheDocument();
    expect(screen.getByText('Tobyson TE created the Membership Card Check activity as a draft.')).toBeInTheDocument();
  });

  it('saves an incomplete activity as a draft and explains what blocks activation', async () => {
    const user = renderApp('/verification-activities/new', sampleState());
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));
    expect(screen.getByText('Enter an activity name.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Activity name/), 'Unfinished Check');
    await user.click(screen.getByRole('button', { name: /Review & Activate/ }));
    expect(screen.getByRole('button', { name: 'Activate Activity' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one verification check.');
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Unfinished Check/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
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

  it('lets a manager remove a verifier from the Verifiers tab', async () => {
    const s = sampleState();
    const activity = s.data.activityConfigs.find((a) => a.organizationId === ORG && a.status === 'active')!;
    const user = renderApp(`/verification-activities/${activity.id}?tab=verifiers`, s);
    const assigned = eligibleVerifiers(s.data, ORG)[0];
    expect(screen.getByRole('row', { name: new RegExp(assigned.name!) })).toHaveTextContent('Yes');
    await user.click(screen.getByRole('button', { name: `Remove ${assigned.name}` }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getByText('No verifiers assigned')).toBeInTheDocument());
  });
});
