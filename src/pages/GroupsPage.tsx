import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Layers, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, OverflowMenu, PageHeader, Pagination, SearchInput, Skeleton, usePageSlice, type OverflowMenuItem } from '@/components/ui';
import { GroupFormModal, RemoveGroupDialog } from '@/components/groups/GroupDialogs';
import { useAuthorization } from '@/auth/authorization';
import { memberCounts } from '@/domain/groups';
import type { Group } from '@/domain/types';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { useOrgData, useSession, useStore } from '@/store/AppStore';

const PAGE_SIZE = 15;

export const groupPath = (id: string, opts?: { addMembers?: boolean }) => `/groups/${id}${opts?.addMembers ? '?add=1' : ''}`;

export function GroupsPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { groups } = useOrgData();
  const canManage = useAuthorization().can('groups.manage');
  const navigate = useNavigate();
  const [q, setQ] = useQueryState('q');
  const [page, setPage] = usePageParam();
  const [form, setForm] = useState<{ open: boolean; group?: Group }>({ open: false });
  const [removing, setRemoving] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 200); return () => clearTimeout(t); }, []);

  const counts = useMemo(() => memberCounts(state.data, organization.id), [state.data, organization.id]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return groups
      .filter((g) => !query || g.name.toLowerCase().includes(query) || g.description.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groups, q]);
  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);

  const menu = (g: Group): OverflowMenuItem[] => [
    { key: 'view', label: 'View Group', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(groupPath(g.id)) },
    ...(canManage ? [
      { key: 'edit', label: 'Edit Group', icon: <Pencil className="h-4 w-4" />, onSelect: () => setForm({ open: true, group: g }) },
      { key: 'members', label: 'Manage Members', icon: <UserPlus className="h-4 w-4" />, onSelect: () => navigate(groupPath(g.id, { addMembers: true })) },
      { key: 'remove', label: 'Remove Group', tone: 'danger' as const, icon: <Trash2 className="h-4 w-4" />, onSelect: () => setRemoving(g) },
    ] : []),
  ];

  const createButton = canManage
    ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ open: true })}>Create Group</Button>
    : undefined;

  return (
    <>
      <PageHeader title="Groups" description="Organize and manage users within your organization." actions={createButton} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search groups" label="Search groups by name or description" className="sm:w-80" />
          <span className="text-sm text-slate-500 sm:ml-auto">{groups.length} {groups.length === 1 ? 'group' : 'groups'}</span>
        </div>
        {loading ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading groups">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <DataTable
            rows={pageRows}
            rowKey={(g) => g.id}
            empty={groups.length === 0 ? (
              <EmptyState icon={<Layers className="h-5 w-5" />} title="No groups yet"
                description="Create a group to organize users, for example by department, team, location or cohort."
                action={createButton} />
            ) : <EmptyState title="No matching groups" description="Try a different search." />}
            columns={[
              { key: 'name', header: 'Group Name', cell: (g) => <Link to={groupPath(g.id)} className="font-medium text-slate-900 hover:text-brand-700">{g.name}</Link> },
              { key: 'description', header: 'Description', className: 'max-w-xs', cell: (g) => <span className="line-clamp-2 text-slate-600">{g.description || <span className="text-slate-400">—</span>}</span> },
              { key: 'members', header: 'Members', cell: (g) => <span className="tabular-nums text-slate-700">{(counts.get(g.id) ?? 0).toLocaleString()}</span> },
              { key: 'created', header: 'Date Created', cell: (g) => <span className="whitespace-nowrap text-slate-500">{formatDate(g.createdAt)}</span> },
              { key: 'updated', header: 'Last Updated', cell: (g) => <span className="whitespace-nowrap text-slate-500">{formatDate(g.updatedAt)}</span> },
              { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right', cell: (g) => <OverflowMenu label={`Actions for ${g.name}`} items={menu(g)} /> },
            ]}
          />
        )}
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
      <GroupFormModal open={form.open} group={form.group} onClose={() => setForm((f) => ({ ...f, open: false }))}
        onSaved={(id) => { if (!form.group) navigate(groupPath(id)); }} />
      <RemoveGroupDialog group={removing} onClose={() => setRemoving(null)} />
    </>
  );
}
