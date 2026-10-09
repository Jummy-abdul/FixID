import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { Card, DataTable, EmptyState, Field, FilterSelect, Input, Pagination, SearchInput, usePageSlice } from '@/components/ui';
import { ResultBadgeFor } from '@/pages/AuditPage';
import type { AuditEvent, Group } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

const PAGE_SIZE = 15;

const TYPES: { value: string; label: string; actions: AuditEvent['action'][] }[] = [
  { value: 'details', label: 'Group details', actions: ['group.created', 'group.updated'] },
  { value: 'membership', label: 'Membership', actions: ['group.members-added', 'group.members-removed'] },
  { value: 'issuance', label: 'Credential issuance', actions: ['issuance.batch-started', 'issuance.batch-completed'] },
];

const ACTION_LABEL: Partial<Record<AuditEvent['action'], string>> = {
  'group.created': 'Group created',
  'group.updated': 'Group updated',
  'group.members-added': 'Members added',
  'group.members-removed': 'Members removed',
  'issuance.batch-started': 'Issuance started',
  'issuance.batch-completed': 'Issuance finished',
};

/** This group's history, read from the organization's Audit Log (no separate store). */
export function GroupActivityTab({ group }: { group: Group }) {
  const { audit } = useOrgData();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const events = useMemo(() => audit.filter((e) => e.resourceType === 'group' && e.resourceId === group.id), [audit, group.id]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const actions = TYPES.find((t) => t.value === type)?.actions;
    return events
      .filter((e) => !actions || actions.includes(e.action))
      .filter((e) => !from || e.occurredAt.slice(0, 10) >= from)
      .filter((e) => !to || e.occurredAt.slice(0, 10) <= to)
      .filter((e) => !query || e.summary.toLowerCase().includes(query) || e.actor.toLowerCase().includes(query)
        || (e.related?.some((r) => r.name.toLowerCase().includes(query)) ?? false))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [events, q, type, from, to]);
  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const filtering = !!(q || type !== 'all' || from || to);

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-end">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search activity" label="Search activity" className="lg:w-72" />
        <FilterSelect label="Activity type" value={type} onChange={(v) => { setType(v); setPage(1); }}
          options={[{ value: 'all', label: 'All activity' }, ...TYPES.map((t) => ({ value: t.value, label: t.label }))]} />
        <div className="grid grid-cols-2 gap-3 lg:w-80">
          <Field label="From">{(p) => <Input {...p} type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} />}</Field>
        </div>
        {filtering && (
          <button type="button" className="text-sm font-medium text-brand-600 hover:text-brand-700 lg:ml-auto lg:pb-2.5"
            onClick={() => { setQ(''); setType('all'); setFrom(''); setTo(''); setPage(1); }}>Clear filters</button>
        )}
      </div>
      <DataTable
        rows={pageRows}
        rowKey={(e) => e.id}
        empty={events.length === 0
          ? <EmptyState icon={<History className="h-5 w-5" />} title="No activity yet" description="Changes to this group and issuance from it will appear here." />
          : <EmptyState title="No matching activity" description="Try a different search, type or date range." />}
        columns={[
          { key: 'time', header: 'Date and Time', cell: (e) => <span className="whitespace-nowrap tabular-nums text-slate-600">{formatDateTime(e.occurredAt)}</span> },
          { key: 'action', header: 'Action', cell: (e) => <span className="whitespace-nowrap font-medium text-slate-900">{ACTION_LABEL[e.action] ?? e.action}</span> },
          {
            key: 'description', header: 'Description', className: 'max-w-md', cell: (e) => (
              <span className="block text-slate-700">
                {e.summary}
                {e.related && e.related.length > 1 && <span className="block text-xs text-slate-500">{e.related.length} users affected</span>}
                {e.action === 'issuance.batch-completed' && e.href && <Link to={e.href} className="block text-xs font-medium text-brand-600 hover:text-brand-700">View issuance details</Link>}
              </span>
            ),
          },
          { key: 'actor', header: 'Actor', cell: (e) => <span className="whitespace-nowrap text-slate-700">{e.actor}</span> },
          { key: 'outcome', header: 'Outcome', cell: (e) => <ResultBadgeFor result={e.result} /> },
        ]}
      />
      <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
    </Card>
  );
}
