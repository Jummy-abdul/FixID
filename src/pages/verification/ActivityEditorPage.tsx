import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Save, ShieldCheck, UserCheck, UserPlus, Users } from 'lucide-react';
import { Button, Card, Field, Input, Textarea, useToast } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { LocationCheckEditor, type LocationDraft } from '@/components/verification/LocationCheckEditor';
import { ParticipantsPicker, useEligibleCount, type Participants } from '@/components/verification/ParticipantsPicker';
import { IssuesList, VerifierPicker } from '@/components/verification/parts';
import { formatCoordinate, formatRadius, locationConfigProblem, type LocationCheckConfig } from '@/domain/location';
import type { ActivityConfig, ActivityVersion } from '@/domain/types';
import {
  DEFAULT_OUTCOME, activeAssignments, buildChecks, currentVersion, describeRequirements, eligibleVerifiers, identityUnavailable, standardRequirementsFor,
  validateConfiguration,
} from '@/domain/verification';
import { cn } from '@/lib/cn';
import { NO_VERIFIER_WARNING, nameProblem, validationContext, type ActivityForm } from '@/store/activityOps';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { saveState } from '@/store/persistence';
import { formatDateTime } from '@/lib/dates';
import { NotFoundPage } from '../NotFoundPage';
import { activityPath } from './paths';

type Step = 'details' | 'people' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'details', label: 'Activity Details' }, { id: 'people', label: 'Participants & Verifiers' }, { id: 'review', label: 'Review & Activate' },
];


type DraftStatus = { kind: 'idle' } | { kind: 'saved'; at: string } | { kind: 'error'; message: string } | { kind: 'conflict' };

export function ActivityEditorPage() {
  const { activityId } = useParams();
  const { state } = useStore();
  const { organization } = useSession();
  const activity = activityId ? state.data.activityConfigs.find((a) => a.id === activityId && a.organizationId === organization.id) : undefined;
  if (activityId && !activity) return <NotFoundPage entity="verification activity" backTo="/verification-activities" />;
  return <Editor key={activity?.id ?? 'new'} activity={activity} />;
}

interface FormState {
  name: string;
  description: string;
  location: LocationDraft;
  participants: Participants;
  verifierIds: string[];
  /** Only for an existing activity without a participant list whose administrator chooses to add one. */
  addEligibility: boolean;
}

const DEFAULT_RADIUS = 100;

function toDraft(c?: LocationCheckConfig): LocationDraft {
  const ok = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { enabled: !!c?.enabled, lat: ok(c?.lat), lng: ok(c?.lng), radiusM: c?.radiusM ?? DEFAULT_RADIUS, label: c?.label ?? '' };
}

function toConfig(d: LocationDraft): LocationCheckConfig {
  return { enabled: d.enabled, lat: d.lat ?? Number.NaN, lng: d.lng ?? Number.NaN, radiusM: d.radiusM, ...(d.label ? { label: d.label } : {}) };
}

/**
 * Create or edit a verification activity in three stages: details (with an optional location check),
 * participants and verifiers, then review. How identity and eligibility are verified is FixID's job:
 * new activities use the strongest identity method genuinely available, existing ones keep theirs.
 */
function Editor({ activity }: { activity?: ActivityConfig }) {
  const { state, getState } = useStore();
  const { organization } = useSession();
  const org = useOrgData();
  const { can, record } = useAuthorization();
  const { saveActivity, activateActivity } = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isNew = !activity;
  const version = activity ? currentVersion(state.data, activity) : undefined;

  const [f, setF] = useState<FormState>(() => ({
    name: activity?.name ?? '', description: activity?.description || activity?.purpose || '',
    location: toDraft(activity?.locationCheck),
    participants: activity?.participants ?? { groupIds: [], memberIds: [] },
    // A new activity starts with the administrator creating it as its verifier, when they can verify.
    verifierIds: activity ? activeAssignments(state.data, organization.id, activity.id).map((v) => v.administratorId)
      : record && eligibleVerifiers(state.data, organization.id).some((a) => a.id === record.id) ? [record.id] : [],
    addEligibility: false,
  }));
  const [nameError, setNameError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'save' | 'activate' | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const eligibleCount = useEligibleCount(f.participants);

  const requested = params.get('step') ?? activity?.editorStep;
  const step: Step = (STEPS.some((s) => s.id === requested) ? requested : 'details') as Step;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const canDetails = isNew ? can('verification.activities.create') : can('verification.activities.edit');
  const canAssign = can('verification.verifiers.assign');
  const canActivate = can('verification.activities.activate');

  // The verification configuration: FixID's standard one for a new activity; an existing activity keeps its own.
  const canAddEligibility = !isNew && !!version?.requirements && !version.customized && !version.requirements.eligibility;
  let k = 0;
  const make = (r: NonNullable<ActivityVersion['requirements']>, outcome: ActivityVersion['outcome']) => ({ requirements: r, ...buildChecks(r, organization, () => `new_${++k}`), outcome });
  const generated = isNew
    ? make(standardRequirementsFor(organization), DEFAULT_OUTCOME)
    : canAddEligibility && f.addEligibility ? make({ ...version!.requirements!, eligibility: 'participants' }, version!.outcome) : null;
  const config: Pick<ActivityVersion, 'type' | 'checks' | 'outcome' | 'requirements' | 'customized'> | undefined = generated ?? version;
  const usesParticipants = !!config?.checks.some((c) => c.params.useParticipants);

  const name = nameProblem(state, organization.id, f.name, activity?.id);
  const location = locationConfigProblem(toConfig(f.location));
  const validation = config ? validateConfiguration(config, validationContext(state, organization.id, f.participants)) : null;
  const identity = config ? identityUnavailable(config, organization) : null;
  const blockers = [...new Set([
    ...(name ? [name] : []),
    ...(location ? [location] : []),
    ...(identity ? [identity] : []),
    // The plain identity message replaces the technical provider messages it summarizes.
    ...(validation?.blockers ?? []).filter((b) => !identity || !/unavailable|not configured/i.test(b.message)).map((b) => b.message),
    ...(!config ? ['This activity has no verification configuration.'] : []),
  ])];
  // Only issues an administrator can act on are shown here.
  const warnings = [...new Set([
    ...(validation?.warnings.map((w) => w.message) ?? []),
    ...(f.verifierIds.length === 0 ? [NO_VERIFIER_WARNING] : []),
  ])];
  const live = activity && activity.status !== 'draft';
  const credName = (id: string) => org.credentialTypeById.get(id)?.name ?? '';
  const adminName = (id: string) => { const a = state.data.administrators.find((x) => x.id === id); return a?.name ?? a?.email ?? 'Former administrator'; };

  const buildForm = (x: FormState, editorStep?: Step): ActivityForm | null => {
    if (!config) return null;
    const common = {
      name: x.name, description: x.description, purpose: x.description,
      locationCheck: toConfig(x.location), participants: x.participants, verifierIds: x.verifierIds, ...(editorStep ? { editorStep } : {}),
    };
    // Multiple-entry rules, schedules and other earlier settings aren't edited here: existing values are kept (left undefined).
    return generated
      ? { ...common, type: generated.type, checks: generated.checks, outcome: generated.outcome, requirements: generated.requirements, customized: false }
      : { ...common, type: config.type, checks: config.checks, outcome: config.outcome, keepConfiguration: true };
  };

  // ---- Draft preservation -------------------------------------------------------------------
  // A new activity or a draft is saved as a draft automatically: when moving between steps, before going
  // to invite an administrator, and when leaving the page. It's one draft record, updated in place, and
  // it's never overwritten if it changed elsewhere after this editor loaded it.
  const autosave = canDetails && (isNew || activity?.status === 'draft');
  const draftId = useRef(activity?.id);
  const seen = useRef(activity?.updatedAt);
  const latest = useRef(f);
  latest.current = f;
  const [draft, setDraft] = useState<DraftStatus>({ kind: 'idle' });

  const persistDraft = (at?: Step, x: FormState = latest.current): { ok: true; id?: string } | { ok: false; reason: 'name' | 'failed' } => {
    if (!autosave) return { ok: true, id: draftId.current };
    if (!x.name.trim() || nameProblem(getState(), organization.id, x.name, draftId.current)) return { ok: false, reason: 'name' };
    const stored = draftId.current ? getState().data.activityConfigs.find((a) => a.id === draftId.current) : undefined;
    if (draftId.current && stored?.status !== 'draft') return { ok: true, id: draftId.current };
    if (stored && stored.updatedAt !== seen.current) { setDraft({ kind: 'conflict' }); return { ok: false, reason: 'failed' }; }
    const form = buildForm(x, at);
    if (!form) return { ok: false, reason: 'failed' };
    const r = saveActivity(organization.id, draftId.current, form);
    if (!r.ok) { setDraft({ kind: 'error', message: r.error }); return { ok: false, reason: 'failed' }; }
    draftId.current = r.activityId;
    seen.current = getState().data.activityConfigs.find((a) => a.id === r.activityId)?.updatedAt;
    if (!saveState(getState())) {
      setDraft({ kind: 'error', message: 'The draft couldn’t be stored in this browser (storage may be full). Keep this page open and try again.' });
      return { ok: false, reason: 'failed' };
    }
    setDraft({ kind: 'saved', at: new Date().toISOString() });
    return { ok: true, id: r.activityId };
  };

  const goto = (s: Step) => {
    const r = persistDraft(s);
    // The first save creates the draft: carry on editing it at its own address.
    if (r.ok && r.id && isNew) { navigate(`${activityPath(r.id)}/edit?step=${s}`, { replace: true }); return; }
    setParams((p) => { const n = new URLSearchParams(p); n.set('step', s); return n; }, { replace: true });
  };

  // Leaving the page (for example to Settings) keeps the latest changes. The step is left as last recorded.
  useEffect(() => () => { if (autosave) persistDraft(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const inviteAdministrator = () => {
    const r = persistDraft('people');
    if (!r.ok) {
      if (r.reason === 'name') { setNameError('Enter an activity name so the draft can be saved before you leave.'); goto('details'); }
      return;
    }
    const id = r.id ?? activity?.id;
    const back = id ? `${activityPath(id)}/edit?step=people` : undefined;
    navigate(`/settings?tab=admins&invite=1${back ? `&returnTo=${encodeURIComponent(back)}` : ''}`);
  };

  const save = async (andActivate: boolean) => {
    const err = nameProblem(state, organization.id, f.name, draftId.current);
    if (err) { setNameError(err); goto('details'); return; }
    if (!config) return;
    setBusy(andActivate ? 'activate' : 'save');
    setProblems(null);
    await new Promise((r) => setTimeout(r, 200));
    const stored = draftId.current ? getState().data.activityConfigs.find((a) => a.id === draftId.current) : undefined;
    if (stored && autosave && stored.status === 'draft' && stored.updatedAt !== seen.current) { setBusy(null); setDraft({ kind: 'conflict' }); return; }
    const form = buildForm(f, step)!;
    // Saving explicitly updates the draft that was autosaved, never a second copy.
    const saved = saveActivity(organization.id, draftId.current, form);
    if (!saved.ok) {
      setBusy(null);
      if (saved.field === 'name') { setNameError(saved.error); goto('details'); return; }
      toast({ tone: 'error', title: 'Nothing was saved', description: saved.error });
      return;
    }
    draftId.current = saved.activityId;
    seen.current = getState().data.activityConfigs.find((a) => a.id === saved.activityId)?.updatedAt;
    if (!andActivate) {
      setBusy(null);
      toast({ tone: 'success', title: 'Saved as draft', description: `${f.name.trim()} is saved.` });
      navigate(activityPath(saved.activityId));
      return;
    }
    const activated = activateActivity(organization.id, saved.activityId);
    setBusy(null);
    if (!activated.ok) {
      setProblems(activated.problems ?? [activated.error]);
      toast({ tone: 'error', title: 'Saved, not activated', description: 'Resolve the listed items to activate it.' });
      if (isNew) navigate(`${activityPath(saved.activityId)}/edit?step=review`, { replace: true });
      return;
    }
    toast({ tone: 'success', title: live ? 'Changes saved and activated' : 'Activity created and activated', description: `${f.name.trim()} is ready for its assigned verifiers.` });
    navigate(activityPath(saved.activityId));
  };

  if (isNew ? !can('verification.activities.create') : !canDetails) return <NoAccess />;

  const next = () => {
    if (step === 'details') {
      if (!f.name.trim()) { setNameError('Enter an activity name.'); return; }
      if (location) { setLocationError(location); return; }
      goto('people');
    } else goto('review');
  };
  const groupNames = f.participants.groupIds.map((id) => org.groupById.get(id)?.name ?? 'Removed group');
  const userNames = f.participants.memberIds.map((id) => org.memberById.get(id)?.displayName ?? 'Removed user');

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        {activity ? <><Link to={activityPath(activity.id)} className="truncate hover:text-slate-800">{activity.name}</Link><ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-slate-700">Edit</span></>
          : <span className="text-slate-700">Create activity</span>}
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{activity ? `Edit ${activity.name}` : 'Create verification activity'}</h1>
      {live && (
        <p className="mt-3 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          This activity is {activity.status}. Changes apply as soon as you save. Earlier verifications and their history are kept as recorded.
        </p>
      )}

      <ol className="my-6 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button type="button" onClick={() => goto(s.id)} aria-current={s.id === step ? 'step' : undefined}
              className={cn('flex items-center gap-1.5', i === stepIndex ? 'font-semibold text-brand-700' : i < stepIndex ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700')}>
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs', i < stepIndex ? 'bg-brand-600 text-white' : i === stepIndex ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500' : 'bg-slate-100 text-slate-500')}>{i + 1}</span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <div className="px-6 py-6 sm:px-8">
          {step === 'details' && (
            <form onSubmit={(e) => { e.preventDefault(); next(); }} noValidate>
              <h2 className="text-lg font-semibold text-slate-900">Activity details</h2>
              <p className="mb-5 text-sm text-slate-500">What people are being verified for, such as event entry, site access or a membership check.</p>
              <fieldset disabled={!canDetails} className="grid max-w-2xl gap-5">
                <Field label="Activity Name" required error={nameError ?? undefined}>
                  {(p) => <Input {...p} autoFocus placeholder="Enter activity name" value={f.name} maxLength={100} onChange={(e) => { set('name', e.target.value); setNameError(null); }} />}
                </Field>
                <Field label="Description" hint="Optional">
                  {(p) => <Textarea {...p} rows={2} placeholder="Describe the purpose of this verification activity" value={f.description} onChange={(e) => set('description', e.target.value)} />}
                </Field>
              </fieldset>
              <div className="mt-6 max-w-2xl border-t border-slate-100 pt-5">
                <LocationCheckEditor value={f.location} readOnly={!canDetails} error={locationError}
                  onChange={(v) => { set('location', v); setLocationError(null); }} />
              </div>
            </form>
          )}

          {step === 'people' && (
            <div className="space-y-8">
              <section aria-labelledby="participants-heading" className="space-y-3">
                <div>
                  <h2 id="participants-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Users className="h-5 w-5 text-slate-400" aria-hidden="true" />Eligible Participants</h2>
                  <p className="text-sm text-slate-500">Select users or groups eligible for verification. Being on this list doesn’t prove who someone is.</p>
                </div>
                {usesParticipants ? (
                  <ParticipantsPicker value={f.participants} onChange={(p) => set('participants', p)} readOnly={!canDetails} />
                ) : config?.requirements?.eligibility === 'external' ? (
                  <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">Eligibility for this activity comes from an external eligibility source, which isn’t connected yet.</p>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
                    This activity doesn’t use a participant list: anyone whose identity is verified meets its conditions.
                    {canAddEligibility && canDetails && <button type="button" className="ml-2 font-semibold text-brand-600 hover:text-brand-700" onClick={() => set('addEligibility', true)}>Add eligible participants</button>}
                  </p>
                )}
              </section>
              <section aria-labelledby="verifiers-heading" className="space-y-3 border-t border-slate-100 pt-6">
                <div>
                  <h2 id="verifiers-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><UserCheck className="h-5 w-5 text-slate-400" aria-hidden="true" />Assigned Verifiers</h2>
                  <p className="text-sm text-slate-500">Select administrators who will perform verification. Only they can verify people for this activity.</p>
                </div>
                <VerifierPicker value={f.verifierIds} onChange={(v) => set('verifierIds', v)} readOnly={!canAssign} />
                {!canAssign && <p className="text-xs text-slate-500">Your role can’t assign verifiers.</p>}
                {canAssign && can('administrators.invite') && (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    Can’t find the right person?
                    <button type="button" onClick={inviteAdministrator} className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700">
                      <UserPlus className="h-4 w-4" aria-hidden="true" />Invite Administrator
                    </button>
                    <span className="text-xs text-slate-500">This draft is saved first, so you can come back to it.</span>
                  </p>
                )}
              </section>
            </div>
          )}

          {step === 'review' && (
            <section className="space-y-5" aria-labelledby="review">
              <div>
                <h2 id="review" className="text-lg font-semibold text-slate-900">Review & Activate</h2>
                <p className="text-sm text-slate-500">Check the activity. Use the steps above to change anything.</p>
              </div>
              <IssuesList blockers={problems ?? blockers} warnings={warnings}
                warningsTitle={warnings.length === 1 && warnings[0] === NO_VERIFIER_WARNING ? 'No verifier assigned' : undefined} />
              <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Activity Name</dt><dd className="font-medium text-slate-900">{f.name || '—'}</dd></div>
                <div><dt className="text-slate-500">Description</dt><dd className="text-slate-900">{f.description || '—'}</dd></div>
                <div>
                  <dt className="text-slate-500">Eligible participants</dt>
                  <dd className="text-slate-900">{usesParticipants ? (
                    <>
                      <span className="block">{eligibleCount} unique {eligibleCount === 1 ? 'person' : 'people'}</span>
                      {groupNames.length > 0 && <span className="block text-slate-600">Groups: {groupNames.join(', ')}</span>}
                      {userNames.length > 0 && <span className="block text-slate-600">Users: {userNames.length <= 5 ? userNames.join(', ') : `${userNames.slice(0, 5).join(', ')} and ${userNames.length - 5} more`}</span>}
                    </>
                  ) : config?.requirements?.eligibility === 'external' ? 'External eligibility source' : 'Anyone whose identity is verified'}</dd>
                </div>
                <div><dt className="text-slate-500">Assigned verifiers</dt><dd className="text-slate-900">{f.verifierIds.length ? f.verifierIds.map(adminName).join(', ') : 'None yet'}</dd></div>
                <div>
                  <dt className="text-slate-500">Location check</dt>
                  <dd className="text-slate-900">{f.location.enabled ? (
                    f.location.lat !== null && f.location.lng !== null && !location
                      ? <>On{f.location.label && <span className="block text-slate-600">{f.location.label}</span>}<span className="block text-slate-600">{formatCoordinate(f.location.lat)}, {formatCoordinate(f.location.lng)} · within {formatRadius(f.location.radiusM)}</span></>
                      : 'On, but no location selected'
                  ) : 'Off'}</dd>
                </div>
                <div><dt className="text-slate-500">How people are verified</dt><dd>
                  <ul className="list-disc pl-5 text-slate-900" aria-label="How people are verified">
                    {config ? describeRequirements(config, credName).map((l) => <li key={l}>{l}</li>) : <li>—</li>}
                  </ul>
                  <p className="mt-1 text-xs text-slate-500">Set by FixID. Officers record each entry decision separately.</p>
                </dd></div>
              </dl>
            </section>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">
          {stepIndex > 0 && <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => goto(STEPS[stepIndex - 1].id)}>Back</Button>}
          <span className="flex-1" />
          {autosave && <DraftStatusNote status={draft} onRetry={() => persistDraft(step)} activityId={draftId.current} />}
          <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>Save as Draft</Button>
          {step !== 'review'
            ? <Button icon={<ArrowRight className="h-4 w-4" />} onClick={next}>Continue</Button>
            : canActivate && (
              <Button icon={<ShieldCheck className="h-4 w-4" />} loading={busy === 'activate'} disabled={!!busy || blockers.length > 0} onClick={() => save(true)}>
                {live ? 'Save & Activate' : 'Create & Activate'}
              </Button>
            )}
        </div>
      </Card>
    </>
  );
}

/** Where the automatic draft save stands: saved, failed (with retry), or changed elsewhere. */
function DraftStatusNote({ status, onRetry, activityId }: { status: DraftStatus; onRetry: () => void; activityId?: string }) {
  if (status.kind === 'idle') return null;
  if (status.kind === 'saved') {
    return <p className="flex items-center gap-1 text-xs text-slate-500" role="status"><Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />Draft saved {formatDateTime(status.at)}</p>;
  }
  if (status.kind === 'conflict') {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-1.5 text-xs text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />This draft was changed elsewhere since you opened it, so your changes weren’t saved over it.
        {activityId && <Link to={activityPath(activityId)} className="font-semibold underline">Open the latest version</Link>}
      </p>
    );
  }
  return (
    <p role="alert" className="flex flex-wrap items-center gap-1.5 text-xs text-red-700">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Draft not saved: {status.message}
      <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>
    </p>
  );
}
