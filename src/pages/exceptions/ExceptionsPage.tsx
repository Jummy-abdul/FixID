import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, FilterSelect, Input, PageHeader, Pagination, SearchInput, Skeleton, Tabs, usePageSlice, useToast,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import {
  CATEGORY_LABEL, EXCEPTION_REASON_LABEL, EXCEPTION_STATUS_LABEL, categoryOf, isUnresolved,
  type ExceptionReason, type ExceptionStatus, type VerificationException,
} from '@/domain/exceptions';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/dates';
import { approvalRequired, exceptionSubject, exceptionsOf, exceptionsVisibleTo } from '@/store/exceptionOps';
import { useActions, useSession, useStore } from '@/store/AppStore';

const STATUS_TONE: Record<ExceptionStatus, 'info' | 'brand' | 'violet' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  open: 'warning', assigned: 'info', 'in-review': 'violet', 'awaiting-information': 'brand', 'pending-approval': 'info', returned: 'danger',
  resolved: 'success', closed: 'neutral', reopened: 'warning',
};
export const ExceptionStatusBadge = ({ status }: { status: ExceptionStatus }) => <Badge tone={STATUS_TONE[status]} dot>{EXCEPTION_STATUS_LABEL[status]}</Badge>;

type View = 'all' | 'mine' | 'approvals' | 'settings';
const PAGE = 15;

/** The approval state of an exception, for the queue. */
export function approvalState(e: VerificationException, required: boolean): { key: 'pending' | 'approved' | 'returned' | 'not-required'; label: string } {
  if (e.status === 'pending-approval') return { key: 'pending', label: 'Awaiting approval' };
  if (e.approval) return { key: 'approved', label: `Approved by ${e.approval.by}` };
  if (e.status === 'returned') return { key: 'returned', label: 'Returned or rejected' };
  return { key: 'not-required', label: required ? 'Not yet submitted' : 'Not required' };
}

/**
 * Exceptions across every verification activity the organization may see: its own transactions’ exceptions, and
 * those routed to it as the owner of a delegated activity. Each keeps its link to the activity that raised it.
 */
export function ExceptionsPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can, record } = useAuthorization();
  const [view, setView] = useQueryState('view', 'all');
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [reason, setReason] = useQueryState('reason', 'all');
  const [activity, setActivity] = useQueryState('activity', 'all');
  const [reviewer, setReviewer] = useQueryState('reviewer', 'all');
  const [approval, setApproval] = useQueryState('approval', 'all');
  const [from, setFrom] = useQueryState('from');
  const [to, setTo] = useQueryState('to');
  const [page, setPage] = usePageParam();
  const [, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 200); return () => clearTimeout(t); }, []);
  const required = approvalRequired(state, organization.id);
  const canReview = can('exceptions.review');
  const canApprove = can('exceptions.approve');
  const all = useMemo(() => exceptionsVisibleTo(state, organization.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state, organization.id]);
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const mine = (e: VerificationException) => e.reviewOrganizationId === organization.id && (
    (canApprove && e.status === 'pending-approval' && e.proposal?.byId !== record?.id)
    || (canReview && isUnresolved(e) && e.status !== 'pending-approval' && (e.assignedReviewerId === record?.id || (!e.assignedReviewerId && ['open', 'returned', 'reopened'].includes(e.status)))));
  const approvals = all.filter((e) => e.status === 'pending-approval' && e.reviewOrganizationId === organization.id);
  const base = view === 'mine' ? all.filter(mine) : view === 'approvals' ? approvals : all;
  const query = q.trim().toLowerCase();
  const rows = base.filter((e) => {
    const who = exceptionSubject(state, e);
    const created = e.createdAt.slice(0, 10);
    return (status === 'all' || (status === 'unresolved' ? isUnresolved(e) : e.status === status))
      && (reason === 'all' || e.reason === reason) && (activity === 'all' || e.activityId === activity)
      && (reviewer === 'all' || (reviewer === 'unassigned' ? !e.assignedReviewerId : e.assignedReviewerId === reviewer))
      && (approval === 'all' || approvalState(e, required).key === approval)
      && (!from || created >= from) && (!to || created <= to)
      && (!query || [e.id, e.transactionId, who.name, who.identifier, e.activityName].join(' ').toLowerCase().includes(query));
  });
  const { pageRows, pageCount, current } = usePageSlice(rows, page, PAGE);
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const clear = () => setParams((prev) => { const n = new URLSearchParams(prev); ['q', 'status', 'reason', 'activity', 'reviewer', 'approval', 'from', 'to', 'page'].forEach((k) => n.delete(k)); return n; }, { replace: true });
  const tabs = [
    { value: 'all' as const, label: 'All exceptions', count: all.length },
    ...(canReview || canApprove ? [{ value: 'mine' as const, label: 'Needs my action', count: all.filter(mine).length }] : []),
    ...(canApprove || required ? [{ value: 'approvals' as const, label: 'Approvals', count: approvals.length }] : []),
    ...(can('exceptions.configure') ? [{ value: 'settings' as const, label: 'Workflow settings' }] : []),
  ];
  const selected: View = tabs.some((t) => t.value === view) ? view as View : 'all';

  return (
    <>
      <PageHeader title="Exceptions" description="Verifications that need investigation or an authorised human review, across all activities." />
      <p className="mb-4 flex items-center gap-2 text-sm text-slate-600">
        <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden="true" />
        {required ? 'Decisions in this organization need a second person’s approval before they’re final.' : 'Decisions in this organization are final when an authorised reviewer records them.'}
      </p>
      <div className="mb-4"><Tabs<View> value={selected} onChange={(v) => setView(v === 'all' ? '' : v)} tabs={tabs} /></div>
      {selected === 'settings' ? <WorkflowSettings /> : loading ? (
        <Card><div className="space-y-3 p-4" aria-busy="true" aria-label="Loading exceptions">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div></Card>
      ) : (
        <Card>
          <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
            <SearchInput value={q} onChange={setQ} placeholder="Search reference, participant or identifier" className="sm:w-72" label="Search exceptions" />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'unresolved', label: 'Unresolved' }, ...(Object.keys(EXCEPTION_STATUS_LABEL) as ExceptionStatus[]).map((s) => ({ value: s, label: EXCEPTION_STATUS_LABEL[s] }))]} />
            <FilterSelect label="Reason" value={reason} onChange={setReason} options={[{ value: 'all', label: 'All reasons' }, ...uniq(all.map((e) => e.reason)).map((r) => ({ value: r, label: EXCEPTION_REASON_LABEL[r as ExceptionReason] }))]} />
            <FilterSelect label="Activity" value={activity} onChange={setActivity} options={[{ value: 'all', label: 'All activities' }, ...uniq(all.map((e) => e.activityId)).map((id) => ({ value: id, label: all.find((e) => e.activityId === id)!.activityName }))]} />
            <FilterSelect label="Assigned reviewer" value={reviewer} onChange={setReviewer} options={[{ value: 'all', label: 'Any reviewer' }, { value: 'unassigned', label: 'Unassigned' }, ...uniq(all.filter((e) => e.assignedReviewerId).map((e) => e.assignedReviewerId!)).map((id) => ({ value: id, label: all.find((e) => e.assignedReviewerId === id)!.assignedReviewerName ?? id }))]} />
            <FilterSelect label="Approval" value={approval} onChange={setApproval} options={[{ value: 'all', label: 'Any approval state' }, { value: 'pending', label: 'Awaiting approval' }, { value: 'approved', label: 'Approved' }, { value: 'returned', label: 'Returned or rejected' }, { value: 'not-required', label: 'Not submitted or not required' }]} />
            <label className="text-sm text-slate-600">Raised from<Input type="date" value={from} onChange={(x) => setFrom(x.target.value)} className="mt-1" aria-label="Raised from" /></label>
            <label className="text-sm text-slate-600">to<Input type="date" value={to} onChange={(x) => setTo(x.target.value)} className="mt-1" aria-label="Raised to" /></label>
          </div>
          <DataTable
            rows={pageRows}
            rowKey={(e) => e.id}
            rowHref={(e) => `/exceptions/${e.id}`}
            empty={all.length === 0
              ? <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="No exceptions" description="When a verification needs investigation under its activity’s policy, an exception appears here." />
              : base.length === 0 && selected !== 'all'
                ? <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title={selected === 'approvals' ? 'No decisions awaiting approval' : 'Nothing awaiting your action'} description="You’re up to date." />
                : <EmptyState title="No matching exceptions" description="Try a different search or filter." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />}
            columns={[
              { key: 'id', header: 'Reference', cell: (e) => <Link to={`/exceptions/${e.id}`} className="font-mono text-xs font-medium text-slate-900 hover:text-brand-700">{e.id}</Link> },
              { key: 'who', header: 'Participant', className: '!whitespace-normal min-w-[9rem]', cell: (e) => { const w = exceptionSubject(state, e); return <span><span className="block font-medium text-slate-900">{w.name}</span><span className="font-mono text-xs text-slate-500">{w.identifier}</span></span>; } },
              { key: 'activity', header: 'Activity', className: '!whitespace-normal min-w-[8rem]', cell: (e) => <span>{e.activityName}{e.organizationId !== organization.id && <span className="block text-xs text-slate-500">{orgName(e.organizationId)}</span>}</span> },
              { key: 'reason', header: 'Reason', className: '!whitespace-normal min-w-[9rem]', cell: (e) => <span>{EXCEPTION_REASON_LABEL[e.reason]}<span className={cn('block text-xs', categoryOf(e.reason) === 'technical' ? 'text-amber-700' : 'text-slate-500')}>{CATEGORY_LABEL[categoryOf(e.reason)]}</span></span> },
              { key: 'raised', header: 'Raised', cell: (e) => <span className="tabular-nums text-slate-600">{formatDateTime(e.createdAt)}</span> },
              { key: 'status', header: 'Status', cell: (e) => <ExceptionStatusBadge status={e.status} /> },
              { key: 'reviewer', header: 'Reviewer', cell: (e) => e.assignedReviewerName ?? <span className="text-slate-400">Unassigned</span> },
              { key: 'approver', header: 'Approver', className: '!whitespace-normal', cell: (e) => <span className="text-xs text-slate-600">{e.approval?.by ?? (e.status === 'pending-approval' ? 'Awaiting approver' : '—')}</span> },
            ]}
          />
          <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={PAGE} onPage={setPage} />
        </Card>
      )}
    </>
  );
}

/** Whether final decisions need a second person’s approval. Changing it never bypasses a decision already awaiting approval. */
function WorkflowSettings() {
  const { organization } = useSession();
  const { state } = useStore();
  const { setExceptionWorkflow } = useActions();
  const toast = useToast();
  const current = !!organization.exceptionWorkflow?.approvalRequired;
  const [value, setValue] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const waiting = exceptionsOf(state).filter((e) => e.reviewOrganizationId === organization.id && e.status === 'pending-approval').length;
  const save = () => {
    setConfirming(false);
    const r = setExceptionWorkflow(organization.id, value);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: 'Exception workflow saved', description: value ? 'Final decisions now need approval.' : 'Final decisions no longer need approval.' });
  };
  const Option = ({ v, title, body }: { v: boolean; title: string; body: string }) => (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm', value === v ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50')}>
      <input type="radio" name="approval" className="mt-0.5" checked={value === v} onChange={() => setValue(v)} />
      <span><span className="block font-semibold text-slate-900">{title}</span><span className="text-slate-600">{body}</span></span>
    </label>
  );
  return (
    <Card className="max-w-3xl p-5">
      <h2 className="text-base font-semibold text-slate-900">Require approval before resolving exceptions</h2>
      <p className="mt-1 text-sm text-slate-500">Applies to final decisions (Confirm identity, Identity could not be established). Requesting another attempt or escalating never needs approval.</p>
      <fieldset className="mt-4 grid gap-3" aria-label="Require approval before resolving exceptions">
        <Option v title="Yes — approval is required" body="A reviewer’s decision is submitted for approval. A different person with permission to approve decisions approves, rejects or returns it. Nobody can approve their own submission." />
        <Option v={false} title="No — approval is not required" body="A reviewer who is also permitted to resolve exceptions records the final decision directly. Reviewers without that permission can’t resolve cases." />
      </fieldset>
      {organization.exceptionWorkflow?.updatedBy && <p className="mt-3 text-xs text-slate-500">Last changed {formatDate(organization.exceptionWorkflow.updatedAt)} by {organization.exceptionWorkflow.updatedBy}.</p>}
      <div className="mt-4 flex justify-end">
        <Button disabled={value === current} onClick={() => setConfirming(true)}>Save</Button>
      </div>
      {confirming && (
        <ConfirmDialog open title={value ? 'Require approval for exception decisions?' : 'Stop requiring approval?'} confirmLabel="Save"
          description={value
            ? 'New final decisions will be submitted for approval. Cases already resolved stay as they are.'
            : `Reviewers permitted to resolve exceptions will record final decisions directly.${waiting ? ` ${waiting} decision${waiting === 1 ? '' : 's'} already awaiting approval still need${waiting === 1 ? 's' : ''} an approver: they aren’t resolved automatically.` : ''}`}
          onCancel={() => setConfirming(false)} onConfirm={save} />
      )}
    </Card>
  );
}
