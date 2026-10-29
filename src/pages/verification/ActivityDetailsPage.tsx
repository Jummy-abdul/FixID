import { organizationOfActivity } from '@/store/managedOrgOps';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Building2, CalendarClock, ChevronRight, MapPin, Pencil, ShieldCheck, Undo2, Users } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, CardHeader, ConfirmDialog, DataTable, Drawer, EmptyState, FilterSelect, OverflowMenu, Pagination, SearchInput, Skeleton, StatCard, Tabs, usePageSlice, useToast,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { DisplayStatusBadge, IssuesList } from '@/components/verification/parts';
import { sourceLabel } from '@/components/verification/RequirementsSummary';
import { LocationMap } from '@/components/verification/LocationMap';
import {
  ELIGIBILITY_MODE_LABEL, ELIGIBILITY_OUTCOME_LABEL, ELIGIBILITY_OUTCOME_TONE, PORTRAIT_BASELINE, SCHEDULE_KIND_LABEL, VERIFICATION_STATUS_LABEL, VERIFICATION_STATUS_TONE,
  activityCounts, describeSource, displayStatus, eligibilityMode, eligibilityOutcome, identityStatus, outcomeExplanation, participantRows, scheduleSummary,
  type EligibilityOutcome, type ParticipantRow, type VerificationStatus,
} from '@/domain/activityLifecycle';
import { formatCoordinate, formatRadius, validCoordinates } from '@/domain/location';
import type { ActivityConfig, VerificationAttempt } from '@/domain/types';
import { activeAssignments, currentVersion, eligibleParticipants } from '@/domain/verification';
import { findRole } from '@/domain/roles';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate, formatDateTime } from '@/lib/dates';
import { useServices } from '@/services/ServicesProvider';
import { NO_VERIFIER_WARNING, activationProblems } from '@/store/activityOps';
import { activityFor, activityPolicy, audienceOf, settingsEditable } from '@/store/sharingOps';
import { exceptionsVisibleTo } from '@/store/exceptionOps';
import { isUnresolved } from '@/domain/exceptions';
import { sharedActivityTransactions } from '@/store/reporting';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { ParticipatingOrganizationsTab, SharedActivityParticipantView } from './SharedActivityPanels';
import { NotFoundPage } from '../NotFoundPage';
import { activityPath } from './paths';
import { useActivityLifecycle } from './useActivityLifecycle';

type TabId = 'overview' | 'participants' | 'configuration';

export function ActivityDetailsPage() {
  const { activityId } = useParams();
  const { state } = useStore();
  const { organization } = useSession();
  // The organization's own activity, or a delegated activity it was invited to or takes part in. Nothing else.
  const activity = activityId ? activityFor(state, organization.id, activityId) : undefined;
  if (!activity) return <NotFoundPage entity="verification activity" backTo="/verification-activities" />;
  if (activity.organizationId !== organization.id) return <SharedActivityParticipantView key={activity.id} activity={activity} />;
  return <Details key={activity.id} activity={activity} />;
}

/** The schedule in one line (kept for the verifier workspace). */
export const scheduleText = scheduleSummary;

// Earlier links used other tab names: they open the tab that now holds that information.
const TAB_ALIASES: Record<string, TabId> = {
  overview: 'overview', participants: 'participants', people: 'participants', verifications: 'participants', transactions: 'participants', history: 'participants', exceptions: 'participants',
  configuration: 'configuration', organizations: 'configuration',
};

function Details({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useQueryState('tab', 'overview');
  const [discarding, setDiscarding] = useState(false);
  const lifecycle = useActivityLifecycle({ afterRemove: () => navigate('/verification-activities', { replace: true }) });
  const status = displayStatus(activity);
  const records = useMemo(() => sharedActivityTransactions(state, activity), [state, activity]);
  const problems = activationProblems(state, organization.id, activity);
  const canEdit = can('verification.activities.edit');
  const versions = state.data.activityVersions.filter((v) => v.activityId === activity.id);
  const pendingChanges = !!activity.draftVersionId && !!activity.activeVersionId && versions.some((v) => v.id === activity.draftVersionId);
  const selected: TabId = TAB_ALIASES[tab] ?? 'overview';
  const tabs = [
    { value: 'overview' as const, label: 'Overview' },
    { value: 'participants' as const, label: 'Participants' },
    { value: 'configuration' as const, label: 'Configuration' },
  ];
  const sched = scheduleSummary(activity.schedule);
  const available = lifecycle.available(activity);
  // The main lifecycle action is a button; the rest are in the menu.
  const primary = available.find((k) => k === 'activate' || k === 'resume' || k === 'pause');
  const menu = [
    ...lifecycle.menu(activity, { includeView: false }).filter((m) => m.key !== 'edit' && m.key !== primary),
    ...(canEdit && pendingChanges && status !== 'completed' ? [{ key: 'discard', label: 'Discard unsaved configuration changes', icon: <Undo2 className="h-4 w-4" />, onSelect: () => setDiscarding(true) }] : []),
  ];
  const discard = () => {
    setDiscarding(false);
    const r = actions.discardActivityDraft(organization.id, activity.id);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: 'Changes discarded' });
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="truncate text-slate-700">{activity.name}</span>
      </nav>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{activity.name}<DisplayStatusBadge activity={activity} /></h1>
          {(activity.description || activity.purpose) && <p className="mt-1 max-w-2xl text-slate-500">{activity.description || activity.purpose}</p>}
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-slate-700">
            <div className="flex items-center gap-1.5"><Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" /><dt className="sr-only">Organization</dt><dd>{organization.name}</dd></div>
            <div className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" /><dt className="sr-only">Schedule</dt><dd>{sched ?? 'Not scheduled'}</dd></div>
            {activity.location && <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" /><dt className="sr-only">Location</dt><dd>{activity.location}</dd></div>}
          </dl>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canEdit && status !== 'completed' && <ButtonLink to={`${activityPath(activity.id)}/edit${status === 'draft' ? '?step=review' : ''}`} variant="secondary" icon={<Pencil className="h-4 w-4" />}>{status === 'draft' ? 'Continue editing' : 'Edit activity'}</ButtonLink>}
          {primary && <Button variant={primary === 'pause' ? 'secondary' : 'primary'} icon={lifecycle.ICON[primary]} onClick={() => lifecycle.request(primary, activity)}>{lifecycle.LABEL[primary]}</Button>}
          {menu.length > 0 && <OverflowMenu label="More actions" items={menu} />}
        </div>
      </header>

      {status === 'completed' && (
        <p className="mb-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
          {activity.completedAt ? `Completed on ${formatDate(activity.completedAt)}${activity.completedBy ? ` by ${activity.completedBy}` : ''}.` : 'Its schedule has ended.'} No new verifications can start. Every record is kept.
        </p>
      )}
      {pendingChanges && status !== 'completed' && (
        <p className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          Configuration changes were saved while the activity was paused. They’ll be used when it’s resumed.
        </p>
      )}
      {status === 'draft' && problems.blockers.length > 0 && (
        <div className="mb-4"><IssuesList blockers={problems.blockers} warnings={[]} title="Finish these before activating" /></div>
      )}

      <Tabs<TabId> value={selected} onChange={(v) => setTab(v)} tabs={tabs} />
      <div className="mt-6" role="tabpanel" aria-label={tabs.find((t) => t.value === selected)?.label}>
        {selected === 'overview' && <Overview activity={activity} records={records} onTab={setTab} />}
        {selected === 'participants' && <ParticipantsTab activity={activity} records={records} />}
        {selected === 'configuration' && <ConfigurationTab activity={activity} />}
      </div>

      {lifecycle.dialog}
      {discarding && (
        <ConfirmDialog open tone="danger" title="Discard the unsaved configuration changes?" confirmLabel="Discard changes" onCancel={() => setDiscarding(false)} onConfirm={discard}
          description="The activity keeps the configuration it last ran with." />
      )}
    </>
  );
}

const statusBadge = (s: VerificationStatus) => <Badge tone={VERIFICATION_STATUS_TONE[s]}>{VERIFICATION_STATUS_LABEL[s]}</Badge>;
const eligibilityBadge = (e: EligibilityOutcome) => <Badge tone={ELIGIBILITY_OUTCOME_TONE[e]}>{ELIGIBILITY_OUTCOME_LABEL[e]}</Badge>;
const personName = (a: VerificationAttempt, memberName?: string) => memberName ?? a.lookup?.displayName ?? (a.lookup?.status === 'FOUND' ? 'Unnamed record' : 'Unidentified person');

/** Figures, recent activity and the activity's essentials. Every figure is counted from the same records. */
function Overview({ activity, records, onTab }: { activity: ActivityConfig; records: VerificationAttempt[]; onTab: (t: string) => void }) {
  const { state } = useStore();
  const { organization } = useSession();
  const org = useOrgData();
  const counts = activityCounts(records);
  const mode = eligibilityMode(activity);
  const eligible = mode === 'selected' ? eligibleParticipants(state.data, organization.id, activity.participants).size : null;
  const policy = activityPolicy(state, activity);
  const verifiers = activeAssignments(state.data, organization.id, activity.id).map((x) => { const a = state.data.administrators.find((y) => y.id === x.administratorId); return a?.name ?? a?.email ?? 'Former administrator'; });
  const delegated = (activity.sharing?.participants ?? []).filter((p) => p.status === 'active' || p.status === 'invited');
  const recent = [...records].sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)).slice(0, 5);
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 200); return () => clearTimeout(t); }, []);
  const noVerifier = !verifiers.length && !delegated.length && displayStatus(activity) !== 'completed';
  const { can } = useAuthorization();
  const canSeeExceptions = can('exceptions.view') || can('exceptions.review') || can('exceptions.approve');
  const exceptions = exceptionsVisibleTo(state, organization.id).filter((x) => x.activityId === activity.id);
  const openExceptions = exceptions.filter(isUnresolved).length;

  return (
    <div className="space-y-6">
      <section aria-label="Verification summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {loading ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full" />) : (
          <>
            <StatCard label="Eligible" value={eligible ?? 'Open'} hint={eligible === null ? 'Open verification: eligibility comes from the identity source' : 'Selected participants'} />
            <StatCard label="Total attempts" value={counts.attempts} />
            <StatCard label="Verified" value={counts.verified} tone="emerald" />
            <StatCard label="Unsuccessful" value={counts.unsuccessful} tone="violet" />
            <StatCard label="Pending or incomplete" value={counts.pending + counts.unable} tone="amber" hint={counts.unable ? `${counts.unable} unable to complete` : undefined} />
          </>
        )}
      </section>
      {noVerifier && <IssuesList blockers={[]} warnings={[NO_VERIFIER_WARNING]} warningsTitle="No verifier assigned" />}
      {canSeeExceptions && exceptions.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900 ring-1 ring-inset ring-violet-200">
          <span><span className="font-semibold">{openExceptions} open {openExceptions === 1 ? 'exception' : 'exceptions'}</span> of {exceptions.length} raised for this activity.</span>
          <Link to={`/exceptions?activity=${encodeURIComponent(activity.id)}`} className="font-semibold underline">View exceptions</Link>
        </p>
      )}
      {delegated.length > 0 && <ResultsByOrganization activity={activity} records={records} />}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Recent activity" action={records.length > 0 ? (
            <span className="flex gap-4">
              <button type="button" onClick={() => onTab('participants')} className="text-sm font-semibold text-brand-600 hover:text-brand-700">View participants</button>
              {can('verification.results.view') && <Link to={`/verification-history?activity=${encodeURIComponent(activity.id)}&range=all`} className="text-sm font-semibold text-brand-600 hover:text-brand-700">View verification history</Link>}
            </span>
          ) : undefined} />
          {recent.length === 0 ? <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No verifications yet" description="Results appear here as verifiers record them." /> : (
            <ul className="divide-y divide-slate-100" aria-label="Recent activity">
              {recent.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{personName(a, a.subject?.memberId ? org.memberById.get(a.subject.memberId)?.displayName : undefined)}</span>
                    <span className="block text-xs text-slate-500">{formatDateTime(a.completedAt ?? a.startedAt)} · {a.verifierName}</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">{statusBadge(identityStatus(a))}{eligibilityBadge(eligibilityOutcome(a))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="px-6 py-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">At a glance</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <Item label="Status"><DisplayStatusBadge activity={activity} /></Item>
            <Item label="Identity source">{sourceLabel(policy.effective.identitySource, policy.integration)}</Item>
            <Item label="Who can be verified">{ELIGIBILITY_MODE_LABEL[mode]}</Item>
            <Item label="Schedule">{scheduleSummary(activity.schedule) ?? 'Not scheduled'}</Item>
            {(() => { const o = organizationOfActivity(state, organization.id, activity.id); return o ? <Item label="Organization">{can('organizations.view') ? <Link to={`/organizations/${o.id}`} className="text-brand-700 hover:underline">{o.name}</Link> : o.name}{o.status === 'inactive' && <span className="ml-1 text-xs text-slate-500">(inactive)</span>}</Item> : null; })()}
            <Item label="Assigned verifiers">{verifiers.length ? <ul aria-label="Assigned verifiers">{verifiers.map((v) => <li key={v}>{v}</li>)}</ul> : 'None yet'}</Item>
            {delegated.length > 0 && <Item label="Authorised sub-organizations">{delegated.map((p) => state.data.organizations.find((o) => o.id === p.organizationId)?.name ?? p.organizationId).join(', ')}</Item>}
          </dl>
        </Card>
      </div>
    </div>
  );
}

/** A delegated activity's results for each organization that verifies for it, counted from the same records. */
function ResultsByOrganization({ activity, records }: { activity: ActivityConfig; records: VerificationAttempt[] }) {
  const { state } = useStore();
  const orgIds = [activity.organizationId, ...(activity.sharing?.participants ?? []).filter((p) => p.status !== 'declined').map((p) => p.organizationId)];
  const rows = [...new Set([...orgIds, ...records.map((r) => r.organizationId)])]
    .map((id) => ({ id, name: state.data.organizations.find((o) => o.id === id)?.name ?? id, counts: activityCounts(records.filter((r) => r.organizationId === id)) }))
    .filter((r) => r.counts.attempts > 0 || r.id !== activity.organizationId);
  return (
    <Card>
      <CardHeader title="Results by organization" />
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'org', header: 'Organization', cell: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
          { key: 'attempts', header: 'Total attempts', cell: (r) => <span className="tabular-nums">{r.counts.attempts}</span> },
          { key: 'verified', header: 'Verified', cell: (r) => <span className="tabular-nums">{r.counts.verified}</span> },
          { key: 'unsuccessful', header: 'Unsuccessful', cell: (r) => <span className="tabular-nums">{r.counts.unsuccessful}</span> },
          { key: 'pending', header: 'Pending or incomplete', cell: (r) => <span className="tabular-nums">{r.counts.pending + r.counts.unable}</span> },
        ]}
      />
    </Card>
  );
}

const STATUS_OPTIONS = [{ value: 'all', label: 'All verification statuses' }, ...(['verified', 'unsuccessful', 'pending', 'unable', 'not-attempted'] as const).map((v) => ({ value: v, label: VERIFICATION_STATUS_LABEL[v] }))];
const ELIGIBILITY_OPTIONS = [{ value: 'all', label: 'All eligibility' }, ...(['eligible', 'not-eligible', 'unknown', 'not-required', 'not-checked'] as const).map((v) => ({ value: v, label: ELIGIBILITY_OUTCOME_LABEL[v] }))];
const PAGE = 10;

/**
 * One row per person: everyone selected, and everyone who attempted. Identity verification and eligibility
 * are separate columns. Search, filters and page are in the address, so closing the details keeps them.
 */
function ParticipantsTab({ activity, records }: { activity: ActivityConfig; records: VerificationAttempt[] }) {
  const { state } = useStore();
  const org = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [eligibility, setEligibility] = useQueryState('eligibility', 'all');
  const [page, setPage] = usePageParam();
  const [, setParams] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const mode = eligibilityMode(activity);
  const listed = useMemo(() => (mode === 'selected' ? eligibleParticipants(state.data, activity.organizationId, activity.participants) : new Set<string>()), [state.data, activity, mode]);
  const rows = useMemo(() => participantRows(records, listed, org.memberById), [records, listed, org.memberById]);
  const query = q.trim().toLowerCase();
  const filtered = rows.filter((r) => (status === 'all' || r.status === status) && (eligibility === 'all' || r.eligibility === eligibility)
    && (!query || r.name.toLowerCase().includes(query) || r.identifier.toLowerCase().includes(query) || (r.memberId && org.memberById.get(r.memberId)?.identifier?.value.toLowerCase().includes(query))));
  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE);
  const attempted = rows.filter((r) => r.attempts.length > 0).length;
  const selectedRow = rows.find((r) => r.key === open);
  // One update for all filters: separate updates in the same event would overwrite each other.
  const clear = () => setParams((prev) => { const next = new URLSearchParams(prev); ['q', 'status', 'eligibility', 'page'].forEach((k) => next.delete(k)); return next; }, { replace: true });

  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">
          {mode === 'selected' ? `${listed.size} eligible ${listed.size === 1 ? 'person' : 'people'} · ${attempted} attempted` : `${attempted} ${attempted === 1 ? 'person' : 'people'} attempted · open verification`}
        </h2>
        <p className="text-sm text-slate-500">Identity verification and eligibility are separate results: being verified doesn’t make someone eligible, and being eligible doesn’t verify them.</p>
      </div>
      <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search by name or identifier" label="Search participants" className="sm:w-72" />
        <FilterSelect label="Verification status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <FilterSelect label="Eligibility" value={eligibility} onChange={setEligibility} options={ELIGIBILITY_OPTIONS} />
      </div>
      <DataTable
        rows={pageRows}
        rowKey={(r) => r.key}
        empty={rows.length === 0
          ? <EmptyState icon={<Users className="h-5 w-5" />} title="No participants yet" description={mode === 'selected' ? 'Select users or groups by editing the activity.' : 'People appear here once they’ve been verified.'} />
          : <EmptyState title="No participants match" description="Try a different search or filter." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />}
        columns={[
          { key: 'name', header: 'Name', cell: (r) => <span className="font-medium text-slate-900">{r.name}{mode === 'selected' && !r.listed && <span className="block text-xs font-normal text-slate-500">Not a selected participant</span>}</span> },
          { key: 'id', header: 'Identifier', cell: (r) => <span className="font-mono text-xs text-slate-600">{r.identifier}</span> },
          { key: 'eligibility', header: 'Eligibility', cell: (r) => eligibilityBadge(r.eligibility) },
          { key: 'status', header: 'Verification', cell: (r) => statusBadge(r.status) },
          { key: 'at', header: 'Date and time', cell: (r) => <span className="whitespace-nowrap text-slate-600">{r.latest ? formatDateTime(r.latest.completedAt ?? r.latest.startedAt) : '—'}</span> },
          { key: 'verifier', header: 'Verifier', cell: (r) => <span className="text-slate-600">{r.latest?.verifierName ?? '—'}</span> },
          { key: 'view', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (r) => (
            <button type="button" onClick={() => setOpen(r.key)} className="whitespace-nowrap text-sm font-semibold text-brand-600 hover:text-brand-700">View details<span className="sr-only"> for {r.name}</span></button>
          ) },
        ]}
      />
      <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE} onPage={setPage} />
      {selectedRow && <ParticipantDrawer row={selectedRow} activity={activity} onClose={() => setOpen(null)} />}
    </Card>
  );
}

/** One person's results for this activity. No images, portraits, templates or scores are ever shown. */
function ParticipantDrawer({ row, activity, onClose }: { row: ParticipantRow; activity: ActivityConfig; onClose: () => void }) {
  const { state } = useStore();
  const { can } = useAuthorization();
  const a = row.latest;
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const source = a ? (a.identitySource === 'external' ? a.serviceName ?? 'Connected identity source' : 'FixID records') : sourceLabel(activityPolicy(state, activity).effective.identitySource, activityPolicy(state, activity).integration);
  const eligibilityText = a?.eligibilityExplanation
    ?? (row.listed ? 'On the activity’s list of selected participants.' : row.eligibility === 'not-checked' ? 'Eligibility wasn’t checked because verification didn’t get that far.' : undefined);
  return (
    <Drawer open onClose={onClose} title={row.name} description={`Identifier ${row.identifier}`} width="md"
      footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>}>
      <dl className="space-y-4 text-sm">
        <Item label="Activity">{activity.name}</Item>
        <Item label="Date and time">{a ? formatDateTime(a.completedAt ?? a.startedAt) : 'Not yet verified'}</Item>
        <div className="grid grid-cols-2 gap-4">
          <Item label="Verification outcome">{statusBadge(row.status)}</Item>
          <Item label="Eligibility outcome">{eligibilityBadge(row.eligibility)}</Item>
        </div>
        <Item label="What happened">{outcomeExplanation(a)}</Item>
        {eligibilityText && <Item label="Eligibility">{eligibilityText}</Item>}
        <Item label="Identity source">{source}</Item>
        <Item label="Verifier">{a?.verifierName ?? '—'}</Item>
        {a && a.organizationId !== activity.organizationId && <Item label="Verified by organization">{orgName(a.organizationId)}</Item>}
      </dl>
      {row.attempts.length > 1 && (
        <section className="mt-6" aria-label="Earlier attempts">
          <h3 className="text-sm font-semibold text-slate-900">Earlier attempts</h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {row.attempts.slice(1).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-slate-600">{formatDateTime(x.completedAt ?? x.startedAt)} · {x.verifierName}</span>
                <span className="flex gap-1.5">{statusBadge(identityStatus(x))}{eligibilityBadge(eligibilityOutcome(x))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-6 text-xs text-slate-500">Images, portraits and biometric data are never shown here.</p>
      {a && can('verification.results.view') && <Link to={`/verification-history/${a.id}`} className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Open the full verification record</Link>}
    </Drawer>
  );
}

/** Everything the activity is configured with, in plain words. Technical policy settings aren't shown. */
function ConfigurationTab({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const org = useOrgData();
  const { maps, faceVerification } = useServices();
  const mode = eligibilityMode(activity);
  const p = activity.participants ?? { groupIds: [], memberIds: [] };
  const policy = activityPolicy(state, activity);
  const editable = settingsEditable(currentVersion(state.data, activity));
  const process = describeSource(policy.effective.identitySource.kind === 'external' ? { kind: 'external', integration: policy.integration } : { kind: 'local' }, mode, !faceVerification.available);
  const verifiers = activeAssignments(state.data, organization.id, activity.id).map((x) => state.data.administrators.find((y) => y.id === x.administratorId)).filter(Boolean);
  const loc = activity.locationCheck;
  const list = (xs: string[]) => (xs.length <= 5 ? xs.join(', ') : `${xs.slice(0, 5).join(', ')} and ${xs.length - 5} more`);
  const eligibleCount = mode === 'selected' ? eligibleParticipants(state.data, organization.id, activity.participants).size : 0;
  const canEdit = can('verification.activities.edit') && displayStatus(activity) !== 'completed';
  const edit = (step: string) => (canEdit ? <ButtonLink to={`${activityPath(activity.id)}/edit?step=${step}`} variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />}>Edit</ButtonLink> : undefined);

  return (
    <div className="space-y-6">
      {canEdit && <div className="flex justify-end"><ButtonLink to={`${activityPath(activity.id)}/edit`} icon={<Pencil className="h-4 w-4" />}>Edit activity</ButtonLink></div>}
      <ConfigCard title="Details" action={edit('details')}>
        <Item label="Name">{activity.name}</Item>
        <Item label="Description">{activity.description || activity.purpose || '—'}</Item>
        <Item label="Organization">{organization.name}</Item>
        <Item label="Created">{formatDate(activity.createdAt)} by {activity.createdBy}</Item>
        <Item label="Last updated">{formatDate(activity.updatedAt)} by {activity.updatedBy}</Item>
      </ConfigCard>
      <ConfigCard title="Participants and schedule" action={edit('participants')}>
        <Item label="Who can be verified">{ELIGIBILITY_MODE_LABEL[mode]}{mode === 'selected' && ` · ${eligibleCount} eligible ${eligibleCount === 1 ? 'person' : 'people'}`}</Item>
        {mode === 'selected' && p.groupIds.length > 0 && <Item label="Groups">{list(p.groupIds.map((id) => org.groupById.get(id)?.name ?? 'Removed group'))}</Item>}
        {mode === 'selected' && p.memberIds.length > 0 && <Item label="Users">{list(p.memberIds.map((id) => org.memberById.get(id)?.displayName ?? 'Removed user'))}</Item>}
        <Item label="Schedule">{activity.schedule?.kind ? `${SCHEDULE_KIND_LABEL[activity.schedule.kind]} · ` : ''}{scheduleSummary(activity.schedule) ?? 'Not scheduled'}</Item>
        <Item label="Location">{[activity.location, activity.locationAddress].filter(Boolean).join(', ') || '—'}</Item>
        <Item label="Location check">{loc?.enabled
          ? validCoordinates(loc.lat, loc.lng) ? `On${loc.label ? ` · ${loc.label}` : ''} · ${formatCoordinate(loc.lat)}, ${formatCoordinate(loc.lng)} · within ${formatRadius(loc.radiusM)}` : 'On, but no location selected'
          : 'Off'}</Item>
      </ConfigCard>
      {loc?.enabled && validCoordinates(loc.lat, loc.lng) && maps.available && (
        <Card className="px-6 py-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Location check area</h2>
          <LocationMap maps={maps} center={{ lat: loc.lat, lng: loc.lng }} radiusM={loc.radiusM} label="Location check area map" />
        </Card>
      )}
      <ConfigCard title="Identity source" action={edit('source')}>
        <Item label="Source">{sourceLabel(policy.effective.identitySource, policy.integration)}</Item>
        <Item label="How people are verified">
          {editable && policy.effective.method === 'face'
            ? <><ol className="list-decimal space-y-1 pl-5" aria-label="Verification process">{process.steps.map((s) => <li key={s}>{s}</li>)}</ol><span className="mt-2 block text-slate-600">{PORTRAIT_BASELINE}</span></>
            : 'Configured before the portrait baseline. Saving this activity in the editor applies the required portrait match.'}
          {process.simulated && <span className="mt-2 block"><Badge tone="warning">Simulated in this prototype</Badge></span>}
        </Item>
      </ConfigCard>
      <ConfigCard title="Verifiers" action={edit('verifiers')}>
        <Item label="Individual verifiers">{verifiers.length ? (
          <ul aria-label="Individual verifiers">{verifiers.map((v) => <li key={v!.id}>{v!.name ?? v!.email} <span className="text-slate-500">· {organization.name} · {v!.roleIds.map((r) => findRole(state.data.customRoles ?? [], v!.organizationId, r)?.name).filter(Boolean).join(', ')}</span></li>)}</ul>
        ) : 'None yet'}</Item>
        {audienceOf(activity) === 'own' && <Item label="Authorised sub-organizations">None</Item>}
      </ConfigCard>
      {audienceOf(activity) === 'shared' && <ParticipatingOrganizationsTab activity={activity} />}
    </div>
  );
}

function ConfigCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} action={action} />
      <dl className="grid gap-x-8 gap-y-4 px-5 py-4 text-sm sm:grid-cols-2">{children}</dl>
    </Card>
  );
}

const Item = ({ label, children }: { label: string; children: ReactNode }) => (
  <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-900">{children}</dd></div>
);
