import { useMemo } from 'react';
import { Link2, UserPlus, Users } from 'lucide-react';
import { Avatar, Badge, ButtonLink, Card, DataTable, EmptyState, FilterSelect, PageHeader, Pagination, SearchInput, usePageSlice } from '@/components/ui';
import { MemberStatusBadge } from '@/components/domain/StatusBadges';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

const PAGE_SIZE = 15;

export function PeoplePage() {
  const { members, credentials, identifierConfigById } = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [relationship, setRelationship] = useQueryState('relationship', 'all');
  const [page, setPage] = usePageParam();

  const credCount = useMemo(() => {
    const map = new Map<string, { active: number; total: number }>();
    for (const c of credentials) {
      const e = map.get(c.memberId) ?? { active: 0, total: 0 };
      e.total += 1;
      if (c.status === 'active') e.active += 1;
      map.set(c.memberId, e);
    }
    return map;
  }, [credentials]);

  const relationships = useMemo(() => [...new Set(members.map((m) => m.relationship).filter(Boolean))].sort(), [members]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return members
      .filter((m) => status === 'all' || m.status === status)
      .filter((m) => relationship === 'all' || m.relationship === relationship)
      .filter((m) => !query || m.displayName.toLowerCase().includes(query) || m.idSwitchId.toLowerCase().includes(query) || m.identifier?.value.toLowerCase().includes(query) || m.unit.toLowerCase().includes(query))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members, q, status, relationship]);

  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const hasFilters = q || status !== 'all' || relationship !== 'all';

  return (
    <>
      <PageHeader
        title="Users"
        description="People linked to your organization. Canonical identity details come from ID Switch; FixID keeps only your organization's context."
        actions={<ButtonLink to="/users/new" variant="primary" icon={<UserPlus className="h-4 w-4" />}>Add user</ButtonLink>}
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, identifier or ID Switch ID" className="sm:w-80" />
          {relationships.length > 0 && (
            <FilterSelect label="Role" value={relationship} onChange={setRelationship}
              options={[{ value: 'all', label: 'All roles' }, ...relationships.map((r) => ({ value: r, label: r }))]} />
          )}
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
          rowHref={(m) => `/users/${m.id}`}
          empty={
            members.length === 0
              ? <EmptyState icon={<Users className="h-5 w-5" />} title="No people yet" description="Add your first person to link an ID Switch identity and issue a credential." />
              : <EmptyState title="No matching people" description="Try a different search or clear the filters." />
          }
          columns={[
            {
              key: 'name', header: 'Name', cell: (m) => (
                <span className="flex items-center gap-3">
                  <Avatar name={m.displayName} photoUrl={m.photoDataUrl} size="sm" />
                  <span>
                    <span className="block font-medium text-slate-900">{m.displayName}</span>
                    <span className="block font-mono text-[11px] text-slate-500">{m.idSwitchId}</span>
                  </span>
                </span>
              ),
            },
            {
              key: 'identifier', header: 'Identifier', cell: (m) => m.identifier ? (
                <span>
                  <span className="block font-mono text-xs text-slate-800">{m.identifier.value}</span>
                  <span className="block text-[11px] text-slate-500">{identifierConfigById.get(m.identifier.configId)?.name}</span>
                </span>
              ) : <span className="text-slate-400">—</span>,
            },
            ...(relationships.length > 0 ? [{ key: 'rel', header: 'Role', cell: (m: (typeof members)[number]) => <span className="text-slate-600">{m.relationship || '—'}</span> }] : []),
            {
              key: 'creds', header: 'Credentials', cell: (m) => {
                const c = credCount.get(m.id);
                return c ? <span className="tabular-nums">{c.active} active{c.total > c.active ? <span className="text-slate-400"> · {c.total} total</span> : ''}</span>
                  : <span className="text-slate-400">None yet</span>;
              },
            },
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
