import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, MapPin, Save, ShieldCheck, Wrench } from 'lucide-react';
import { Badge, Button, Card, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { CheckConfigurator } from '@/components/verification/CheckConfigurator';
import { ParticipantsPicker, useEligibleCount, type Participants } from '@/components/verification/ParticipantsPicker';
import { IssuesList, ProviderStatusBadge, VerifierPicker } from '@/components/verification/parts';
import type { ActivityCheck, ActivityConfig, OutcomePolicy, StandardRequirements } from '@/domain/types';
import {
  DEFAULT_OUTCOME, IDENTITY_METHODS, OUTCOME_LABEL, activeAssignments, buildChecks, currentVersion, describeRequirements, eligibleVerifiers, providersFor,
  validateConfiguration, withPlatformPolicies,
} from '@/domain/verification';
import { cn } from '@/lib/cn';
import { nameProblem, validationContext } from '@/store/activityOps';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { NotFoundPage } from '../NotFoundPage';
import { activityPath } from './paths';

type Step = 'details' | 'requirements' | 'participants';
const STEPS: { id: Step; label: string }[] = [
  { id: 'details', label: 'Activity Details' }, { id: 'requirements', label: 'Verification Requirements' }, { id: 'participants', label: 'Eligible Participants' },
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
  requirements: StandardRequirements;
  customized: boolean;
  checks: ActivityCheck[];
  outcome: OutcomePolicy;
  participants: Participants;
  entryPolicy: NonNullable<ActivityConfig['entryPolicy']>;
  restrictVerifiers: boolean;
  verifierIds: string[];
}

/** Create or edit an activity in three steps. Advanced configuration stays available but out of the way. */
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
  const activeVersion = activity?.activeVersionId ? state.data.activityVersions.find((v) => v.id === activity.activeVersionId) : undefined;
  const providers = providersFor(organization);
  const available = (ids: string[]) => ids.every((id) => providers.find((p) => p.id === id)?.status === 'available');
  const defaultIdentity = available(['identity-service', 'facial-matching']) ? 'face' : 'record';

  const [f, setF] = useState<FormState>(() => ({
    name: activity?.name ?? '', purpose: activity?.purpose || activity?.description || '', location: activity?.location ?? '',
    startsAt: toLocal(activity?.schedule?.startsAt), endsAt: toLocal(activity?.schedule?.endsAt), enforced: !!activity?.schedule?.enforced,
    requirements: version?.requirements ?? { identity: defaultIdentity, credential: null, eligibility: 'participants' },
    customized: version ? (!version.requirements || !!version.customized) : false,
    checks: version?.checks ?? [], outcome: version?.outcome ?? DEFAULT_OUTCOME,
    participants: activity?.participants ?? { groupIds: [], memberIds: [] }, entryPolicy: activity?.entryPolicy ?? 'off',
    restrictVerifiers: !!activity?.restrictVerifiers,
    verifierIds: activity ? activeAssignments(state.data, organization.id, activity.id).map((v) => v.administratorId) : [],
  }));
  const [nameError, setNameError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'save' | 'activate' | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const setReq = (patch: Partial<StandardRequirements>) => setF((x) => ({ ...x, requirements: { ...x.requirements, ...patch } }));
  const eligibleCount = useEligibleCount(f.participants);

  const step: Step = (STEPS.some((s) => s.id === params.get('step')) ? params.get('step') : 'details') as Step;
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const goto = (s: Step) => setParams((p) => { const n = new URLSearchParams(p); n.set('step', s); return n; }, { replace: true });

  const canDetails = isNew ? can('verification.activities.create') : can('verification.activities.manage');
  const canRules = can('verification.rules.manage');
  const canVerifiers = can('verification.verifiers.assign');
  const canActivate = can('verification.activities.manage');

  // The configuration the store will save: generated from the standard requirements unless customized.
  let k = 0;
  const built = buildChecks(f.requirements, organization, () => `preview_${++k}`);
  const config = f.customized
    ? { type: f.checks.some((c) => ['credential-authenticity'].includes(c.type)) ? (f.checks.some((c) => ['identity-lookup', 'face-match', 'liveness', 'attribute-match'].includes(c.type)) ? 'identity-credential' as const : 'credential' as const) : 'identity' as const, checks: f.checks }
    : built;
  const validation = validateConfiguration({ ...config, outcome: f.outcome }, validationContext(state, organization.id, f.participants));
  const eligibleAdmins = eligibleVerifiers(state.data, organization.id);
  const scheduleError = f.startsAt && f.endsAt && f.endsAt <= f.startsAt ? 'The end must be after the start.' : null;
  const blockers = [...new Set([
    ...(nameProblem(state, organization.id, f.name, activity?.id) ? [nameProblem(state, organization.id, f.name, activity?.id)!] : []),
    ...(scheduleError ? [scheduleError] : []),
    ...(!f.customized && !f.requirements.identity && !f.requirements.credential ? ['Choose at least one of Verify Identity or Verify Credential.'] : []),
    ...validation.blockers.map((b) => b.message),
    ...(f.restrictVerifiers && !f.verifierIds.some((id) => eligibleAdmins.some((a) => a.id === id)) ? ['This activity is limited to assigned verifiers. Assign at least one, or allow any Verifier.'] : []),
  ])];
  const warnings = [...new Set([
    ...validation.warnings.map((w) => w.message),
    ...(f.requirements.identity === 'record' && !f.customized ? [IDENTITY_METHODS.find((m) => m.id === 'record')!.note!] : []),
    ...(!eligibleAdmins.length ? ['Nobody in your organization has the Verifier role yet. Add one in Settings → Administrators & Roles.'] : []),
  ])];
  const live = activity && activity.status !== 'draft';
  const credName = (id: string) => org.credentialTypeById.get(id)?.name ?? '';

  const save = async (andActivate: boolean) => {
    const err = nameProblem(state, organization.id, f.name, activity?.id);
    if (err) { setNameError(err); goto('details'); return; }
    if (scheduleError) { goto('details'); return; }
    setBusy(andActivate ? 'activate' : 'save');
    setProblems(null);
    await new Promise((r) => setTimeout(r, 200));
    const saved = saveActivity(organization.id, activity?.id, {
      name: f.name, description: f.purpose, purpose: f.purpose, type: config.type, checks: config.checks, outcome: f.outcome,
      requirements: f.requirements, customized: f.customized, verifierIds: f.verifierIds,
      location: f.location, schedule: f.startsAt || f.endsAt ? { startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), enforced: f.enforced } : undefined,
      participants: f.participants, entryPolicy: f.entryPolicy, restrictVerifiers: f.restrictVerifiers,
    });
    if (!saved.ok) {
      setBusy(null);
      if (saved.field === 'name') { setNameError(saved.error); goto('details'); return; }
      toast({ tone: 'error', title: 'Nothing was saved', description: saved.error });
      return;
    }
    if (!andActivate) {
      setBusy(null);
      toast({ tone: 'success', title: 'Saved as draft', description: live ? 'Changes to requirements are saved as a draft version; the active version stays in use until you activate them.' : `${f.name.trim()} is saved.` });
      navigate(activityPath(saved.activityId));
      return;
    }
    const activated = activateActivity(organization.id, saved.activityId);
    setBusy(null);
    if (!activated.ok) {
      setProblems(activated.problems ?? [activated.error]);
      toast({ tone: 'error', title: 'Saved as draft, not activated', description: 'Resolve the listed items to activate it.' });
      if (isNew) navigate(`${activityPath(saved.activityId)}/edit?step=participants`, { replace: true });
      return;
    }
    toast({ tone: 'success', title: live ? 'Changes activated' : 'Activity created and activated', description: `${f.name.trim()} is available to your organization’s verifiers.` });
    navigate(activityPath(saved.activityId));
  };

  if (isNew ? !can('verification.activities.create') : !(canDetails || canRules || canVerifiers)) return <NoAccess />;

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
          This activity is {activity.status}. Changes to verification requirements are saved as a new draft version; version {activeVersion?.number} stays in use until you activate them.
          Details and participants change straight away. Earlier verifications always keep the version they used.
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
            <form onSubmit={(e) => { e.preventDefault(); goto('requirements'); }} noValidate>
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

          {step === 'requirements' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Verification Requirements</h2>
                <p className="text-sm text-slate-500">Choose what must be confirmed before a participant can be verified for this activity.</p>
              </div>
              {f.customized ? (
                <div className="rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900 ring-1 ring-inset ring-violet-200">
                  These requirements were customized in advanced configuration, so they’re shown there.
                  {canRules && <button type="button" className="ml-2 font-semibold underline" onClick={() => setF((x) => ({ ...x, customized: false }))}>Use standard requirements instead</button>}
                </div>
              ) : (
                <fieldset disabled={!canRules} className="space-y-4">
                  <Requirement title="Verify identity" on={!!f.requirements.identity} onToggle={(on) => setReq({ identity: on ? defaultIdentity : null })}
                    description="Confirm the person in front of the officer is the person on the trusted record or credential.">
                    <div role="radiogroup" aria-label="Identity method" className="grid gap-2 md:grid-cols-3">
                      {IDENTITY_METHODS.map((m) => {
                        const ok = available(m.providers);
                        return (
                          <button key={m.id} type="button" role="radio" aria-checked={f.requirements.identity === m.id} onClick={() => setReq({ identity: m.id })}
                            className={cn('rounded-xl border p-3 text-left', f.requirements.identity === m.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                            <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900">{m.name}{!ok && <ProviderStatusBadge status="not-configured" />}{providers.some((p) => m.providers.includes(p.id) && p.simulated) && <Badge tone="warning">Simulated</Badge>}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">{m.description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </Requirement>
                  <Requirement title="Verify credential" on={!!f.requirements.credential || f.requirements.identity === 'holder'} locked={f.requirements.identity === 'holder'}
                    onToggle={(on) => setReq({ credential: on ? { credentialTypeIds: [] } : null })}
                    description="The person presents a digital credential, checked for authenticity, trusted issuer, validity and revocation. Not every activity needs one.">
                    <fieldset>
                      <legend className="mb-1.5 text-sm font-medium text-slate-700">Accepted credentials</legend>
                      <div className="flex flex-wrap gap-2">
                        {org.credentialTypes.filter((t) => t.status === 'active').map((t) => {
                          const ids = f.requirements.credential?.credentialTypeIds ?? [];
                          const on = ids.includes(t.id);
                          return (
                            <label key={t.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset', on ? 'bg-brand-50 ring-brand-300' : 'ring-slate-200')}>
                              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={on}
                                onChange={() => setReq({ credential: { credentialTypeIds: on ? ids.filter((x) => x !== t.id) : [...ids, t.id] } })} />{t.name}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  </Requirement>
                  <Requirement title="Verify eligibility" on={!!f.requirements.eligibility} onToggle={(on) => setReq({ eligibility: on ? 'participants' : null })}
                    description="Confirm the verified person is an eligible participant. You’ll choose participants in the next step." />
                </fieldset>
              )}
              <div className="rounded-xl border border-slate-200 p-4">
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" disabled={!canDetails} checked={f.entryPolicy !== 'off'}
                    onChange={(e) => set('entryPolicy', e.target.checked ? 'deny' : 'off')} />
                  <span>
                    <span className="font-semibold text-slate-900">Prevent multiple entries</span>
                    <span className="block text-slate-500">For physical access: if someone already has a recorded entry, a second one is refused or flagged. A successful verification alone doesn’t count as an entry.</span>
                  </span>
                </label>
                {f.entryPolicy !== 'off' && (
                  <div className="mt-3 max-w-xs pl-7">
                    <Field label="When someone has already entered">{(p) => (
                      <Select {...p} value={f.entryPolicy} disabled={!canDetails} onChange={(e) => set('entryPolicy', e.target.value as FormState['entryPolicy'])}>
                        <option value="deny">Don’t permit access</option><option value="flag">Flag for review</option>
                      </Select>
                    )}</Field>
                  </div>
                )}
              </div>

              <section className="rounded-xl border border-slate-200">
                <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-800">
                  <Wrench className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />Advanced configuration
                  <span className="hidden font-normal text-slate-500 sm:inline">Checks, providers, alternatives, outcome policy and who can verify</span>
                  <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 transition-transform', advanced && 'rotate-180')} aria-hidden="true" />
                </button>
                {advanced && (
                  <div className="space-y-6 border-t border-slate-100 px-4 py-4">
                    {!f.customized ? (
                      <p className="text-sm text-slate-600">The standard requirements generate these checks: {built.checks.map((c) => c.type).length} checks.
                        {canRules && <button type="button" className="ml-2 font-semibold text-brand-600 hover:text-brand-700" onClick={() => { let n = 0; setF((x) => ({ ...x, customized: true, checks: withPlatformPolicies(built.checks.map((c) => ({ ...c, id: `adv_${++n}` })), built.type, organization, () => `adv_${++n}`) })); }}>Customize checks</button>}
                      </p>
                    ) : (
                      <CheckConfigurator type={config.type} checks={f.checks} onChange={(c) => set('checks', c)} issues={[...validation.blockers, ...validation.warnings]} readOnly={!canRules} />
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="When a required check fails">{(p) => (
                        <Select {...p} disabled={!canRules} value={f.outcome.onRequiredFailure} onChange={(e) => set('outcome', { ...f.outcome, onRequiredFailure: e.target.value as OutcomePolicy['onRequiredFailure'] })}>
                          <option value="not-verified">{OUTCOME_LABEL['not-verified']}</option><option value="pending-review">Refer for review</option>
                        </Select>
                      )}</Field>
                      <Field label="When a required check can’t be completed">{(p) => (
                        <Select {...p} disabled={!canRules} value={f.outcome.onInconclusive} onChange={(e) => set('outcome', { ...f.outcome, onInconclusive: e.target.value as OutcomePolicy['onInconclusive'] })}>
                          <option value="unable-to-verify">{OUTCOME_LABEL['unable-to-verify']}</option><option value="pending-review">Refer for review</option>
                        </Select>
                      )}</Field>
                    </div>
                    <fieldset disabled={!canVerifiers}>
                      <legend className="mb-1.5 text-sm font-medium text-slate-700">Who can verify</legend>
                      <div className="space-y-2 text-sm">
                        <label className="flex items-center gap-2"><input type="radio" name="who" checked={!f.restrictVerifiers} onChange={() => set('restrictVerifiers', false)} className="h-4 w-4 text-brand-600" />Anyone with the Verifier role in your organization (recommended)</label>
                        <label className="flex items-center gap-2"><input type="radio" name="who" checked={f.restrictVerifiers} onChange={() => set('restrictVerifiers', true)} className="h-4 w-4 text-brand-600" />Only specific verifiers</label>
                      </div>
                      {f.restrictVerifiers && <div className="mt-3"><VerifierPicker value={f.verifierIds} onChange={(v) => set('verifierIds', v)} readOnly={!canVerifiers} /></div>}
                    </fieldset>
                  </div>
                )}
              </section>
            </div>
          )}

          {step === 'participants' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Eligible Participants</h2>
                <p className="text-sm text-slate-500">Choose who is eligible for this verification activity.</p>
              </div>
              {f.requirements.eligibility === null && !f.customized ? (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
                  Eligibility isn’t required, so anyone who passes verification meets this activity’s conditions.
                  {canRules && <button type="button" className="ml-2 font-semibold text-brand-600 hover:text-brand-700" onClick={() => setReq({ eligibility: 'participants' })}>Require eligibility</button>}
                </p>
              ) : (
                <>
                  <div role="radiogroup" aria-label="Eligibility source" className="grid gap-2 sm:grid-cols-2">
                    <button type="button" role="radio" aria-checked={f.requirements.eligibility !== 'external'} disabled={!canRules} onClick={() => setReq({ eligibility: 'participants' })}
                      className={cn('rounded-xl border p-3 text-left', f.requirements.eligibility !== 'external' ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200')}>
                      <span className="block text-sm font-semibold text-slate-900">Groups and users</span>
                      <span className="block text-xs text-slate-500">From your organization’s records.</span>
                    </button>
                    <button type="button" role="radio" aria-checked={f.requirements.eligibility === 'external'} disabled={!canRules} onClick={() => setReq({ eligibility: 'external' })}
                      className={cn('rounded-xl border p-3 text-left', f.requirements.eligibility === 'external' ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200')}>
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">External eligibility source <ProviderStatusBadge status="not-configured" /></span>
                      <span className="block text-xs text-slate-500">An authorized external system. None is connected yet.</span>
                    </button>
                  </div>
                  {f.requirements.eligibility !== 'external' && <ParticipantsPicker value={f.participants} onChange={(p) => set('participants', p)} readOnly={!canDetails} />}
                </>
              )}

              <section className="space-y-4 border-t border-slate-100 pt-6" aria-labelledby="review">
                <h2 id="review" className="text-lg font-semibold text-slate-900">Review</h2>
                <IssuesList blockers={problems ?? blockers} warnings={warnings} />
                <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-slate-500">Activity</dt><dd className="font-medium text-slate-900">{f.name || '—'}</dd></div>
                  <div><dt className="text-slate-500">Purpose</dt><dd className="text-slate-900">{f.purpose || '—'}</dd></div>
                  {f.location && <div><dt className="text-slate-500">Location</dt><dd className="text-slate-900">{f.location}</dd></div>}
                  {(f.startsAt || f.endsAt) && <div><dt className="text-slate-500">Schedule</dt><dd className="text-slate-900">{f.startsAt ? new Date(f.startsAt).toLocaleString() : '…'} – {f.endsAt ? new Date(f.endsAt).toLocaleString() : '…'}{f.enforced ? ' (verification only in this window)' : ' (information only)'}</dd></div>}
                  <div className="sm:col-span-2"><dt className="text-slate-500">Verification requirements</dt><dd><ul className="mt-0.5 list-disc pl-5 text-slate-900">
                    {describeRequirements({ requirements: f.requirements, customized: f.customized, checks: config.checks }, credName).map((l) => <li key={l}>{l}</li>)}
                    {f.entryPolicy !== 'off' && <li>Multiple entries: {f.entryPolicy === 'deny' ? 'not permitted' : 'flagged for review'}</li>}
                  </ul></dd></div>
                  <div><dt className="text-slate-500">Eligible participants</dt><dd className="text-slate-900">{f.requirements.eligibility === 'participants' || f.customized ? `${eligibleCount} ${eligibleCount === 1 ? 'person' : 'people'} (${f.participants.groupIds.length} ${f.participants.groupIds.length === 1 ? 'group' : 'groups'}, ${f.participants.memberIds.length} ${f.participants.memberIds.length === 1 ? 'user' : 'users'})` : f.requirements.eligibility === 'external' ? 'External source' : 'Not required'}</dd></div>
                  <div><dt className="text-slate-500">Who can verify</dt><dd className="text-slate-900">{f.restrictVerifiers ? `${f.verifierIds.length} assigned ${f.verifierIds.length === 1 ? 'verifier' : 'verifiers'}` : 'Anyone with the Verifier role'}</dd></div>
                </dl>
              </section>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">
          {stepIndex > 0 && <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => goto(STEPS[stepIndex - 1].id)}>Back</Button>}
          <span className="flex-1" />
          <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>Save as Draft</Button>
          {step !== 'participants'
            ? <Button icon={<ArrowRight className="h-4 w-4" />} onClick={() => goto(STEPS[stepIndex + 1].id)}>Continue</Button>
            : canActivate && (
              <Button icon={<ShieldCheck className="h-4 w-4" />} loading={busy === 'activate'} disabled={!!busy || blockers.length > 0} onClick={() => save(true)}>
                {live ? 'Activate changes' : 'Create & Activate'}
              </Button>
            )}
        </div>
      </Card>
    </>
  );
}

function Requirement({ title, description, on, onToggle, locked, children }: { title: string; description: string; on: boolean; onToggle: (on: boolean) => void; locked?: boolean; children?: ReactNode }) {
  return (
    <div className={cn('rounded-xl border p-4', on ? 'border-brand-300 bg-white' : 'border-slate-200 bg-slate-50/50')}>
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={on} disabled={locked} onChange={(e) => onToggle(e.target.checked)} aria-label={title}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
        <span>
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          <span className="block text-sm text-slate-500">{description}</span>
          {locked && <span className="block text-xs text-slate-500">Required because the identity method uses the credential.</span>}
        </span>
      </label>
      {on && children && <div className="mt-4 pl-7">{children}</div>}
    </div>
  );
}
