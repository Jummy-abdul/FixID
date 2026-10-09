import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { Badge, Button, Card, DataTable, Drawer, EmptyState, FilterSelect, PageHeader, Pagination, SearchInput, usePageSlice } from '@/components/ui';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import type { AuditEvent } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

const PAGE_SIZE = 20;
const ACTOR_TONE = { admin: 'brand', system: 'neutral', integration: 'info' } as const;

export function AuditPage() {
  const { audit, organization } = useOrgData();
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const [q, setQ] = useQueryState('q');
  const [area, setArea] = useQueryState('area', 'all');
  const [result, setResult] = useQueryState('result', 'all');
  const [page, setPage] = usePageParam();

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return audit.filter((e) =>
      (area === 'all' || e.action.startsWith(area)) &&
      (result === 'all' || e.result === result) &&
      (!query || e.summary.toLowerCase().includes(query) || e.actor.toLowerCase().includes(query) || e.id.toLowerCase().includes(query) || (e.subject?.name.toLowerCase().includes(query) ?? false)));
  }, [audit, q, area, result]);
  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);

  return (
    <>
      <PageHeader title="Audit Log" description="Administrative, integration and security-sensitive activity in this organization. Records are append-only." />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search events or actors" className="sm:w-72" />
          <FilterSelect label="Area" value={area} onChange={setArea} options={[
            { value: 'all', label: 'All areas' }, { value: 'user', label: 'Users' }, { value: 'enrollment', label: 'Enrollment' }, { value: 'identifier', label: 'Identifiers' }, { value: 'credential', label: 'Credentials' },
            { value: 'wallet', label: 'Wallet' }, { value: 'activity', label: 'Verification events' }, { value: 'organization', label: 'Organization' }, { value: 'admin', label: 'Administrators' }, { value: 'group', label: 'Groups' }, { value: 'issuance', label: 'Group issuance' },
          ]} />
          <FilterSelect label="Result" value={result} onChange={setResult} options={[
            { value: 'all', label: 'Any result' }, { value: 'success', label: 'Success' }, { value: 'partial', label: 'Partial' }, { value: 'failure', label: 'Failure' },
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
            { key: 'result', header: 'Result', cell: (e) => <ResultBadgeFor result={e.result} /> },
            {
              key: 'details', header: <span className="sr-only">Details</span>, className: 'w-24 text-right',
              cell: (e) => <Button size="sm" variant="ghost" onClick={() => setOpen(e)} aria-label={`Details for ${e.id}`}>Details</Button>,
            },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
      <AuditEventDrawer event={open} organizationName={organization.name} onClose={() => setOpen(null)} />
    </>
  );
}

function AuditEventDrawer({ event: e, organizationName, onClose }: { event: AuditEvent | null; organizationName: string; onClose: () => void }) {
  if (!e) return null;
  const rows: [string, React.ReactNode][] = [
    ['Event ID', <span className="font-mono text-xs">{e.id}</span>],
    ['Time', formatDateTime(e.occurredAt)],
    ['Organization', organizationName],
    ['Actor', e.actor],
    ['Action', <span className="font-mono text-xs">{e.action}</span>],
    ...(e.subject ? [[{ administrator: 'Affected administrator', group: 'Affected group' }[e.resourceType as string] ?? 'Affected record', e.subject.name] as [string, React.ReactNode]] : []),
    ...(e.related?.length ? [[e.related.length === 1 ? 'Affected user' : `Affected users (${e.related.length})`, (
      <ul className="space-y-0.5">{e.related.map((r) => <li key={r.id}>{r.name}</li>)}</ul>
    )] as [string, React.ReactNode]] : []),
    ['Outcome', <ResultBadgeFor result={e.result} />],
  ];
  return (
    <Drawer open onClose={onClose} title="Audit event" description={e.summary}>
      <dl className="divide-y divide-slate-100">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-3 py-2.5 text-sm">
            <dt className="text-slate-500">{k}</dt><dd className="col-span-2 text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
      {e.changes && e.changes.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">Changes</h3>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr><th className="py-1.5 font-semibold">Field</th><th className="py-1.5 font-semibold">Previous</th><th className="py-1.5 font-semibold">New</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {e.changes.map((c) => (
                <tr key={c.field}><td className="py-2 text-slate-500">{c.field}</td><td className="py-2 text-slate-700">{c.from}</td><td className="py-2 font-medium text-slate-900">{c.to}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {e.href && <Link to={e.href} onClick={onClose} className="mt-6 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Go to record</Link>}
    </Drawer>
  );
}

export function ResultBadgeFor({ result }: { result: AuditEvent['result'] }) {
  return <Badge tone={result === 'success' ? 'success' : result === 'partial' ? 'warning' : 'danger'} dot>{result}</Badge>;
}
