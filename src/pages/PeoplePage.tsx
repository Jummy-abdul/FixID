import { useMemo } from 'react';
import { Link2, UserPlus, Users } from 'lucide-react';
import { Avatar, Badge, Card, DataTable, EmptyState, FilterSelect, PageHeader, Pagination, SearchInput, usePageSlice } from '@/components/ui';
import { MemberStatusBadge } from '@/components/domain/StatusBadges';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

const PAGE_SIZE = 15;

export function PeoplePage() {
  const { members, credentials } = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [relationship, setRelationship] = useQueryState('relationship', 'all');
  const [page, setPage] = usePageParam();

  const credCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of credentials) if (c.status === 'active') map.set(c.memberId, (map.get(c.memberId) ?? 0) + 1);
    return map;
  }, [credentials]);

  const relationships = useMemo(() => [...new Set(members.map((m) => m.relationship))].sort(), [members]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return members
      .filter((m) => status === 'all' || m.status === status)
      .filter((m) => relationship === 'all' || m.relationship === relationship)
      .filter((m) => !query || m.displayName.toLowerCase().includes(query) || m.idSwitchId.toLowerCase().includes(query) || m.externalRef?.value.toLowerCase().includes(query) || m.unit.toLowerCase().includes(query))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members, q, status, relationship]);

  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const hasFilters = q || status !== 'all' || relationship !== 'all';

  return (
    <>
      <PageHeader
        title="People"
        description="People linked to your organization. Canonical identity details come from ID Switch; FixID keeps only your organization's context."
        actions={<PlannedButton variant="primary" icon={<UserPlus className="h-4 w-4" />} info={PLANNED.onboardAndIssue}>Add person & issue</PlannedButton>}
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, ID Switch ID, reference or unit" className="sm:w-80" />
          <FilterSelect label="Relationship" value={relationship} onChange={setRelationship}
            options={[{ value: 'all', label: 'All relationships' }, ...relationships.map((r) => ({ value: r, label: r }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus}
            options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'pending', label: 'Pending' }, { value: 'inactive', label: 'Inactive' }]} />
          {hasFilters && (
            <button type="button" className="text-sm font-medium text-brand-600 hover:text-brand-700 sm:ml-auto"
              onClick={() => { setQ(''); setStatus('all'); setRelationship('all'); }}>
              Clear filters
            </button>
          )}
        </div>
        <DataTable
          rows={pageRows}
          rowKey={(m) => m.id}
          rowHref={(m) => `/people/${m.id}`}
          empty={
            members.length === 0
              ? <EmptyState icon={<Users className="h-5 w-5" />} title="No people yet" description="Add your first person to link an ID Switch identity and issue a credential." />
              : <EmptyState title="No matching people" description="Try a different search or clear the filters." />
          }
          columns={[
            {
              key: 'name', header: 'Name', cell: (m) => (
                <span className="flex items-center gap-3">
                  <Avatar name={m.displayName} size="sm" />
                  <span>
                    <span className="block font-medium text-slate-900">{m.displayName}</span>
                    <span className="block font-mono text-[11px] text-slate-500">{m.idSwitchId}</span>
                  </span>
                </span>
              ),
            },
            { key: 'rel', header: 'Relationship', cell: (m) => m.relationship },
            { key: 'unit', header: 'Unit', cell: (m) => <span className="text-slate-600">{m.unit}</span> },
            { key: 'ref', header: 'Reference', cell: (m) => m.externalRef ? <span className="font-mono text-xs text-slate-600">{m.externalRef.value}</span> : <span className="text-slate-400">—</span> },
            { key: 'creds', header: 'Active credentials', cell: (m) => <span className="tabular-nums">{credCount.get(m.id) ?? 0}</span> },
            {
              key: 'source', header: 'Identity', cell: (m) => m.resolution === 'linked-existing'
                ? <Badge tone="info"><Link2 className="h-3 w-3" />Reused</Badge>
                : <Badge>New in ID Switch</Badge>,
            },
            { key: 'status', header: 'Status', cell: (m) => <MemberStatusBadge status={m.status} /> },
            { key: 'joined', header: 'Linked', cell: (m) => <span className="text-slate-500">{formatDate(m.joinedAt)}</span> },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
    </>
  );
}
