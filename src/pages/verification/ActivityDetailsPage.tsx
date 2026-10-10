import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarClock, ChevronRight, Copy, MapPin, Pencil, Power, PowerOff, Trash2, Undo2, Users } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, ConfirmDialog, DataTable, EmptyState, Modal, OverflowMenu, Pagination, SearchInput, Tabs, useToast, type OverflowMenuItem,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { ParticipantsPicker, useEligibleCount, type Participants } from '@/components/verification/ParticipantsPicker';
import { ActivityStatusBadge, IssuesList } from '@/components/verification/parts';
import { memberCounts } from '@/domain/groups';
import type { ActivityConfig } from '@/domain/types';
import { activeAssignments, eligibleParticipants } from '@/domain/verification';
import { PARTICIPANT_ENTRY_LABEL, PARTICIPANT_VERIFICATION_LABEL, participantProgress, participantStatuses, statusOf } from '@/domain/participantStatus';
import { formatCoordinate, formatRadius, validCoordinates } from '@/domain/location';
import { useServices } from '@/services/ServicesProvider';
import { LocationMap } from '@/components/verification/LocationMap';
import { useQueryState } from '@/hooks/useQueryState';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/dates';
import { NO_VERIFIER_WARNING, activationProblems } from '@/store/activityOps';
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
            {activity.locationCheck?.enabled && <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" /><dt className="sr-only">Location check</dt><dd>Location check on{activity.locationCheck.label ? ` · ${activity.locationCheck.label.split(',')[0]}` : ''}</dd></div>}
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
        {selected === 'overview' && <Overview activity={activity} warnings={problems.warnings} />}
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

/**
 * An operational summary for the administrator: who can be verified, who verifies, where, and progress
 * so far from actual records. How checks and providers work is FixID's concern and isn't shown here.
 */
function Overview({ activity, warnings }: { activity: ActivityConfig; warnings: string[] }) {
  const { state } = useStore();
  const { organization } = useSession();
  const org = useOrgData();
  const { maps } = useServices();
  const loc = activity.locationCheck;
  const p = activity.participants ?? { groupIds: [], memberIds: [] };
  const usesList = p.groupIds.length + p.memberIds.length > 0;
  const progress = participantProgress(participantStatuses(state.data.verificationAttempts, activity.id), eligibleParticipants(state.data, organization.id, activity.participants));
  const verifiers = activeAssignments(state.data, organization.id, activity.id).map((x) => { const a = state.data.administrators.find((y) => y.id === x.administratorId); return a?.name ?? a?.email ?? 'Former administrator'; });
  const groups = p.groupIds.map((id) => org.groupById.get(id)?.name ?? 'Removed group');
  const users = p.memberIds.map((id) => org.memberById.get(id)?.displayName ?? 'Removed user');
  const list = (xs: string[]) => (xs.length <= 5 ? xs.join(', ') : `${xs.slice(0, 5).join(', ')} and ${xs.length - 5} more`);
  // Only issues an administrator can act on.
  const actionable = warnings.filter((w) => w === NO_VERIFIER_WARNING);
  return (
    <div className="space-y-6">
      <section aria-label="Activity summary" className="grid gap-4 sm:grid-cols-3">
        {[
          ['Eligible participants', progress.eligible],
          ['Verified participants', progress.verified],
          ['Entries granted', progress.granted],
        ].map(([label, value]) => (
          <Card key={label} className="p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p></Card>
        ))}
      </section>
      {actionable.length > 0 && <IssuesList blockers={[]} warnings={actionable} warningsTitle="No verifier assigned" />}
      <Card className="px-6 py-5">
        <h2 className="text-sm font-semibold text-slate-900">Activity details</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Eligible participants</dt><dd className="mt-0.5 text-slate-900">{usesList ? (
            <>
              {groups.length > 0 && <span className="block">Groups: {list(groups)}</span>}
              {users.length > 0 && <span className="block">Users: {list(users)}</span>}
            </>
          ) : 'None selected'}</dd></div>
          <div><dt className="text-slate-500">Assigned verifiers</dt><dd className="mt-0.5 text-slate-900">{verifiers.length ? <ul aria-label="Assigned verifiers">{verifiers.map((v) => <li key={v}>{v}</li>)}</ul> : 'None yet'}</dd></div>
          <div><dt className="text-slate-500">Location check</dt><dd className="mt-0.5 text-slate-900">{loc?.enabled
            ? validCoordinates(loc.lat, loc.lng)
              ? <>On{loc.label && <span className="block">{loc.label}</span>}<span className="block text-slate-600">{formatCoordinate(loc.lat)}, {formatCoordinate(loc.lng)} · within {formatRadius(loc.radiusM)}</span></>
              : 'On, but no location selected'
            : 'Off'}</dd></div>
          <div><dt className="text-slate-500">Last updated</dt><dd className="mt-0.5 text-slate-900">{formatDate(activity.updatedAt)} by {activity.updatedBy}</dd></div>
        </dl>
      </Card>
      {loc?.enabled && validCoordinates(loc.lat, loc.lng) && maps.available && (
        <Card className="px-6 py-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Location check area</h2>
          <LocationMap maps={maps} center={{ lat: loc.lat, lng: loc.lng }} radiusM={loc.radiusM} label="Location check area map" />
        </Card>
      )}
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
      <ParticipantStatusTable activity={activity} />
      {editing && (
        <Modal open size="lg" onClose={() => setEditing(null)} title="Edit participants" description="Changes apply from the next verification and are recorded in the Audit Log."
          footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => save(editing)}>Save participants</Button></>}>
          <ParticipantsPicker value={editing} onChange={setEditing} />
        </Modal>
      )}
    </Card>
  );
}

const STATUS_FILTERS = [
  { id: 'all', label: 'All' }, { id: 'verified', label: 'Verified' }, { id: 'not-verified', label: 'Not verified' },
  { id: 'failed', label: 'Failed or unable' }, { id: 'granted', label: 'Entry granted' }, { id: 'denied', label: 'Entry denied' },
] as const;
const PAGE = 25;

/** Each eligible participant's verification and entry status, from persisted results only. */
function ParticipantStatusTable({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const org = useOrgData();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]['id']>('all');
  const [page, setPage] = useState(1);
  const statuses = useMemo(() => participantStatuses(state.data.verificationAttempts, activity.id), [state.data.verificationAttempts, activity.id]);
  const people = useMemo(() => [...eligibleParticipants(state.data, activity.organizationId, activity.participants)]
    .map((id) => org.memberById.get(id)).filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, b) => a.displayName.localeCompare(b.displayName)), [state.data, activity, org.memberById]);
  const rows = people.filter((m) => {
    const st = statusOf(statuses, m.id);
    const text = !q.trim() || `${m.displayName} ${m.identifier?.value ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());
    const f = filter === 'all' || (filter === 'verified' ? st.verification === 'verified' : filter === 'not-verified' ? st.verification === 'not-verified'
      : filter === 'failed' ? st.verification === 'failed' || st.verification === 'unable' : st.entry === filter);
    return text && f;
  });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((Math.min(page, pageCount) - 1) * PAGE, Math.min(page, pageCount) * PAGE);
  const vTone = { verified: 'success', failed: 'danger', unable: 'warning', 'not-verified': 'neutral' } as const;
  const eTone = { granted: 'brand', denied: 'danger', 'not-granted': 'neutral', pending: 'warning', 'not-recorded': 'neutral' } as const;
  return (
    <section aria-label="Participant status" className="border-t border-slate-100 px-6 py-5">
      <h3 className="text-sm font-semibold text-slate-900">Participant status</h3>
      <p className="text-sm text-slate-500">Identity verification and physical entry are recorded separately. Finding someone’s identifier never makes them Verified.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:w-72"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search participants" label="Search participants" /></div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setPage(1); }}
              className={cn('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset', filter === f.id ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'text-slate-600 ring-slate-200 hover:bg-slate-50')}>{f.label}</button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
        <DataTable
          rows={shown}
          rowKey={(m) => m.id}
          empty={<p className="px-4 py-4 text-sm text-slate-500">No participants match.</p>}
          columns={[
            { key: 'name', header: 'Participant', cell: (m) => <Link to={`/users/${m.id}`} className="font-medium text-slate-900 hover:text-brand-700">{m.displayName}</Link> },
            { key: 'id', header: 'Identifier', cell: (m) => <span className="font-mono text-xs text-slate-600">{m.identifier?.value ?? '—'}</span> },
            { key: 'verification', header: 'Verification', cell: (m) => { const st = statusOf(statuses, m.id); return <Badge tone={vTone[st.verification]}>{PARTICIPANT_VERIFICATION_LABEL[st.verification]}</Badge>; } },
            { key: 'entry', header: 'Entry', cell: (m) => { const st = statusOf(statuses, m.id); return <Badge tone={eTone[st.entry]}>{PARTICIPANT_ENTRY_LABEL[st.entry]}</Badge>; } },
            { key: 'at', header: 'Last verification', cell: (m) => { const st = statusOf(statuses, m.id); return st.attemptId ? <Link to={`/verification-history/${st.attemptId}`} className="text-slate-600 hover:text-brand-700">{formatDateTime(st.at!)}</Link> : <span className="text-slate-400">—</span>; } },
          ]}
        />
      </div>
      {rows.length > PAGE && <div className="mt-3"><Pagination page={Math.min(page, pageCount)} pageCount={pageCount} total={rows.length} pageSize={PAGE} onPage={setPage} /></div>}
    </section>
  );
}
