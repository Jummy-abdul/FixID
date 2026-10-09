import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronRight, Fingerprint, IdCard, Layers, Save, ShieldCheck } from 'lucide-react';
import { Button, Card, Field, Input, Textarea, useToast } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { CheckConfigurator } from '@/components/verification/CheckConfigurator';
import { ChecksSummary, IssuesList, RulesList, VerifierPicker, typeName } from '@/components/verification/parts';
import type { ActivityConfig, OutcomePolicy, VerificationType } from '@/domain/types';
import {
  DEFAULT_OUTCOME, OUTCOME_LABEL, PLATFORM_POLICIES, TYPE_INFO, activeAssignments, currentVersion, eligibleVerifiers, providersFor,
  validateConfiguration, withPlatformPolicies,
} from '@/domain/verification';
import { cn } from '@/lib/cn';
import { nameProblem, validationContext, type ActivityForm } from '@/store/activityOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { NotFoundPage } from '../NotFoundPage';
import { activityPath } from './paths';

type Step = 'details' | 'type' | 'checks' | 'outcomes' | 'verifiers' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'details', label: 'Activity Details' }, { id: 'type', label: 'Verification Type' }, { id: 'checks', label: 'Checks & Rules' },
  { id: 'outcomes', label: 'Outcomes' }, { id: 'verifiers', label: 'Assign Verifiers' }, { id: 'review', label: 'Review & Activate' },
];

/** Create a verification activity, or edit one (rules changes to an active activity become a new draft version). */
export function ActivityEditorPage() {
  const { activityId } = useParams();
  const { state } = useStore();
  const { organization } = useSession();
  const activity = activityId ? state.data.activityConfigs.find((a) => a.id === activityId && a.organizationId === organization.id) : undefined;
  if (activityId && !activity) return <NotFoundPage entity="verification activity" backTo="/verification-activities" />;
  return <Editor key={activity?.id ?? 'new'} activity={activity} />;
}

function Editor({ activity }: { activity?: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const { saveActivity, activateActivity } = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isNew = !activity;
  const version = activity ? currentVersion(state.data, activity) : undefined;
  const activeVersion = activity?.activeVersionId ? state.data.activityVersions.find((v) => v.id === activity.activeVersionId) : undefined;

  const [form, setForm] = useState<ActivityForm>(() => ({
    name: activity?.name ?? '', description: activity?.description ?? '', purpose: activity?.purpose ?? '',
    type: version?.type ?? 'identity', checks: version?.checks ?? [], outcome: version?.outcome ?? DEFAULT_OUTCOME,
    verifierIds: activity ? activeAssignments(state.data, organization.id, activity.id).map((v) => v.administratorId) : [],
  }));
  const [nameError, setNameError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'save' | 'activate' | null>(null);
  const [typeNotice, setTypeNotice] = useState<string | null>(null);

  const step: Step = (STEPS.some((s) => s.id === params.get('step')) ? params.get('step') : 'details') as Step;
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const goto = (s: Step) => setParams((p) => { const n = new URLSearchParams(p); n.set('step', s); return n; }, { replace: true });

  const canDetails = isNew ? can('verification.activities.create') : can('verification.activities.manage');
  const canRules = can('verification.rules.manage');
  const canVerifiers = can('verification.verifiers.assign');
  const canActivate = can('verification.activities.manage');
  const ctx = validationContext(state, organization.id);
  const validation = validateConfiguration(form, ctx);
  const eligible = new Set(eligibleVerifiers(state.data, organization.id).map((a) => a.id));
  const blockers = [
    ...(nameProblem(state, organization.id, form.name, activity?.id) ? [nameProblem(state, organization.id, form.name, activity?.id)!] : []),
    ...validation.blockers.map((b) => b.message),
    ...(form.verifierIds.some((id) => eligible.has(id)) ? [] : ['Assign at least one verifier with the Verifier role.']),
  ];
  const uniqueBlockers = [...new Set(blockers)];
  const set = <K extends keyof ActivityForm>(k: K, v: ActivityForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const live = activity && activity.status !== 'draft';

  const chooseType = (t: VerificationType) => {
    let n = 0;
    const next = withPlatformPolicies(form.checks, t, organization, () => `chk_${Date.now().toString(36)}_${++n}`);
    const dropped = form.checks.filter((c) => !next.some((x) => x.type === c.type)).length;
    setTypeNotice(dropped ? `${dropped} check${dropped === 1 ? '' : 's'} that don’t apply to ${TYPE_INFO[t].name} verification were removed.` : null);
    setForm((f) => ({ ...f, type: t, checks: next }));
  };

  const save = async (andActivate: boolean) => {
    const err = nameProblem(state, organization.id, form.name, activity?.id);
    if (err) { setNameError(err); goto('details'); return; }
    setBusy(andActivate ? 'activate' : 'save');
    setProblems(null);
    await new Promise((r) => setTimeout(r, 250));
    const saved = saveActivity(organization.id, activity?.id, form);
    if (!saved.ok) {
      setBusy(null);
      if (saved.field === 'name') { setNameError(saved.error); goto('details'); return; }
      toast({ tone: 'error', title: 'Nothing was saved', description: saved.error });
      return;
    }
    if (!andActivate) {
      setBusy(null);
      toast({ tone: 'success', title: 'Saved as draft', description: live ? 'Your changes are saved as a draft version. The active version stays in use until you activate them.' : `${form.name.trim()} is saved. You can come back to it anytime.` });
      navigate(activityPath(saved.activityId));
      return;
    }
    const activated = activateActivity(organization.id, saved.activityId);
    setBusy(null);
    if (!activated.ok) {
      setProblems(activated.problems ?? [activated.error]);
      toast({ tone: 'error', title: 'Saved as draft, not activated', description: 'Resolve the items listed to activate it.' });
      if (isNew) navigate(`${activityPath(saved.activityId)}/edit?step=review`, { replace: true });
      return;
    }
    toast({ tone: 'success', title: live ? 'Changes activated' : 'Activity activated', description: `${form.name.trim()} is active. Assigned verifiers can use it now.` });
    navigate(activityPath(saved.activityId));
  };

  const header = (
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
          This activity is {activity.status}. Changes to checks or rules are saved as a new draft version; version {activeVersion?.number} stays in use until you activate them.
          Earlier verifications always keep the version they used.
        </p>
      )}
    </>
  );

  if (isNew ? !can('verification.activities.create') : !(canDetails || canRules || canVerifiers)) return <NoAccess />;

  return (
    <>
      {header}
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
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); goto('type'); }} noValidate>
              <h2 className="text-lg font-semibold text-slate-900">Activity details</h2>
              <p className="mb-5 text-sm text-slate-500">Name the activity and explain why verification is performed.</p>
              <fieldset disabled={!canDetails} className="grid max-w-2xl gap-5">
                <Field label="Activity name" required error={nameError ?? undefined} hint="Clear and descriptive, e.g. Visitor Identity Check. Unique in your organization.">
                  {(p) => <Input {...p} autoFocus value={form.name} maxLength={100} onChange={(e) => { set('name', e.target.value); setNameError(null); }} />}
                </Field>
                <Field label="Description" hint="Optional. What happens in this activity.">
                  {(p) => <Textarea {...p} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />}
                </Field>
                <Field label="Purpose" hint="Why verification is performed, in your own words. e.g. Confirm a visitor’s identity before granting entry.">
                  {(p) => <Textarea {...p} rows={2} value={form.purpose} onChange={(e) => set('purpose', e.target.value)} />}
                </Field>
              </fieldset>
              {!canDetails && <p className="mt-4 text-sm text-slate-500">You can’t change activity details with your role.</p>}
            </form>
          )}

          {step === 'type' && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">What do you want to verify?</h2>
              <p className="mb-5 text-sm text-slate-500">This decides which checks are available in the next step.</p>
              <div role="radiogroup" aria-label="Verification type" className="grid gap-3 md:grid-cols-3">
                {(['identity', 'credential', 'identity-credential'] as const).map((t) => {
                  const Icon = t === 'identity' ? Fingerprint : t === 'credential' ? IdCard : ShieldCheck;
                  return (
                    <button key={t} type="button" role="radio" aria-checked={form.type === t} disabled={!canRules} onClick={() => chooseType(t)}
                      className={cn('rounded-xl border p-5 text-left transition-colors disabled:cursor-not-allowed',
                        form.type === t ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                      <Icon className="h-5 w-5 text-brand-600" aria-hidden="true" />
                      <span className="mt-3 block font-semibold text-slate-900">{TYPE_INFO[t].name}</span>
                      <span className="mt-1 block text-sm text-slate-500">{TYPE_INFO[t].description}</span>
                    </button>
                  );
                })}
              </div>
              {typeNotice && <p role="status" className="mt-4 text-sm text-amber-800">{typeNotice}</p>}
              {form.type !== 'identity' && <p className="mt-4 text-sm text-slate-500">Credential authenticity is added and required automatically (platform policy).</p>}
            </div>
          )}

          {step === 'checks' && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Verification checks & rules</h2>
              <p className="mb-5 text-sm text-slate-500">Add the checks this activity needs, mark each as required or optional, and choose who runs it. Checks whose service isn’t configured can be added to a draft, but the activity can’t be activated until it’s available.</p>
              {!canRules && <p className="mb-4 text-sm text-slate-500">You can view the checks but not change them with your role.</p>}
              <CheckConfigurator type={form.type} checks={form.checks} onChange={(c) => set('checks', c)} issues={[...validation.blockers, ...validation.warnings]} readOnly={!canRules} />
            </div>
          )}

          {step === 'outcomes' && <OutcomeStep outcome={form.outcome} onChange={(o) => set('outcome', o)} readOnly={!canRules} checks={form} />}

          {step === 'verifiers' && (
            <div className="max-w-2xl">
              <h2 className="text-lg font-semibold text-slate-900">Assign verifiers</h2>
              <p className="mb-5 text-sm text-slate-500">Assigned verifiers can perform this activity through an authorized verifier application. Assignment doesn’t let them change the activity or give them any other access.</p>
              {!canVerifiers && <p className="mb-4 text-sm text-slate-500">You can’t change verifier assignments with your role.</p>}
              <VerifierPicker value={form.verifierIds} onChange={(v) => set('verifierIds', v)} readOnly={!canVerifiers} />
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-7">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Review</h2>
                <p className="text-sm text-slate-500">Check the configuration. Nothing changes for verifiers until you activate.</p>
              </div>
              <IssuesList blockers={problems ?? uniqueBlockers} warnings={validation.warnings.map((w) => w.message)} />
              <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Activity name</dt><dd className="mt-0.5 font-medium text-slate-900">{form.name || '—'}</dd></div>
                <div><dt className="text-slate-500">Verification type</dt><dd className="mt-0.5 font-medium text-slate-900">{typeName(form.type)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">Description</dt><dd className="mt-0.5 text-slate-900">{form.description || '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">Purpose</dt><dd className="mt-0.5 text-slate-900">{form.purpose || '—'}</dd></div>
                <div><dt className="text-slate-500">Checks</dt><dd className="mt-0.5 text-slate-900">
                  {form.checks.filter((c) => c.requirement === 'required').length} required · {form.checks.filter((c) => c.requirement === 'optional').length} optional · {form.checks.filter((c) => c.requirement === 'alternative').length} alternatives
                </dd></div>
                <div><dt className="text-slate-500">Assigned verifiers</dt><dd className="mt-0.5 text-slate-900">{form.verifierIds.map((id) => state.data.administrators.find((a) => a.id === id)?.name ?? '—').join(', ') || 'None'}</dd></div>
              </dl>
              <section><h3 className="mb-3 text-sm font-semibold text-slate-900">Checks, providers and sources</h3><ChecksSummary version={form} issues={validation.blockers} /></section>
              <section><h3 className="mb-3 text-sm font-semibold text-slate-900">Outcome rules</h3><RulesList version={form} /></section>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">
          {stepIndex > 0 && <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => goto(STEPS[stepIndex - 1].id)}>Back</Button>}
          <span className="flex-1" />
          <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>
            {live ? 'Save as draft version' : 'Save as Draft'}
          </Button>
          {step !== 'review'
            ? <Button icon={<ArrowRight className="h-4 w-4" />} onClick={() => goto(STEPS[stepIndex + 1].id)}>Continue</Button>
            : canActivate && (
              <Button icon={<ShieldCheck className="h-4 w-4" />} loading={busy === 'activate'} disabled={!!busy || uniqueBlockers.length > 0} onClick={() => save(true)}>
                {live ? 'Activate changes' : 'Activate Activity'}
              </Button>
            )}
        </div>
      </Card>
      {providersFor(organization).some((p) => p.status !== 'available') && step === 'checks' && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500"><Layers className="h-3.5 w-3.5" aria-hidden="true" />Provider availability comes from Settings → Integrations. No external verification service is connected in this prototype.</p>
      )}
    </>
  );
}

function OutcomeStep({ outcome, onChange, readOnly, checks }: { outcome: OutcomePolicy; onChange: (o: OutcomePolicy) => void; readOnly: boolean; checks: Pick<ActivityForm, 'checks' | 'outcome'> }) {
  const option = (key: keyof OutcomePolicy, value: OutcomePolicy[keyof OutcomePolicy], label: string, hint: string) => (
    <button type="button" role="radio" aria-checked={outcome[key] === value} disabled={readOnly} onClick={() => onChange({ ...outcome, [key]: value })}
      className={cn('rounded-xl border p-4 text-left disabled:cursor-not-allowed', outcome[key] === value ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
      <span className="block text-sm font-semibold text-slate-900">{label}</span>
      <span className="mt-0.5 block text-sm text-slate-500">{hint}</span>
    </button>
  );
  return (
    <div className="space-y-7">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Verification outcomes</h2>
        <p className="text-sm text-slate-500">Every verification ends as Verified, Not Verified, Unable to Verify or Pending Review. Choose what happens when things don’t go to plan.</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['verified', 'All required conditions are satisfied.'],
          ['not-verified', 'One or more required conditions failed.'],
          ['unable-to-verify', 'Couldn’t be completed reliably: missing data, a service unavailable, or not enough evidence.'],
          ['pending-review', 'Referred to an authorized reviewer.'],
        ].map(([k, d]) => <div key={k} className="rounded-xl border border-slate-200 px-4 py-3"><dt className="font-semibold text-slate-900">{OUTCOME_LABEL[k]}</dt><dd className="mt-0.5 text-slate-500">{d}</dd></div>)}
      </dl>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">When a required check fails</legend>
        <div role="radiogroup" aria-label="When a required check fails" className="grid gap-3 sm:grid-cols-2">
          {option('onRequiredFailure', 'not-verified', 'Not Verified', 'The verification fails.')}
          {option('onRequiredFailure', 'pending-review', 'Refer for review', 'Pending Review. A reviewer decides; the original failed result is kept.')}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">When a required check can’t be completed</legend>
        <div role="radiogroup" aria-label="When a required check can’t be completed" className="grid gap-3 sm:grid-cols-2">
          {option('onInconclusive', 'unable-to-verify', 'Unable to Verify', 'The verifier is told it couldn’t be completed.')}
          {option('onInconclusive', 'pending-review', 'Refer for review', 'Pending Review, with the reason recorded.')}
        </div>
      </fieldset>
      <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
        A failed or inconclusive required check can never be turned into Verified. Reviews will be handled in a later release; this records the intended policy, and a reviewer’s decision will be kept separately from the original result.
      </p>
      <section><h3 className="mb-2 text-sm font-semibold text-slate-900">How this activity decides</h3><RulesList version={checks} /></section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Platform policies</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">{PLATFORM_POLICIES.map((p) => <li key={p.id}>{p.text}</li>)}</ul>
      </section>
    </div>
  );
}
