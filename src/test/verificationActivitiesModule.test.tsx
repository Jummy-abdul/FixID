import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { ORG_B, ORG_B1, ORG_C } from '@/data/demoPersonas';
import { NEW_ORGANIZATION_ID } from '@/data/seed';
import {
  activityCounts, displayStatus, eligibilityOutcome, identityStatus, maskIdentifier, participantRows, scheduleSummary,
} from '@/domain/activityLifecycle';
import { authorizeVerifier, eligibleParticipants, eligibleVerifiers } from '@/domain/verification';
import { applyActivate, applyComplete, applySaveActivity } from '@/store/activityOps';
import { loadState } from '@/store/persistence';
import { sharedActivityTransactions } from '@/store/reporting';
import { createInitialState, type AppState } from '@/store/state';
import { EMPTY_DESCRIPTION, EMPTY_TITLE } from '@/pages/verification/VerificationActivitiesPage';
import { cont, localInput } from './helpers/activityWizard';

const AT = new Date().toISOString();
const OPEN_DAY = `${ORG_C}_va_open_day`;

function stateIn(orgId: string): AppState {
  const s = createInitialState(new Date());
  s.session.currentOrganizationId = orgId;
  return s;
}
const byName = (s: AppState, name: string) => s.data.activityConfigs.find((a) => a.organizationId === ORG_C && a.name === name)!;

function renderApp(path: string, state: AppState) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('status, schedule and outcomes', () => {
  it('derives Draft, Scheduled, Active, Paused and Completed, and the demo data shows each', () => {
    const now = new Date('2030-06-15T12:00:00Z');
    const base = { status: 'active' as const, schedule: { kind: 'one-time' as const, startsAt: '2030-06-20T09:00:00Z', endsAt: '2030-06-20T17:00:00Z' } };
    expect(displayStatus({ ...base, status: 'draft' }, now)).toBe('draft');
    expect(displayStatus(base, now)).toBe('scheduled');
    expect(displayStatus(base, new Date('2030-06-20T10:00:00Z'))).toBe('active');
    expect(displayStatus(base, new Date('2030-06-21T10:00:00Z'))).toBe('completed');
    expect(displayStatus({ ...base, status: 'inactive' }, new Date('2030-06-20T10:00:00Z'))).toBe('paused');
    expect(displayStatus({ ...base, completedAt: '2030-06-01T00:00:00Z' }, now)).toBe('completed');
    // Activities from before schedules existed are never Scheduled or Completed by date.
    expect(displayStatus({ status: 'active', schedule: { startsAt: '2030-07-01T00:00:00Z', endsAt: '2030-07-02T00:00:00Z' } }, now)).toBe('active');

    const s = stateIn(ORG_C);
    const statuses = new Set(s.data.activityConfigs.filter((a) => a.organizationId === ORG_C).map((a) => displayStatus(a)));
    expect([...statuses].sort()).toEqual(['active', 'completed', 'draft', 'paused', 'scheduled']);
  });

  it('describes each kind of schedule in words', () => {
    expect(scheduleSummary({ kind: 'open-ended', startsAt: '2030-06-20T09:00:00' })).toMatch(/^From 20 Jun 2030, 09:00 · no end date$/);
    expect(scheduleSummary({ kind: 'recurring', startsAt: '2030-06-01T00:00:00', recurrence: { frequency: 'weekly', days: [5, 1], startTime: '08:00', endTime: '17:00' } }))
      .toBe('Weekly on Mon, Fri · 08:00–17:00 · from 1 Jun 2030');
    expect(scheduleSummary(undefined)).toBeNull();
  });

  it('keeps identity verification and eligibility apart, and counts add up', () => {
    const s = stateIn(ORG_C);
    const records = sharedActivityTransactions(s, byName(s, 'Spring Open Day Check-in'));
    const counts = activityCounts(records);
    expect(counts).toEqual({ attempts: 5, verified: 2, unsuccessful: 1, pending: 1, unable: 1 });
    // Verified, yet not eligible: the record is suspended.
    const suspended = records.find((r) => r.lookup?.reference === 'DEMO-10002')!;
    expect([identityStatus(suspended), eligibilityOutcome(suspended)]).toEqual(['verified', 'not-eligible']);
    // One row per person; the latest attempt decides it; identifiers are masked.
    const rows = participantRows(records, new Set(), new Map());
    expect(rows.map((r) => [r.name, r.status, r.attempts.length])).toEqual([['Sample Person A', 'pending', 3], ['Sample Person B', 'verified', 1], ['Unidentified person', 'unable', 1]]);
    expect(rows.every((r) => !r.identifier.includes('DEMO'))).toBe(true);
    expect(maskIdentifier('DEMO-10002')).toBe('••••0002');
  });

  it('lists selected people who haven’t attempted yet as eligible and not yet verified', () => {
    const s = stateIn(ORG_C);
    const a = byName(s, 'Graduation Ceremony Check-in');
    const listed = eligibleParticipants(s.data, ORG_C, a.participants);
    const memberById = new Map(s.data.members.map((m) => [m.id, m]));
    const rows = participantRows([], listed, memberById);
    expect(rows).toHaveLength(listed.size);
    expect(rows.every((r) => r.status === 'not-attempted' && r.eligibility === 'eligible' && r.listed)).toBe(true);
  });
});

describe('completing an activity', () => {
  it('stops new verifications for good and keeps every record', () => {
    let s = stateIn(ORG_C);
    const a = byName(s, 'Visitor Check-in');
    const verifier = eligibleVerifiers(s.data, ORG_C).find((v) => s.data.verifierAssignments.some((x) => x.activityId === a.id && x.administratorId === v.id && x.status === 'active'))!;
    expect(authorizeVerifier(s.data, { organizationId: ORG_C, activityId: a.id, administratorId: verifier.id })).toEqual({ authorized: true });
    const before = s.data.verificationAttempts.filter((x) => x.activityId === a.id).length;
    const r = applyComplete(s, { organizationId: ORG_C, activityId: a.id, at: AT });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    const done = s.data.activityConfigs.find((x) => x.id === a.id)!;
    expect(displayStatus(done)).toBe('completed');
    expect(s.data.audit[0]).toMatchObject({ action: 'verification-activity.completed', resourceId: a.id });
    expect(s.data.verificationAttempts.filter((x) => x.activityId === a.id)).toHaveLength(before);
    expect(authorizeVerifier(s.data, { organizationId: ORG_C, activityId: a.id, administratorId: verifier.id })).toEqual({ authorized: false, reason: 'The activity isn’t active.' });
    expect(applyActivate(s, { organizationId: ORG_C, activityId: a.id, at: AT })).toMatchObject({ ok: false });
    const form = { name: 'Renamed', description: '', purpose: '', type: 'identity' as const, checks: [], outcome: { onRequiredFailure: 'not-verified' as const, onInconclusive: 'unable-to-verify' as const }, verifierIds: [], keepConfiguration: true };
    expect(applySaveActivity(s, { organizationId: ORG_C, activityId: a.id, ids: { activityId: 'x', versionId: 'y' }, at: AT, form })).toMatchObject({ ok: false });
    expect(applyComplete(s, { organizationId: ORG_C, activityId: byName(s, 'Event Access Verification').id, at: AT })).toMatchObject({ ok: false });
  });

  it('lets an activity for the organization’s own use be delegated later, and a delegated one stays delegated', () => {
    let s = stateIn(ORG_B);
    const own = s.data.activityConfigs.find((a) => a.organizationId === ORG_B && !a.sharing && a.verification?.identitySource.kind === 'external')
      ?? s.data.activityConfigs.find((a) => a.organizationId === ORG_B && !a.sharing)!;
    const v = s.data.activityVersions.find((x) => x.id === (own.activeVersionId ?? own.draftVersionId))!;
    const form = {
      name: own.name, description: own.description, purpose: own.purpose, type: v.type, checks: v.checks, outcome: v.outcome, verifierIds: [], keepConfiguration: true,
      audience: 'shared' as const, participantIds: [ORG_B1],
      verification: { ...(own.verification ?? { identitySource: { kind: 'external' as const, integrationId: 'int_b_identity' }, method: 'face' as const, liveness: 'required' as const, reverification: { mode: 'every-time' as const }, exceptions: 'unsuccessful' as const, eligibility: { approach: 'external-source' as const }, decisionRules: { onInconclusiveMatch: 'unable-to-decide' as const, onServiceUnavailable: 'unable-to-decide' as const } }), identitySource: { kind: 'external' as const, integrationId: 'int_b_identity' } },
    };
    const r = applySaveActivity(s, { organizationId: ORG_B, activityId: own.id, ids: { activityId: 'x', versionId: 'y' }, at: AT, form });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.data.activityConfigs.find((a) => a.id === own.id)!.sharing?.participants.map((p) => [p.organizationId, p.status])).toEqual([[ORG_B1, 'invited']]);
    const back = applySaveActivity(s, { organizationId: ORG_B, activityId: own.id, ids: { activityId: 'x', versionId: 'y' }, at: AT, form: { ...form, audience: 'own', participantIds: [] } });
    expect(back).toMatchObject({ ok: false });
  });
});

describe('screens', () => {
  it('shows the first-time empty state for an organization without activities, and starts the wizard from it', async () => {
    const user = renderApp('/verification-activities', stateIn(NEW_ORGANIZATION_ID));
    expect(await screen.findByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(EMPTY_TITLE).toBe('No verification activities yet');
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeInTheDocument();
    // No table, filters or figures.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByLabelText('Status')).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Create activity' }));
    expect(await screen.findByText('Step 1 of 5: Details')).toBeInTheDocument();
  });

  it('previews the empty state in the demo without losing any activities', async () => {
    const s = stateIn(ORG_C);
    const user = renderApp('/verification-activities', s);
    await user.click(await screen.findByRole('button', { name: 'preview the empty state' }));
    expect(await screen.findByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/Demo preview:/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show activities' }));
    expect(await screen.findByRole('link', { name: 'Visitor Check-in' })).toBeInTheDocument();
  });

  it('filters by status and identity source, and offers a way out of an empty search', async () => {
    const user = renderApp('/verification-activities', stateIn(ORG_C));
    await screen.findByRole('link', { name: 'Visitor Check-in' });
    await user.selectOptions(screen.getByLabelText('Status'), 'completed');
    expect(screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Spring Open Day Check-in']);
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await user.selectOptions(screen.getByLabelText('Identity source'), 'int_c_delegates');
    expect(screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent).sort()).toEqual(['Restricted Lounge Access', 'Spring Open Day Check-in', 'Visitor Check-in']);
    await user.type(screen.getByLabelText('Search activities by name'), 'zzz');
    expect(screen.getByText('No matching activities')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Search activities by name')).toHaveValue('');
    expect(screen.getAllByRole('row').length).toBeGreaterThan(5);
  });

  it('opens a participant’s details without images and keeps the search and filter when it closes', async () => {
    const user = renderApp(`/verification-activities/${OPEN_DAY}?tab=participants`, stateIn(ORG_C));
    await user.selectOptions(screen.getByLabelText('Verification status'), 'verified');
    await user.type(screen.getByLabelText('Search participants'), 'Person');
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'View details for Sample Person B' }));
    const drawer = screen.getByRole('dialog', { name: 'Sample Person B' });
    expect(drawer).toHaveTextContent('Verification outcomeVerified');
    expect(drawer).toHaveTextContent('Eligibility outcomeNot eligible');
    expect(drawer).toHaveTextContent('Identity sourceBrightwater Identity Service');
    expect(drawer).toHaveTextContent('Images, portraits and biometric data are never shown here.');
    expect(drawer.querySelector('img, canvas, video')).toBeNull();
    expect(drawer).not.toHaveTextContent(/score|threshold|0\.9/i);
    expect(within(drawer).queryByRole('button', { name: /override|approve|review/i })).toBeNull();
    await user.click(within(drawer).getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Search participants')).toHaveValue('Person');
    expect(screen.getByLabelText('Verification status')).toHaveValue('verified');
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    // A failed portrait match is explained safely.
    await user.selectOptions(screen.getByLabelText('Verification status'), 'all');
    await user.click(screen.getByRole('button', { name: 'View details for Sample Person A' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Earlier attempts');
    expect(screen.getByRole('dialog')).toHaveTextContent('Unsuccessful');
    // An empty search says so and offers to clear it.
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0]);
    await user.clear(screen.getByLabelText('Search participants'));
    await user.type(screen.getByLabelText('Search participants'), 'nobody here');
    expect(screen.getByText('No participants match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(3);
  });

  it('pauses, resumes and completes an activity from its details, each confirmed first', async () => {
    const s = stateIn(ORG_C);
    const a = byName(s, 'Badge Collection');
    const user = renderApp(`/verification-activities/${a.id}`, s);
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    const pause = screen.getByRole('dialog', { name: 'Pause Badge Collection?' });
    expect(pause).toHaveTextContent('Earlier verification records and the configuration are kept');
    await user.click(within(pause).getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('Activity paused')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Paused');
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Resume Badge Collection?' })).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Active'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as completed' }));
    const complete = screen.getByRole('dialog', { name: 'Mark Badge Collection as completed?' });
    expect(complete).toHaveTextContent('it can’t be resumed or edited afterwards');
    await user.click(within(complete).getByRole('button', { name: 'Mark as completed' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Completed'));
    expect(screen.queryByRole('link', { name: /Edit activity/ })).toBeNull();
    expect(loadState()!.data.activityConfigs.find((x) => x.id === a.id)!.completedAt).toBeDefined();
  });

  it('asks before discarding unsaved edits, and saves changes that then show on the list', async () => {
    const s = stateIn(ORG_C);
    const a = byName(s, 'Badge Collection');
    const user = renderApp(`/verification-activities/${a.id}/edit`, s);
    expect(screen.getByLabelText('Activity name')).toHaveValue('Badge Collection');
    await user.clear(screen.getByLabelText('Activity name'));
    await user.type(screen.getByLabelText('Activity name'), 'Badge Desk');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Activity name')).toHaveValue('Badge Desk');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    // Saving opens the activity's details.
    expect(await screen.findByRole('heading', { level: 1, name: /^Badge Desk/ })).toBeInTheDocument();
    // The list, from the saved data, shows the new name.
    cleanup();
    renderApp('/verification-activities', loadState()!);
    expect(await screen.findByRole('link', { name: 'Badge Desk' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('confirms an identity source change on an activity with records; the portrait match stays required', async () => {
    const s = stateIn(ORG_C);
    const a = byName(s, 'Visitor Check-in');
    const user = renderApp(`/verification-activities/${a.id}/edit?step=source`, s);
    await user.click(screen.getByRole('radio', { name: 'FixID records' }));
    expect(screen.getByText(/They keep the source they used/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Change the identity source?' });
    expect(dialog).toHaveTextContent('the portrait match stays required');
    await user.click(within(dialog).getByRole('button', { name: 'Change source' }));
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    const saved = loadState()!.data.activityConfigs.find((x) => x.id === a.id)!;
    expect(saved.verification).toMatchObject({ identitySource: { kind: 'local' }, method: 'face', liveness: 'required' });
    expect(loadState()!.data.verificationAttempts.filter((x) => x.activityId === a.id).every((x) => x.identitySource === 'external')).toBe(true);
  });

  it('validates a recurring schedule', async () => {
    const user = renderApp('/verification-activities/new', stateIn(ORG_C));
    await user.type(screen.getByLabelText('Activity name'), 'Weekly Check');
    await cont(user);
    await user.click(screen.getByRole('radio', { name: /Open verification/ }));
    await user.click(screen.getByRole('radio', { name: /Recurring/ }));
    for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) await user.click(screen.getByRole('checkbox', { name: d }));
    fireEvent.change(screen.getByLabelText('Until (time)'), { target: { value: '07:00' } });
    await cont(user);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a start date.');
    expect(alert).toHaveTextContent('Choose at least one day of the week.');
    expect(alert).toHaveTextContent('The daily end time must be after the start time.');
    await user.click(screen.getByRole('checkbox', { name: 'Wednesday' }));
    fireEvent.change(screen.getByLabelText('Until (time)'), { target: { value: '12:00' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: localInput(1).slice(0, 10) } });
    await cont(user);
    expect(screen.getByText('Step 3 of 5: Identity source')).toBeInTheDocument();
  });
});
