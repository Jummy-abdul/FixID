import { useMemo, useState } from 'react';
import { Download, FlaskConical } from 'lucide-react';
import { Button, Card, CardHeader, DataTable, FilterSelect, PageHeader, StatCard, Tabs, useToast } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { EXCEPTION_REASON_LABEL, type ExceptionReason } from '@/domain/exceptions';
import { DECISION_LABEL, ELIGIBILITY_STATUS_LABEL, MATCH_LABEL } from '@/domain/transactions';
import { formatDate } from '@/lib/dates';
import { exceptionsVisibleTo } from '@/store/exceptionOps';
import { activityBreakdown, exceptionSummary, organizationTransactions, sharedActivityExceptions, sharedActivityTransactions, sharedResults, summarize, toCsv, type Period, type Summary } from '@/store/reporting';
import { useSession, useStore } from '@/store/AppStore';

type Tab = 'organization' | 'shared' | 'exceptions';
const PERIODS = { '7d': 7, '30d': 30, '90d': 90, all: 0 } as const;

/** Downloads aggregate rows as CSV. Never people, references, identity attributes or biometric data. */
function download(name: string, rows: (string | number)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function outcomeRows(s: Summary): (string | number)[][] {
  return [
    ['Verification attempts', s.attempts], ['Completed', s.completed], ['Pending reviews', s.pendingReview], ['Unable to complete', s.unableToComplete], ['Cancelled', s.cancelled],
    ...(['allow', 'deny', 'pending-review', 'unable-to-decide'] as const).map((d) => [`Decision: ${DECISION_LABEL[d]}`, s.byDecision[d]]),
    ...Object.entries(s.byMatch).map(([k, v]) => [`Identity match: ${MATCH_LABEL[k as keyof typeof MATCH_LABEL] ?? k}`, v]),
    ...Object.entries(s.byEligibility).map(([k, v]) => [`Eligibility: ${ELIGIBILITY_STATUS_LABEL[k as keyof typeof ELIGIBILITY_STATUS_LABEL] ?? k}`, v]),
  ];
}

/**
 * Operational reports for the current workspace, from stored records. Organization and exception reports
 * cover this organization (plus exceptions routed to it); the shared activity report covers shared activities
 * it owns, across their participating organizations, for those activities only. Exports contain aggregates only.
 */
export function ReportsPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const toast = useToast();
  const owned = state.data.activityConfigs.filter((a) => a.organizationId === organization.id && a.sharing && a.status !== 'draft');
  const showExceptions = can('exceptions.view') || can('exceptions.review');
  const tabs = [{ value: 'organization' as Tab, label: 'Organization verification report' }, ...(owned.length ? [{ value: 'shared' as Tab, label: 'Shared activity report' }] : []), ...(showExceptions ? [{ value: 'exceptions' as Tab, label: 'Exception report' }] : [])];
  const [tab, setTab] = useState<Tab>('organization');
  const [periodKey, setPeriodKey] = useState<keyof typeof PERIODS>('30d');
  const [sharedId, setSharedId] = useState(owned[0]?.id ?? '');
  const now = useMemo(() => new Date(), []);
  const period: Period = PERIODS[periodKey] ? { from: new Date(now.getTime() - PERIODS[periodKey] * 86_400_000).toISOString(), to: now.toISOString() } : {};
  const periodLabel = period.from ? `${formatDate(period.from)} – ${formatDate(now.toISOString())}` : 'All time';
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const exported = (name: string) => toast({ tone: 'success', title: 'Report exported', description: `${name} (aggregates only).` });

  return (
    <>
      <PageHeader title="Reports" description="Verification and exception reports from recorded transactions. Exports contain aggregate figures only." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect label="Reporting period" value={periodKey} onChange={(v) => setPeriodKey(v as keyof typeof PERIODS)} options={[{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' }, { value: 'all', label: 'All time' }]} />
        <span className="text-sm text-slate-500">Reporting period: {periodLabel}</span>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-6">
        {tab === 'organization' && <OrganizationReport period={period} periodLabel={periodLabel} onExport={exported} />}
        {tab === 'shared' && owned.length > 0 && (() => {
          const a = owned.find((x) => x.id === sharedId) ?? owned[0];
          const o = sharedResults(state, a, period);
          const ex = sharedActivityExceptions(state, a);
          const tx = sharedActivityTransactions(state, a, period);
          const name = `shared-activity-report-${a.id}.csv`;
          return (
            <section aria-label="Shared activity report" className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                {owned.length > 1 && <FilterSelect label="Shared activity" value={a.id} onChange={setSharedId} options={owned.map((x) => ({ value: x.id, label: x.name }))} />}
                <span className="flex-1 text-sm text-slate-600">Shared activity: <span className="font-medium text-slate-900">{a.name}</span></span>
                <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => {
                  download(name, [['Shared activity', a.name], ['Reporting period', periodLabel], ['Participating organizations', o.participating], ...outcomeRows(o.summary), ['Exceptions', ex.length], ['Unresolved exceptions', o.exceptions.unresolved], [], ['Organization', 'Attempts', 'Completed', 'Pending review', 'Unable to complete'], ...o.rows.map((r) => [r.name, r.summary.attempts, r.summary.completed, r.summary.pendingReview, r.summary.unableToComplete])]);
                  exported(name);
                }}>Export CSV</Button>
              </div>
              <Figures s={o.summary} extra={[{ label: 'Participating Organizations', value: o.participating }, { label: 'Exceptions', value: ex.length }, { label: 'Unresolved Exceptions', value: o.exceptions.unresolved }]} />
              <Card>
                <CardHeader title="By organization" description="This activity’s transactions only. Participating organizations’ other records aren’t included." />
                <DataTable rows={o.rows.filter((r) => r.summary.attempts > 0 || r.participation === 'active' || r.participation === 'owner')} rowKey={(r) => r.organizationId} columns={[
                  { key: 'org', header: 'Organization', cell: (r) => r.name },
                  { key: 'att', header: 'Attempts', cell: (r) => r.summary.attempts },
                  { key: 'done', header: 'Completed', cell: (r) => r.summary.completed },
                  { key: 'pend', header: 'Pending Review', cell: (r) => r.summary.pendingReview },
                  { key: 'unable', header: 'Unable to Complete', cell: (r) => r.summary.unableToComplete },
                ]} />
              </Card>
              <p className="text-xs text-slate-500">{tx.length} transactions in the reporting period.</p>
            </section>
          );
        })()}
        {tab === 'exceptions' && (() => {
          const list = exceptionsVisibleTo(state, organization.id).filter((e) => (!period.from || e.createdAt >= period.from));
          const x = exceptionSummary(list);
          const name = `exception-report-${organization.id}.csv`;
          return (
            <section aria-label="Exception report" className="space-y-6">
              <div className="flex justify-end">
                <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => {
                  download(name, [['Organization', organization.name], ['Reporting period', periodLabel], ['Total exceptions', x.total], ['Open exceptions', x.open], ['Resolved exceptions', x.resolved], ['Median resolution time (hours)', x.medianResolutionHours === null ? 'Not calculable' : Math.round(x.medianResolutionHours * 10) / 10], [],
                    ['Reason', 'Exceptions'], ...Object.entries(x.byReason).map(([k, v]) => [EXCEPTION_REASON_LABEL[k as ExceptionReason], v]), [], ['Activity', 'Exceptions'], ...Object.entries(x.byActivity), [], ['Organization', 'Exceptions'], ...Object.entries(x.byOrganization).map(([k, v]) => [orgName(k), v])]);
                  exported(name);
                }}>Export CSV</Button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Total Exceptions" value={x.total} />
                <StatCard label="Open Exceptions" value={x.open} tone="violet" />
                <StatCard label="Resolved Exceptions" value={x.resolved} tone="emerald" />
                <StatCard label="Median Resolution Time" value={x.medianResolutionHours === null ? 'Not calculable' : `${Math.round(x.medianResolutionHours * 10) / 10} h`} hint={x.medianResolutionHours === null ? 'No exception has a recorded resolution yet' : 'From creation to recorded resolution'} />
              </div>
              <div className="grid gap-6 lg:grid-cols-3">
                <Breakdown title="Exceptions by reason" rows={Object.entries(x.byReason).map(([k, v]) => [EXCEPTION_REASON_LABEL[k as ExceptionReason], v])} />
                <Breakdown title="Exceptions by activity" rows={Object.entries(x.byActivity)} />
                <Breakdown title="Exceptions by organization" rows={Object.entries(x.byOrganization).map(([k, v]) => [orgName(k), v])} />
              </div>
            </section>
          );
        })()}
      </div>
    </>
  );
}

function OrganizationReport({ period, periodLabel, onExport }: { period: Period; periodLabel: string; onExport: (name: string) => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const tx = organizationTransactions(state, organization.id, period);
  const s = summarize(state, tx);
  const acts = activityBreakdown(state, tx);
  const name = `verification-report-${organization.id}.csv`;
  return (
    <section aria-label="Organization verification report" className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-sm text-slate-600">{organization.name}{s.simulated ? <span className="ml-2 inline-flex items-center gap-1 text-amber-700"><FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />{s.simulated} used simulated services</span> : null}</span>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => {
          download(name, [['Organization', organization.name], ['Reporting period', periodLabel], ...outcomeRows(s), [], ['Activity', 'Attempts', 'Allowed', 'Denied', 'Pending review', 'Unable to complete'], ...acts.map((a) => [a.activityName, a.attempts, a.allowed, a.denied, a.pendingReview, a.unableToComplete])]);
          onExport(name);
        }}>Export CSV</Button>
      </div>
      <Figures s={s} />
      <ActivityTable rows={acts} />
    </section>
  );
}

function Figures({ s, extra = [] }: { s: Summary; extra?: { label: string; value: number }[] }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {extra.map((x) => <StatCard key={x.label} label={x.label} value={x.value} />)}
        <StatCard label="Verification Attempts" value={s.attempts} />
        <StatCard label="Completed" value={s.completed} tone="emerald" />
        <StatCard label="Pending Reviews" value={s.pendingReview} tone="violet" />
        <StatCard label="Unable to Complete" value={s.unableToComplete} tone="amber" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Breakdown title="Activity decisions" rows={(['allow', 'deny', 'pending-review', 'unable-to-decide'] as const).map((d) => [DECISION_LABEL[d], s.byDecision[d]])} />
        <Breakdown title="Identity match outcomes" rows={Object.entries(s.byMatch).map(([k, v]) => [MATCH_LABEL[k as keyof typeof MATCH_LABEL] ?? k, v])} />
        <Breakdown title="Eligibility outcomes" rows={Object.entries(s.byEligibility).map(([k, v]) => [ELIGIBILITY_STATUS_LABEL[k as keyof typeof ELIGIBILITY_STATUS_LABEL] ?? k, v])} />
      </div>
    </>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] | (string | number)[][] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y divide-slate-100 text-sm" aria-label={title}>
        {rows.length === 0 && <li className="px-5 py-3 text-slate-500">No records in this period.</li>}
        {rows.map(([k, v]) => <li key={String(k)} className="flex justify-between px-5 py-2"><span className="text-slate-600">{k}</span><span className="font-semibold tabular-nums text-slate-900">{v}</span></li>)}
      </ul>
    </Card>
  );
}

function ActivityTable({ rows, orgName }: { rows: ReturnType<typeof activityBreakdown>; orgName?: (id: string) => string }) {
  return (
    <Card>
      <CardHeader title="Activity breakdown" />
      <DataTable rows={rows} rowKey={(a) => a.activityId} empty={<p className="px-5 py-6 text-sm text-slate-500">No verifications in this period.</p>} columns={[
        { key: 'name', header: 'Activity', cell: (a) => a.activityName },
        ...(orgName ? [{ key: 'org', header: 'Organization', cell: (a: (typeof rows)[number]) => orgName(a.organizationId) }] : []),
        { key: 'att', header: 'Attempts', cell: (a) => a.attempts },
        { key: 'allow', header: 'Allowed', cell: (a) => a.allowed },
        { key: 'deny', header: 'Denied', cell: (a) => a.denied },
        { key: 'pend', header: 'Pending Review', cell: (a) => a.pendingReview },
        { key: 'unable', header: 'Unable to Complete', cell: (a) => a.unableToComplete },
      ]} />
    </Card>
  );
}
