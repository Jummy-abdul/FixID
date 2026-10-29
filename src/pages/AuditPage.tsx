import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { Badge, Button, Card, DataTable, Drawer, EmptyState, FilterSelect, Input, PageHeader, Pagination, SearchInput, usePageSlice } from '@/components/ui';
import { AUDIT_MODULES, activityLabel, isAttemptEvent, moduleOf } from '@/domain/auditCatalog';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import type { AuditEvent } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { useOrgData, useStore } from '@/store/AppStore';

const PAGE_SIZE = 20;
const ACTOR_TONE = { admin: 'brand', system: 'neutral', integration: 'info' } as const;

export function AuditPage() {
  const { audit, organization } = useOrgData();
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const [q, setQ] = useQueryState('q');
  const [actor, setActor] = useQueryState('actor', 'all');
  const [module] = useQueryState('module', 'all');
  const [type, setType] = useQueryState('type', 'all');
  const [from, setFrom] = useQueryState('from');
  const [to, setTo] = useQueryState('to');
  const [page, setPage] = usePageParam();
  const [, setParams] = useSearchParams();
  // Verification attempts are records in Verification History, not platform actions.
  const events = useMemo(() => audit.filter((e) => !isAttemptEvent(e)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [audit]);
  const actors = useMemo(() => [...new Set(events.map((e) => e.actor))].sort(), [events]);
  const modules = AUDIT_MODULES.filter((m) => events.some((e) => moduleOf(e.action) === m));
  const types = useMemo(() => [...new Set(events.filter((e) => module === 'all' || moduleOf(e.action) === module).map((e) => e.action))]
    .map((a) => ({ value: a, label: activityLabel(a) })).sort((a, b) => a.label.localeCompare(b.label)), [events, module]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return events.filter((e) =>
      (actor === 'all' || e.actor === actor) && (module === 'all' || moduleOf(e.action) === module) && (type === 'all' || e.action === type)
      && (!from || e.occurredAt.slice(0, 10) >= from) && (!to || e.occurredAt.slice(0, 10) <= to)
      && (!query || [activityLabel(e.action), e.summary, e.actor, e.id, e.resourceId, e.subject?.name ?? ''].join(' ').toLowerCase().includes(query)));
  }, [events, q, actor, module, type, from, to]);
  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const clear = () => setParams((prev) => { const n = new URLSearchParams(prev); ['q', 'actor', 'module', 'type', 'from', 'to', 'page'].forEach((k) => n.delete(k)); return n; }, { replace: true });

  return (
    <>
      <PageHeader title="Audit Logs" description={`Administrative activity in ${organization.name}: what happened, who did it, when, and what changed.`} />
      <p className="mb-4 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
        Read-only: no one can edit or delete these entries through FixID. Verification attempts are in Verification History, not here. This log is kept in this browser’s storage, so it’s illustrative, not tamper-resistant audit evidence.
      </p>
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Search activity, person or record" className="sm:w-72" label="Search audit logs" />
          <FilterSelect label="Performed by" value={actor} onChange={setActor} options={[{ value: 'all', label: 'Anyone' }, ...actors.map((a) => ({ value: a, label: a }))]} />
          <FilterSelect label="Module" value={module} onChange={(v) => setParams((prev) => { const n = new URLSearchParams(prev); if (v === 'all') n.delete('module'); else n.set('module', v); n.delete('type'); n.delete('page'); return n; }, { replace: true })} options={[{ value: 'all', label: 'All modules' }, ...modules.map((m) => ({ value: m, label: m }))]} />
          <FilterSelect label="Activity type" value={type} onChange={setType} options={[{ value: 'all', label: 'All activity types' }, ...types]} />
          <label className="text-sm text-slate-600">From<Input type="date" value={from} onChange={(x) => setFrom(x.target.value)} className="mt-1" aria-label="From date" /></label>
          <label className="text-sm text-slate-600">To<Input type="date" value={to} onChange={(x) => setTo(x.target.value)} className="mt-1" aria-label="To date" /></label>
        </div>
        <DataTable<AuditEvent>
          rows={pageRows}
          rowKey={(e) => e.id}
          empty={events.length === 0
            ? <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No activity recorded yet" description="Administrative actions appear here as they happen." />
            : <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No activity matches" description="Try a different search or filter." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />}
          columns={[
            { key: 'activity', header: 'Activity', className: '!whitespace-normal min-w-[16rem]', cell: (e) => (
              <span><span className="font-medium text-slate-900">{activityLabel(e.action)}</span>{e.result !== 'success' && <span className="ml-1.5"><ResultBadgeFor result={e.result} /></span>}<span className="block text-xs text-slate-500">{e.summary}</span></span>
            ) },
            { key: 'actor', header: 'Performed by', cell: (e) => <span className="flex items-center gap-2">{e.actor}{e.actorType !== 'admin' && <Badge tone={ACTOR_TONE[e.actorType]}>{e.actorType}</Badge>}</span> },
            { key: 'module', header: 'Module', cell: (e) => <span className="text-slate-600">{moduleOf(e.action)}</span> },
            { key: 'time', header: 'Date and time', cell: (e) => <span className="tabular-nums text-slate-600">{formatDateTime(e.occurredAt)}</span> },
            { key: 'details', header: 'Details', className: 'w-24 text-right', cell: (e) => <Button size="sm" variant="ghost" onClick={() => setOpen(e)} aria-label={`Details for ${e.id}`}>View</Button> },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
      <AuditEventDrawer event={open} organizationName={organization.name} onClose={() => setOpen(null)} />
    </>
  );
}

function AuditEventDrawer({ event: e, organizationName, onClose }: { event: AuditEvent | null; organizationName: string; onClose: () => void }) {
  const { state } = useStore();
  if (!e) return null;
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const rows: [string, React.ReactNode][] = [
    ['Activity', activityLabel(e.action)],
    ['Module', moduleOf(e.action)],
    ['Event reference', <span className="font-mono text-xs">{e.id}</span>],
    ['Date and time', formatDateTime(e.occurredAt)],
    ['Organization', organizationName],
    ['Performed by', e.actor],
    ...(e.actorId ? [['Actor ID', <span className="font-mono text-xs">{e.actorId}</span>] as [string, React.ReactNode]] : []),
    ...(e.actorOrganizationId ? [['Actor organization', orgName(e.actorOrganizationId)] as [string, React.ReactNode]] : []),
    ['Record reference', <span className="text-xs"><span className="text-slate-500">{e.resourceType}</span> <span className="font-mono">{e.resourceId}</span></span>],
    ...(e.targetOrganizationId ? [['Target organization', orgName(e.targetOrganizationId)] as [string, React.ReactNode]] : []),
    ...(e.correlationId ? [['Correlation ID', <span className="font-mono text-xs">{e.correlationId}</span>] as [string, React.ReactNode]] : []),
    ['Action type', <span className="font-mono text-xs">{e.action}</span>],
    ...(e.subject ? [[{ administrator: 'Affected administrator', group: 'Affected group', 'verification-activity': 'Verification activity' }[e.resourceType as string] ?? 'Affected record', e.subject.name] as [string, React.ReactNode]] : []),
    ...(e.related?.length ? [[e.related.length === 1 ? 'Affected user' : `Affected users (${e.related.length})`, (
      <ul className="space-y-0.5">{e.related.map((r) => <li key={r.id}>{r.name}</li>)}</ul>
    )] as [string, React.ReactNode]] : []),
    ['Outcome', <ResultBadgeFor result={e.result} />],
  ];
  return (
    <Drawer open onClose={onClose} title={activityLabel(e.action)} description={e.summary}>
      <dl className="divide-y divide-slate-100">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-3 py-2.5 text-sm">
            <dt className="text-slate-500">{k}</dt><dd className="col-span-2 text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
      {e.changes && e.changes.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">What changed</h3>
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
  return <Badge tone={result === 'success' ? 'success' : result === 'partial' || result === 'denied' ? 'warning' : 'danger'} dot>{result}</Badge>;
}
