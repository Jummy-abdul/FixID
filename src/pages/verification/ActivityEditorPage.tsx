import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, ChevronRight, Lock, UserPlus, Users } from 'lucide-react';
import { Button, Card, Field, Input, Textarea, useToast } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { LocationCheckEditor, type LocationDraft } from '@/components/verification/LocationCheckEditor';
import { ParticipantsPicker, type Participants } from '@/components/verification/ParticipantsPicker';
import { IssuesList, VerifierPicker } from '@/components/verification/parts';
import { locationConfigProblem, type LocationCheckConfig } from '@/domain/location';
import type { ActivityConfig } from '@/domain/types';
import { DEFAULT_ELIGIBILITY_ATTRIBUTE, DEFAULT_ELIGIBLE_VALUES } from '@/domain/transactions';
import { AUDIENCE_LABEL, defaultSettings, type ActivityAudience, type VerificationSettings } from '@/domain/activitySettings';
import { activeAssignments, currentVersion, eligibleVerifiers, identityUnavailable } from '@/domain/verification';
import { cn } from '@/lib/cn';
import { NO_VERIFIER_WARNING, nameProblem, type ActivityForm } from '@/store/activityOps';
import {
  activityPolicyProblems, audienceOf, availableSources, configFromSettings, invitableOrganizations, participantProblems, settingsEditable, settingsFromVersion,
} from '@/store/sharingOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
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
  const isNew = !activity;
  const version = activity ? currentVersion(state.data, activity) : undefined;
  const editable = settingsEditable(version);
  const existing = activity ? activity.verification ?? settingsFromVersion(version) : undefined;

  const [f, setF] = useState<FormState>(() => {
    const audience: ActivityAudience = activity ? audienceOf(activity) : 'own';
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
  const [busy, setBusy] = useState<'draft' | 'create' | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  const canDetails = isNew ? can('verification.activities.create') : can('verification.activities.edit');
  const canAssign = can('verification.verifiers.assign');
  const sources = availableSources(state, organization.id, f.audience);
  const source = sources.find((x) => x.id === f.sourceId);
  const orgs = invitableOrganizations(state, organization.id);
  const faceAvailable = !source || source.capabilities.includes('matching');

  /** The settings saved from the form. Settings that aren't asked here keep their stored (or default) values. */
  const settingsOf = (x: FormState): VerificationSettings | null => {
    const src = sources.find((y) => y.id === x.sourceId);
    if (!src) return null;
    const base = existing ?? defaultSettings();
    const face = x.faceMatch && src.capabilities.includes('matching');
    const sameSource = !!existing && sourceKey(existing.identitySource) === src.id;
    // Eligibility isn't asked: a connected source's record status decides it; FixID records check anyone
    // registered unless "More options" limits who can be verified. An earlier reference list is kept.
    const eligibility: VerificationSettings['eligibility'] = sameSource && existing!.eligibility.approach === 'reference-list' ? existing!.eligibility
      : src.source.kind === 'external' ? { approach: 'external-source', attribute: DEFAULT_ELIGIBILITY_ATTRIBUTE, allowedValues: DEFAULT_ELIGIBLE_VALUES }
        : { approach: x.people.groupIds.length || x.people.memberIds.length ? 'local-population' : 'none' };
    return {
      ...base, identitySource: src.source, method: face ? 'face' : 'record',
      liveness: face ? (x.liveness ? 'required' : 'optional') : 'not-applicable',
      exceptions: x.onFailure, eligibility,
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
      name: x.name, description: x.description, purpose: x.description, verifierIds: x.verifierIds,
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
  const live = activity && activity.status !== 'draft';
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const participantStatus = (id: string) => activity?.sharing?.participants.find((p) => p.organizationId === id)?.status;
  const chooseAudience = (audience: ActivityAudience) => setF((x) => {
    const list = availableSources(state, organization.id, audience);
    return { ...x, audience, sourceId: list.some((s) => s.id === x.sourceId) ? x.sourceId : list.length === 1 ? list[0].id : '' };
  });
  const step = (k: 'participants' | 'checks' | 'verifiers') => ({ participants: 4, checks: f.audience === 'shared' ? 5 : 4, verifiers: f.audience === 'shared' ? 6 : 5 }[k]);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        {activity ? <><Link to={activityPath(activity.id)} className="truncate hover:text-slate-800">{activity.name}</Link><ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-slate-700">Edit</span></>
          : <span className="text-slate-700">Create activity</span>}
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{activity ? `Edit ${activity.name}` : 'Create verification activity'}</h1>
      {live && <p className="mt-3 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">Changes apply as soon as you save. Earlier verifications keep the settings they used.</p>}

      <form className="mt-6 max-w-3xl space-y-5" onSubmit={(e) => { e.preventDefault(); void save(true); }} noValidate>
        <Section n={1} title="Activity name">
          <Field label="Activity name" error={showErrors && name ? name : undefined}>
            {(p) => <Input {...p} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Enter activity name" maxLength={80} readOnly={!canDetails} />}
          </Field>
          <Field label="Short description" hint="Optional. Shown to verifiers and, for a shared activity, to participating organizations.">
            {(p) => <Textarea {...p} rows={2} placeholder="Describe the purpose of this verification activity" value={f.description} onChange={(e) => set('description', e.target.value)} readOnly={!canDetails} />}
          </Field>
        </Section>

        <Section n={2} title="Who is this activity for?">
          {isNew ? (
            <div role="radiogroup" aria-label="Who is this activity for?" className="grid gap-3 sm:grid-cols-2">
              <Choice selected={f.audience === 'own'} onSelect={() => chooseAudience('own')} icon={<Users className="h-5 w-5" />}
                title={AUDIENCE_LABEL.own} body="Your staff verify people for your organization’s own purposes." />
              <Choice selected={f.audience === 'shared'} onSelect={() => chooseAudience('shared')} icon={<Building2 className="h-5 w-5" />}
                title={AUDIENCE_LABEL.shared} body="Other organizations run this activity from their own FixID workspaces, with the requirements you set." />
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-slate-700"><Lock className="h-4 w-4 text-slate-400" aria-hidden="true" />{AUDIENCE_LABEL[f.audience]}. This is set when the activity is created.</p>
          )}
        </Section>

        <Section n={3} title="Identity source" description="Where FixID checks the identifier a verifier enters. Sources are connected in Settings → Integrations.">
          {!editable ? (
            <p className="text-sm text-slate-600">This activity uses an earlier credential-based configuration, which is kept as it is.</p>
          ) : sources.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              No connected identity source is available. <Link to="/settings?tab=integrations" className="font-semibold underline">Connect one in Settings</Link>.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Identity source" className="space-y-2">
              {sources.map((s) => (
                <label key={s.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm', f.sourceId === s.id ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50')}>
                  <input type="radio" name="source" className="mt-0.5" checked={f.sourceId === s.id} onChange={() => set('sourceId', s.id)} disabled={!canDetails} aria-label={s.label} />
                  <span><span className="block font-medium text-slate-900">{s.label}</span><span className="text-slate-500">{s.detail}</span></span>
                </label>
              ))}
              {f.audience === 'shared' && <p className="text-xs text-slate-500">Shared activities use a connected source, so participating organizations never see your own FixID records.</p>}
            </div>
          )}
          {showErrors && editable && sources.length > 0 && !source && <p className="text-sm text-red-700">Choose an identity source.</p>}
        </Section>

        {f.audience === 'shared' && (
          <Section n={step('participants')} title="Participating organizations" description="Each one gets an invitation in its own FixID workspace and runs this activity with its own staff. They can’t change its requirements or see your other data.">
            <fieldset aria-label="Participating organizations" className="grid gap-2 sm:grid-cols-2">
              {orgs.map((o) => {
                const st = participantStatus(o.id);
                return (
                  <label key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={f.participantIds.includes(o.id)} disabled={!canDetails}
                        onChange={(e) => set('participantIds', e.target.checked ? [...f.participantIds, o.id] : f.participantIds.filter((x) => x !== o.id))} />
                      {o.name}
                    </span>
                    {st && st !== 'removed' && st !== 'declined' && <span className="text-xs text-slate-500">{st === 'active' ? 'Taking part' : st === 'invited' ? 'Invited' : 'Suspended'}</span>}
                  </label>
                );
              })}
            </fieldset>
          </Section>
        )}

        <Section n={step('checks')} title="Required checks" description={f.audience === 'shared' ? 'These apply to every participating organization.' : undefined}>
          {!editable ? <p className="text-sm text-slate-600">Kept as configured.</p> : (
            <div className="space-y-3 text-sm">
              <p className="text-slate-700">FixID always checks the identifier against the identity source. A valid-looking identifier isn’t enough: the person is only verified when the checks below pass.</p>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-0.5" checked={f.faceMatch && faceAvailable} disabled={!canDetails || !faceAvailable} onChange={(e) => set('faceMatch', e.target.checked)} />
                <span><span className="font-medium text-slate-900">Match the person’s face</span><span className="block text-slate-500">{faceAvailable ? 'Compare a live photo with the identity record.' : 'This identity source offers record lookup only.'} Without it, the verifier confirms stated details instead.</span></span>
              </label>
              {f.faceMatch && faceAvailable && (
                <label className="ml-7 flex items-start gap-3">
                  <input type="checkbox" className="mt-0.5" checked={f.liveness} disabled={!canDetails} onChange={(e) => set('liveness', e.target.checked)} />
                  <span><span className="font-medium text-slate-900">Confirm a live person is present</span><span className="block text-slate-500">A liveness check before the face match. Recommended.</span></span>
                </label>
              )}
              <div>
                <p className="font-medium text-slate-900">When a check fails or can’t be completed</p>
                <div role="radiogroup" aria-label="When a check fails" className="mt-1 flex flex-wrap gap-4">
                  {([['unsuccessful', 'Mark as not verified'], ['review', 'Send for review']] as const).map(([v, label]) => (
                    <label key={v} className="flex items-center gap-2"><input type="radio" name="onFailure" checked={f.onFailure === v} disabled={!canDetails} onChange={() => set('onFailure', v)} />{label}</label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">If the identity source is unavailable, no decision is made: the person isn’t treated as invalid.</p>
              </div>
            </div>
          )}
        </Section>

        <Section n={step('verifiers')} title="Who can verify" description={f.audience === 'shared' ? 'Your own staff (optional). Participating organizations assign their own staff.' : 'Staff who perform verifications for this activity.'}>
          <VerifierPicker value={f.verifierIds} onChange={(v) => set('verifierIds', v)} readOnly={!canAssign} />
          {can('administrators.invite') && (isNew || activity?.status === 'draft') && (
            <Button type="button" variant="ghost" size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => void inviteAdministrator()}>Invite Administrator</Button>
          )}
        </Section>

        <details className="rounded-xl border border-slate-200 bg-white px-5 py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">More options</summary>
          <div className="mt-4 space-y-5">
            {settings?.identitySource.kind === 'local' && (
              <div>
                <p className="text-sm font-medium text-slate-900">Limit who can be verified (optional)</p>
                <p className="mb-2 text-sm text-slate-500">By default, anyone registered in your FixID records can be checked. Choose groups or people to allow only them.</p>
                <ParticipantsPicker value={f.people} onChange={(p) => set('people', p)} readOnly={!canDetails} />
              </div>
            )}
            <LocationCheckEditor value={f.location} onChange={(v) => set('location', v)} readOnly={!canDetails} error={showErrors ? location : null} />
          </div>
        </details>

        <Card className="p-5">
          <h2 className="text-base font-semibold text-slate-900">Review and create</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Row label="Name">{f.name.trim() || '—'}</Row>
            <Row label="For">{AUDIENCE_LABEL[f.audience]}</Row>
            <Row label="Identity source">{source?.label ?? (editable ? '—' : 'Kept as configured')}</Row>
            {f.audience === 'shared' && <Row label="Participating organizations">{f.participantIds.map(orgName).join(', ') || '—'}</Row>}
            <Row label="Checks">{settings ? ['Identifier', ...(settings.method === 'face' ? ['face match', ...(settings.liveness === 'required' ? ['liveness'] : [])] : ['stated details'])].join(', ') : '—'}</Row>
            <Row label="Failures">{f.onFailure === 'review' ? 'Sent for review' : 'Marked as not verified'}</Row>
          </dl>
          {showErrors && (missing.length > 0 || problems) && <div className="mt-4"><IssuesList blockers={problems ?? missing} warnings={[]} title="Before you continue" /></div>}
          {/* Nobody can verify an activity for the organization's own use until someone is assigned. */}
          {f.audience === 'own' && f.verifierIds.length === 0 && <div className="mt-4"><IssuesList blockers={[]} warnings={[NO_VERIFIER_WARNING]} warningsTitle="No verifier assigned" /></div>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {(isNew || activity?.status === 'draft') && <Button type="button" variant="secondary" loading={busy === 'draft'} disabled={!!busy} onClick={() => void save(false)}>Save as draft</Button>}
            <Button type="submit" loading={busy === 'create'} disabled={!!busy}>{isNew ? 'Create activity' : activity?.status === 'active' ? 'Save changes' : 'Save and activate'}</Button>
          </div>
        </Card>
      </form>
    </>
  );
}

function Section({ n, title, description, children }: { n: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs text-brand-700" aria-hidden="true">{n}</span>{title}</h2>
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
