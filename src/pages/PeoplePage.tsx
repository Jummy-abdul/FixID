import { useAuthorization } from '@/auth/authorization';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, ScanFace, Send, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import {
  Button, ButtonLink, Card, DataTable, EmptyState, FilterSelect, OverflowMenu, PageHeader, Pagination, SearchInput, Skeleton, StatCard, usePageSlice,
} from '@/components/ui';
import { MemberStatusBadge, PortraitEnrollmentBadge } from '@/components/domain/StatusBadges';
import { bulkEligibility, useUserActions } from '@/components/users/useUserActions';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { useContacts } from '@/hooks/useContacts';
import { useOrgData } from '@/store/AppStore';

const PAGE_SIZE = 15;

export function PeoplePage() {
  const { members, identifierConfigById } = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [relationship, setRelationship] = useQueryState('relationship', 'all');
  const [page, setPage] = usePageParam();
  const { menuItems, dialogs, openBulk } = useUserActions();
  const { can } = useAuthorization();
  const canManage = can('users.edit');

  const kpis = useMemo(() => ({
    total: members.length,
    active: members.filter((m) => m.status === 'active').length,
    inactive: members.filter((m) => m.status === 'inactive').length,
    enrolled: members.filter((m) => m.faceEnrollment.status === 'enrolled').length,
  }), [members]);

  const relationships = useMemo(() => [...new Set(members.map((m) => m.relationship).filter(Boolean))].sort(), [members]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return members
      .filter((m) => status === 'all' || m.status === status)
      .filter((m) => relationship === 'all' || m.relationship === relationship)
      .filter((m) => !query || m.displayName.toLowerCase().includes(query) || m.identifier?.value.toLowerCase().includes(query) || m.unit.toLowerCase().includes(query))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members, q, status, relationship]);

  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const contacts = useContacts(pageRows.map((m) => m.idSwitchId));
  const hasFilters = q || status !== 'all' || relationship !== 'all';
  const serial = new Map(pageRows.map((m, i) => [m.id, (current - 1) * PAGE_SIZE + i + 1]));

  // Selection covers the visible page; it resets when the filters or page change, and drops rows that leave the page.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const viewKey = `${q}|${status}|${relationship}|${current}`;
  useEffect(() => { setSelected(new Set()); }, [viewKey]);
  const visibleIds = pageRows.map((m) => m.id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const visibleKey = visibleIds.join(',');
  useEffect(() => {
    const visible = new Set(visibleKey.split(','));
    setSelected((s) => ([...s].some((id) => !visible.has(id)) ? new Set([...s].filter((id) => visible.has(id))) : s));
  }, [visibleKey]);
  const clearSelection = () => setSelected(new Set());
  const selectedMembers = pageRows.filter((m) => selected.has(m.id));
  const bulkCounts = {
    invite: bulkEligibility('invite', selectedMembers).eligible.length,
    activate: bulkEligibility('activate', selectedMembers).eligible.length,
    deactivate: bulkEligibility('deactivate', selectedMembers).eligible.length,
  };
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <PageHeader
        title="Users"
        actions={can('users.create') || can('users.import') ? (
          <>
            {can('users.import') && <ButtonLink to="/users/import" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />}>Import Users</ButtonLink>}
            {can('users.create') && <ButtonLink to="/users/new" variant="primary" icon={<UserPlus className="h-4 w-4" />}>Add user</ButtonLink>}
          </>
        ) : undefined}
      />
      <section aria-label="User summary" className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Users" value={kpis.total} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Active Users" value={kpis.active} icon={<UserCheck className="h-4 w-4" />} tone="emerald" />
        <StatCard label="Inactive Users" value={kpis.inactive} icon={<UserX className="h-4 w-4" />} tone="amber" />
        <StatCard label="Portrait Enrolled" value={kpis.enrolled} icon={<ScanFace className="h-4 w-4" />} tone="violet" />
      </section>
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
        {canManage && selectedVisible.length > 0 && (
          <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50/60 px-4 py-2.5">
            <span className="mr-2 text-sm font-medium text-slate-700" aria-live="polite">{selectedVisible.length} selected</span>
            {bulkCounts.invite > 0 && (
              <Button size="sm" variant="secondary" icon={<Send className="h-4 w-4" />} onClick={() => openBulk('invite', selectedVisible, clearSelection)}>
                Send Enrollment Link{bulkCounts.invite < selectedVisible.length ? ` (${bulkCounts.invite})` : ''}
              </Button>
            )}
            {bulkCounts.activate > 0 && (
              <Button size="sm" variant="secondary" icon={<UserCheck className="h-4 w-4" />} onClick={() => openBulk('activate', selectedVisible, clearSelection)}>
                Activate Users{bulkCounts.activate < selectedVisible.length ? ` (${bulkCounts.activate})` : ''}
              </Button>
            )}
            {bulkCounts.deactivate > 0 && (
              <Button size="sm" variant="secondary" icon={<UserX className="h-4 w-4" />} onClick={() => openBulk('deactivate', selectedVisible, clearSelection)}>
                Deactivate Users{bulkCounts.deactivate < selectedVisible.length ? ` (${bulkCounts.deactivate})` : ''}
              </Button>
            )}
            {bulkCounts.invite + bulkCounts.activate + bulkCounts.deactivate === 0 && (
              <span className="text-sm text-slate-500">No actions apply to the selected users.</span>
            )}
            <button type="button" className="ml-auto text-sm font-medium text-brand-600 hover:text-brand-700" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}
        <DataTable
          rows={pageRows}
          rowKey={(m) => m.id}
          empty={
            members.length === 0
              ? <EmptyState icon={<Users className="h-5 w-5" />} title="No users yet" description="Add your first user. You can issue their digital ID right after, or later." />
              : <EmptyState title="No matching users" description="Try a different search or clear the filters." />
          }
          columns={[
            {
              key: 'select', className: 'w-10',
              header: <SelectAll checked={allSelected} indeterminate={selectedVisible.length > 0 && !allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))} />,
              cell: (m) => (
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.displayName}`}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              ),
            },
            { key: 'sn', header: 'SN', className: 'w-12', cell: (m) => <span className="tabular-nums text-slate-500">{serial.get(m.id)}</span> },
            {
              key: 'name', header: 'Name', cell: (m) => (
                <Link to={`/users/${m.id}`} className="font-medium text-slate-900 hover:text-brand-700">{m.displayName}</Link>
              ),
            },
            {
              key: 'identifier', header: 'Identifier', cell: (m) => m.identifier ? (
                <span>
                  <span className="block text-[11px] text-slate-500">{identifierConfigById.get(m.identifier.configId)?.name}</span>
                  <span className="block font-mono text-xs text-slate-800">{m.identifier.value}</span>
                </span>
              ) : <span className="text-slate-400">—</span>,
            },
            {
              key: 'email', header: 'Email', cell: (m) => contacts.status === 'ready'
                ? <span className="text-slate-600">{contacts.byId.get(m.idSwitchId)?.email || <span className="text-slate-400">—</span>}</span>
                : contacts.status === 'error' ? <span className="text-xs text-slate-400">Unavailable</span>
                  : <Skeleton className="h-4 w-36" />,
            },
            { key: 'status', header: 'User Status', cell: (m) => <MemberStatusBadge status={m.status} /> },
            { key: 'portrait', header: 'Portrait Enrollment', cell: (m) => <PortraitEnrollmentBadge status={m.faceEnrollment.status} /> },
            {
              key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right',
              cell: (m) => <OverflowMenu label={`Actions for ${m.displayName}`} items={menuItems(m)} />,
            },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
      {dialogs}
    </>
  );
}

function SelectAll({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label="Select all users on this page"
      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
  );
}
