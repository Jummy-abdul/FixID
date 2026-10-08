import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState, FilterSelect, PageHeader, Pagination, SearchInput, usePageSlice } from '@/components/ui';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import type { AuditEvent } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

const PAGE_SIZE = 20;
const ACTOR_TONE = { admin: 'brand', system: 'neutral', integration: 'info' } as const;

export function AuditPage() {
  const { audit } = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [area, setArea] = useQueryState('area', 'all');
  const [result, setResult] = useQueryState('result', 'all');
  const [page, setPage] = usePageParam();

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return audit.filter((e) =>
      (area === 'all' || e.action.startsWith(area)) &&
      (result === 'all' || e.result === result) &&
      (!query || e.summary.toLowerCase().includes(query) || e.actor.toLowerCase().includes(query) || e.id.toLowerCase().includes(query)));
  }, [audit, q, area, result]);
  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);

  return (
    <>
      <PageHeader title="Audit Log" description="Administrative, integration and security-sensitive activity in this organization. Records are append-only." />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search events or actors" className="sm:w-72" />
          <FilterSelect label="Area" value={area} onChange={setArea} options={[
            { value: 'all', label: 'All areas' }, { value: 'identity', label: 'Identity' }, { value: 'credential', label: 'Credentials' },
            { value: 'wallet', label: 'Wallet' }, { value: 'activity', label: 'Verification activities' }, { value: 'organization', label: 'Organization' },
          ]} />
          <FilterSelect label="Result" value={result} onChange={setResult} options={[
            { value: 'all', label: 'Any result' }, { value: 'success', label: 'Success' }, { value: 'failure', label: 'Failure' },
          ]} />
        </div>
        <DataTable<AuditEvent>
          rows={pageRows}
          rowKey={(e) => e.id}
          empty={<EmptyState icon={<ScrollText className="h-5 w-5" />} title="No audit events match" />}
          columns={[
            { key: 'time', header: 'Time', cell: (e) => <span className="tabular-nums text-slate-600">{formatDateTime(e.occurredAt)}</span> },
            { key: 'action', header: 'Action', cell: (e) => <span className="font-mono text-xs text-slate-600">{e.action}</span> },
            { key: 'summary', header: 'Event', cell: (e) => e.href ? <Link to={e.href} className="text-slate-900 hover:text-brand-700">{e.summary}</Link> : e.summary, className: 'max-w-md truncate' },
            { key: 'actor', header: 'Actor', cell: (e) => <span className="flex items-center gap-2">{e.actor}<Badge tone={ACTOR_TONE[e.actorType]}>{e.actorType}</Badge></span> },
            { key: 'result', header: 'Result', cell: (e) => <Badge tone={e.result === 'success' ? 'success' : 'danger'} dot>{e.result}</Badge> },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
    </>
  );
}
