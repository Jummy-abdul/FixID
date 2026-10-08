import { useMemo } from 'react';
import { Download, X } from 'lucide-react';
import { Badge, Card, FilterSelect, PageHeader, Pagination, SearchInput, usePageSlice } from '@/components/ui';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { TransactionsTable } from '@/components/domain/TransactionsTable';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { allowRate, formatPercent, rangeStart, type TimeRange } from '@/domain/metrics';
import { METHOD_LABEL } from '@/domain/labels';
import { useOrgData } from '@/store/AppStore';

const PAGE_SIZE = 20;

export function TransactionsPage() {
  const { transactions, activities, memberById, credentialById } = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [range, setRange] = useQueryState('range', '7d');
  const [decision, setDecision] = useQueryState('decision', 'all');
  const [activity, setActivity] = useQueryState('activity', 'all');
  const [method, setMethod] = useQueryState('method', 'all');
  const [person, setPerson] = useQueryState('person', '');
  const [page, setPage] = usePageParam();
  const now = useMemo(() => new Date(), []);

  const filtered = useMemo(() => {
    const start = rangeStart(range as TimeRange, now)?.toISOString();
    const query = q.trim().toLowerCase();
    return transactions.filter((t) =>
      (!start || t.occurredAt >= start) &&
      (decision === 'all' || (decision === 'not-allowed' ? t.decision !== 'allow' : t.decision === decision)) &&
      (activity === 'all' || t.activityId === activity) &&
      (method === 'all' || (method === 'fallback' ? t.fallbackUsed : t.method === method)) &&
      (!person || t.memberId === person) &&
      (!query || t.id.toLowerCase().includes(query) || t.reason.toLowerCase().includes(query) ||
        (t.memberId && memberById.get(t.memberId)?.displayName.toLowerCase().includes(query)) ||
        (t.credentialId && credentialById.get(t.credentialId)?.identifier.toLowerCase().includes(query))),
    );
  }, [transactions, range, decision, activity, method, person, q, now, memberById, credentialById]);

  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const personName = person ? memberById.get(person)?.displayName : null;

  return (
    <>
      <PageHeader
        title="Verification History"
        description="Every verification attempt, its verification result and its authorization decision."
        actions={<PlannedButton icon={<Download className="h-4 w-4" />} info={PLANNED.export}>Export CSV</PlannedButton>}
      />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search ID, person, credential or reason" className="sm:w-72" />
          <FilterSelect label="Time range" value={range} onChange={setRange}
            options={[{ value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'all', label: 'All time' }]} />
          <FilterSelect label="Decision" value={decision} onChange={setDecision}
            options={[{ value: 'all', label: 'All decisions' }, { value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }, { value: 'indeterminate', label: 'Indeterminate' }, { value: 'not-allowed', label: 'Not allowed (deny + indeterminate)' }]} />
          <FilterSelect label="Activity" value={activity} onChange={setActivity}
            options={[{ value: 'all', label: 'All activities' }, ...activities.map((a) => ({ value: a.id, label: a.name }))]} />
          <FilterSelect label="Method" value={method} onChange={setMethod}
            options={[{ value: 'all', label: 'Any method' }, ...Object.entries(METHOD_LABEL).map(([v, l]) => ({ value: v, label: l })), { value: 'fallback', label: 'Fallback used' }]} />
          {personName && (
            <Badge tone="brand" className="py-1">
              Person: {personName}
              <button type="button" onClick={() => setPerson('')} aria-label="Remove person filter"><X className="h-3 w-3" /></button>
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-6 border-b border-slate-100 bg-slate-50/50 px-4 py-2.5 text-sm text-slate-600">
          <span><span className="font-semibold tabular-nums text-slate-900">{filtered.length.toLocaleString()}</span> attempts</span>
          <span><span className="font-semibold tabular-nums text-slate-900">{formatPercent(allowRate(filtered))}</span> allowed</span>
          <span><span className="font-semibold tabular-nums text-slate-900">{filtered.filter((t) => t.fallbackUsed).length}</span> used fallback</span>
        </div>
        <TransactionsTable rows={pageRows} emptyTitle="No transactions match" emptyDescription="Try widening the time range or clearing filters." />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
    </>
  );
}
