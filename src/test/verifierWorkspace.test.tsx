import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { participantStatuses, statusOf } from '@/domain/participantStatus';
import type { LocationCheckConfig } from '@/domain/location';
import type { Member } from '@/domain/types';
import { adminsOf } from '@/store/adminOps';
import { loadState } from '@/store/persistence';
import { createInitialState, reducer, type Action, type AppState } from '@/store/state';
import { createDefaultServices } from '@/services/ServicesProvider';
import { FACE_UNAVAILABLE_REASON, createHttpFaceVerification, type FaceVerificationResponse, type FaceVerificationService } from '@/services/faceVerification';
import type { DeviceLocation } from '@/services/location';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import type { Services } from '@/services/types';
import { createVerificationService } from '@/verification/engine';
import { CAPTURE, FACE, fakeFaceVerification } from './helpers/faceVerification';
import { assign } from './helpers/identity';
import { findParticipant } from './helpers/verifierFlow';

const ORG = SAMPLE_ORGANIZATION_ID;
const AT = new Date().toISOString();
let seq = 0;

const base = () => { const s = createInitialState(new Date()); s.session.currentOrganizationId = ORG; return s; };
const exam = (s: AppState) => s.data.activityConfigs.find((a) => a.organizationId === ORG && a.name === '2026 Examination Clearance')!;
const halima = (s: AppState) => adminsOf(s, ORG).find((a) => a.roleIds.includes('verifier') && a.status === 'active')!;
const signInAs = (s: AppState, userId: string): AppState => ({ ...s, data: { ...s.data, admin: { ...s.data.admin, id: userId } } });
/** Signed in as Halima (a Verifier) and assigned to the examination clearance. */
const asHalima = (s: AppState): AppState => assign(signInAs(s, halima(s).userId!), halima(s).id, [exam(s).id]);
/** The demo Organization Admin, given the Verifier role and assigned to the examination clearance. */
const adminVerifier = (s: AppState): AppState => {
  const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
  return assign(reducer(s, { type: 'admins/roles', organizationId: ORG, adminId: me.id, roleIds: [...me.roleIds, 'verifier'], at: AT }), me.id, [exam(s).id]);
};
const setFace = (s: AppState, memberId: string, status: Member['faceEnrollment']['status']): AppState => ({ ...s, data: { ...s.data, members: s.data.members.map((m) => (m.id === memberId ? { ...m, faceEnrollment: { ...m.faceEnrollment, status } } : m)) } });
const withLocation = (s: AppState, locationCheck: LocationCheckConfig): AppState => ({ ...s, data: { ...s.data, activityConfigs: s.data.activityConfigs.map((a) => (a.id === exam(s).id ? { ...a, locationCheck } : a)) } });

/** Candidates: two eligible students (one enrolled, one not) and a student who isn't eligible. */
function people(s: AppState) {
  const ids = exam(s).participants!.memberIds;
  const byId = (id: string) => s.data.members.find((m) => m.id === id)!;
  const matric = s.data.members.find((m) => m.id === ids[0])!.identifier!.configId;
  return {
    enrolled: byId(ids[0]), second: byId(ids[2]), noPortrait: byId(ids[1]),
    outsider: s.data.members.find((m) => m.organizationId === ORG && m.status === 'active' && m.identifier?.configId === matric && !ids.includes(m.id))!,
    staff: s.data.members.find((m) => m.organizationId === ORG && m.identifier && m.identifier.configId !== matric)!,
  };
}
/** A prepared state: enrolment statuses fixed so results don't depend on sample data. */
function prepared(s: AppState) {
  const p = people(s);
  let out = setFace(s, p.enrolled.id, 'enrolled');
  out = setFace(out, p.second.id, 'enrolled');
  out = setFace(out, p.noPortrait.id, 'not-enrolled');
  return setFace(out, p.outsider.id, 'enrolled');
}

function harness(initial: AppState, face?: FaceVerificationService) {
  let state = initial;
  const dispatch = (a: Action) => { state = reducer(state, a); };
  const service = createVerificationService({ getState: () => state, dispatch, idSwitch: createMockIdSwitch(), timeoutMs: 600, faceVerification: face });
  return { get state() { return state; }, set state(v: AppState) { state = v; }, dispatch, service };
}

const capture = () => ({ image: CAPTURE, capturedAt: AT });

async function verify(h: ReturnType<typeof harness>, m: Member, opts: { face?: boolean; location?: DeviceLocation } = {}) {
  const started = h.service.startAttempt(ORG, exam(h.state).id);
  if (!started.ok) throw new Error(started.error);
  const r = await h.service.submitInputs(started.attempt.id, { identifier: m.identifier!.value, face: opts.face === false ? undefined : capture(), location: opts.location }, { submissionId: `w${++seq}` });
  if (!r.ok) throw new Error(r.error);
  return r.attempt;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('the examination clearance activity', () => {
  it('identifies candidates by matric number, verifies their face 1:1 with liveness, then checks eligibility', () => {
    const s = asHalima(base());
    const h = harness(s);
    const started = h.service.startAttempt(ORG, exam(s).id);
    if (!started.ok) throw new Error(started.error);
    const steps = h.service.requiredSteps(started.attempt.id)!;
    expect(steps.identifier).toEqual({ label: 'Matric number' });
    expect(steps.biometric).toMatchObject({ checks: ['liveness', 'face-match'], available: false });
    expect(steps.attributes).toEqual([]);
    expect(steps.credential).toBeNull();
  });
});

describe('access to activities and verification', () => {
  it('shows an assigned verifier their active activities, and nothing to an unassigned one', () => {
    const s = asHalima(base());
    expect(harness(s).service.listAuthorizedActivities(ORG).map((x) => x.activity.name)).toEqual(['2026 Examination Clearance']);
    const unassigned = signInAs(base(), halima(base()).userId!);
    const h = harness(unassigned);
    expect(h.service.listAuthorizedActivities(ORG)).toEqual([]);
    expect(h.service.startAttempt(ORG, exam(unassigned).id)).toMatchObject({ ok: false, code: 'not-assigned' });
  });

  it('lets an Organization Admin manage every activity but not verify without the Verifier role and an assignment', () => {
    let s = base();
    const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
    expect(harness(s).service.startAttempt(ORG, exam(s).id)).toMatchObject({ ok: false });
    s = reducer(s, { type: 'admins/roles', organizationId: ORG, adminId: me.id, roleIds: [...me.roleIds, 'verifier'], at: AT });
    expect(harness(s).service.startAttempt(ORG, exam(s).id)).toMatchObject({ ok: false, error: 'Not assigned to this activity.' });
    expect(harness(assign(s, me.id, [exam(s).id])).service.startAttempt(ORG, exam(s).id)).toMatchObject({ ok: true });
  });

  it('refuses activities and participants from another organization', async () => {
    const s = asHalima(base());
    const other = s.data.activityConfigs.find((a) => a.organizationId !== ORG && a.status === 'active')!;
    const h = harness(s);
    expect(h.service.startAttempt(ORG, other.id)).toMatchObject({ ok: false });
    expect(h.service.startAttempt(other.organizationId, other.id)).toMatchObject({ ok: false });
    // A person from another organization isn't found here, even with a real identifier.
    const foreign = s.data.members.find((m) => m.organizationId !== ORG && m.identifier)!;
    const started = h.service.startAttempt(ORG, exam(s).id);
    if (!started.ok) throw new Error(started.error);
    expect(await h.service.lookupParticipant(started.attempt.id, foreign.identifier!.value)).toMatchObject({ ok: false, code: 'identifier-not-found' });
  });

  it('can’t be bypassed through the service once access changes during a verification', async () => {
    const s = prepared(asHalima(base()));
    const { enrolled } = people(s);
    const h = harness(s, fakeFaceVerification(FACE.match));
    const started = h.service.startAttempt(ORG, exam(s).id);
    if (!started.ok) throw new Error(started.error);
    // Assignment revoked mid-verification.
    h.state = { ...h.state, data: { ...h.state.data, verifierAssignments: h.state.data.verifierAssignments.map((v) => (v.activityId === exam(s).id ? { ...v, status: 'removed' as const } : v)) } };
    expect(await h.service.lookupParticipant(started.attempt.id, enrolled.identifier!.value)).toMatchObject({ ok: false, code: 'not-assigned' });
    expect(await h.service.submitInputs(started.attempt.id, { identifier: enrolled.identifier!.value, face: capture() }, { submissionId: 'x1' })).toMatchObject({ ok: false });
    // Activity deactivated mid-verification.
    const h2 = harness(s, fakeFaceVerification(FACE.match));
    const second = h2.service.startAttempt(ORG, exam(s).id);
    if (!second.ok) throw new Error(second.error);
    h2.state = { ...h2.state, data: { ...h2.state.data, activityConfigs: h2.state.data.activityConfigs.map((a) => (a.id === exam(s).id ? { ...a, status: 'inactive' as const } : a)) } };
    expect(await h2.service.submitInputs(second.attempt.id, { identifier: enrolled.identifier!.value, face: capture() }, { submissionId: 'x2' })).toMatchObject({ ok: false, code: 'inactive' });
    expect(h2.state.data.verificationAttempts.find((a) => a.id === second.attempt.id)!.status).toBe('in-progress');
  });
});

describe('Find Participant', () => {
  it('finds the eligible participant for the identifier, without proving who is present', async () => {
    const s = prepared(asHalima(base()));
    const { enrolled, noPortrait, outsider, staff } = people(s);
    const h = harness(s);
    const started = h.service.startAttempt(ORG, exam(s).id);
    if (!started.ok) throw new Error(started.error);
    const found = await h.service.lookupParticipant(started.attempt.id, ` ${enrolled.identifier!.value.toLowerCase()} `);
    expect(found).toMatchObject({ ok: true, participant: { memberId: enrolled.id, name: enrolled.displayName, identifierLabel: 'Matric number' }, eligibility: 'eligible', portrait: 'enrolled', faceRequired: true });
    expect(await h.service.lookupParticipant(started.attempt.id, noPortrait.identifier!.value)).toMatchObject({ ok: true, eligibility: 'eligible', portrait: 'missing' });
    expect(await h.service.lookupParticipant(started.attempt.id, outsider.identifier!.value)).toMatchObject({ ok: true, eligibility: 'not-eligible' });
    // Another kind of identifier (a staff number) isn't a matric number.
    expect(await h.service.lookupParticipant(started.attempt.id, staff.identifier!.value)).toMatchObject({ ok: false, code: 'identifier-not-found' });
    expect(await h.service.lookupParticipant(started.attempt.id, 'NBU/0000/00000')).toMatchObject({ ok: false, code: 'identifier-not-found' });
    // Looking someone up records nothing about them.
    expect(h.state.data.verificationAttempts.find((a) => a.id === started.attempt.id)).toMatchObject({ status: 'in-progress' });
    expect(h.state.data.verificationAttempts.find((a) => a.id === started.attempt.id)!.subject).toBeUndefined();
  });

  it('reports the lookup service being unavailable', async () => {
    const s = asHalima(base());
    let state = s;
    const idSwitch = createMockIdSwitch();
    (idSwitch as unknown as { simulation: { setOutage: (v: boolean) => void } }).simulation.setOutage(true);
    const service = createVerificationService({ getState: () => state, dispatch: (a) => { state = reducer(state, a); }, idSwitch });
    const started = service.startAttempt(ORG, exam(s).id);
    if (!started.ok) throw new Error(started.error);
    expect(await service.lookupParticipant(started.attempt.id, people(s).enrolled.identifier!.value)).toMatchObject({ ok: false, code: 'lookup-unavailable' });
  });

  it('never treats an ineligible participant as eligible', async () => {
    const s = prepared(asHalima(base()));
    const h = harness(s, fakeFaceVerification(FACE.match));
    const a = await verify(h, people(s).outsider);
    expect(a).toMatchObject({ verificationResult: 'verified', eligibilityResult: 'not-eligible', outcome: 'not-verified', accessDecision: 'not-permitted' });
    expect(h.service.recordEntry(a.id)).toMatchObject({ ok: false });
  });
});

describe('biometric verification', () => {
  it('can’t produce a match without a provider: identity is Unable to Verify and entry can’t be allowed', async () => {
    const s = prepared(asHalima(base()));
    const h = harness(s); // no provider: the default
    const a = await verify(h, people(s).enrolled);
    expect(a.verificationResult).toBe('unable-to-verify');
    expect(a.outcome).not.toBe('verified');
    expect(a.checks.find((c) => c.type === 'face-match')).toMatchObject({ status: 'inconclusive', explanation: FACE_UNAVAILABLE_REASON });
    expect(a.checks.find((c) => c.type === 'liveness')).toMatchObject({ status: 'inconclusive', explanation: FACE_UNAVAILABLE_REASON });
    expect(a.accessDecision).not.toBe('permitted');
    expect(h.service.recordEntry(a.id)).toMatchObject({ ok: false });
    expect(a.simulated).toBeFalsy();
  });

  it('records a genuine provider match as Verified, sending only the reference ID and the capture, and stores no image', async () => {
    const s = prepared(asHalima(base()));
    const { enrolled } = people(s);
    const face = fakeFaceVerification(FACE.match);
    const h = harness(s, face);
    const a = await verify(h, enrolled);
    expect(a).toMatchObject({ verificationResult: 'verified', eligibilityResult: 'eligible', outcome: 'verified', accessDecision: 'permitted' });
    expect(a.checks.find((c) => c.type === 'face-match')).toMatchObject({ status: 'passed', evidenceRef: 'biometric:cmp-001' });
    expect(face.calls).toHaveLength(1);
    expect(face.calls[0]).toMatchObject({ requestId: a.id, organizationId: ORG, subjectRef: enrolled.idSwitchId, checkLiveness: true, probe: CAPTURE });
    expect(a.inputs).toMatchObject({ identifier: true, biometric: true });
    expect(JSON.stringify(h.state)).not.toContain(CAPTURE.slice(30, 80));
    expect(a.entry).toBeUndefined();
  });

  it('never marks a mismatch, a failed liveness check or a provider failure as Verified', async () => {
    const s = prepared(asHalima(base()));
    let next: FaceVerificationResponse = FACE.noMatch;
    const h = harness(s, fakeFaceVerification(() => next));
    const { enrolled } = people(s);
    const mismatch = await verify(h, enrolled);
    expect(mismatch).toMatchObject({ verificationResult: 'not-verified', outcome: 'not-verified', accessDecision: 'not-permitted' });
    expect(h.service.recordEntry(mismatch.id)).toMatchObject({ ok: false });
    next = FACE.notLive;
    const spoof = await verify(h, enrolled);
    expect(spoof.verificationResult).toBe('not-verified');
    expect(spoof.checks.find((c) => c.type === 'face-match')!.status).toBe('skipped');
    next = FACE.poor;
    expect((await verify(h, enrolled)).verificationResult).toBe('unable-to-verify');
    next = FACE.down;
    const down = await verify(h, enrolled);
    expect(down.verificationResult).toBe('unable-to-verify');
    expect(down.checks.find((c) => c.type === 'liveness')).toMatchObject({ status: 'error', explanation: FACE.down.reason });
  });

  it('doesn’t verify someone with no enrolled portrait, or without a capture', async () => {
    const s = prepared(asHalima(base()));
    const face = fakeFaceVerification(FACE.match);
    const h = harness(s, face);
    const noPortrait = await verify(h, people(s).noPortrait);
    expect(noPortrait.verificationResult).toBe('unable-to-verify');
    expect(noPortrait.checks.find((c) => c.type === 'liveness')!.explanation).toMatch(/No enrolled portrait/);
    const noCapture = await verify(h, people(s).enrolled, { face: false });
    expect(noCapture.verificationResult).toBe('unable-to-verify');
    expect(face.calls).toHaveLength(0);
  });

  it('won’t confirm a live person with a provider that doesn’t check liveness', async () => {
    const s = prepared(asHalima(base()));
    const a = await verify(harness(s, fakeFaceVerification(FACE.match, { supportsLiveness: false })), people(s).enrolled);
    expect(a.verificationResult).toBe('unable-to-verify');
  });

  it('uses the HTTP adapter’s documented contract and never trusts a malformed or failed response', async () => {
    const req = { requestId: 'VER-1', organizationId: ORG, subjectRef: 'IDS-1', probe: CAPTURE, checkLiveness: true };
    const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
    let sent: { url: string; body: Record<string, unknown> } | undefined;
    const ok = createHttpFaceVerification('https://fixid.example/face', { fetcher: (async (url: string, init: RequestInit) => { sent = { url, body: JSON.parse(String(init.body)) }; return new Response(JSON.stringify({ decision: 'match', liveness: 'live', reference: 'cmp-9' })); }) as unknown as typeof fetch });
    expect(await ok.verify(req)).toEqual({ status: 'completed', decision: 'match', liveness: 'live', reference: 'cmp-9' });
    expect(sent!.body).toMatchObject({ requestId: 'VER-1', subjectRef: 'IDS-1', checkLiveness: true, probe: { mediaType: 'image/jpeg' } });
    expect(String((sent!.body.probe as { data: string }).data)).not.toMatch(/^data:/);
    const adapter = (f: () => Promise<Response>) => createHttpFaceVerification('https://fixid.example/face', { fetcher: f as unknown as typeof fetch });
    expect((await adapter(reply(200, { decision: 'yes', liveness: 'live', reference: 'r' })).verify(req)).status).toBe('error');
    expect((await adapter(reply(200, { decision: 'match', liveness: 'live' })).verify(req)).status).toBe('error');
    expect((await adapter(reply(503, {})).verify(req)).status).toBe('unavailable');
    expect((await adapter(reply(500, {})).verify(req)).status).toBe('error');
    expect(await adapter(async () => { throw new TypeError('offline'); }).verify(req)).toMatchObject({ status: 'error', reason: expect.stringMatching(/network interruption/) });
  });
});

describe('location, entry and participant status', () => {
  const AREA: LocationCheckConfig = { enabled: true, lat: 6.5174, lng: 3.3859, radiusM: 100 };

  it('ignores location when the check is off, and reports outside the area without denying entry', async () => {
    const s = prepared(asHalima(base()));
    const off = await verify(harness(s, fakeFaceVerification(FACE.match)), people(s).enrolled, { location: { status: 'captured', lat: 0, lng: 0, accuracyM: 5, capturedAt: AT } });
    expect(off.location).toEqual({ result: 'not-required' });
    const h = harness(withLocation(s, AREA), fakeFaceVerification(FACE.match));
    const outside = await verify(h, people(s).enrolled, { location: { status: 'captured', lat: 6.5274, lng: 3.3859, accuracyM: 10, capturedAt: AT } });
    expect(outside).toMatchObject({ verificationResult: 'verified', eligibilityResult: 'eligible', accessDecision: 'permitted', location: { result: 'outside' } });
    expect(outside.entry).toBeUndefined();
    expect(h.service.recordEntry(outside.id)).toEqual({ ok: true });
  });

  it('records entry decisions separately and never records a second entry', async () => {
    const s = prepared(asHalima(base()));
    const h = harness(s, fakeFaceVerification(FACE.match));
    const { enrolled } = people(s);
    const first = await verify(h, enrolled);
    expect(first.entry).toBeUndefined();
    expect(h.service.recordEntry(first.id)).toEqual({ ok: true });
    expect(h.state.data.verificationAttempts.find((a) => a.id === first.id)).toMatchObject({ verificationResult: 'verified', entry: { status: 'entered' } });
    // The officer is warned at lookup, and a second entry can't be recorded.
    const next = h.service.startAttempt(ORG, exam(s).id);
    if (!next.ok) throw new Error(next.error);
    const lookup = await h.service.lookupParticipant(next.attempt.id, enrolled.identifier!.value);
    expect(lookup).toMatchObject({ ok: true, history: { entered: { attemptId: first.id } } });
    const again = await h.service.submitInputs(next.attempt.id, { identifier: enrolled.identifier!.value, face: capture() }, { submissionId: 'dup' });
    if (!again.ok) throw new Error(again.error);
    expect(again.attempt).toMatchObject({ verificationResult: 'verified', accessDecision: 'not-permitted' });
    expect(h.service.recordEntry(again.attempt.id)).toMatchObject({ ok: false });
    expect(h.state.data.verificationAttempts.filter((a) => a.subject?.memberId === enrolled.id && a.entry?.status === 'entered')).toHaveLength(1);
  });

  it('derives participant statuses from persisted results only', async () => {
    const s = prepared(asHalima(base()));
    let next: FaceVerificationResponse = FACE.match;
    const h = harness(s, fakeFaceVerification(() => next));
    const { enrolled, second, noPortrait } = people(s);
    h.service.recordEntry((await verify(h, enrolled)).id);
    await verify(h, second);
    next = FACE.noMatch;
    const failed = await verify(h, noPortrait);
    expect(failed.verificationResult).toBe('unable-to-verify');
    const st = participantStatuses(h.state.data.verificationAttempts, exam(s).id);
    expect(statusOf(st, enrolled.id)).toMatchObject({ verification: 'verified', entry: 'granted' });
    expect(statusOf(st, second.id)).toMatchObject({ verification: 'verified', entry: 'pending' });
    expect(statusOf(st, noPortrait.id)).toMatchObject({ verification: 'unable', entry: 'not-granted' });
    const untouched = exam(s).participants!.memberIds[5];
    expect(statusOf(st, untouched)).toEqual({ verification: 'not-verified', entry: 'not-recorded' });
    h.service.denyEntry(failed.id, 'Identity not confirmed');
    expect(statusOf(participantStatuses(h.state.data.verificationAttempts, exam(s).id), noPortrait.id).entry).toBe('denied');
  });
});

describe('screens', () => {
  const services = (face?: FaceVerificationService): Services => ({ ...createDefaultServices(), ...(face ? { faceVerification: face } : {}) });
  function renderApp(path: string, state: AppState, svc: Services = services()) {
    render(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders initialState={state} services={svc} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    return userEvent.setup();
  }
  const media = navigator.mediaDevices;
  function mockCamera(getUserMedia: () => Promise<MediaStream>) {
    const track = { stop: vi.fn() };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(getUserMedia), enumerateDevices: vi.fn(async () => [{ kind: 'videoinput' }]) } });
    return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
  }
  beforeEach(() => {
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(CAPTURE);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media }); vi.restoreAllMocks(); });

  it('runs the whole journey: activity, find participant, live selfie, result, entry decision, next participant, statuses and history', async () => {
    const s = prepared(adminVerifier(base()));
    const { enrolled } = people(s);
    const face = fakeFaceVerification(FACE.match);
    const cam = mockCamera(async () => cam.stream);
    const user = renderApp('/verify', s, services(face));
    const list = await screen.findByRole('list', { name: 'Your verification activities' });
    const card = within(list).getByRole('heading', { name: '2026 Examination Clearance' }).closest('li')!;
    expect(card).toHaveTextContent(`0 of ${exam(s).participants!.memberIds.length} verified`);
    await user.click(within(card).getByRole('link', { name: 'View details: 2026 Examination Clearance' }));
    expect(await screen.findByRole('heading', { level: 1, name: '2026 Examination Clearance' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Verification progress' })).toHaveTextContent(`Eligible participants${exam(s).participants!.memberIds.length}`);
    await user.click(screen.getByRole('button', { name: 'Start Verification' }));

    // 1. Find Participant: the label is the activity's identifier.
    expect(await screen.findByLabelText(/Matric number/)).toBeInTheDocument();
    await findParticipant(user, enrolled.identifier!.value);
    const found = await screen.findByRole('region', { name: 'Participant found' });
    expect(found).toHaveTextContent(enrolled.displayName);
    expect(found).toHaveTextContent('EligibilityEligible');
    expect(found).toHaveTextContent('Enrolled portraitAvailable');
    await user.click(within(found).getByRole('button', { name: 'Continue to face verification' }));

    // 2. Verify Identity: live capture, retake, then verify.
    expect(screen.getByRole('button', { name: 'Verify Identity' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Capture Selfie' }));
    expect(await screen.findByLabelText('Camera preview')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Capture' }));
    expect(screen.getByRole('img', { name: 'Captured selfie' })).toBeInTheDocument();
    expect(cam.track.stop).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retake' }));
    await user.click(await screen.findByRole('button', { name: 'Capture' }));
    await user.click(screen.getByRole('button', { name: 'Verify Identity' }));

    // 3. Result: identity, eligibility and location kept apart; entry is the officer's decision.
    const outcome = await screen.findByRole('region', { name: 'Outcome' }, { timeout: 4000 });
    expect(outcome).toHaveTextContent('Identity verificationVerified');
    expect(outcome).toHaveTextContent('Activity eligibilityEligible');
    expect(outcome).toHaveTextContent('Location checkNot required');
    expect(face.calls).toHaveLength(1);
    const panel = screen.getByRole('region', { name: 'Access and entry' });
    expect(panel).toHaveTextContent('Not recorded');
    await user.click(within(panel).getByRole('button', { name: 'Allow Entry' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Allow Entry' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Access and entry' })).getByText('Entered')).toBeInTheDocument());

    // Verify Next Participant starts clean.
    await user.click(screen.getByRole('button', { name: 'Verify Next Participant' }));
    expect(await screen.findByLabelText(/Matric number/)).toHaveValue('');
    expect(screen.queryByRole('region', { name: 'Participant found' })).toBeNull();
    // The same person again: warned, and no second entry.
    await findParticipant(user, enrolled.identifier!.value);
    expect(await screen.findByRole('region', { name: 'Participant found' })).toHaveTextContent(/Already granted entry/);

    const saved = loadState()!;
    const attempt = saved.data.verificationAttempts.find((a) => a.subject?.memberId === enrolled.id && a.entry)!;
    expect(attempt).toMatchObject({ activityId: exam(s).id, verificationResult: 'verified', eligibilityResult: 'eligible', location: { result: 'not-required' }, entry: { status: 'entered' } });
    expect(JSON.stringify(saved)).not.toContain(CAPTURE.slice(30, 80));
  });

  it('shows statuses in the participant list and results in Verification History', async () => {
    const s0 = prepared(adminVerifier(base()));
    const h = harness(s0, fakeFaceVerification(FACE.match));
    const { enrolled, second } = people(s0);
    h.service.recordEntry((await verify(h, enrolled)).id);
    await verify(h, second);
    const user = renderApp(`/verification-activities/${exam(s0).id}?tab=participants`, h.state);
    const table = screen.getByRole('region', { name: 'Participant status' });
    const row = (m: Member) => within(table).getAllByRole('row').find((r) => r.textContent?.includes(m.displayName))!;
    expect(row(enrolled)).toHaveTextContent('VerifiedGranted');
    expect(row(second)).toHaveTextContent('VerifiedPending');
    await user.click(within(table).getByRole('button', { name: 'Not verified' }));
    expect(within(table).queryByText(enrolled.displayName)).toBeNull();
    // Verification History keeps the same results.
    await user.click(screen.getByRole('tab', { name: /Verification History/ }));
    const historyRow = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes(enrolled.displayName.split(' ')[0]) && r.textContent?.includes('Entered'));
    expect(historyRow).toBeDefined();
  });

  it('says plainly when biometric verification is unavailable, and records Unable to Verify', async () => {
    const s = prepared(adminVerifier(base()));
    const cam = mockCamera(async () => cam.stream);
    const user = renderApp(`/verify/activities/${exam(s).id}`, s);
    expect(await screen.findByText(/Biometric verification unavailable: integration required/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start Verification' }));
    await findParticipant(user, people(s).enrolled.identifier!.value);
    await user.click(within(await screen.findByRole('region', { name: 'Participant found' })).getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('status')).toHaveTextContent('Biometric Verification Unavailable: integration required');
    await user.click(screen.getByRole('button', { name: 'Capture Selfie' }));
    await user.click(await screen.findByRole('button', { name: 'Capture' }));
    await user.click(screen.getByRole('button', { name: 'Verify Identity' }));
    const outcome = await screen.findByRole('region', { name: 'Outcome' }, { timeout: 4000 });
    expect(outcome).toHaveTextContent('Biometric Verification Unavailable');
    expect(outcome).toHaveTextContent('Identity verificationUnable to verify');
    expect(within(screen.getByRole('region', { name: 'Access and entry' })).queryByRole('button', { name: 'Allow Entry' })).toBeNull();
  });

  it('handles camera permission denied and no camera', async () => {
    const s = prepared(adminVerifier(base()));
    mockCamera(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); });
    const user = renderApp(`/verify/activities/${exam(s).id}`, s, services(fakeFaceVerification(FACE.match)));
    await user.click(await screen.findByRole('button', { name: 'Start Verification' }));
    await findParticipant(user, people(s).enrolled.identifier!.value);
    await user.click(within(await screen.findByRole('region', { name: 'Participant found' })).getByRole('button', { name: /^Continue/ }));
    await user.click(screen.getByRole('button', { name: 'Capture Selfie' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera permission was denied');
    expect(screen.getByRole('button', { name: 'Verify Identity' })).toBeDisabled();
    mockCamera(async () => { throw Object.assign(new Error('none'), { name: 'NotFoundError' }); });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera unavailable: No camera was found on this device.');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Camera unavailable: (This browser|The camera needs a secure)/);
  });

  it('stops ineligible people and people with no enrolled portrait from proceeding as if they could be verified', async () => {
    const s = prepared(adminVerifier(base()));
    const { outsider, noPortrait } = people(s);
    const user = renderApp(`/verify/activities/${exam(s).id}`, s, services(fakeFaceVerification(FACE.match)));
    await user.click(await screen.findByRole('button', { name: 'Start Verification' }));
    await findParticipant(user, noPortrait.identifier!.value);
    const found = await screen.findByRole('region', { name: 'Participant found' });
    expect(found).toHaveTextContent('Enrolled portraitNot enrolled');
    expect(within(found).queryByRole('button', { name: /^Continue/ })).toBeNull();
    await user.click(within(found).getByRole('button', { name: 'Find a different participant' }));
    await findParticipant(user, outsider.identifier!.value);
    const notEligible = await screen.findByRole('region', { name: 'Participant found' });
    expect(notEligible).toHaveTextContent('EligibilityNot eligible');
    await user.click(within(notEligible).getByRole('button', { name: 'Record as not eligible' }));
    const outcome = await screen.findByRole('region', { name: 'Outcome' }, { timeout: 4000 });
    expect(outcome).toHaveTextContent('Activity eligibilityNot eligible');
    expect(outcome).not.toHaveTextContent('Identity verificationVerified');
  });

  it('refuses an unassigned verifier who opens an activity link directly, and shows the Organization Admin how verifier access works', async () => {
    let s = base();
    const me = adminsOf(s, ORG).find((a) => a.userId === s.data.admin.id)!;
    s = reducer(s, { type: 'admins/roles', organizationId: ORG, adminId: me.id, roleIds: [...me.roleIds, 'verifier'], at: AT });
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/verify/activities/${exam(s).id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders initialState={s} services={services()} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'You can’t perform this verification' })).toBeInTheDocument();
    expect(screen.getByText('Not assigned to this activity.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Verification' })).toBeNull();
    unmount();
    renderApp(`/verification-activities/${exam(s).id}`, s);
    expect(screen.getByLabelText('Your verifier access')).toHaveTextContent('You aren’t assigned as a verifier for this activity');
    expect(screen.getByRole('link', { name: 'Open Verifier Workspace' })).toHaveAttribute('href', '/verify');
  });
});
