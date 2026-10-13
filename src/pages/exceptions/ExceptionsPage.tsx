import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, ShieldAlert } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState, FilterSelect, OverflowMenu, PageHeader, SearchInput } from '@/components/ui';
import { EXCEPTION_REASON_LABEL, EXCEPTION_STATUS_LABEL, type ExceptionReason, type ExceptionStatus } from '@/domain/exceptions';
import { useQueryState } from '@/hooks/useQueryState';
import { formatDateTime } from '@/lib/dates';
import { exceptionsVisibleTo } from '@/store/exceptionOps';
import { useSession, useStore } from '@/store/AppStore';

const STATUS_TONE: Record<ExceptionStatus, 'info' | 'brand' | 'violet' | 'warning' | 'success' | 'neutral'> = {
  open: 'warning', assigned: 'info', 'in-review': 'violet', 'awaiting-information': 'brand', resolved: 'success', closed: 'neutral',
};
export const ExceptionStatusBadge = ({ status }: { status: ExceptionStatus }) => <Badge tone={STATUS_TONE[status]} dot>{EXCEPTION_STATUS_LABEL[status]}</Badge>;

/**
 * Verification Exceptions the current organization may see: its own transactions' exceptions, and those
 * routed to it as the owner of a shared activity. Read-only for roles without review permission.
 */
export function ExceptionsPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const navigate = useNavigate();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [reason, setReason] = useQueryState('reason', 'all');
  const [activity, setActivity] = useQueryState('activity', 'all');
  const [reviewer, setReviewer] = useQueryState('reviewer', 'all');
  const all = useMemo(() => exceptionsVisibleTo(state, organization.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state, organization.id]);
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const rows = all.filter((e) => (status === 'all' || (status === 'unresolved' ? !['resolved', 'closed'].includes(e.status) : e.status === status))
    && (reason === 'all' || e.reason === reason) && (activity === 'all' || e.activityId === activity)
    && (reviewer === 'all' || (reviewer === 'unassigned' ? !e.assignedReviewerId : e.assignedReviewerId === reviewer))
    && (!q.trim() || [e.id, e.transactionId, e.activityName, e.assignedReviewerName].join(' ').toLowerCase().includes(q.trim().toLowerCase())));
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];

  return (
    <>
      <PageHeader title="Exceptions" description="Verifications that need review." />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search exception, transaction or activity" className="sm:w-72" label="Search exceptions" />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'unresolved', label: 'Unresolved' }, ...(Object.keys(EXCEPTION_STATUS_LABEL) as ExceptionStatus[]).map((s) => ({ value: s, label: EXCEPTION_STATUS_LABEL[s] }))]} />
          <FilterSelect label="Reason" value={reason} onChange={setReason} options={[{ value: 'all', label: 'All reasons' }, ...uniq(all.map((e) => e.reason)).map((r) => ({ value: r, label: EXCEPTION_REASON_LABEL[r as ExceptionReason] }))]} />
          <FilterSelect label="Activity" value={activity} onChange={setActivity} options={[{ value: 'all', label: 'All activities' }, ...uniq(all.map((e) => e.activityId)).map((id) => ({ value: id, label: all.find((e) => e.activityId === id)!.activityName }))]} />
          <FilterSelect label="Assigned reviewer" value={reviewer} onChange={setReviewer} options={[{ value: 'all', label: 'Any reviewer' }, { value: 'unassigned', label: 'Unassigned' }, ...uniq(all.filter((e) => e.assignedReviewerId).map((e) => e.assignedReviewerId!)).map((id) => ({ value: id, label: all.find((e) => e.assignedReviewerId === id)!.assignedReviewerName ?? id }))]} />
        </div>
        <DataTable
          rows={rows}
          rowKey={(e) => e.id}
          rowHref={(e) => `/exceptions/${e.id}`}
          empty={all.length === 0
            ? <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="No exceptions" description="When a verification needs review under its activity’s settings, an exception appears here." />
            : <EmptyState title="No matching exceptions" description="Try a different search or filter." />}
          columns={[
            { key: 'id', header: 'Exception', cell: (e) => <Link to={`/exceptions/${e.id}`} className="font-mono text-xs font-medium text-slate-900 hover:text-brand-700">{e.id}</Link> },
            { key: 'tx', header: 'Transaction', cell: (e) => <span className="font-mono text-xs text-slate-600">{e.transactionId}</span> },
            { key: 'activity', header: 'Activity', cell: (e) => e.activityName },
            { key: 'org', header: 'Organization', cell: (e) => <span className="text-slate-600">{orgName(e.organizationId)}</span> },
            { key: 'review', header: 'Reviewed by', cell: (e) => <span className="text-slate-600">{orgName(e.reviewOrganizationId)}</span> },
            { key: 'reason', header: 'Reason', cell: (e) => EXCEPTION_REASON_LABEL[e.reason] },
            { key: 'status', header: 'Status', cell: (e) => <ExceptionStatusBadge status={e.status} /> },
            { key: 'reviewer', header: 'Assigned Reviewer', cell: (e) => e.assignedReviewerName ?? <span className="text-slate-400">Unassigned</span> },
            { key: 'created', header: 'Created', cell: (e) => <span className="tabular-nums text-slate-600">{formatDateTime(e.createdAt)}</span> },
            { key: 'updated', header: 'Last Updated', cell: (e) => <span className="tabular-nums text-slate-600">{formatDateTime(e.updatedAt)}</span> },
            { key: 'actions', header: 'Actions', className: 'w-20 text-right', cell: (e) => <OverflowMenu label={`Actions for ${e.id}`} items={[{ key: 'view', label: 'View details', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(`/exceptions/${e.id}`) }]} /> },
          ]}
        />
      </Card>
    </>
  );
}
