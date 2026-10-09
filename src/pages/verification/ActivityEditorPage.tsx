import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronRight, MapPin, Save, ShieldCheck } from 'lucide-react';
import { Button, Card, Field, Input, Textarea, useToast } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { ParticipantsPicker, useEligibleCount, type Participants } from '@/components/verification/ParticipantsPicker';
import { IssuesList } from '@/components/verification/parts';
import type { ActivityConfig, ActivityVersion } from '@/domain/types';
import {
  DEFAULT_OUTCOME, activeAssignments, buildChecks, currentVersion, describeRequirements, identityUnavailable, lookupOnlyIdentity, standardRequirementsFor,
  validateConfiguration,
} from '@/domain/verification';
import { cn } from '@/lib/cn';
import { nameProblem, validationContext, type ActivityForm } from '@/store/activityOps';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { NotFoundPage } from '../NotFoundPage';
import { activityPath } from './paths';
import { scheduleText } from './ActivityDetailsPage';

type Step = 'details' | 'participants' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'details', label: 'Activity Details' }, { id: 'participants', label: 'Eligible Participants' }, { id: 'review', label: 'Review' },
];

export function ActivityEditorPage() {
  const { activityId } = useParams();
  const { state } = useStore();
  const { organization } = useSession();
  const activity = activityId ? state.data.activityConfigs.find((a) => a.id === activityId && a.organizationId === organization.id) : undefined;
  if (activityId && !activity) return <NotFoundPage entity="verification activity" backTo="/verification-activities" />;
  return <Editor key={activity?.id ?? 'new'} activity={activity} />;
}

const toLocal = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : undefined);

interface FormState {
  name: string;
  purpose: string;
  location: string;
  startsAt: string;
  endsAt: string;
  enforced: boolean;
  participants: Participants;
  /** Only for an existing activity without a participant list whose administrator chooses to add one. */
  addEligibility: boolean;
}

/**
 * Create or edit an activity: what it is, and who is eligible. How people are verified is FixID's job:
 * new activities use the strongest identity method genuinely available to the organization, and
 * existing activities keep the verification configuration they were saved with.
 */
function Editor({ activity }: { activity?: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const org = useOrgData();
  const { can } = useAuthorization();
  const { saveActivity, activateActivity } = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isNew = !activity;
  const version = activity ? currentVersion(state.data, activity) : undefined;

  const [f, setF] = useState<FormState>(() => ({
    name: activity?.name ?? '', purpose: activity?.purpose || activity?.description || '', location: activity?.location ?? '',
    startsAt: toLocal(activity?.schedule?.startsAt), endsAt: toLocal(activity?.schedule?.endsAt), enforced: !!activity?.schedule?.enforced,
    participants: activity?.participants ?? { groupIds: [], memberIds: [] }, addEligibility: false,
  }));
  const [nameError, setNameError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'save' | 'activate' | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const eligibleCount = useEligibleCount(f.participants);

  const step: Step = (STEPS.some((s) => s.id === params.get('step')) ? params.get('step') : 'details') as Step;
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const goto = (s: Step) => setParams((p) => { const n = new URLSearchParams(p); n.set('step', s); return n; }, { replace: true });

  const canDetails = isNew ? can('verification.activities.create') : can('verification.activities.manage');
  const canActivate = can('verification.activities.manage');

  // The verification configuration: FixID's standard one for a new activity; an existing activity keeps its own.
  // Adding a participant list to an existing activity that has none changes only its eligibility requirement.
  const canAddEligibility = !isNew && !!version?.requirements && !version.customized && !version.requirements.eligibility;
  let k = 0;
  const make = (r: NonNullable<ActivityVersion['requirements']>, outcome: ActivityVersion['outcome']) => ({ requirements: r, ...buildChecks(r, organization, () => `new_${++k}`), outcome });
  const generated = isNew
    ? make(standardRequirementsFor(organization), DEFAULT_OUTCOME)
    : canAddEligibility && f.addEligibility ? make({ ...version!.requirements!, eligibility: 'participants' }, version!.outcome) : null;
  const config: Pick<ActivityVersion, 'type' | 'checks' | 'outcome' | 'requirements' | 'customized'> | undefined = generated ?? version;
  const usesParticipants = !!config?.checks.some((c) => c.params.useParticipants);

  const scheduleError = f.startsAt && f.endsAt && f.endsAt <= f.startsAt ? 'The end must be after the start.' : null;
  const name = nameProblem(state, organization.id, f.name, activity?.id);
  const validation = config ? validateConfiguration(config, validationContext(state, organization.id, f.participants)) : null;
  const identity = config ? identityUnavailable(config, organization) : null;
  const blockers = [...new Set([
    ...(name ? [name] : []),
    ...(scheduleError ? [scheduleError] : []),
    ...(identity ? [identity] : []),
    // The plain identity message replaces the technical provider messages it summarizes.
    ...(validation?.blockers ?? []).filter((b) => !identity || !/unavailable|not configured/i.test(b.message)).map((b) => b.message),
    ...(!config ? ['This activity has no verification configuration.'] : []),
  ])];
  const warnings = [...new Set([
    ...(validation?.warnings.map((w) => w.message) ?? []),
    ...(config && lookupOnlyIdentity(config) ? ['Identity is confirmed only by finding a record from an identifier, which doesn’t prove who is present.'] : []),
  ])];
  const live = activity && activity.status !== 'draft';
  const credName = (id: string) => org.credentialTypeById.get(id)?.name ?? '';

  const save = async (andActivate: boolean) => {
    const err = nameProblem(state, organization.id, f.name, activity?.id);
    if (err) { setNameError(err); goto('details'); return; }
    if (scheduleError) { goto('details'); return; }
    if (!config) return;
    setBusy(andActivate ? 'activate' : 'save');
    setProblems(null);
    await new Promise((r) => setTimeout(r, 200));
    const common = {
      name: f.name, description: f.purpose, purpose: f.purpose,
      location: f.location, schedule: f.startsAt || f.endsAt ? { startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), enforced: f.enforced } : undefined,
      participants: f.participants,
      verifierIds: activity ? activeAssignments(state.data, organization.id, activity.id).map((v) => v.administratorId) : [],
    };
    // Multiple-entry rules and verifier restrictions aren't edited here: existing values are kept (left undefined).
    const form: ActivityForm = generated
      ? { ...common, type: generated.type, checks: generated.checks, outcome: generated.outcome, requirements: generated.requirements, customized: false }
      : { ...common, type: config.type, checks: config.checks, outcome: config.outcome, keepConfiguration: true };
    const saved = saveActivity(organization.id, activity?.id, form);
    if (!saved.ok) {
      setBusy(null);
      if (saved.field === 'name') { setNameError(saved.error); goto('details'); return; }
      toast({ tone: 'error', title: 'Nothing was saved', description: saved.error });
      return;
    }
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
    toast({ tone: 'success', title: live ? 'Changes saved and activated' : 'Activity created and activated', description: `${f.name.trim()} is available to your organization’s verifiers.` });
    navigate(activityPath(saved.activityId));
  };

  if (isNew ? !can('verification.activities.create') : !canDetails) return <NoAccess />;

  const next = () => {
    if (step === 'details') {
      if (!f.name.trim()) { setNameError('Enter an activity name.'); return; }
      goto('participants');
    } else goto('review');
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        {activity ? <><Link to={activityPath(activity.id)} className="truncate hover:text-slate-800">{activity.name}</Link><ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-slate-700">Edit</span></>
          : <span className="text-slate-700">Create activity</span>}
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{activity ? `Edit ${activity.name}` : 'Create activity'}</h1>
      {live && (
        <p className="mt-3 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          This activity is {activity.status}. Details and participants change as soon as you save. Earlier verifications keep the configuration they used.
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
              <p className="mb-5 text-sm text-slate-500">What the activity is, and where and when it happens.</p>
              <fieldset disabled={!canDetails} className="grid max-w-2xl gap-5">
                <Field label="Activity name" required error={nameError ?? undefined} hint="e.g. Annual Staff Conference">
                  {(p) => <Input {...p} autoFocus value={f.name} maxLength={100} onChange={(e) => { set('name', e.target.value); setNameError(null); }} />}
                </Field>
                <Field label="Description / Purpose" hint="Why verification is needed, e.g. Verify the identity and eligibility of participants before granting entry.">
                  {(p) => <Textarea {...p} rows={2} value={f.purpose} onChange={(e) => set('purpose', e.target.value)} />}
                </Field>
                <Field label="Location" hint="Optional and for information only. It isn’t used to track anyone or restrict verification.">
                  {(p) => (
                    <div className="relative">
                      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <Input {...p} className="pl-9" value={f.location} placeholder="Venue name or address" onChange={(e) => set('location', e.target.value)} />
                    </div>
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Starts" hint="Optional">{(p) => <Input {...p} type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} />}</Field>
                  <Field label="Ends" hint="Optional" error={scheduleError ?? undefined}>{(p) => <Input {...p} type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} />}</Field>
                </div>
                {(f.startsAt || f.endsAt) && (
                  <label className="flex items-start gap-3 text-sm text-slate-700">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={f.enforced} onChange={(e) => set('enforced', e.target.checked)} />
                    <span>Only allow verification between these times<span className="block text-xs text-slate-500">Off: the schedule is information only, and the activity stays available until you deactivate it.</span></span>
                  </label>
                )}
              </fieldset>
            </form>
          )}

          {step === 'participants' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Eligible Participants</h2>
                <p className="text-sm text-slate-500">Choose who is eligible. FixID confirms each person’s identity first; being on this list doesn’t prove who someone is.</p>
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
            </div>
          )}

          {step === 'review' && (
            <section className="space-y-5" aria-labelledby="review">
              <div>
                <h2 id="review" className="text-lg font-semibold text-slate-900">Review</h2>
                <p className="text-sm text-slate-500">Check the activity before you save or activate it.</p>
              </div>
              <IssuesList blockers={problems ?? blockers} warnings={warnings} />
              <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Activity</dt><dd className="font-medium text-slate-900">{f.name || '—'}</dd></div>
                <div><dt className="text-slate-500">Purpose</dt><dd className="text-slate-900">{f.purpose || '—'}</dd></div>
                <div><dt className="text-slate-500">Location</dt><dd className="text-slate-900">{f.location || '—'}</dd></div>
                <div><dt className="text-slate-500">Schedule</dt><dd className="text-slate-900">{f.startsAt || f.endsAt
                  ? <>{scheduleText({ startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt) })}{f.enforced ? ' (verification only in this window)' : ' (information only)'}</> : 'No schedule'}</dd></div>
                <div><dt className="text-slate-500">Eligible participants</dt><dd className="text-slate-900">{usesParticipants
                  ? `${eligibleCount} ${eligibleCount === 1 ? 'person' : 'people'} (${f.participants.groupIds.length} ${f.participants.groupIds.length === 1 ? 'group' : 'groups'}, ${f.participants.memberIds.length} ${f.participants.memberIds.length === 1 ? 'user' : 'users'})`
                  : config?.requirements?.eligibility === 'external' ? 'External eligibility source' : 'Anyone whose identity is verified'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">How people are verified</dt><dd>
                  <ul className="mt-0.5 list-disc pl-5 text-slate-900" aria-label="How people are verified">
                    {config ? describeRequirements(config, credName).map((l) => <li key={l}>{l}</li>) : <li>—</li>}
                  </ul>
                  <p className="mt-1 text-xs text-slate-500">Set by FixID. A successful verification doesn’t record entry; an officer does that separately.</p>
                </dd></div>
              </dl>
            </section>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">
          {stepIndex > 0 && <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => goto(STEPS[stepIndex - 1].id)}>Back</Button>}
          <span className="flex-1" />
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
