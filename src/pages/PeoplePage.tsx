import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Users } from 'lucide-react';
import { Avatar, ButtonLink, Skeleton, Card, DataTable, EmptyState, FilterSelect, PageHeader, Pagination, SearchInput, usePageSlice } from '@/components/ui';
import { FaceEnrollmentBadge, MemberStatusBadge } from '@/components/domain/StatusBadges';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { useServices } from '@/services/ServicesProvider';
import { useOrgData } from '@/store/AppStore';

const PAGE_SIZE = 15;

export function PeoplePage() {
  const { members, identifierConfigById } = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [relationship, setRelationship] = useQueryState('relationship', 'all');
  const [page, setPage] = usePageParam();

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
  const contacts = useContacts(pageRows.map((m) => m.idSwitchId));
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
          <SearchInput value={q} onChange={setQ} placeholder="Search name or identifier" className="sm:w-80" />
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
              ? <EmptyState icon={<Users className="h-5 w-5" />} title="No users yet" description="Add your first user. You can issue their digital ID right after, or later." />
              : <EmptyState title="No matching users" description="Try a different search or clear the filters." />
          }
          columns={[
            {
              key: 'name', header: 'Name', cell: (m) => (
                <span className="flex items-center gap-3">
                  <Avatar name={m.displayName} photoUrl={m.photoDataUrl} size="sm" />
                  <span className="font-medium text-slate-900">{m.displayName}</span>
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
            {
              key: 'email', header: 'Email', cell: (m) => contacts.status === 'ready'
                ? <span className="text-slate-600">{contacts.byId.get(m.idSwitchId)?.email || <span className="text-slate-400">—</span>}</span>
                : contacts.status === 'error' ? <span className="text-xs text-slate-400">Unavailable</span>
                  : <Skeleton className="h-4 w-36" />,
            },
            { key: 'status', header: 'User status', cell: (m) => <MemberStatusBadge status={m.status} /> },
            { key: 'face', header: 'Face enrollment', cell: (m) => <FaceEnrollmentBadge status={m.faceEnrollment.status} /> },
            {
              key: 'actions', header: <span className="sr-only">Actions</span>, cell: (m) => (
                <Link to={`/users/${m.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-sm font-medium text-brand-600 hover:text-brand-700">
                  View details<span className="sr-only"> for {m.displayName}</span>
                </Link>
              ),
            },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
    </>
  );
}

type Contacts = { status: 'loading' } | { status: 'ready'; byId: Map<string, { email?: string }> } | { status: 'error' };

/** Email addresses belong to ID Switch; they're read for the visible rows only and never stored in FixID. */
function useContacts(idSwitchIds: string[]): Contacts {
  const { idSwitch } = useServices();
  const key = idSwitchIds.join(',');
  const [state, setState] = useState<Contacts>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    idSwitch.getContacts(key ? key.split(',') : [])
      .then((byId) => { if (!cancelled) setState({ status: 'ready', byId }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [idSwitch, key]);
  return state;
}
