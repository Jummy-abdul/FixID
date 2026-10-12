import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Lock, Save, ShieldCheck, UserCheck, UserPlus, Users } from 'lucide-react';
import { Button, Card, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { LocationCheckEditor, type LocationDraft } from '@/components/verification/LocationCheckEditor';
import { ParticipantsPicker, useEligibleCount, type Participants } from '@/components/verification/ParticipantsPicker';
import { IssuesList, VerifierPicker } from '@/components/verification/parts';
import { RequirementsStep } from '@/components/verification/RequirementsStep';
import { ActivitySettingsSummary } from '@/components/verification/RequirementsSummary';
import { formatCoordinate, formatRadius, locationConfigProblem, type LocationCheckConfig } from '@/domain/location';
import type { ActivityConfig, ActivityVersion } from '@/domain/types';
import {
  ELIGIBILITY_DESCRIPTION, ELIGIBILITY_LABEL, defaultSettings, effectiveSettings, type EligibilityApproach, type VerificationSettings,
} from '@/domain/programmes';
import {
  activeAssignments, currentVersion, describeRequirements, eligibleVerifiers, identityUnavailable, validateConfiguration,
} from '@/domain/verification';
import { cn } from '@/lib/cn';
import { NO_VERIFIER_WARNING, nameProblem, validationContext, type ActivityForm } from '@/store/activityOps';
import { integrationsOf } from '@/store/integrationOps';
import { accessibleIntegration, activityPolicyProblems, configFromSettings, linkableProgrammes, settingsEditable, settingsFromVersion } from '@/store/programmeOps';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { saveState } from '@/store/persistence';
import { formatDateTime } from '@/lib/dates';
import { NotFoundPage } from '../NotFoundPage';
import { activityPath } from './paths';

type Step = 'details' | 'requirements' | 'people' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'details', label: 'Activity Details' }, { id: 'requirements', label: 'Identity & Requirements' },
  { id: 'people', label: 'Eligibility & Verifiers' }, { id: 'review', label: 'Review & Activate' },
];
const APPROACHES: EligibilityApproach[] = ['local-population', 'external-source', 'reference-list', 'none'];
/** Datetime-local value <-> ISO. */
const toLocal = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : undefined);
const parseReferences = (text: string) => [...new Set(text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];


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
  /** New activities only: the programme it runs under, if any. */
  programmeId: string;
  /** The activity's own verification settings (stricter than or equal to its programme's). */
  settings: VerificationSettings;
  referenceText: string;
  startsAt: string;
  endsAt: string;
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
 * Create or edit a verification activity: details (optional programme, schedule and location check), identity
 * source and requirements, eligibility and verifiers, then review. A programme-linked activity inherits the
 * programme's mandatory requirements and can only make them stricter. Credential-based or customized
 * configurations from earlier versions are kept as they are and shown read-only.
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
  const editable = settingsEditable(version);

  const [f, setF] = useState<FormState>(() => ({
    name: activity?.name ?? '', description: activity?.description || activity?.purpose || '',
    location: toDraft(activity?.locationCheck),
    participants: activity?.participants ?? { groupIds: [], memberIds: [] },
    // A new activity starts with the administrator creating it as its verifier, when they can verify.
    verifierIds: activity ? activeAssignments(state.data, organization.id, activity.id).map((v) => v.administratorId)
      : record && eligibleVerifiers(state.data, organization.id).some((a) => a.id === record.id) ? [record.id] : [],
    programmeId: activity?.programmeId ?? (linkableProgrammes(state, organization.id).some((p) => p.id === params.get('programme')) ? params.get('programme')! : ''),
    settings: (() => {
      const own = activity?.verification ?? (activity ? settingsFromVersion(version) : defaultSettings());
      const pid = activity?.programmeId ?? params.get('programme');
      const programme = pid ? (state.data.verificationProgrammes ?? []).find((p) => p.id === pid) : undefined;
      return effectiveSettings(own, programme?.requirements);
    })(),
    referenceText: (activity?.verification?.eligibility.referenceList ?? []).join('\n'),
    startsAt: toLocal(activity?.schedule?.startsAt), endsAt: toLocal(activity?.schedule?.endsAt),
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

  // The programme (new activities choose one; existing ones keep theirs) and the settings that apply.
  const programmeOf = (x: FormState) => { const id = activity ? activity.programmeId : x.programmeId || undefined; return { id, p: id ? (state.data.verificationProgrammes ?? []).find((p) => p.id === id) : undefined }; };
  const { id: programmeId, p: programme } = programmeOf(f);
  const linkable = isNew ? linkableProgrammes(state, organization.id) : [];
  // Everything saved is derived from a form state, so the save on leaving the page uses the latest one.
  const derive = (x: FormState) => {
    const { id: pid, p: programme } = programmeOf(x);
    const own: VerificationSettings = x.settings.eligibility.approach === 'reference-list'
      ? { ...x.settings, eligibility: { approach: 'reference-list', referenceList: parseReferences(x.referenceText) } } : { ...x.settings, eligibility: { approach: x.settings.eligibility.approach } };
    const eff = effectiveSettings(own, programme?.requirements);
    // The configuration follows the settings for a new activity or when they change; otherwise it's kept.
    const changed = editable && (isNew || JSON.stringify(own) !== JSON.stringify(activity?.verification ?? settingsFromVersion(version)));
    let n = 0;
    const identifierConfigId = version?.checks.find((c) => c.params.identifierConfigId)?.params.identifierConfigId;
    const gen = changed ? configFromSettings(eff, organization, () => `new_${++n}`, identifierConfigId) : null;
    // Untouched times keep their stored value exactly (the inputs only show minutes).
    const time = (v: string, stored?: string) => (v && v === toLocal(stored) ? stored : fromLocal(v));
    const startsAt = time(x.startsAt, activity?.schedule?.startsAt);
    const endsAt = time(x.endsAt, activity?.schedule?.endsAt);
    const sched = { ...(activity?.schedule?.enforced !== undefined ? { enforced: activity.schedule.enforced } : {}), ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}) };
    return { own, eff, gen, sched, pid };
  };
  const { own: settings, eff: effective, gen: generated } = derive(f);
  const ownIntegrations = integrationsOf(state, organization.id);
  const src = effective.identitySource;
  const integration = src.kind === 'external' ? accessibleIntegration(state, organization.id, src.integrationId, programme) : undefined;
  const integrationOwner = integration && integration.organizationId !== organization.id ? state.data.organizations.find((o) => o.id === integration.organizationId)?.name : undefined;
  const allowedApproaches = APPROACHES.filter((a) => (programme ? programme.requirements.allowedEligibility.includes(a) && !(programme.requirements.eligibilityRequired && a === 'none')
    : effective.identitySource.kind === 'external' || (a !== 'external-source' && a !== 'reference-list')));

  const config: Pick<ActivityVersion, 'type' | 'checks' | 'outcome' | 'requirements' | 'customized'> | undefined = generated ?? version;
  const usesParticipants = !!config?.checks.some((c) => c.params.useParticipants);
  const policyProblems = editable ? activityPolicyProblems(state, organization.id, programmeId, settings) : [];
  const scheduleProblem = f.startsAt && f.endsAt && f.endsAt <= f.startsAt ? 'The schedule must end after it starts.' : null;

  const name = nameProblem(state, organization.id, f.name, activity?.id);
  const location = locationConfigProblem(toConfig(f.location));
  const validation = config ? validateConfiguration(config, validationContext(state, organization.id, f.participants)) : null;
  const identity = config ? identityUnavailable(config, organization) : null;
  const blockers = [...new Set([
    ...(name ? [name] : []),
    ...(location ? [location] : []),
    ...(scheduleProblem ? [scheduleProblem] : []),
    ...policyProblems,
    // An external identity source isn't checked against local providers.
    ...(identity && src.kind === 'local' ? [identity] : []),
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
    const d = derive(x);
    const cfg = d.gen ?? version;
    if (!cfg) return null;
    const common = {
      name: x.name, description: x.description, purpose: x.description,
      locationCheck: toConfig(x.location), participants: x.participants, verifierIds: x.verifierIds, ...(editorStep ? { editorStep } : {}),
      schedule: d.sched, ...(isNew && d.pid ? { programmeId: d.pid } : {}), ...(editable ? { verification: d.own } : {}),
    };
    // Multiple-entry rules and other earlier settings aren't edited here: existing values are kept (left undefined).
    return d.gen
      ? { ...common, type: d.gen.type, checks: d.gen.checks, outcome: d.gen.outcome, requirements: d.gen.requirements, customized: false }
      : { ...common, type: cfg.type, checks: cfg.checks, outcome: cfg.outcome, keepConfiguration: true };
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
      if (scheduleProblem) return;
      goto('requirements');
    } else goto(step === 'requirements' ? 'people' : 'review');
  };
  const groupNames = f.participants.groupIds.map((id) => org.groupById.get(id)?.name ?? 'Removed group');
  const userNames = f.participants.memberIds.map((id) => org.memberById.get(id)?.displayName ?? 'Removed user');
  const chooseProgramme = (id: string) => {
    const p = linkable.find((x) => x.id === id);
    // Leaving a programme drops its (possibly another organization's) identity source.
    setF((x) => ({ ...x, programmeId: id, settings: p ? effectiveSettings(x.settings, p.requirements) : defaultSettings() }));
  };
  const setApproach = (a: EligibilityApproach) => set('settings', { ...f.settings, eligibility: { approach: a } });

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
                {isNew ? (
                  <Field label="Verification Programme" hint="Optional. Programme-linked activities inherit its mandatory requirements.">
                    {(p) => (
                      <Select {...p} value={f.programmeId} onChange={(e) => chooseProgramme(e.target.value)}>
                        <option value="">None — independent activity</option>
                        {linkable.map((x) => <option key={x.id} value={x.id}>{x.name}{x.ownerOrganizationId !== organization.id ? ` (${state.data.organizations.find((o) => o.id === x.ownerOrganizationId)?.name ?? ''})` : ''}</option>)}
                      </Select>
                    )}
                  </Field>
                ) : (
                  <div className="text-sm">
                    <p className="font-medium text-slate-700">Verification Programme</p>
                    <p className="mt-1 flex items-center gap-1.5 text-slate-600">{programme ? <><Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />{programme.name}</> : 'None — independent activity'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">An activity’s programme is set when it’s created.</p>
                  </div>
                )}
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Starts" hint="Optional">
                    {(p) => <Input {...p} type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} />}
                  </Field>
                  <Field label="Ends" hint="Optional" error={scheduleProblem ?? undefined}>
                    {(p) => <Input {...p} type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} />}
                  </Field>
                </div>
              </fieldset>
              <div className="mt-6 max-w-2xl border-t border-slate-100 pt-5">
                <LocationCheckEditor value={f.location} readOnly={!canDetails} error={locationError}
                  onChange={(v) => { set('location', v); setLocationError(null); }} />
              </div>
            </form>
          )}

          {step === 'requirements' && (
            <div className="max-w-3xl space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Identity & Requirements</h2>
                <p className="text-sm text-slate-500">{programme ? `Settings marked with a lock come from ${programme.name}. You can make the others stricter, not weaker.` : 'Where identities come from and how strictly they’re verified.'}</p>
              </div>
              {editable ? (
                <RequirementsStep value={effective} onChange={(v) => set('settings', v)} programme={programme} integrations={ownIntegrations}
                  programmeIntegration={programme ? integration : undefined} ownerName={integrationOwner} readOnly={!canDetails} />
              ) : (
                <div className="space-y-3">
                  <p className="flex gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />This activity uses a credential-based or customized configuration from an earlier version. It’s kept as it is and can’t be changed here.</p>
                  <ul className="list-disc pl-5 text-sm text-slate-900" aria-label="How people are verified">
                    {config ? describeRequirements(config, credName).map((l) => <li key={l}>{l}</li>) : <li>—</li>}
                  </ul>
                </div>
              )}
              {editable && policyProblems.length > 0 && <IssuesList blockers={policyProblems} warnings={[]} />}
            </div>
          )}

          {step === 'people' && (
            <div className="space-y-8">
              <section aria-labelledby="participants-heading" className="space-y-3">
                <div>
                  <h2 id="participants-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Users className="h-5 w-5 text-slate-400" aria-hidden="true" />Eligible Participants</h2>
                  <p className="text-sm text-slate-500">{usesParticipants ? 'Select users or groups eligible for verification.' : 'How FixID decides who is eligible.'} Eligibility never proves who someone is, and a verified identity never makes someone eligible.</p>
                </div>
                {editable && (
                  <fieldset disabled={!canDetails} className="grid gap-2 sm:grid-cols-2" aria-label="Eligibility approach">
                    {allowedApproaches.map((a) => (
                      <label key={a} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', effective.eligibility.approach === a ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                        <input type="radio" name="eligibility-approach" className="mt-0.5 h-4 w-4" checked={effective.eligibility.approach === a} onChange={() => setApproach(a)} />
                        <span><span className="block text-sm font-semibold text-slate-900">{ELIGIBILITY_LABEL[a]}</span><span className="block text-sm text-slate-500">{ELIGIBILITY_DESCRIPTION[a]}</span></span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {programme && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3 w-3" aria-hidden="true" />{programme.name} allows: {programme.requirements.allowedEligibility.map((a) => ELIGIBILITY_LABEL[a]).join(', ')}{programme.requirements.eligibilityRequired ? '. Eligibility is required.' : '.'}</p>}
                {usesParticipants ? (
                  <ParticipantsPicker value={f.participants} onChange={(p) => set('participants', p)} readOnly={!canDetails} />
                ) : editable && effective.eligibility.approach === 'reference-list' ? (
                  <Field label="Permitted external references" hint="One per line. Letters, numbers and hyphens, 2–40 characters. Use fictional references only.">
                    {(p) => <Textarea {...p} rows={5} disabled={!canDetails} value={f.referenceText} onChange={(e) => set('referenceText', e.target.value)} placeholder={'REF-1001\nREF-1002'} />}
                  </Field>
                ) : editable && effective.eligibility.approach === 'external-source' ? (
                  <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">Eligibility comes from the authorized lookup response of {integration?.name ?? 'the external identity service'}. Nobody is copied into FixID.</p>
                ) : config?.requirements?.eligibility === 'external' ? (
                  <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">Eligibility for this activity comes from an external eligibility source, which isn’t connected yet.</p>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">This activity doesn’t use a participant list: anyone whose identity is verified meets its conditions.</p>
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
                <div><dt className="text-slate-500">Verification programme</dt><dd className="text-slate-900">{programme ? programme.name : 'None — independent activity'}</dd></div>
                <div><dt className="text-slate-500">Schedule</dt><dd className="text-slate-900">{f.startsAt || f.endsAt ? `${f.startsAt ? formatDateTime(fromLocal(f.startsAt)!) : 'Open'} – ${f.endsAt ? formatDateTime(fromLocal(f.endsAt)!) : 'Open'}` : 'No schedule'}</dd></div>
                <div>
                  <dt className="text-slate-500">Eligible participants</dt>
                  <dd className="text-slate-900">{usesParticipants ? (
                    <>
                      <span className="block">{eligibleCount} unique {eligibleCount === 1 ? 'person' : 'people'}</span>
                      {groupNames.length > 0 && <span className="block text-slate-600">Groups: {groupNames.join(', ')}</span>}
                      {userNames.length > 0 && <span className="block text-slate-600">Users: {userNames.length <= 5 ? userNames.join(', ') : `${userNames.slice(0, 5).join(', ')} and ${userNames.length - 5} more`}</span>}
                    </>
                  ) : editable ? ELIGIBILITY_LABEL[effective.eligibility.approach] + (effective.eligibility.approach === 'reference-list' ? ` (${settings.eligibility.referenceList?.length ?? 0} references)` : '')
                    : config?.requirements?.eligibility === 'external' ? 'External eligibility source' : 'Anyone whose identity is verified'}</dd>
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
              {editable && (
                <div className="border-t border-slate-100 pt-5">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Verification settings</h3>
                  <ActivitySettingsSummary settings={effective} inherited={!!programme} integration={integration} ownerName={integrationOwner} />
                </div>
              )}
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
