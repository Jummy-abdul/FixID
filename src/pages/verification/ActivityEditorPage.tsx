import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Building2, ChevronRight, Lock, UserPlus, Users } from 'lucide-react';
import { Button, Card, Field, Input, SearchInput, Textarea, useToast } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { LocationCheckEditor, type LocationDraft } from '@/components/verification/LocationCheckEditor';
import { ParticipantsPicker, type Participants } from '@/components/verification/ParticipantsPicker';
import { IssuesList, VerifierPicker } from '@/components/verification/parts';
import { formatCoordinate, formatRadius, locationConfigProblem, type LocationCheckConfig } from '@/domain/location';
import type { ActivityConfig } from '@/domain/types';
import { DEFAULT_ELIGIBILITY_ATTRIBUTE, DEFAULT_ELIGIBLE_VALUES } from '@/domain/transactions';
import { AUDIENCE_LABEL, PARTICIPATION_LABEL, defaultSettings, type ActivityAudience, type VerificationSettings } from '@/domain/activitySettings';
import { activeAssignments, currentVersion, eligibleVerifiers, identityUnavailable } from '@/domain/verification';
import { cn } from '@/lib/cn';
import { NO_VERIFIER_WARNING, nameProblem, type ActivityForm } from '@/store/activityOps';
import {
  activityPolicyProblems, audienceOf, availableSources, configFromSettings, invitableOrganizations, participantProblems, settingsEditable, settingsFromVersion,
} from '@/store/sharingOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { checksLabel } from '@/components/verification/RequirementsSummary';
import { NotFoundPage } from '../NotFoundPage';
import { activityPath } from './paths';

export function ActivityEditorPage() {
  const { activityId } = useParams();
  const { state } = useStore();
  const { organization } = useSession();
  // Only the owner edits an activity; organizations taking part in a shared activity can't change it.
  const activity = activityId ? state.data.activityConfigs.find((a) => a.id === activityId && a.organizationId === organization.id) : undefined;
  if (activityId && !activity) return <NotFoundPage entity="verification activity" backTo="/verification-activities" />;
  return <Editor key={activity?.id ?? 'new'} activity={activity} />;
}

interface FormState {
  name: string;
  description: string;
  audience: ActivityAudience;
  /** Key of the chosen identity source ('local' or an integration ID). */
  sourceId: string;
  participantIds: string[];
  faceMatch: boolean;
  liveness: boolean;
  onFailure: 'unsuccessful' | 'review';
  verifierIds: string[];
  /** Optional, under "More options". */
  people: Participants;
  location: LocationDraft;
}

const toDraft = (c?: LocationCheckConfig): LocationDraft => {
  const ok = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { enabled: !!c?.enabled, lat: ok(c?.lat), lng: ok(c?.lng), radiusM: c?.radiusM ?? 100, label: c?.label ?? '' };
};
const toConfig = (d: LocationDraft): LocationCheckConfig => ({ enabled: d.enabled, lat: d.lat ?? Number.NaN, lng: d.lng ?? Number.NaN, radiusM: d.radiusM, ...(d.label ? { label: d.label } : {}) });
const sourceKey = (s: VerificationSettings['identitySource']) => (s.kind === 'local' ? 'local' : s.integrationId);

/**
 * Create or edit a Verification Activity on one short page: name, who it's for, identity source, the
 * organizations taking part (shared activities only), required checks and who verifies, then review and
 * create. Everything else has a safe default; limiting who can be verified and a location check are under
 * "More options".
 */
function Editor({ activity }: { activity?: ActivityConfig }) {
  const { state, getState } = useStore();
  const { organization } = useSession();
  const { can, record } = useAuthorization();
  const { saveActivity, activateActivity } = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isNew = !activity;
  const version = activity ? currentVersion(state.data, activity) : undefined;
  const editable = settingsEditable(version);
  const existing = activity ? activity.verification ?? settingsFromVersion(version) : undefined;

  const [f, setF] = useState<FormState>(() => {
    const audience: ActivityAudience = activity ? audienceOf(activity) : params.get('type') === 'shared' ? 'shared' : 'own';
    const sources = availableSources(state, organization.id, audience);
    const s = existing ?? defaultSettings();
    return {
      name: activity?.name ?? '', description: activity?.description || activity?.purpose || '', audience,
      // A single suitable source is preselected.
      sourceId: existing ? sourceKey(existing.identitySource) : sources.length === 1 ? sources[0].id : '',
      participantIds: (activity?.sharing?.participants ?? []).filter((p) => p.status !== 'removed' && p.status !== 'declined').map((p) => p.organizationId),
      faceMatch: s.method === 'face', liveness: s.method !== 'face' || s.liveness === 'required',
      onFailure: s.exceptions === 'unsuccessful' ? 'unsuccessful' : 'review',
      // A new activity starts with the administrator creating it as its verifier, when they can verify.
      verifierIds: activity ? activeAssignments(state.data, organization.id, activity.id).map((v) => v.administratorId)
        : record && eligibleVerifiers(state.data, organization.id).some((a) => a.id === record.id) ? [record.id] : [],
      people: activity?.participants ?? { groupIds: [], memberIds: [] },
      location: toDraft(activity?.locationCheck),
    };
  });
  // New activities start with one question: who it's for. `?type=shared|own` answers it up front.
  const [chosen, setChosen] = useState(!isNew || params.get('type') === 'shared' || params.get('type') === 'own');
  const [busy, setBusy] = useState<'draft' | 'create' | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  // A new activity for the organization's own use is set up in two steps, then reviewed.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  const canDetails = isNew ? can('verification.activities.create') : can('verification.activities.edit');
  const canAssign = can('verification.verifiers.assign');
  const sources = availableSources(state, organization.id, f.audience);
  const source = sources.find((x) => x.id === f.sourceId);
  const orgs = invitableOrganizations(state, organization.id);
  const [orgQuery, setOrgQuery] = useState('');
  const shownOrgs = orgs.filter((o) => !orgQuery.trim() || o.name.toLowerCase().includes(orgQuery.trim().toLowerCase()));
  const faceAvailable = !source || source.capabilities.includes('matching');

  /** The settings saved from the form. Settings that aren't asked here keep their stored (or default) values. */
  const settingsOf = (x: FormState): VerificationSettings | null => {
    const src = sources.find((y) => y.id === x.sourceId);
    if (!src) return null;
    const base = existing ?? defaultSettings();
    // A shared activity takes its checks from the identity source: face match and liveness when the source
    // can match faces; problems go to review. Nothing else is asked.
    const shared = x.audience === 'shared';
    const face = (shared || x.faceMatch) && src.capabilities.includes('matching');
    const sameSource = !!existing && sourceKey(existing.identitySource) === src.id;
    // Eligibility isn't asked: a connected source's record status decides it; FixID records check anyone
    // registered unless "More options" limits who can be verified. An earlier reference list is kept.
    const eligibility: VerificationSettings['eligibility'] = sameSource && existing!.eligibility.approach === 'reference-list' ? existing!.eligibility
      : src.source.kind === 'external' ? { approach: 'external-source', attribute: DEFAULT_ELIGIBILITY_ATTRIBUTE, allowedValues: DEFAULT_ELIGIBLE_VALUES }
        : { approach: x.people.groupIds.length || x.people.memberIds.length ? 'local-population' : 'none' };
    return {
      ...base, identitySource: src.source, method: face ? 'face' : 'record',
      liveness: face ? (shared || x.liveness ? 'required' : 'optional') : 'not-applicable',
      exceptions: shared ? (existing && audienceOf(activity!) === 'shared' ? existing.exceptions : 'review') : x.onFailure, eligibility,
    };
  };
  const settings = settingsOf(f);

  const buildForm = (x: FormState): ActivityForm | null => {
    const s = settingsOf(x);
    if (!s && editable) return null;
    const changed = editable && !!s && (isNew || JSON.stringify(s) !== JSON.stringify(existing));
    let n = 0;
    const identifierConfigId = version?.checks.find((c) => c.params.identifierConfigId)?.params.identifierConfigId;
    const gen = changed && s ? configFromSettings(s, organization, () => `new_${++n}`, identifierConfigId) : null;
    const common = {
      // Participating organizations assign their own verifiers to a shared activity.
      name: x.name, description: x.description, purpose: x.description, verifierIds: x.audience === 'shared' && isNew ? [] : x.verifierIds,
      participants: x.people, locationCheck: toConfig(x.location),
      ...(isNew ? { audience: x.audience } : {}), ...(x.audience === 'shared' ? { participantIds: x.participantIds } : {}),
      ...(editable && s ? { verification: s } : {}),
    };
    if (gen) return { ...common, type: gen.type, checks: gen.checks, outcome: gen.outcome, requirements: gen.requirements, customized: false };
    if (!version) return null;
    return { ...common, type: version.type, checks: version.checks, outcome: version.outcome, keepConfiguration: true };
  };

  // What's missing, in plain language. Shown after the first attempt to save.
  const name = nameProblem(state, organization.id, f.name, activity?.id);
  const location = locationConfigProblem(toConfig(f.location));
  const generated = settings ? configFromSettings(settings, organization, () => 'x') : undefined;
  const identity = settings?.identitySource.kind === 'local' && generated ? identityUnavailable(generated, organization) : null;
  const missing = [...new Set([
    ...(name ? [name] : []),
    ...(editable && !source ? [sources.length ? 'Choose an identity source.' : 'Connect an identity source in Settings → Integrations first.'] : []),
    ...(f.audience === 'shared' ? participantProblems(state, organization.id, f.participantIds) : []),
    ...(settings && editable ? activityPolicyProblems(state, organization.id, settings, f.audience) : []),
    ...(identity ? [identity] : []),
    ...(location ? [location] : []),
  ])];

  const save = async (activate: boolean) => {
    setShowErrors(true);
    // A draft only needs a name and an identity source; everything else can be finished later.
    if (activate ? missing.length : name || (editable && !source)) return;
    const form = buildForm(f);
    if (!form) return;
    setBusy(activate ? 'create' : 'draft');
    setProblems(null);
    await new Promise((r) => setTimeout(r, 150));
    const saved = saveActivity(organization.id, activity?.id, form);
    if (!saved.ok) { setBusy(null); setProblems(saved.problems ?? [saved.error]); return; }
    const stored = getState().data.activityConfigs.find((a) => a.id === saved.activityId)!;
    if (!activate || (stored.status === 'active' && !stored.draftVersionId)) {
      setBusy(null);
      toast({ tone: 'success', title: activate ? 'Changes saved' : 'Saved as draft', description: f.name.trim() });
      navigate(activityPath(saved.activityId));
      return;
    }
    const activated = activateActivity(organization.id, saved.activityId);
    setBusy(null);
    if (!activated.ok) {
      setProblems(activated.problems ?? [activated.error]);
      toast({ tone: 'error', title: 'Saved as draft', description: 'Resolve the listed items to start using it.' });
      if (isNew) navigate(`${activityPath(saved.activityId)}/edit`, { replace: true });
      return;
    }
    toast({
      tone: 'success', title: isNew ? 'Activity created' : 'Changes saved',
      description: f.audience === 'shared' ? `${f.name.trim()} is ready. Invited organizations see it in their own workspaces.` : `${f.name.trim()} is ready for its verifiers.`,
    });
    navigate(activityPath(saved.activityId));
  };

  /**
   * Inviting an administrator leaves the page: the activity is kept as a draft first (one record, updated in
   * place), and Settings offers a way back to it.
   */
  const inviteAdministrator = async () => {
    if (name) { setShowErrors(true); return; }
    const built = buildForm(f);
    const saved = built ? saveActivity(organization.id, activity?.id, built) : null;
    if (!saved || !saved.ok) { setShowErrors(true); if (saved && !saved.ok) setProblems(saved.problems ?? [saved.error]); return; }
    navigate(`/settings?tab=admins&invite=1&returnTo=${encodeURIComponent(`${activityPath(saved.activityId)}/edit`)}`);
  };

  if (isNew ? !can('verification.activities.create') : !canDetails) return <NoAccess />;
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const participantStatus = (id: string) => activity?.sharing?.participants.find((p) => p.organizationId === id)?.status;
  const chooseAudience = (audience: ActivityAudience) => {
    setF((x) => {
      const list = availableSources(state, organization.id, audience);
      return { ...x, audience, sourceId: list.some((s) => s.id === x.sourceId) ? x.sourceId : list.length === 1 ? list[0].id : '' };
    });
    setChosen(true);
  };

  const audienceLine = (
    <p className="flex items-center gap-2 text-sm text-slate-600">
      {isNew ? <>{f.audience === 'shared' ? <Building2 className="h-4 w-4" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}{AUDIENCE_LABEL[f.audience]}
        <button type="button" onClick={() => setChosen(false)} className="font-medium text-brand-600 hover:text-brand-700">Change</button></>
        : <><Lock className="h-4 w-4 text-slate-400" aria-hidden="true" />{AUDIENCE_LABEL[f.audience]}</>}
    </p>
  );
  const detailsFields = (
    <>
      <Field label="Activity name" error={showErrors && name ? name : undefined}>
        {(p) => <Input {...p} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Enter activity name" maxLength={80} readOnly={!canDetails} />}
      </Field>
      <Field label="Short description (optional)">
        {(p) => <Textarea {...p} rows={2} placeholder="Describe the purpose of this verification activity" value={f.description} onChange={(e) => set('description', e.target.value)} readOnly={!canDetails} />}
      </Field>
    </>
  );
  const sourceFields = (
    <>
      {!editable ? (
        <p className="text-sm text-slate-600">Kept as configured.</p>
      ) : sources.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          No identity source available. <Link to="/settings?tab=integrations" className="font-semibold underline">Connect one in Settings</Link>.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Identity source" className="space-y-2">
          {sources.map((s) => (
            <label key={s.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm', f.sourceId === s.id ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50')}>
              <input type="radio" name="source" className="mt-0.5" checked={f.sourceId === s.id} onChange={() => set('sourceId', s.id)} disabled={!canDetails} aria-label={s.label} />
              <span><span className="block font-medium text-slate-900">{s.label}</span><span className="text-slate-500">{s.detail}</span></span>
            </label>
          ))}
        </div>
      )}
      {showErrors && editable && sources.length > 0 && !source && <p className="text-sm text-red-700">Choose an identity source.</p>}
    </>
  );
  const checkFields = !editable ? <p className="text-sm text-slate-600">Kept as configured.</p> : (
    <div className="space-y-3 text-sm">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-0.5" checked={f.faceMatch && faceAvailable} disabled={!canDetails || !faceAvailable} onChange={(e) => set('faceMatch', e.target.checked)} />
        <span><span className="font-medium text-slate-900">Match the person’s face</span>{!faceAvailable && <span className="block text-slate-500">Not offered by this source.</span>}</span>
      </label>
      {f.faceMatch && faceAvailable && (
        <label className="ml-7 flex items-start gap-3">
          <input type="checkbox" className="mt-0.5" checked={f.liveness} disabled={!canDetails} onChange={(e) => set('liveness', e.target.checked)} />
          <span className="font-medium text-slate-900">Confirm a live person is present</span>
        </label>
      )}
      <div>
        <p className="font-medium text-slate-900">When a check fails</p>
        <div role="radiogroup" aria-label="When a check fails" className="mt-1 flex flex-wrap gap-4">
          {([['unsuccessful', 'Not verified'], ['review', 'Pending review']] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="onFailure" checked={f.onFailure === v} disabled={!canDetails} onChange={() => set('onFailure', v)} />{label}</label>
          ))}
        </div>
      </div>
    </div>
  );
  const verifierFields = (
    <>
      <VerifierPicker value={f.verifierIds} onChange={(v) => set('verifierIds', v)} readOnly={!canAssign} />
      {can('administrators.invite') && (isNew || activity?.status === 'draft') && (
        <Button type="button" variant="ghost" size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => void inviteAdministrator()}>Invite Administrator</Button>
      )}
    </>
  );
  const peopleFields = settings?.identitySource.kind === 'local' ? (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-900">Limit who can be verified (optional)</p>
      <ParticipantsPicker value={f.people} onChange={(p) => set('people', p)} readOnly={!canDetails} />
    </div>
  ) : null;
  const locationFields = <LocationCheckEditor value={f.location} onChange={(v) => set('location', v)} readOnly={!canDetails} error={showErrors ? location : null} />;
  const noVerifier = f.audience === 'own' && f.verifierIds.length === 0 && <div className="mt-4"><IssuesList blockers={[]} warnings={[NO_VERIFIER_WARNING]} warningsTitle="No verifier assigned" /></div>;
  const draftButton = (isNew || activity?.status === 'draft') && <Button type="button" variant="secondary" loading={busy === 'draft'} disabled={!!busy} onClick={() => void save(false)}>Save as draft</Button>;

  if (isNew && f.audience === 'own' && chosen) {
    // Step 2 covers everything except the name; the name is checked on step 1.
    const configMissing = missing.filter((m) => m !== name);
    const next = () => {
      setShowErrors(true);
      if (step === 1 && name) return;
      if (step === 2 && configMissing.length) return;
      setShowErrors(false);
      setProblems(null);
      setStep(step === 1 ? 2 : 3);
    };
    const back = () => { setShowErrors(false); setProblems(null); setStep(step === 3 ? 2 : 1); };
    const verifierNames = f.verifierIds.map((id) => { const a = state.data.administrators.find((x) => x.id === id); return a?.name ?? a?.email ?? id; });
    const loc = f.location;
    return (
      <>
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
          <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="text-slate-700">Create activity</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Create activity</h1>
        <form className="mt-6 max-w-3xl space-y-5" noValidate
          onSubmit={(e) => { e.preventDefault(); if (step === 3) void save(true); else next(); }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {step === 1 ? audienceLine : <p className="text-sm text-slate-600">{AUDIENCE_LABEL.own}</p>}
            <p className="text-sm font-medium text-slate-700" aria-live="polite">{step === 3 ? 'Review' : `Step ${step} of 2`}</p>
          </div>

          {step === 1 && <Section title="Activity details">{detailsFields}</Section>}

          {step === 2 && (
            <>
              <Section title="Identity source">
                {sourceFields}
                {source && editable && <div className="border-t border-slate-100 pt-4">{checkFields}</div>}
                {peopleFields && <details className="border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-slate-700">Limit who can be verified</summary><div className="mt-3">{peopleFields}</div></details>}
              </Section>
              <Section title="Who can verify?">{verifierFields}</Section>
              <Section title="Location check">{locationFields}</Section>
              {showErrors && configMissing.length > 0 && <IssuesList blockers={configMissing} warnings={[]} title="Before you continue" />}
            </>
          )}

          {step === 3 && (
            <Card className="p-5">
              <h2 className="text-base font-semibold text-slate-900">Review</h2>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2" aria-label="Activity summary">
                <Row label="Name">{f.name.trim()}</Row>
                {f.description.trim() && <Row label="Description">{f.description.trim()}</Row>}
                <Row label="Identity source">{source?.label ?? '—'}</Row>
                <Row label="Checks">{settings ? checksLabel(settings) : '—'}</Row>
                <Row label="Verifiers">{verifierNames.join(', ') || 'None yet'}</Row>
                <Row label="Location check">{loc.enabled && loc.lat !== null && loc.lng !== null
                  ? `On · ${loc.label || `${formatCoordinate(loc.lat)}, ${formatCoordinate(loc.lng)}`} · within ${formatRadius(loc.radiusM)}` : 'Off'}</Row>
              </dl>
              {showErrors && (missing.length > 0 || problems) && <div className="mt-4"><IssuesList blockers={problems ?? missing} warnings={[]} title="Before you continue" /></div>}
              {noVerifier}
            </Card>
          )}

          <div className="flex flex-wrap justify-between gap-2">
            {step > 1 ? <Button type="button" variant="secondary" onClick={back} disabled={!!busy}>Back</Button> : <span />}
            <div className="flex flex-wrap gap-2">
              {step === 3 && draftButton}
              {step === 3 ? <Button type="submit" loading={busy === 'create'} disabled={!!busy}>Create Activity</Button> : <Button type="submit">Next</Button>}
            </div>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        {activity ? <><Link to={activityPath(activity.id)} className="truncate hover:text-slate-800">{activity.name}</Link><ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-slate-700">Edit</span></>
          : <span className="text-slate-700">Create activity</span>}
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{activity ? `Edit ${activity.name}` : 'Create activity'}</h1>

      {!chosen ? (
        <section className="mt-6 max-w-3xl" aria-label="What do you want to do?">
          <h2 className="text-base font-semibold text-slate-900">What do you want to do?</h2>
          <div role="radiogroup" aria-label="What do you want to do?" className="mt-3 grid gap-3 sm:grid-cols-2">
            <Choice selected={false} onSelect={() => chooseAudience('shared')} icon={<Building2 className="h-5 w-5" />}
              title={AUDIENCE_LABEL.shared} body="Invite organizations to verify people for you." />
            <Choice selected={false} onSelect={() => chooseAudience('own')} icon={<Users className="h-5 w-5" />}
              title={AUDIENCE_LABEL.own} body="Verify people with your own staff." />
          </div>
        </section>
      ) : (
      <form className="mt-6 max-w-3xl space-y-5" onSubmit={(e) => { e.preventDefault(); void save(true); }} noValidate>
        {audienceLine}

        <Section n={1} title="Activity details">{detailsFields}</Section>

        <Section n={2} title="Identity source">{sourceFields}</Section>

        {f.audience === 'shared' ? (
          <Section n={3} title="Participating organizations">
            {orgs.length > 8 && (
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <SearchInput value={orgQuery} onChange={setOrgQuery} placeholder="Search organizations" label="Search organizations" className="sm:w-72" />
                {canDetails && shownOrgs.length > 0 && orgQuery.trim() && (
                  <Button variant="ghost" size="sm" onClick={() => set('participantIds', [...new Set([...f.participantIds, ...shownOrgs.map((o) => o.id)])])}>Select all shown</Button>
                )}
                <span className="text-xs text-slate-500">{f.participantIds.length} selected</span>
              </div>
            )}
            <fieldset aria-label="Participating organizations" className="grid gap-2 sm:grid-cols-2">
              {shownOrgs.map((o) => {
                const st = participantStatus(o.id);
                return (
                  <label key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={f.participantIds.includes(o.id)} disabled={!canDetails}
                        onChange={(e) => set('participantIds', e.target.checked ? [...f.participantIds, o.id] : f.participantIds.filter((x) => x !== o.id))} />
                      {o.name}
                    </span>
                    {st && st !== 'removed' && st !== 'declined' && <span className="text-xs text-slate-500">{PARTICIPATION_LABEL[st]}</span>}
                  </label>
                );
              })}
            </fieldset>
            <p className="text-xs text-slate-500">Each organization assigns its own verifiers.</p>
          </Section>
        ) : (
          <>
            <Section n={3} title="Checks">{checkFields}</Section>

            <Section n={4} title="Who can verify">{verifierFields}</Section>

            <details className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">More options</summary>
              <div className="mt-4 space-y-5">
                {peopleFields}
                {locationFields}
              </div>
            </details>
          </>
        )}

        <Card className="p-5">
          <h2 className="text-base font-semibold text-slate-900">Review</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Row label="Name">{f.name.trim() || '—'}</Row>
            <Row label="Identity source">{source?.label ?? (editable ? '—' : 'Kept as configured')}</Row>
            {f.audience === 'shared' && <Row label="Participating organizations">{f.participantIds.map(orgName).join(', ') || '—'}</Row>}
            <Row label="Checks">{settings ? checksLabel(settings) : '—'}</Row>
          </dl>
          {showErrors && (missing.length > 0 || problems) && <div className="mt-4"><IssuesList blockers={problems ?? missing} warnings={[]} title="Before you continue" /></div>}
          {/* Nobody can verify an activity for the organization's own use until someone is assigned. */}
          {noVerifier}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {draftButton}
            <Button type="submit" loading={busy === 'create'} disabled={!!busy}>{isNew ? 'Create Activity' : activity?.status === 'active' ? 'Save changes' : 'Save and activate'}</Button>
          </div>
        </Card>
      </form>
      )}
    </>
  );
}

function Section({ n, title, description, children }: { n?: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">{n !== undefined && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs text-brand-700" aria-hidden="true">{n}</span>}{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

function Choice({ selected, onSelect, icon, title, body }: { selected: boolean; onSelect: () => void; icon: React.ReactNode; title: string; body: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cn('flex items-start gap-3 rounded-lg border p-4 text-left text-sm', selected ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50')}>
      <span className="text-brand-600" aria-hidden="true">{icon}</span>
      <span><span className="block font-semibold text-slate-900">{title}</span><span className="text-slate-600">{body}</span></span>
    </button>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><dt className="text-slate-500">{label}</dt><dd className="font-medium text-slate-900">{children}</dd></div>
);
