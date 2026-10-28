import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Building2, Check, ChevronRight, Lock, Pencil, UserPlus } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, Field, Input, SearchInput, Select, Textarea, useToast } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { LocationCheckEditor, type LocationDraft } from '@/components/verification/LocationCheckEditor';
import { ParticipantsPicker, useEligibleCount, type Participants } from '@/components/verification/ParticipantsPicker';
import { IssuesList, VerifierPicker } from '@/components/verification/parts';
import {
  ELIGIBILITY_MODE_LABEL, PORTRAIT_BASELINE, SCHEDULE_KIND_LABEL, WEEKDAY_NAMES, describeSource, eligibilityMode, scheduleSummary,
} from '@/domain/activityLifecycle';
import { PARTICIPATION_LABEL, defaultSettings, type VerificationSettings } from '@/domain/activitySettings';
import { formatCoordinate, formatRadius, locationConfigProblem, type LocationCheckConfig } from '@/domain/location';
import type { ActivityConfig, Recurrence, ScheduleKind } from '@/domain/types';
import { DEFAULT_ELIGIBILITY_ATTRIBUTE, DEFAULT_ELIGIBLE_VALUES } from '@/domain/transactions';
import { activeAssignments, currentVersion, eligibleVerifiers } from '@/domain/verification';
import { cn } from '@/lib/cn';
import { useServices } from '@/services/ServicesProvider';
import { NO_VERIFIER_WARNING, nameProblem, type ActivityForm } from '@/store/activityOps';
import { subRelationships } from '@/store/orgOps';
import { audienceOf, configFromSettings, settingsEditable, settingsFromVersion } from '@/store/sharingOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { NotFoundPage } from '../NotFoundPage';
import { activityPath } from './paths';

export function ActivityEditorPage() {
  const { activityId } = useParams();
  const { state } = useStore();
  const { organization } = useSession();
  // Only the owner edits an activity; organizations taking part in a delegated activity can't change it.
  const activity = activityId ? state.data.activityConfigs.find((a) => a.id === activityId && a.organizationId === organization.id) : undefined;
  if (activityId && !activity) return <NotFoundPage entity="verification activity" backTo="/verification-activities" />;
  if (activity?.completedAt) {
    return (
      <Card className="mx-auto mt-10 max-w-lg p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-900">This activity is completed</h1>
        <p className="mt-2 text-sm text-slate-600">Completed activities can’t be edited. Their records are kept. Duplicate it to run it again.</p>
        <Link to={activityPath(activity.id)} className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to the activity</Link>
      </Card>
    );
  }
  return <Wizard key={activity?.id ?? 'new'} activity={activity} />;
}

type StepId = 'details' | 'participants' | 'source' | 'verifiers' | 'review';
const STEPS: { id: StepId; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'participants', label: 'Participants and schedule' },
  { id: 'source', label: 'Identity source' },
  { id: 'verifiers', label: 'Verifiers' },
  { id: 'review', label: 'Review' },
];

interface FormState {
  name: string;
  description: string;
  mode: 'selected' | 'open';
  people: Participants;
  scheduleKind: ScheduleKind | '';
  /** One-time and open-ended: local date and time ("YYYY-MM-DDTHH:MM"). */
  start: string;
  end: string;
  /** Recurring: local dates ("YYYY-MM-DD") and the daily time window. */
  startDate: string;
  endDate: string;
  frequency: Recurrence['frequency'];
  days: number[];
  startTime: string;
  endTime: string;
  locationName: string;
  locationAddress: string;
  location: LocationDraft;
  /** 'local' or an integration ID. */
  sourceId: string;
  verifierIds: string[];
  subOrgIds: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDateTime = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const localDate = (iso?: string) => localDateTime(iso).slice(0, 10);
const toIso = (local: string) => new Date(local).toISOString();
const toDraft = (c?: LocationCheckConfig): LocationDraft => {
  const ok = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { enabled: !!c?.enabled, lat: ok(c?.lat), lng: ok(c?.lng), radiusM: c?.radiusM ?? 100, label: c?.label ?? '' };
};
const toConfig = (d: LocationDraft): LocationCheckConfig => ({ enabled: d.enabled, lat: d.lat ?? Number.NaN, lng: d.lng ?? Number.NaN, radiusM: d.radiusM, ...(d.label ? { label: d.label } : {}) });
const sourceKey = (s: VerificationSettings['identitySource']) => (s.kind === 'local' ? 'local' : s.integrationId);
/** New activities make no exceptions and send nothing for human review: a result is final. */
const NO_REVIEW: Pick<VerificationSettings, 'exceptions' | 'decisionRules'> = { exceptions: 'unsuccessful', decisionRules: { onInconclusiveMatch: 'unable-to-decide', onServiceUnavailable: 'unable-to-decide' } };

function scheduleOf(f: FormState): ActivityConfig['schedule'] {
  if (f.scheduleKind === 'one-time') return { kind: 'one-time', startsAt: toIso(f.start), endsAt: toIso(f.end), enforced: true };
  if (f.scheduleKind === 'open-ended') return { kind: 'open-ended', startsAt: toIso(f.start), enforced: true };
  if (f.scheduleKind === 'recurring') {
    return {
      kind: 'recurring', startsAt: toIso(`${f.startDate}T00:00`), ...(f.endDate ? { endsAt: toIso(`${f.endDate}T23:59`) } : {}), enforced: true,
      recurrence: { frequency: f.frequency, ...(f.frequency === 'weekly' ? { days: [...f.days].sort((a, b) => a - b) } : {}), startTime: f.startTime, endTime: f.endTime },
    };
  }
  return undefined;
}

/** The schedule fields that matter for the chosen kind, for change detection. */
function scheduleFields(f: FormState) {
  return f.scheduleKind === 'one-time' ? [f.start, f.end] : f.scheduleKind === 'open-ended' ? [f.start]
    : f.scheduleKind === 'recurring' ? [f.startDate, f.endDate, f.frequency, f.days, f.startTime, f.endTime] : null;
}

/**
 * Create or edit a Verification Activity in five steps: details; who can be verified and when; the identity
 * source (which prescribes how people are verified, with the portrait match always required); verifiers and
 * authorised sub-organizations; then review. Nothing here sets up integrations, users or groups.
 */
function Wizard({ activity }: { activity?: ActivityConfig }) {
  const { state, getState } = useStore();
  const { organization } = useSession();
  const { can, record } = useAuthorization();
  const { saveActivity, activateActivity } = useActions();
  const { faceVerification } = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isNew = !activity;
  const isDraft = !activity || activity.status === 'draft';
  const version = activity ? currentVersion(state.data, activity) : undefined;
  const editable = settingsEditable(version);
  const existing = activity ? activity.verification ?? settingsFromVersion(version) : undefined;
  const delegatedAlready = !!activity && audienceOf(activity) === 'shared';
  const attemptCount = activity ? state.data.verificationAttempts.filter((a) => a.activityId === activity.id).length : 0;

  const initial = useMemo<FormState>(() => {
    const s = activity?.schedule;
    const kind: ScheduleKind | '' = s?.kind ?? (s?.startsAt && s?.endsAt ? 'one-time' : '');
    return {
      name: activity?.name ?? '', description: activity?.description || activity?.purpose || '',
      mode: activity ? eligibilityMode(activity) : 'selected', people: activity?.participants ?? { groupIds: [], memberIds: [] },
      scheduleKind: kind, start: localDateTime(s?.startsAt), end: localDateTime(s?.endsAt),
      startDate: localDate(s?.startsAt), endDate: s?.kind === 'recurring' ? localDate(s?.endsAt) : '',
      frequency: s?.recurrence?.frequency ?? 'weekly', days: s?.recurrence?.days ?? [1, 2, 3, 4, 5], startTime: s?.recurrence?.startTime ?? '08:00', endTime: s?.recurrence?.endTime ?? '17:00',
      locationName: activity?.location ?? '', locationAddress: activity?.locationAddress ?? '', location: toDraft(activity?.locationCheck),
      sourceId: existing ? sourceKey(existing.identitySource) : '',
      // A new activity starts with the administrator creating it as its verifier, when they can verify.
      verifierIds: activity ? activeAssignments(state.data, organization.id, activity.id).map((v) => v.administratorId)
        : record && eligibleVerifiers(state.data, organization.id).some((a) => a.id === record.id) ? [record.id] : [],
      subOrgIds: (activity?.sharing?.participants ?? []).filter((p) => p.status !== 'removed' && p.status !== 'declined').map((p) => p.organizationId),
    };
  // Captured once: the form's starting point, used to detect unsaved changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [f, setF] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const requested = params.get('step');
  const [step, setStep] = useState<StepId>(STEPS.some((s) => s.id === requested) ? requested as StepId : 'details');
  // The furthest step reached; a new activity can only jump back to steps it has already reached.
  const [reached, setReached] = useState<number>(isNew ? STEPS.findIndex((s) => s.id === step) : STEPS.length - 1);
  // Steps whose problems are shown: after Continue was pressed on them, or after a save was attempted.
  const [shown, setShown] = useState<Set<StepId>>(new Set(requested === 'review' ? STEPS.map((s) => s.id) : []));
  const [busy, setBusy] = useState<'draft' | 'create' | 'changes' | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'source' | null>(null);
  const [orgQuery, setOrgQuery] = useState('');
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const canDetails = isNew ? can('verification.activities.create') : can('verification.activities.edit');
  const canAssign = can('verification.verifiers.assign');
  const eligibleCount = useEligibleCount(f.people);

  /* ---------------- Identity sources ---------------- */
  const localPortrait = faceVerification.available || !!organization.integrations.simulatedBiometrics?.enabled;
  const integrations = (state.data.customIntegrations ?? []).filter((i) => i.organizationId === organization.id && i.capabilities.includes('lookup'));
  const delegating = f.subOrgIds.length > 0;
  const options = [
    {
      id: 'local', label: 'FixID records', detail: 'People registered in your organization', source: { kind: 'local' as const },
      problem: !localPortrait ? 'Portrait matching isn’t set up for FixID records in this organization, so the required portrait match can’t run.'
        : delegating || delegatedAlready ? 'A delegated activity needs a connected identity source, so sub-organizations never see your organization’s own records.' : null,
    },
    ...integrations.map((i) => ({
      id: i.id, label: i.name, detail: `Connected identity source${i.connection.target === 'simulated' ? ' (simulated)' : ''} · ${i.referenceLabel}`,
      source: { kind: 'external' as const, integrationId: i.id },
      problem: i.status !== 'active' ? `${i.name} isn’t active yet. Finish setting it up in Settings → Integrations.`
        : !i.capabilities.includes('matching') ? `${i.name} only retrieves records. It can’t perform the required portrait match.`
          : i.connection.target !== 'simulated' ? `${i.name} can’t be reached from this prototype.`
            : f.mode === 'selected' ? 'Selected participants are users registered in FixID. Choose Open verification in step 2 to use this source.' : null,
    })),
  ];
  const option = options.find((o) => o.id === f.sourceId);
  const usable = options.filter((o) => !o.problem);

  /* ---------------- Validation ---------------- */
  const now = new Date();
  const scheduleChanged = JSON.stringify(scheduleFields(f)) !== JSON.stringify(scheduleFields(initial));
  const scheduleProblems: string[] = [];
  // Activities created before schedules existed may stay unscheduled; everything else needs one.
  const unscheduledAllowed = !isNew && initial.scheduleKind === '';
  if (!f.scheduleKind && !unscheduledAllowed) scheduleProblems.push('Choose when verification takes place.');
  if (f.scheduleKind === 'one-time') {
    if (!f.start || !f.end) scheduleProblems.push('Enter a start and end date and time.');
    else if (new Date(f.end) <= new Date(f.start)) scheduleProblems.push('The end must be after the start.');
    else if (scheduleChanged && new Date(f.end) <= now) scheduleProblems.push('The end must be in the future.');
  }
  if (f.scheduleKind === 'open-ended' && !f.start) scheduleProblems.push('Enter a start date and time.');
  if (f.scheduleKind === 'recurring') {
    if (!f.startDate) scheduleProblems.push('Enter a start date.');
    if (f.frequency === 'weekly' && f.days.length === 0) scheduleProblems.push('Choose at least one day of the week.');
    if (!f.startTime || !f.endTime || f.endTime <= f.startTime) scheduleProblems.push('The daily end time must be after the start time.');
    if (f.endDate && f.startDate && f.endDate < f.startDate) scheduleProblems.push('The end date can’t be before the start date.');
    else if (f.endDate && scheduleChanged && new Date(`${f.endDate}T23:59`) <= now) scheduleProblems.push('The end date must be in the future.');
  }
  const locationProblem = locationConfigProblem(toConfig(f.location));
  const stepProblems: Record<StepId, string[]> = {
    details: [nameProblem(state, organization.id, f.name, activity?.id)].filter(Boolean) as string[],
    participants: [
      ...(f.mode === 'selected' && f.people.groupIds.length + f.people.memberIds.length === 0 ? ['Select at least one user or group, or choose Open verification.'] : []),
      ...scheduleProblems, ...(locationProblem ? [locationProblem] : []),
    ],
    // A running activity whose source is unchanged keeps it; a new source must support the whole process.
    source: !editable || (!isDraft && f.sourceId === initial.sourceId) ? []
      : !option ? [usable.length ? 'Choose an identity source.' : 'No identity source can be used yet. Set one up in Settings → Integrations.'] : option.problem ? [option.problem] : [],
    // Creating needs someone to verify; a running activity without anyone is only warned about.
    verifiers: [
      ...(isDraft && f.verifierIds.length + f.subOrgIds.length === 0 ? ['Assign at least one verifier or authorised sub-organization.'] : []),
      ...(delegatedAlready && f.subOrgIds.length === 0 ? ['A delegated activity keeps at least one sub-organization. Its earlier records stay.'] : []),
    ],
    review: [],
  };
  const allProblems = [...new Set(STEPS.flatMap((s) => stepProblems[s.id]))];
  const noVerifierWarning = !isDraft && f.verifierIds.length + f.subOrgIds.length === 0;
  const firstInvalid = STEPS.find((s) => stepProblems[s.id].length)?.id;
  const index = STEPS.findIndex((s) => s.id === step);

  /* ---------------- Saving ---------------- */
  const settingsOf = (x: FormState): VerificationSettings | null => {
    const opt = options.find((o) => o.id === x.sourceId);
    if (!opt) return null;
    const base = existing ?? { ...defaultSettings(), ...NO_REVIEW };
    const sameSource = !!existing && sourceKey(existing.identitySource) === opt.id;
    const eligibility: VerificationSettings['eligibility'] = sameSource && existing!.eligibility.approach === 'reference-list' ? existing!.eligibility
      : opt.source.kind === 'external' ? { approach: 'external-source', attribute: DEFAULT_ELIGIBILITY_ATTRIBUTE, allowedValues: DEFAULT_ELIGIBLE_VALUES }
        : { approach: x.mode === 'selected' ? 'local-population' : 'none' };
    // The portrait baseline: a live portrait matched against the reference portrait, every time.
    return { ...base, identitySource: opt.source, method: 'face', liveness: 'required', eligibility };
  };
  const buildForm = (x: FormState): ActivityForm | null => {
    const s = editable ? settingsOf(x) : null;
    if (editable && !s) return null;
    // An existing activity keeps how it verifies until its identity source or eligibility changes; then the
    // portrait baseline applies. Editing other details never changes its verification configuration.
    const changed = editable && !!s && (isNew || JSON.stringify([s.identitySource, s.eligibility]) !== JSON.stringify([existing!.identitySource, existing!.eligibility]));
    let n = 0;
    const identifierConfigId = version?.checks.find((c) => c.params.identifierConfigId)?.params.identifierConfigId;
    const gen = changed && s ? configFromSettings(s, organization, () => `new_${++n}`, identifierConfigId) : null;
    const shared = x.subOrgIds.length > 0 || delegatedAlready;
    const common: Omit<ActivityForm, 'type' | 'checks' | 'outcome'> = {
      name: x.name, description: x.description, purpose: x.description, verifierIds: x.verifierIds,
      eligibilityMode: x.mode, participants: x.mode === 'selected' ? x.people : { groupIds: [], memberIds: [] },
      // An unchanged schedule is kept exactly as stored.
      schedule: JSON.stringify(scheduleFields(x)) === JSON.stringify(scheduleFields(initial)) && !isNew ? activity!.schedule : scheduleOf(x), location: x.locationName, locationAddress: x.locationAddress, locationCheck: toConfig(x.location),
      audience: shared ? 'shared' : 'own', ...(shared ? { participantIds: x.subOrgIds } : {}),
      ...(s && changed ? { verification: s } : {}),
    };
    if (gen) return { ...common, type: gen.type, checks: gen.checks, outcome: gen.outcome, requirements: gen.requirements, customized: false };
    if (!version) return null;
    return { ...common, type: version.type, checks: version.checks, outcome: version.outcome, keepConfiguration: true };
  };

  const save = async (intent: 'draft' | 'create' | 'changes', sourceConfirmed = false) => {
    setShown(new Set(STEPS.map((s) => s.id)));
    setProblems(null);
    // A draft needs only a name and an identity source; everything else can be finished later.
    if (intent === 'draft') {
      if (stepProblems.details.length) { setStep('details'); return; }
      if (stepProblems.source.length) { setStep('source'); return; }
    } else if (firstInvalid) {
      setStep(firstInvalid);
      return;
    }
    if (!isNew && !sourceConfirmed && attemptCount > 0 && existing && f.sourceId !== sourceKey(existing.identitySource)) { setConfirm('source'); return; }
    const form = buildForm(f);
    if (!form) return;
    setBusy(intent);
    await new Promise((r) => setTimeout(r, 300));
    const saved = saveActivity(organization.id, activity?.id, form);
    if (!saved.ok) { setBusy(null); setProblems(saved.problems ?? [saved.error]); setStep('review'); return; }
    const stored = getState().data.activityConfigs.find((a) => a.id === saved.activityId)!;
    // Creating makes it ready; saving changes to a running activity puts them in use straight away.
    const activate = intent === 'create' || (intent === 'changes' && stored.status === 'active' && !!stored.draftVersionId);
    if (activate) {
      const r = activateActivity(organization.id, saved.activityId);
      if (!r.ok) {
        setBusy(null);
        setProblems(r.problems ?? [r.error]);
        setStep('review');
        toast({ tone: 'error', title: intent === 'create' ? 'Saved as draft' : 'Changes saved, not yet in use', description: 'Resolve the listed items first.' });
        if (isNew) navigate(`${activityPath(saved.activityId)}/edit?step=review`, { replace: true });
        return;
      }
    }
    setBusy(null);
    toast({ tone: 'success', title: { draft: 'Saved as draft', create: 'Activity created', changes: 'Changes saved' }[intent], description: f.name.trim() });
    navigate(activityPath(saved.activityId), { replace: isNew });
  };

  const go = (to: StepId) => {
    setProblems(null);
    setStep(to);
    setReached((r) => Math.max(r, STEPS.findIndex((s) => s.id === to)));
  };
  const next = () => {
    setShown((x) => new Set([...x, step]));
    if (stepProblems[step].length) return;
    go(STEPS[index + 1].id);
  };
  /**
   * Inviting an administrator leaves the page: the activity is kept as a draft first (one record, updated in
   * place), and Settings offers a way back to this step.
   */
  const inviteAdministrator = () => {
    setShown((x) => new Set([...x, 'details', 'source']));
    if (stepProblems.details.length) { setStep('details'); return; }
    if (stepProblems.source.length) { setStep('source'); return; }
    const form = buildForm(f);
    const saved = form ? saveActivity(organization.id, activity?.id, form) : null;
    if (!saved || !saved.ok) { if (saved && !saved.ok) setProblems(saved.problems ?? [saved.error]); return; }
    navigate(`/settings?tab=admins&invite=1&returnTo=${encodeURIComponent(`${activityPath(saved.activityId)}/edit?step=verifiers`)}`);
  };
  const leave = () => navigate(activity ? activityPath(activity.id) : '/verification-activities');
  const cancel = () => (dirty ? setConfirm('discard') : leave());

  if (!canDetails) return <NoAccess />;
  const errorsFor = (id: StepId) => (shown.has(id) ? stepProblems[id] : []);
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const subOrgs = [...new Set([...subRelationships(state, organization.id).map((r) => r.childOrganizationId), ...initial.subOrgIds])]
    .filter((id) => state.data.organizations.some((o) => o.id === id && o.status !== 'inactive'));
  const shownSubOrgs = subOrgs.filter((id) => !orgQuery.trim() || orgName(id).toLowerCase().includes(orgQuery.trim().toLowerCase()));
  const verifierName = (id: string) => { const a = state.data.administrators.find((x) => x.id === id); return a?.name ?? a?.email ?? id; };
  const process = option ? describeSource(option.source.kind === 'external'
    ? { kind: 'external', integration: integrations.find((i) => i.id === option.id) } : { kind: 'local' }, f.mode, !faceVerification.available) : null;
  const sched = f.scheduleKind && !scheduleProblems.length ? scheduleSummary(scheduleOf(f)) : null;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        {activity ? <><Link to={activityPath(activity.id)} className="truncate hover:text-slate-800">{activity.name}</Link><ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-slate-700">Edit</span></>
          : <span className="text-slate-700">Create activity</span>}
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{activity && !isDraft ? `Edit ${activity.name}` : 'Create activity'}</h1>

      <ol aria-label="Steps" className="mt-6 grid max-w-4xl grid-cols-5 gap-2">
        {STEPS.map((s, i) => {
          const open = i <= reached;
          const invalid = shown.has(s.id) && stepProblems[s.id].length > 0;
          return (
            <li key={s.id}>
              <button type="button" disabled={!open || !!busy} onClick={() => go(s.id)} aria-current={s.id === step ? 'step' : undefined}
                className={cn('flex w-full flex-col items-start gap-1 border-t-4 pt-2 text-left text-xs font-medium disabled:cursor-not-allowed',
                  s.id === step ? 'border-brand-600 text-brand-700' : invalid ? 'border-red-400 text-red-700' : open ? 'border-brand-200 text-slate-700 hover:text-brand-700' : 'border-slate-200 text-slate-400')}>
                <span>Step {i + 1}</span>
                <span className="hidden text-sm sm:block">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-sm font-medium text-slate-700" aria-live="polite">Step {index + 1} of {STEPS.length}: {STEPS[index].label}</p>

      <form className="mt-4 max-w-4xl space-y-5" noValidate onSubmit={(e) => { e.preventDefault(); if (step === 'review') void save(isDraft ? 'create' : 'changes'); else next(); }}>
        {step === 'details' && (
          <Section title="Activity details" description="Give the activity a name people will recognize.">
            <Field label="Activity name" error={errorsFor('details')[0]}>
              {(p) => <Input {...p} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Enter activity name" maxLength={80} />}
            </Field>
            <Field label="Description (optional)">
              {(p) => <Textarea {...p} rows={3} placeholder="Describe the purpose of this verification activity" value={f.description} onChange={(e) => set('description', e.target.value)} />}
            </Field>
            <div className="text-sm"><p className="text-slate-500">Organization</p><p className="mt-0.5 flex items-center gap-1.5 font-medium text-slate-900"><Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />{organization.name}</p></div>
          </Section>
        )}

        {step === 'participants' && (
          <>
            <Section title="Who can be verified?">
              <div role="radiogroup" aria-label="Who can be verified?" className="grid gap-3 sm:grid-cols-2">
                <Choice selected={f.mode === 'selected'} onSelect={() => set('mode', 'selected')} title={ELIGIBILITY_MODE_LABEL.selected} body="Only the users and groups you choose are eligible." />
                <Choice selected={f.mode === 'open'} onSelect={() => set('mode', 'open')} title={ELIGIBILITY_MODE_LABEL.open}
                  body="People present themselves to be verified. Not everyone is eligible: eligibility comes from the identity source." />
              </div>
              {f.mode === 'selected' ? (
                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-3 text-sm text-slate-500">Choose from existing users and groups. Nothing is imported or created here.</p>
                  <ParticipantsPicker value={f.people} onChange={(p) => set('people', p)} />
                </div>
              ) : <p className="text-sm text-slate-600">Nobody needs to be listed in advance. Every verification still requires the portrait match, and eligibility is checked separately.</p>}
            </Section>
            <Section title="Schedule">
              <div role="radiogroup" aria-label="Schedule type" className="grid gap-3 sm:grid-cols-3">
                {(['one-time', 'recurring', 'open-ended'] as const).map((k) => (
                  <Choice key={k} selected={f.scheduleKind === k} onSelect={() => set('scheduleKind', k)} title={SCHEDULE_KIND_LABEL[k]}
                    body={{ 'one-time': 'Runs once, between a start and an end.', recurring: 'Repeats on a regular pattern.', 'open-ended': 'Starts on a date and runs until you complete it.' }[k]} />
                ))}
              </div>
              {(f.scheduleKind === 'one-time' || f.scheduleKind === 'open-ended') && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={f.start} onChange={(e) => set('start', e.target.value)} />}</Field>
                  {f.scheduleKind === 'one-time' && <Field label="Ends">{(p) => <Input {...p} type="datetime-local" value={f.end} onChange={(e) => set('end', e.target.value)} />}</Field>}
                </div>
              )}
              {f.scheduleKind === 'recurring' && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Repeats">{(p) => (
                      <Select {...p} value={f.frequency} onChange={(e) => set('frequency', e.target.value as Recurrence['frequency'])}>
                        <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                      </Select>
                    )}</Field>
                    <Field label="From (time)">{(p) => <Input {...p} type="time" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} />}</Field>
                    <Field label="Until (time)">{(p) => <Input {...p} type="time" value={f.endTime} onChange={(e) => set('endTime', e.target.value)} />}</Field>
                  </div>
                  {f.frequency === 'weekly' && (
                    <fieldset>
                      <legend className="text-sm font-medium text-slate-700">On these days</legend>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                          <label key={d} className={cn('cursor-pointer rounded-full px-3 py-1 text-sm ring-1 ring-inset focus-within:ring-2 focus-within:ring-brand-500', f.days.includes(d) ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'text-slate-600 ring-slate-200')}>
                            <input type="checkbox" className="sr-only" checked={f.days.includes(d)} aria-label={WEEKDAY_NAMES[d]}
                              onChange={() => set('days', f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d])} />
                            <span aria-hidden="true">{WEEKDAY_NAMES[d].slice(0, 3)}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Start date">{(p) => <Input {...p} type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />}</Field>
                    <Field label="End date (optional)">{(p) => <Input {...p} type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />}</Field>
                  </div>
                </div>
              )}
              {f.scheduleKind ? <p className="text-xs text-slate-500">Verification can only start between the start and the end.</p>
                : unscheduledAllowed && <p className="text-sm text-slate-600">This activity has no schedule: it runs while it’s active. Choose a schedule to limit when verification can take place.</p>}
            </Section>
            <Section title="Location (optional)">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Location name">{(p) => <Input {...p} value={f.locationName} onChange={(e) => set('locationName', e.target.value)} placeholder="For example, Main Hall" maxLength={80} />}</Field>
                <Field label="Address">{(p) => <Input {...p} value={f.locationAddress} onChange={(e) => set('locationAddress', e.target.value)} placeholder="Street and town" maxLength={160} />}</Field>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <LocationCheckEditor value={f.location} onChange={(v) => set('location', v)} error={shown.has('participants') ? locationProblem : null} />
              </div>
            </Section>
            <StepErrors problems={errorsFor('participants')} />
          </>
        )}

        {step === 'source' && (
          <>
            <Section title="Identity source" description="Where each person’s record and reference portrait are held. Only sources available to your organization are listed.">
              {!editable ? (
                <p className="text-sm text-slate-600">This activity checks credentials and keeps the process it was configured with.</p>
              ) : (
                <>
                  <div role="radiogroup" aria-label="Identity source" className="space-y-2">
                    {options.map((o) => (
                      <label key={o.id} className={cn('flex items-start gap-3 rounded-lg border p-3 text-sm',
                        o.problem ? 'cursor-not-allowed border-slate-200 bg-slate-50' : f.sourceId === o.id ? 'cursor-pointer border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'cursor-pointer border-slate-200 hover:bg-slate-50')}>
                        <input type="radio" name="source" className="mt-0.5" checked={f.sourceId === o.id} disabled={!!o.problem} onChange={() => set('sourceId', o.id)} aria-label={o.label} />
                        <span>
                          <span className={cn('block font-medium', o.problem ? 'text-slate-500' : 'text-slate-900')}>{o.label}</span>
                          <span className="text-slate-500">{o.detail}</span>
                          {o.problem && <span className="mt-1 block text-amber-800">{o.problem}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                  {usable.length === 0 && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
                      No identity source can perform the required portrait match yet. <Link to="/settings?tab=integrations" className="font-semibold underline">Set one up in Settings → Integrations</Link>.
                    </p>
                  )}
                </>
              )}
            </Section>
            {process && editable && (
              <Section title="How people are verified" description="Prescribed by the identity source. It can’t be changed or bypassed.">
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-800" aria-label="Verification process">{process.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                <p className="text-sm text-slate-600">{PORTRAIT_BASELINE}</p>
                {process.simulated && <p className="flex flex-wrap items-center gap-2"><Badge tone="warning">Simulated in this prototype</Badge><span className="text-xs text-slate-500">No real identity service or biometric matching is connected.</span></p>}
              </Section>
            )}
            {!isNew && attemptCount > 0 && existing && f.sourceId !== sourceKey(existing.identitySource) && (
              <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">This activity has {plural(attemptCount, 'verification record', 'verification records')}. They keep the source they used; only new verifications use the new source.</p>
            )}
            <StepErrors problems={errorsFor('source')} />
          </>
        )}

        {step === 'verifiers' && (
          <>
            <Section title="Individual verifiers" description="Only people whose role allows performing verifications are listed. Assigning someone doesn’t change their permissions.">
              <VerifierPicker value={f.verifierIds} onChange={(v) => set('verifierIds', v)} readOnly={!canAssign} showOrganization />
              {can('administrators.invite') && isDraft && (
                <Button type="button" variant="ghost" size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={inviteAdministrator}>Invite Administrator</Button>
              )}
            </Section>
            <Section title="Authorised sub-organizations (optional)" description="A sub-organization verifies with its own staff, whom it assigns itself. It can’t change the activity.">
              {subOrgs.length > 8 && (
                <div className="flex flex-wrap items-center gap-3">
                  <SearchInput value={orgQuery} onChange={setOrgQuery} placeholder="Search organizations" label="Search organizations" className="sm:w-72" />
                  {canAssign && shownSubOrgs.length > 0 && orgQuery.trim() && (
                    <Button variant="ghost" size="sm" onClick={() => set('subOrgIds', [...new Set([...f.subOrgIds, ...shownSubOrgs])])}>Select all shown</Button>
                  )}
                  <span className="text-xs text-slate-500">{f.subOrgIds.length} selected</span>
                </div>
              )}
              {subOrgs.length === 0 ? <p className="text-sm text-slate-500">Your organization has no sub-organizations to delegate to.</p> : (
                <fieldset aria-label="Authorised sub-organizations" className="grid gap-2 sm:grid-cols-2">
                  {shownSubOrgs.map((id) => {
                    const st = activity?.sharing?.participants.find((p) => p.organizationId === id)?.status;
                    return (
                      <label key={id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <span className="flex items-center gap-2">
                          <input type="checkbox" checked={f.subOrgIds.includes(id)} disabled={!canAssign}
                            onChange={(e) => set('subOrgIds', e.target.checked ? [...f.subOrgIds, id] : f.subOrgIds.filter((x) => x !== id))} />
                          <Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" />{orgName(id)}
                        </span>
                        {st && st !== 'removed' && st !== 'declined' && <span className="text-xs text-slate-500">{PARTICIPATION_LABEL[st]}</span>}
                      </label>
                    );
                  })}
                </fieldset>
              )}
              {delegating && <p className="text-xs text-slate-500">Each sub-organization accepts the invitation in its own workspace before its staff can verify.</p>}
            </Section>
            <StepErrors problems={errorsFor('verifiers')} />
            {noVerifierWarning && <IssuesList blockers={[]} warnings={[NO_VERIFIER_WARNING]} warningsTitle="No verifier assigned" />}
          </>
        )}

        {step === 'review' && (
          <>
            {(problems || allProblems.length > 0) && <IssuesList blockers={problems ?? allProblems} warnings={[]} title="Before you continue" />}
            {noVerifierWarning && <IssuesList blockers={[]} warnings={[NO_VERIFIER_WARNING]} warningsTitle="No verifier assigned" />}
            <ReviewSection title="Details" onEdit={() => go('details')} problems={stepProblems.details}>
              <Row label="Name">{f.name.trim() || '—'}</Row>
              <Row label="Description">{f.description.trim() || '—'}</Row>
              <Row label="Organization">{organization.name}</Row>
            </ReviewSection>
            <ReviewSection title="Participants and schedule" onEdit={() => go('participants')} problems={stepProblems.participants}>
              <Row label="Who can be verified">{f.mode === 'selected'
                ? `${ELIGIBILITY_MODE_LABEL.selected}: ${plural(eligibleCount, 'person', 'people')} (${plural(f.people.groupIds.length, 'group', 'groups')}, ${plural(f.people.memberIds.length, 'user', 'users')})`
                : ELIGIBILITY_MODE_LABEL.open}</Row>
              <Row label="Schedule">{f.scheduleKind ? `${SCHEDULE_KIND_LABEL[f.scheduleKind]}${sched ? ` · ${sched}` : ''}` : unscheduledAllowed ? 'Not scheduled' : '—'}</Row>
              <Row label="Location">{[f.locationName.trim(), f.locationAddress.trim()].filter(Boolean).join(', ') || '—'}</Row>
              <Row label="Location check">{f.location.enabled && f.location.lat !== null && f.location.lng !== null
                ? `On · ${f.location.label || `${formatCoordinate(f.location.lat)}, ${formatCoordinate(f.location.lng)}`} · within ${formatRadius(f.location.radiusM)}` : 'Off'}</Row>
            </ReviewSection>
            <ReviewSection title="Identity source" onEdit={() => go('source')} problems={stepProblems.source}>
              <Row label="Source">{editable ? option?.label ?? '—' : 'Kept as configured'}</Row>
              {process && editable && <Row label="Process"><ol className="list-decimal pl-5 font-normal">{process.steps.map((s) => <li key={s}>{s}</li>)}</ol></Row>}
            </ReviewSection>
            <ReviewSection title="Verifiers" onEdit={() => go('verifiers')} problems={stepProblems.verifiers}>
              <Row label="Individual verifiers">{f.verifierIds.map(verifierName).join(', ') || 'None'}</Row>
              <Row label="Authorised sub-organizations">{f.subOrgIds.map(orgName).join(', ') || 'None'}</Row>
            </ReviewSection>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-5">
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={cancel} disabled={!!busy}>Cancel</Button>
            {index > 0 && <Button type="button" variant="secondary" onClick={() => go(STEPS[index - 1].id)} disabled={!!busy}>Back</Button>}
          </div>
          <div className="flex flex-wrap gap-2">
            {isDraft && step === 'review' && <Button type="button" variant="secondary" loading={busy === 'draft'} disabled={!!busy} onClick={() => void save('draft')}>Save as draft</Button>}
            {!isDraft && <Button type="button" variant={step === 'review' ? 'primary' : 'secondary'} loading={busy === 'changes'} disabled={!!busy} onClick={() => void save('changes')}>Save changes</Button>}
            {step !== 'review' ? <Button type="submit" disabled={!!busy}>Continue</Button>
              : isDraft && <Button type="submit" loading={busy === 'create'} disabled={!!busy}>Create activity</Button>}
          </div>
        </div>
      </form>

      {confirm === 'discard' && (
        <ConfirmDialog open tone="danger" title="Discard unsaved changes?" description="What you’ve entered will be lost." confirmLabel="Discard changes"
          onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); leave(); }} />
      )}
      {confirm === 'source' && (
        <ConfirmDialog open title="Change the identity source?" confirmLabel="Change source"
          description={`${plural(attemptCount, 'earlier verification record keeps', 'earlier verification records keep')} the source used at the time. New verifications will retrieve records from ${option?.label ?? 'the new source'}, and the portrait match stays required.`}
          onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void save(isDraft ? 'create' : 'changes', true); }} />
      )}
    </>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

function ReviewSection({ title, onEdit, problems, children }: { title: string; onEdit: () => void; problems: string[]; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          {problems.length ? <span className="h-2 w-2 rounded-full bg-red-500" aria-label="Needs attention" /> : <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />}{title}
        </h2>
        <Button type="button" size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>Edit<span className="sr-only"> {title}</span></Button>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function StepErrors({ problems }: { problems: string[] }) {
  return problems.length ? <IssuesList blockers={problems} warnings={[]} title="Before you continue" /> : null;
}

function Choice({ selected, onSelect, title, body }: { selected: boolean; onSelect: () => void; title: string; body: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cn('flex flex-col items-start rounded-lg border p-4 text-left text-sm', selected ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50')}>
      <span className="font-semibold text-slate-900">{title}</span>
      <span className="mt-0.5 text-slate-600">{body}</span>
    </button>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 font-medium text-slate-900">{children}</dd></div>
);
