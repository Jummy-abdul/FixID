import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Plus, ShieldCheck, X } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, Tabs, DataTable, EmptyState, FilterSelect, OverflowMenu, PageHeader, Pagination, SearchInput, Skeleton, usePageSlice, useToast,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { DisplayStatusBadge } from '@/components/verification/parts';
import { sourceLabel } from '@/components/verification/RequirementsSummary';
import { DEMO_AUTH_ENABLED } from '@/auth/authCore';
import { DISPLAY_STATUS_LABEL, activityCounts, displayStatus, eligibilityMode, identityStatus, scheduleShort, scheduleSummary, type ActivityDisplayStatus } from '@/domain/activityLifecycle';
import { PARTICIPATION_LABEL } from '@/domain/activitySettings';
import { eligibleParticipants } from '@/domain/verification';
import { activityPolicy, participation, sharedWith } from '@/store/sharingOps';
import { sharedActivityTransactions } from '@/store/reporting';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { activityPath } from './paths';
import { useActivityLifecycle } from './useActivityLifecycle';

const PAGE_SIZE = 15;
const STATUSES: ActivityDisplayStatus[] = ['draft', 'scheduled', 'active', 'paused', 'completed'];

export const EMPTY_TITLE = 'No verification activities yet';
export const EMPTY_DESCRIPTION = 'Create a verification activity to define when verification takes place, who is eligible to participate, which identity source to use, and who is authorised to conduct verification.';

/**
 * Verification Activities: every activity the organization runs, with its status, identity source, schedule
 * and progress counted from its verification records. Invitations from other organizations are on their own tab.
 */
export function VerificationActivitiesPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [source, setSource] = useQueryState('source', 'all');
  const [page, setPage] = usePageParam();
  const [, setParams] = useSearchParams();
  const [view, setView] = useQueryState('view', '');
  // Demonstration only: shows the first-time empty state without touching any data.
  const [preview, setPreview] = useQueryState('preview', '');
  const previewEmpty = DEMO_AUTH_ENABLED && preview === 'empty';
  const invitedCount = sharedWith(state, organization.id).length;
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 200); return () => clearTimeout(t); }, []);
  const lifecycle = useActivityLifecycle();

  const canCreate = can('verification.activities.create');

  const rows = useMemo(() => (previewEmpty ? [] : state.data.activityConfigs.filter((a) => a.organizationId === organization.id))
    .map((a) => {
      const policy = activityPolicy(state, a);
      const records = sharedActivityTransactions(state, a);
      const counts = activityCounts(records);
      const mode = eligibilityMode(a);
      const eligible = mode === 'selected' ? eligibleParticipants(state.data, organization.id, a.participants) : undefined;
      const verifiedPeople = eligible ? new Set(records.filter((t) => t.subject?.memberId && eligible.has(t.subject.memberId) && identityStatus(t) === 'verified').map((t) => t.subject!.memberId)).size : 0;
      return {
        activity: a, status: displayStatus(a), counts, eligible: eligible?.size, verifiedPeople,
        sourceKey: policy.effective.identitySource.kind === 'local' ? 'local' : policy.effective.identitySource.integrationId,
        source: sourceLabel(policy.effective.identitySource, policy.integration),
        delegated: (a.sharing?.participants ?? []).filter((p) => p.status === 'active' || p.status === 'invited').length,
      };
    })
    .sort((a, b) => b.activity.createdAt.localeCompare(a.activity.createdAt)), [state, organization.id, previewEmpty]);
  const sources = [...new Map(rows.map((r) => [r.sourceKey, r.source])).entries()];
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows
      .filter((r) => status === 'all' || r.status === status)
      .filter((r) => source === 'all' || r.sourceKey === source)
      .filter((r) => !query || r.activity.name.toLowerCase().includes(query) || r.activity.description.toLowerCase().includes(query));
  }, [rows, q, status, source]);
  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  // One update for all filters: separate updates in the same event would overwrite each other.
  const clearFilters = () => setParams((prev) => { const next = new URLSearchParams(prev); ['q', 'status', 'source', 'page'].forEach((k) => next.delete(k)); return next; }, { replace: true });

  const create = canCreate ? <ButtonLink to="/verification-activities/new" variant="primary" icon={<Plus className="h-4 w-4" />}>Create activity</ButtonLink> : undefined;
  const firstTime = rows.length === 0;

  return (
    <>
      <PageHeader title="Verification Activities" actions={firstTime && view !== 'invited' ? undefined : create} />
      {previewEmpty && (
        <p className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <span><span className="font-semibold">Demo preview:</span> showing the empty state. Your activities are unchanged.</span>
          <button type="button" onClick={() => setPreview('')} className="font-semibold underline">Show activities</button>
        </p>
      )}
      <div className="mb-4"><Tabs<'mine' | 'invited'> value={view === 'invited' ? 'invited' : 'mine'} onChange={(v) => setView(v === 'mine' ? '' : v)}
        tabs={[{ value: 'mine', label: 'My Activities', count: rows.length }, { value: 'invited', label: 'Invited Activities', count: invitedCount }]} /></div>
      {view === 'invited' ? <InvitedActivities /> : loading ? (
        <Card><div className="space-y-3 p-4" aria-busy="true" aria-label="Loading activities">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div></Card>
      ) : firstTime ? (
        <Card><EmptyState icon={<ShieldCheck className="h-5 w-5" />} title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} action={create} /></Card>
      ) : (
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search activities" label="Search activities by name" className="sm:w-72" />
          <FilterSelect label="Status" value={status} onChange={setStatus}
            options={[{ value: 'all', label: 'All statuses' }, ...STATUSES.map((v) => ({ value: v, label: DISPLAY_STATUS_LABEL[v] }))]} />
          <FilterSelect label="Identity source" value={source} onChange={setSource}
            options={[{ value: 'all', label: 'All identity sources' }, ...sources.map(([value, label]) => ({ value, label }))]} />
        </div>
        <DataTable
          rows={pageRows}
          rowKey={(r) => r.activity.id}
          rowHref={(r) => activityPath(r.activity.id)}
          empty={<EmptyState title="No matching activities" description="Try a different search or filter." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />}
          columns={[
            { key: 'name', header: 'Activity', className: '!whitespace-normal min-w-[7rem]', cell: (r) => <Link to={activityPath(r.activity.id)} className="font-medium text-slate-900 hover:text-brand-700">{r.activity.name}</Link> },
            { key: 'org', header: 'Organization', className: '!whitespace-normal min-w-[7rem]', cell: (r) => <span className="text-slate-700">{organization.name}{r.delegated > 0 && <span className="block text-xs text-slate-500">+ {r.delegated} {r.delegated === 1 ? 'sub-organization' : 'sub-organizations'}</span>}</span> },
            { key: 'source', header: 'Identity source', className: '!whitespace-normal min-w-[7rem]', cell: (r) => <span className="text-slate-700">{r.source}</span> },
            { key: 'schedule', header: 'Schedule', className: '!whitespace-normal min-w-[8rem]', cell: (r) => <span className="block text-slate-700" title={scheduleSummary(r.activity.schedule) ?? undefined}>{scheduleShort(r.activity.schedule) ?? <span className="text-slate-400">Not scheduled</span>}</span> },
            { key: 'status', header: 'Status', cell: (r) => <span className="flex flex-wrap items-center gap-1.5"><DisplayStatusBadge activity={r.activity} />{r.status !== 'draft' && r.status !== 'completed' && r.activity.draftVersionId && <span className="text-xs text-slate-500">Changes pending</span>}</span> },
            { key: 'progress', header: 'Progress', cell: (r) => <Progress row={r} /> },
            { key: 'created', header: 'Created', cell: (r) => <span className="whitespace-nowrap text-slate-500">{formatDate(r.activity.createdAt)}</span> },
            { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (r) => (
              <OverflowMenu label={`Actions for ${r.activity.name}`} items={lifecycle.menu(r.activity)} />
            ) },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
      )}
      {DEMO_AUTH_ENABLED && !previewEmpty && view !== 'invited' && !firstTime && (
        <p className="mt-3 text-xs text-slate-500">Demo: <button type="button" onClick={() => setPreview('empty')} className="font-medium text-brand-600 hover:text-brand-700">preview the empty state</button> without changing any data.</p>
      )}
      {lifecycle.dialog}
    </>
  );
}

/** Verified people of all eligible, for selected participants; verified and total attempts for open verification. */
function Progress({ row }: { row: { counts: ReturnType<typeof activityCounts>; eligible?: number; verifiedPeople: number; status: ActivityDisplayStatus } }) {
  if (row.eligible !== undefined) {
    const pct = row.eligible ? Math.round((row.verifiedPeople / row.eligible) * 100) : 0;
    return (
      <span className="block min-w-[6rem]">
        <span className="text-slate-700"><span className="font-medium tabular-nums">{row.verifiedPeople}</span> of <span className="tabular-nums">{row.eligible}</span> verified</span>
        <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>
      </span>
    );
  }
  if (!row.counts.attempts) return <span className="text-slate-400">{row.status === 'draft' || row.status === 'scheduled' ? 'Not started' : 'No verifications yet'}</span>;
  return <span className="text-slate-700"><span className="font-medium tabular-nums">{row.counts.verified}</span> verified<br /><span className="text-xs text-slate-500"><span className="tabular-nums">{row.counts.attempts}</span> {row.counts.attempts === 1 ? 'attempt' : 'attempts'}</span></span>;
}


/** Shared activities other organizations invited this organization to. Accepting needs permission to edit activities. */
function InvitedActivities() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const { respondToInvitation } = useActions();
  const toast = useToast();
  const list = sharedWith(state, organization.id);
  const ownerName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? 'Another organization';
  const respond = (id: string, name: string, accept: boolean) => {
    const r = respondToInvitation(organization.id, id, accept);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: accept ? 'Invitation accepted' : 'Invitation declined', description: name });
  };
  return (
    <Card>
      <DataTable
        rows={list}
        rowKey={(a) => a.id}
        empty={<EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No invitations" description="Activities other organizations share with you appear here." />}
        columns={[
          { key: 'name', header: 'Activity', cell: (a) => <Link to={activityPath(a.id)} className="font-medium text-slate-900 hover:text-brand-700">{a.name}</Link> },
          { key: 'owner', header: 'From', cell: (a) => <span className="text-slate-700">{ownerName(a.organizationId)}</span> },
          { key: 'status', header: 'Status', cell: (a) => { const st = participation(a, organization.id) as 'invited' | 'active' | 'suspended'; return <Badge tone={st === 'active' ? 'success' : st === 'invited' ? 'info' : 'warning'}>{PARTICIPATION_LABEL[st]}</Badge>; } },
          {
            key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (a) => {
              const st = participation(a, organization.id);
              if (st === 'invited' && can('verification.activities.edit')) {
                return (
                  <span className="inline-flex gap-2">
                    <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => respond(a.id, a.name, true)}>Accept<span className="sr-only"> {a.name}</span></Button>
                    <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => respond(a.id, a.name, false)}>Decline<span className="sr-only"> {a.name}</span></Button>
                  </span>
                );
              }
              return st === 'active' ? <Link to={activityPath(a.id)} className="text-sm font-semibold text-brand-600 hover:text-brand-700">Assign verifiers<span className="sr-only"> for {a.name}</span></Link> : null;
            },
          },
        ]}
      />
    </Card>
  );
}
