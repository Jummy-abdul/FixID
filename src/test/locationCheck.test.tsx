import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { evaluateLocation, locationConfigProblem, type LocationCheckConfig } from '@/domain/location';
import { eligibleParticipants } from '@/domain/verification';
import type { Member } from '@/domain/types';
import { adminsOf } from '@/store/adminOps';
import { loadState } from '@/store/persistence';
import { createInitialState, reducer, type Action, type AppState } from '@/store/state';
import { createDefaultServices } from '@/services/ServicesProvider';
import type { DeviceLocation, GeolocationService, MapsService } from '@/services/location';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import type { Services } from '@/services/types';
import { createVerificationService } from '@/verification/engine';
import { assign, statedDetails } from './helpers/identity';
import { verifyByDetails } from './helpers/verifierFlow';

const ORG = SAMPLE_ORGANIZATION_ID;
const AT = new Date().toISOString();
const AREA: LocationCheckConfig = { enabled: true, lat: 6.5174, lng: 3.3859, radiusM: 100, label: 'Main Auditorium' };
/** About 111 m per 0.001° of latitude. */
const at = (dLat: number, accuracyM = 10): DeviceLocation => ({ status: 'captured', lat: AREA.lat + dLat, lng: AREA.lng, accuracyM, capturedAt: AT });
const DENIED: DeviceLocation = { status: 'unavailable', reason: 'Location permission was denied on the verifier’s device.' };
let seq = 0;

const base = () => { const s = createInitialState(new Date()); s.session.currentOrganizationId = ORG; return s; };
const conference = (s: AppState) => s.data.activityConfigs.find((a) => a.organizationId === ORG && a.name === 'Annual Staff Conference')!;
const withArea = (s: AppState, locationCheck: LocationCheckConfig | undefined = AREA): AppState => ({ ...s, data: { ...s.data, activityConfigs: s.data.activityConfigs.map((a) => (a.id === conference(s).id ? { ...a, locationCheck } : a)) } });
/** The demo Organization Admin, also a Verifier assigned to the conference. */
const adminVerifier = (s: AppState): AppState => {
  const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
  return assign(reducer(s, { type: 'admins/roles', organizationId: ORG, adminId: me.id, roleIds: [...me.roleIds, 'verifier'], at: AT }), me.id, [conference(s).id]);
};
const insider = (s: AppState) => {
  const eligible = eligibleParticipants(s.data, ORG, conference(s).participants);
  return s.data.members.find((m) => m.organizationId === ORG && m.status === 'active' && m.identifier && eligible.has(m.id))!;
};

function harness(initial: AppState) {
  let state = initial;
  const dispatch = (a: Action) => { state = reducer(state, a); };
  const service = createVerificationService({ getState: () => state, dispatch, idSwitch: createMockIdSwitch(), timeoutMs: 600 });
  return { get state() { return state; }, dispatch, service };
}

async function verify(h: ReturnType<typeof harness>, m: Member, location?: DeviceLocation) {
  const started = h.service.startAttempt(ORG, conference(h.state).id);
  if (!started.ok) throw new Error(started.error);
  const r = await h.service.submitInputs(started.attempt.id, { identifier: m.identifier!.value, attributes: statedDetails(m), location }, { submissionId: `l${++seq}` });
  if (!r.ok) throw new Error(r.error);
  return r.attempt;
}

// Leaflet needs real layout and SVG, which jsdom lacks; the map itself is checked in the browser.
vi.mock('@/components/verification/LocationMap', () => ({
  LocationMap: ({ center, radiusM, label = 'Activity location map' }: { center: { lat: number; lng: number } | null; radiusM: number; label?: string }) => (
    <div role="application" aria-label={label}>{center ? `pin ${center.lat},${center.lng} r${radiusM}` : 'no pin'}</div>
  ),
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('evaluating a location check', () => {
  it('reports within, outside, inconclusive, unavailable and not required', () => {
    expect(evaluateLocation(AREA, at(0.0002))).toMatchObject({ result: 'within', distanceM: 22, reported: { accuracyM: 10 } });
    expect(evaluateLocation(AREA, at(0.003))).toMatchObject({ result: 'outside', distanceM: 334 });
    expect(evaluateLocation(AREA, DENIED)).toEqual({ result: 'unavailable', reason: DENIED.status === 'unavailable' ? DENIED.reason : '', configured: { lat: AREA.lat, lng: AREA.lng, radiusM: 100, label: 'Main Auditorium' } });
    expect(evaluateLocation(AREA, undefined).result).toBe('unavailable');
    expect(evaluateLocation({ ...AREA, enabled: false }, at(0.003))).toEqual({ result: 'not-required' });
    expect(evaluateLocation(undefined, at(0))).toEqual({ result: 'not-required' });
  });

  it('allows for the reported accuracy instead of claiming certainty', () => {
    // 78 m from the centre: inside the 100 m radius only if the fix is accurate enough.
    expect(evaluateLocation(AREA, at(0.0007, 15)).result).toBe('within');
    expect(evaluateLocation(AREA, at(0.0007, 60)).result).toBe('inconclusive');
    // 122 m away: outside only when even the accuracy margin can't bring it inside.
    expect(evaluateLocation(AREA, at(0.0011, 10)).result).toBe('outside');
    expect(evaluateLocation(AREA, at(0.0011, 40)).result).toBe('inconclusive');
    expect(evaluateLocation(AREA, { status: 'captured', lat: 200, lng: 0, accuracyM: 5, capturedAt: AT }).result).toBe('unavailable');
  });

  it('requires a location and a sensible radius once the check is on', () => {
    expect(locationConfigProblem({ enabled: false, lat: NaN, lng: NaN, radiusM: 100 })).toBeNull();
    expect(locationConfigProblem({ enabled: true, lat: NaN, lng: NaN, radiusM: 100 })).toMatch(/Choose the activity’s location/);
    expect(locationConfigProblem({ ...AREA, radiusM: 10 })).toMatch(/between 25 m and 5,000 m/);
    expect(locationConfigProblem(AREA)).toBeNull();
  });
});

describe('location during verification', () => {
  it('reports a device outside the area without failing identity, eligibility or access, and records no entry', async () => {
    const h = harness(withArea(adminVerifier(base())));
    const a = await verify(h, insider(h.state), at(0.003));
    expect(a).toMatchObject({ outcome: 'verified', verificationResult: 'verified', eligibilityResult: 'eligible', accessDecision: 'permitted' });
    expect(a.location).toMatchObject({ result: 'outside', distanceM: 334, reported: { lat: AREA.lat + 0.003, accuracyM: 10 }, configured: { radiusM: 100 } });
    expect(a.entry).toBeUndefined();
  });

  it('reports a denied permission as unavailable, never as within the area', async () => {
    const h = harness(withArea(adminVerifier(base())));
    const a = await verify(h, insider(h.state), DENIED);
    expect(a.location).toMatchObject({ result: 'unavailable', reason: 'Location permission was denied on the verifier’s device.' });
    expect(a.location!.reported).toBeUndefined();
    expect(a.accessDecision).toBe('permitted');
  });

  it('ignores any reported location when the activity doesn’t check it', async () => {
    const h = harness(adminVerifier(base()));
    const a = await verify(h, insider(h.state), at(0));
    expect(a.location).toEqual({ result: 'not-required' });
  });

  it('records Allow Entry and Deny Entry as explicit, audited decisions with the location result', async () => {
    const h = harness(withArea(adminVerifier(base())));
    const allowed = await verify(h, insider(h.state), at(0.003));
    expect(h.service.recordEntry(allowed.id)).toEqual({ ok: true });
    const entered = h.state.data.verificationAttempts.find((x) => x.id === allowed.id)!;
    expect(entered.entry).toMatchObject({ status: 'entered' });
    expect(h.state.data.audit[0].changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'Location check', to: 'Outside configured area' })]));
    // A decision can't be changed afterwards.
    expect(h.service.denyEntry(allowed.id).ok).toBe(false);

    const denied = await verify(h, insider(h.state), at(0));
    expect(h.service.denyEntry(denied.id, 'Wrong entrance')).toEqual({ ok: true });
    const d = h.state.data.verificationAttempts.find((x) => x.id === denied.id)!;
    expect(d).toMatchObject({ entry: { status: 'denied', reason: 'Wrong entrance' }, location: { result: 'within' } });
    expect(h.state.data.audit[0]).toMatchObject({ action: 'verification.entry-denied' });
    expect(h.service.recordEntry(denied.id).ok).toBe(false);
  });

  it('refuses entry decisions and activity changes from someone without permission', async () => {
    const h = harness(withArea(adminVerifier(base())));
    const a = await verify(h, insider(h.state), at(0));
    const other = adminsOf(h.state, ORG).find((x) => x.userId && x.userId !== h.state.data.admin.id && x.status === 'active')!;
    let s = reducer(h.state, { type: 'admins/roles', organizationId: ORG, adminId: other.id, roleIds: ['viewer'], at: AT });
    s = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: other.userId! } } };
    const denied = reducer(s, { type: 'verify/denyEntry', attemptId: a.id, at: AT });
    expect(denied.data.verificationAttempts.find((x) => x.id === a.id)!.entry).toBeUndefined();
    const act = conference(s);
    const edited = reducer(s, { type: 'vactivities/save', organizationId: ORG, activityId: act.id, ids: { activityId: act.id, versionId: 'v-x' }, at: AT,
      form: { name: act.name, description: '', purpose: '', type: 'identity' as never, checks: [], outcome: { mode: 'all' } as never, verifierIds: [], keepConfiguration: true, locationCheck: { ...AREA, enabled: false } } });
    expect(conference(edited).locationCheck).toEqual(AREA);
  });

  it('refuses verification by a verifier who isn’t assigned to the activity', () => {
    const s = withArea(adminVerifier(base()));
    const unassigned = { ...s, data: { ...s.data, verifierAssignments: s.data.verifierAssignments.filter((v) => v.activityId !== conference(s).id) } };
    expect(harness(unassigned).service.startAttempt(ORG, conference(s).id).ok).toBe(false);
  });
});

describe('screens', () => {
  function renderApp(path: string, state: AppState, services: Services) {
    render(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders initialState={state} services={services} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    return userEvent.setup();
  }
  const fakeGeo = (result: DeviceLocation) => {
    const geo: GeolocationService & { calls: number } = { calls: 0, async getCurrentPosition() { geo.calls += 1; return result; } };
    return geo;
  };

  async function runVerification(user: ReturnType<typeof userEvent.setup>, m: Member) {
    const list = await screen.findByRole('list', { name: 'Your verification activities' });
    const card = within(list).getByRole('heading', { name: 'Annual Staff Conference' }).closest('li')!;
    await user.click(within(card).getByRole('button', { name: 'Start verification: Annual Staff Conference' }));
    return verifyByDetails(user, m);
  }

  it('doesn’t ask for the device location when the activity doesn’t check it', async () => {
    const s = adminVerifier(base());
    const geo = fakeGeo(at(0));
    const user = renderApp('/verify', s, { ...createDefaultServices(), geolocation: geo });
    expect(await runVerification(user, insider(s))).toHaveTextContent('Verified');
    expect(geo.calls).toBe(0);
    expect(within(screen.getByRole('region', { name: 'Access and entry' })).queryByRole('group', { name: 'Location check' })).toBeNull();
  });

  it('checks the location when enabled, shows an unavailable result, and leaves the entry decision to the officer', async () => {
    const s = withArea(adminVerifier(base()));
    const geo = fakeGeo(DENIED);
    const user = renderApp('/verify', s, { ...createDefaultServices(), geolocation: geo });
    expect(await runVerification(user, insider(s))).toHaveTextContent('Verified');
    expect(geo.calls).toBe(1);
    const panel = screen.getByRole('region', { name: 'Access and entry' });
    expect(panel).toHaveTextContent('Location unavailable');
    expect(panel).toHaveTextContent('Location permission was denied');
    expect(panel).toHaveTextContent('Not recorded');
    await user.click(within(panel).getByRole('button', { name: 'Deny Entry' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Could not confirm location');
    await user.click(within(dialog).getByRole('button', { name: 'Deny Entry' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Access and entry' })).getByText('Entry denied')).toBeInTheDocument());
    const saved = loadState()!.data.verificationAttempts.find((a) => a.activityId === conference(s).id && a.entry)!;
    expect(saved).toMatchObject({ entry: { status: 'denied', reason: 'Could not confirm location' }, location: { result: 'unavailable' } });
  });

  it('searches for a place with a connected map provider and selects it', async () => {
    const maps: MapsService = { available: true, providerName: 'Test Maps', tileUrl: '', attribution: '', searchPlaces: async () => [{ label: 'Main Hall, Lagos', lat: 6.5, lng: 3.4 }] };
    const user = renderApp('/verification-activities/new', base(), { ...createDefaultServices(), maps });
    await user.click(screen.getByRole('switch', { name: /Enable Location Check/ }));
    const settings = screen.getByRole('region', { name: 'Location settings' });
    expect(within(settings).getByRole('application', { name: 'Activity location map' })).toBeInTheDocument();
    expect(settings).toHaveTextContent('Map data from Test Maps');
    expect(within(settings).queryByLabelText('Latitude')).toBeNull();
    // The search sits inside the editor's form, so it mustn't be a form of its own (browsers would submit the editor).
    expect(settings.querySelector('form')).toBeNull();
    await user.type(within(settings).getByLabelText('Search for a location or address'), 'Main Hall{Enter}');
    expect(screen.getByRole('heading', { name: 'Activity details' })).toBeInTheDocument();
    await user.click(await within(settings).findByRole('button', { name: 'Main Hall, Lagos' }));
    expect(within(settings).getByLabelText('Selected location')).toHaveTextContent('Main Hall, Lagos6.50000, 3.40000 · within 100 m');
  });
});
