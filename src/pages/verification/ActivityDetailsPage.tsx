import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarClock, ChevronDown, ChevronRight, Copy, MapPin, Pencil, Power, PowerOff, Trash2, Undo2, Users, Wrench } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, ConfirmDialog, DataTable, EmptyState, Modal, OverflowMenu, Tabs, useToast, type OverflowMenuItem,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { ParticipantsPicker, useEligibleCount, type Participants } from '@/components/verification/ParticipantsPicker';
import { ActivityStatusBadge, ChecksSummary, IssuesList, RulesList } from '@/components/verification/parts';
import { memberCounts } from '@/domain/groups';
import type { ActivityConfig, ActivityVersion } from '@/domain/types';
import { describeRequirements, validateConfiguration } from '@/domain/verification';
import { useQueryState } from '@/hooks/useQueryState';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/dates';
import { activationProblems, validationContext } from '@/store/activityOps';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { NotFoundPage } from '../NotFoundPage';
import { AttemptsTable } from './VerificationHistoryPage';
import { activityPath } from './paths';

type TabId = 'overview' | 'participants' | 'history';

export function ActivityDetailsPage() {
  const { activityId } = useParams();
  const { state } = useStore();
  const { organization } = useSession();
  const activity = state.data.activityConfigs.find((a) => a.id === activityId && a.organizationId === organization.id);
  if (!activity) return <NotFoundPage entity="verification activity" backTo="/verification-activities" />;
  return <Details key={activity.id} activity={activity} />;
}

export const scheduleText = (s?: ActivityConfig['schedule']) => (s?.startsAt || s?.endsAt
  ? `${s.startsAt ? formatDateTime(s.startsAt) : '…'} – ${s.endsAt ? formatDateTime(s.endsAt) : '…'}` : null);

function Details({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useQueryState('tab', 'overview');
  const [pending, setPending] = useState<'activate' | 'deactivate' | 'remove' | 'discard' | null>(null);

  const versions = state.data.activityVersions.filter((v) => v.activityId === activity.id).sort((a, b) => b.number - a.number);
  const active = versions.find((v) => v.id === activity.activeVersionId);
  const draft = versions.find((v) => v.id === activity.draftVersionId);
  const current = draft ?? active;
  const problems = activationProblems(state, organization.id, activity);
  const eligible = useEligibleCount(activity.participants);
  const attempts = state.data.verificationAttempts.filter((a) => a.activityId === activity.id);
  const canManage = can('verification.activities.activate');
  const canEdit = can('verification.activities.edit');
  const usesParticipants = !!current?.checks.some((c) => c.params.useParticipants);
  const tabs = [
    { value: 'overview' as const, label: 'Overview' },
    { value: 'participants' as const, label: 'Participants', count: usesParticipants ? eligible : undefined },
    ...(can('verification.results.view') ? [{ value: 'history' as const, label: 'Verification History', count: attempts.length }] : []),
  ];
  const selected: TabId = tabs.some((t) => t.value === tab) ? (tab as TabId) : 'overview';

  const run = () => {
    const kind = pending;
    setPending(null);
    if (!kind) return;
    const r = kind === 'activate' ? actions.activateActivity(organization.id, activity.id)
      : kind === 'deactivate' ? actions.deactivateActivity(organization.id, activity.id)
        : kind === 'discard' ? actions.discardActivityDraft(organization.id, activity.id) : actions.removeDraftActivity(organization.id, activity.id);
    if (!r.ok) return toast({ tone: 'error', title: kind === 'activate' ? 'Can’t activate yet' : 'Nothing was changed', description: r.problems?.join(' ') ?? r.error });
    if (kind === 'remove') { toast({ tone: 'success', title: 'Draft removed', description: activity.name }); navigate('/verification-activities', { replace: true }); return; }
    toast({ tone: 'success', title: { activate: draft && active ? 'Changes activated' : 'Activity activated', deactivate: 'Activity deactivated', discard: 'Draft changes discarded' }[kind] });
  };

  const menu: OverflowMenuItem[] = [
    ...(can('verification.activities.create') ? [{
      key: 'dup', label: 'Duplicate Activity', icon: <Copy className="h-4 w-4" />, onSelect: () => {
        const r = actions.duplicateActivity(organization.id, activity.id);
        if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
        toast({ tone: 'success', title: 'Activity duplicated', description: 'The copy is a draft.' });
        navigate(activityPath((r as { activityId: string }).activityId));
      },
    }] : []),
    ...(canEdit && draft && active ? [{ key: 'discard', label: 'Discard Draft Changes', icon: <Undo2 className="h-4 w-4" />, onSelect: () => setPending('discard') }] : []),
    ...(canEdit && activity.status === 'draft' && !active ? [{ key: 'remove', label: 'Remove Draft Activity', tone: 'danger' as const, icon: <Trash2 className="h-4 w-4" />, onSelect: () => setPending('remove') }] : []),
  ];
  const needsActivation = activity.status !== 'active' || !!draft;
  const when = scheduleText(activity.schedule);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="truncate text-slate-700">{activity.name}</span>
      </nav>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{activity.name}<ActivityStatusBadge status={activity.status} /></h1>
          <p className="mt-1 max-w-2xl text-slate-500">{activity.purpose || activity.description || 'No purpose given.'}</p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-slate-700">
            {activity.location && <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" /><dt className="sr-only">Location</dt><dd>{activity.location}</dd></div>}
            {when && <div className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" /><dt className="sr-only">Schedule</dt><dd>{when}{activity.schedule?.enforced ? ' · verification only in this window' : ''}</dd></div>}
            {usesParticipants && <div className="flex items-center gap-1.5"><Users className="h-4 w-4 text-slate-400" aria-hidden="true" /><dt className="sr-only">Eligible participants</dt><dd>{eligible} eligible {eligible === 1 ? 'participant' : 'participants'}</dd></div>}
          </dl>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canEdit && <ButtonLink to={`${activityPath(activity.id)}/edit`} variant="secondary" icon={<Pencil className="h-4 w-4" />}>Edit</ButtonLink>}
          {canManage && activity.status === 'active' && <Button variant="secondary" icon={<PowerOff className="h-4 w-4" />} onClick={() => setPending('deactivate')}>Deactivate</Button>}
          {canManage && needsActivation && (
            <Button icon={<Power className="h-4 w-4" />} disabled={problems.blockers.length > 0} title={problems.blockers.length ? 'Resolve the listed items first' : undefined}
              onClick={() => setPending('activate')}>{activity.status === 'active' ? 'Activate changes' : 'Activate'}</Button>
          )}
          {menu.length > 0 && <OverflowMenu label="More actions" items={menu} />}
        </div>
      </header>

      {draft && active && (
        <p className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          Version {draft.number} has requirement changes that aren’t in use yet. Version {active.number} {activity.status === 'active' ? 'is used for verifications' : 'is the last activated version'} until you activate them.
        </p>
      )}
      {canManage && needsActivation && problems.blockers.length > 0 && (
        <div className="mb-4"><IssuesList blockers={problems.blockers} warnings={[]} title={activity.status === 'active' ? 'Resolve before activating the changes' : 'Resolve before activating'} /></div>
      )}

      <Tabs<TabId> value={selected} onChange={(v) => setTab(v)} tabs={tabs} />
      <div className="mt-6" role="tabpanel" aria-label={tabs.find((t) => t.value === selected)?.label}>
        {selected === 'overview' && <Overview activity={activity} versions={versions} current={current} warnings={problems.warnings} eligible={usesParticipants ? eligible : null} />}
        {selected === 'participants' && <ParticipantsTab activity={activity} uses={usesParticipants} />}
        {selected === 'history' && (
          <Card>
            <p className="border-b border-slate-100 px-4 py-3 text-sm text-slate-500">Verification attempts for this activity. Configuration changes are in the Audit Log.</p>
            <AttemptsTable rows={attempts} hideActivity />
          </Card>
        )}
      </div>

      {pending && (
        <ConfirmDialog open onCancel={() => setPending(null)} onConfirm={run} tone={pending === 'activate' ? 'primary' : 'danger'}
          title={{ activate: draft && active ? `Activate version ${draft.number}?` : `Activate ${activity.name}?`, deactivate: `Deactivate ${activity.name}?`, remove: `Remove ${activity.name}?`, discard: 'Discard draft changes?' }[pending]}
          confirmLabel={{ activate: 'Activate', deactivate: 'Deactivate', remove: 'Remove Draft', discard: 'Discard changes' }[pending]}
          description={{
            activate: draft && active ? `New verifications will use version ${draft.number}. Earlier verifications keep the version they used.` : 'Your organization’s verifiers will be able to use it straight away.',
            deactivate: 'No new verifications can start. Earlier verification records and the configuration are kept, and you can activate it again later.',
            remove: 'This draft was never activated. It will be removed. This can’t be undone.',
            discard: `Draft version ${draft?.number} will be deleted. Version ${active?.number} stays as it is.`,
          }[pending]} />
      )}
    </>
  );
}

function Overview({ activity, versions, current, warnings, eligible }: { activity: ActivityConfig; versions: ActivityVersion[]; current?: ActivityVersion; warnings: string[]; eligible: number | null }) {
  const { state } = useStore();
  const { organization } = useSession();
  const org = useOrgData();
  const [advanced, setAdvanced] = useState(false);
  const credName = (id: string) => org.credentialTypeById.get(id)?.name ?? '';
  const v = current ? validateConfiguration(current, validationContext(state, organization.id, activity.participants)) : null;
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-8 px-6 py-5 lg:grid-cols-2">
          <section>
            <h2 className="text-sm font-semibold text-slate-900">How people are verified</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700" aria-label="How people are verified">
              {current ? describeRequirements(current, credName).map((l) => <li key={l}>{l}</li>) : <li>Not configured yet.</li>}
              {activity.entryPolicy && activity.entryPolicy !== 'off' && <li>Repeat entry: {activity.entryPolicy === 'deny' ? 'not permitted after a recorded entry' : 'flagged for review after a recorded entry'}</li>}
            </ul>
            {current && <><h3 className="mt-5 text-sm font-semibold text-slate-900">How the result is decided</h3><div className="mt-2"><RulesList version={current} /></div></>}
          </section>
          <section>
            <dl className="grid gap-y-3 text-sm">
              <div><dt className="text-slate-500">Status</dt><dd className="mt-0.5"><ActivityStatusBadge status={activity.status} /></dd></div>
              <div><dt className="text-slate-500">Eligibility</dt><dd className="text-slate-900">{eligible === null ? 'Not based on a participant list' : `${eligible} eligible ${eligible === 1 ? 'person' : 'people'}, using current group membership at verification time`}</dd></div>
              <div><dt className="text-slate-500">Who can verify</dt><dd className="text-slate-900">{activity.restrictVerifiers ? 'Only assigned verifiers' : 'Anyone with the Verifier role in the organization'}</dd></div>
              <div><dt className="text-slate-500">Location</dt><dd className="text-slate-900">{activity.location || '—'}{activity.location && <span className="block text-xs text-slate-500">For information only.</span>}</dd></div>
              <div><dt className="text-slate-500">Schedule</dt><dd className="text-slate-900">{scheduleText(activity.schedule) ?? 'No schedule: available until deactivated'}{activity.schedule && !activity.schedule.enforced && scheduleText(activity.schedule) && <span className="block text-xs text-slate-500">For information only.</span>}</dd></div>
              <div><dt className="text-slate-500">Last updated</dt><dd className="text-slate-900">{formatDate(activity.updatedAt)} by {activity.updatedBy}</dd></div>
            </dl>
          </section>
        </div>
        {warnings.length > 0 && <div className="px-6 pb-5"><IssuesList blockers={[]} warnings={warnings} /></div>}
      </Card>

      <Card>
        <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="flex w-full items-center gap-2 px-6 py-4 text-left text-sm font-semibold text-slate-800">
          <Wrench className="h-4 w-4 text-slate-400" aria-hidden="true" />Technical details: checks, providers and versions
          <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', advanced && 'rotate-180')} aria-hidden="true" />
        </button>
        {advanced && current && (
          <div className="space-y-6 border-t border-slate-100 px-6 py-5">
            <ChecksSummary version={current} issues={v?.blockers ?? []} />
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Configuration versions</h3>
              <p className="text-xs text-slate-500">Each verification records the version it used, so changes never rewrite earlier results.</p>
              <ul className="mt-2 divide-y divide-slate-100" aria-label="Configuration versions">
                {versions.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span><span className="font-medium text-slate-900">Version {x.number}</span>
                      <span className="block text-xs text-slate-500">{x.status === 'draft' ? `Draft, last saved ${formatDateTime(x.updatedAt)}` : `Activated ${x.activatedAt ? formatDateTime(x.activatedAt) : ''}${x.activatedBy ? ` by ${x.activatedBy}` : ''}`}</span></span>
                    <Badge tone={x.status === 'active' ? 'success' : x.status === 'draft' ? 'info' : 'neutral'}>{x.status === 'active' ? 'In use' : x.status === 'draft' ? 'Draft' : 'Superseded'}</Badge>
                  </li>
                ))}
              </ul>
            </section>
            <Link to={`/audit?area=verification-activity&q=${encodeURIComponent(activity.name)}`} className="inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">View configuration changes in the Audit Log</Link>
          </div>
        )}
      </Card>
    </div>
  );
}

function ParticipantsTab({ activity, uses }: { activity: ActivityConfig; uses: boolean }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const { saveActivity } = useActions();
  const toast = useToast();
  const org = useOrgData();
  const [editing, setEditing] = useState<Participants | null>(null);
  const p = activity.participants ?? { groupIds: [], memberIds: [] };
  const counts = useMemo(() => memberCounts(state.data, organization.id), [state.data, organization.id]);
  const total = useEligibleCount(p);
  const canManage = can('verification.activities.edit');
  const version = state.data.activityVersions.find((v) => v.id === (activity.draftVersionId ?? activity.activeVersionId));

  const save = (next: Participants) => {
    if (!version) return;
    const r = saveActivity(organization.id, activity.id, {
      name: activity.name, description: activity.description, purpose: activity.purpose, type: version.type, checks: version.checks, outcome: version.outcome,
      verifierIds: state.data.verifierAssignments.filter((x) => x.activityId === activity.id && x.status === 'active').map((x) => x.administratorId),
      participants: next, keepConfiguration: true,
    });
    setEditing(null);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: 'Participants updated', description: 'Eligibility uses the new list from the next verification.' });
  };

  if (!uses) {
    return <Card><EmptyState icon={<Users className="h-5 w-5" />} title="This activity doesn’t use a participant list" description="Anyone who passes verification meets its conditions. Edit the activity to require eligibility." /></Card>;
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{total} eligible {total === 1 ? 'person' : 'people'}</h2>
          <p className="text-sm text-slate-500">Group eligibility uses current membership when someone is verified. Being eligible doesn’t prove identity.</p>
        </div>
        {canManage && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(p)}>Edit participants</Button>}
      </div>
      <div className="grid gap-6 px-6 py-5 lg:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Groups ({p.groupIds.length})</h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Eligible groups">
            {p.groupIds.map((id) => {
              const g = org.groupById.get(id);
              return <li key={id} className="flex items-center justify-between px-3 py-2 text-sm">{g ? <Link to={`/groups/${id}`} className="font-medium text-slate-900 hover:text-brand-700">{g.name}</Link> : <span className="text-slate-400">Removed group</span>}<span className="text-xs text-slate-500">{counts.get(id) ?? 0} members</span></li>;
            })}
            {p.groupIds.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No groups.</li>}
          </ul>
        </section>
        <section>
          <h3 className="text-sm font-semibold text-slate-900">Specific users ({p.memberIds.length})</h3>
          <DataTable
            rows={p.memberIds.map((id) => org.memberById.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof org.memberById.get>>[]}
            rowKey={(m) => m.id}
            empty={<p className="px-3 py-3 text-sm text-slate-500">No specific users.</p>}
            columns={[
              { key: 'name', header: 'Name', cell: (m) => <Link to={`/users/${m.id}`} className="font-medium text-slate-900 hover:text-brand-700">{m.displayName}</Link> },
              { key: 'id', header: 'Identifier', cell: (m) => <span className="font-mono text-xs text-slate-600">{m.identifier?.value ?? '—'}</span> },
            ]}
          />
        </section>
      </div>
      {editing && (
        <Modal open size="lg" onClose={() => setEditing(null)} title="Edit participants" description="Changes apply from the next verification and are recorded in the Audit Log."
          footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => save(editing)}>Save participants</Button></>}>
          <ParticipantsPicker value={editing} onChange={setEditing} />
        </Modal>
      )}
    </Card>
  );
}
