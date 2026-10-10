import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, Eye, Pencil, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import {
  Button, Card, ConfirmDialog, Tabs, DataTable, EmptyState, FilterSelect, OverflowMenu, Pagination, SearchInput, Skeleton, usePageSlice, useToast,
  type OverflowMenuItem,
} from '@/components/ui';
import { MemberStatusBadge } from '@/components/domain/StatusBadges';
import { AddMembersDrawer, SelectAllBox } from '@/components/groups/AddMembersDrawer';
import { GroupFormModal, RemoveGroupDialog } from '@/components/groups/GroupDialogs';
import { useAuthorization } from '@/auth/authorization';
import { membershipsOfGroup } from '@/domain/groups';
import type { Group, Member } from '@/domain/types';
import { useContacts } from '@/hooks/useContacts';
import { useQueryState } from '@/hooks/useQueryState';
import { GroupActivityTab } from '@/components/groups/GroupActivityTab';
import { GroupCredentialsTab } from '@/components/groups/GroupCredentialsTab';
import { formatDate } from '@/lib/dates';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { NotFoundPage } from './NotFoundPage';

const PAGE_SIZE = 15;

export function GroupDetailPage() {
  const { groupId } = useParams();
  const { groupById } = useOrgData();
  const group = groupId ? groupById.get(groupId) : undefined;
  if (!group) return <NotFoundPage entity="group" backTo="/groups" />;
  return <GroupDetails key={group.id} group={group} />;
}

type Row = { member: Member; addedAt: string; addedBy: string };
type TabId = 'members' | 'credentials' | 'activity';

/** Group header (always visible) and the Members, Credentials and Activity tabs. Tabs follow permissions. */
function GroupDetails({ group }: { group: Group }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const navigate = useNavigate();
  const [tab, setTab] = useQueryState('tab', 'members');
  const [editing, setEditing] = useState(false);
  const [removingGroup, setRemovingGroup] = useState(false);
  const count = membershipsOfGroup(state.data, organization.id, group.id).length;
  const batches = state.data.issuanceBatches.filter((b) => b.organizationId === organization.id && b.groupId === group.id);
  const tabs = [
    { value: 'members' as const, label: 'Members', count },
    ...(can('credentials.view') ? [{ value: 'credentials' as const, label: 'Credentials', count: batches.length }] : []),
    ...(can('audit.view') ? [{ value: 'activity' as const, label: 'Activity' }] : []),
  ];
  const requested = (['members', 'credentials', 'activity'] as const).includes(tab as TabId) ? (tab as TabId) : 'members';
  const allowed = tabs.some((t) => t.value === requested);
  const current: TabId = allowed ? requested : 'members';
  const canManage = can('groups.manage');

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/groups" className="hover:text-slate-800">Groups</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="truncate text-slate-700">{group.name}</span>
      </nav>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{group.name}</h1>
          <p className="mt-1 max-w-2xl text-slate-500">{group.description || 'No description.'}</p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
            <div className="flex items-center gap-1.5"><Users className="h-4 w-4 text-slate-400" aria-hidden="true" /><dt className="sr-only">Total members</dt>
              <dd className="font-medium text-slate-900">{count} {count === 1 ? 'member' : 'members'}</dd></div>
            <div className="flex gap-1.5"><dt className="text-slate-500">Created</dt><dd className="text-slate-700">{formatDate(group.createdAt)} by {group.createdBy}</dd></div>
            <div className="flex gap-1.5"><dt className="text-slate-500">Last updated</dt><dd className="text-slate-700">{formatDate(group.updatedAt)}</dd></div>
          </dl>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit Group</Button>
            <Button variant="secondary" icon={<Trash2 className="h-4 w-4" />} onClick={() => setRemovingGroup(true)}>Remove Group</Button>
          </div>
        )}
      </header>

      <Tabs<TabId> value={current} onChange={(v) => setTab(v)} tabs={tabs} />
      <div className="mt-6" role="tabpanel" aria-label={tabs.find((t) => t.value === current)?.label}>
        {!allowed && tab !== 'members' && tab !== '' && (
          <p role="status" className="mb-4 rounded-lg bg-slate-50 px-4 py-2.5 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">You don't have access to that tab, so Members is shown.</p>
        )}
        {current === 'members' && <MembersTab group={group} />}
        {current === 'credentials' && <GroupCredentialsTab group={group} batches={batches} />}
        {current === 'activity' && <GroupActivityTab group={group} />}
      </div>

      <GroupFormModal open={editing} group={group} onClose={() => setEditing(false)} />
      {removingGroup && <RemoveGroupDialog group={group} onClose={() => setRemovingGroup(false)} onRemoved={() => navigate('/groups', { replace: true })} />}
    </>
  );
}

function MembersTab({ group }: { group: Group }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { memberById, identifierConfigById } = useOrgData();
  const { can } = useAuthorization();
  const canManage = can('groups.members');
  const canViewUsers = can('users.view');
  const { removeGroupMembers } = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Member[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // "Manage Members" from the Groups list opens the picker straight away.
  useEffect(() => {
    if (params.get('add') !== '1') return;
    if (canManage) setAdding(true);
    setParams((p) => { p.delete('add'); return p; }, { replace: true });
  }, [params, setParams, canManage]);

  const rows: Row[] = useMemo(() => membershipsOfGroup(state.data, organization.id, group.id)
    .flatMap((m) => { const member = memberById.get(m.memberId); return member ? [{ member, addedAt: m.addedAt, addedBy: m.addedBy }] : []; })
    .sort((a, b) => a.member.displayName.localeCompare(b.member.displayName)), [state.data, organization.id, group.id, memberById]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows
      .filter((r) => status === 'all' || r.member.status === status)
      .filter((r) => !query || r.member.displayName.toLowerCase().includes(query) || (r.member.identifier?.value.toLowerCase().includes(query) ?? false));
  }, [rows, q, status]);
  useEffect(() => { setPage(1); }, [q, status]);
  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const contacts = useContacts(pageRows.map((r) => r.member.idSwitchId));

  // Selection follows the visible page.
  const visibleKey = pageRows.map((r) => r.member.id).join(',');
  useEffect(() => {
    const visible = new Set(visibleKey.split(','));
    setSelected((s) => ([...s].some((id) => !visible.has(id)) ? new Set([...s].filter((id) => visible.has(id))) : s));
  }, [visibleKey]);
  const allSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.member.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const remove = (members: Member[]) => {
    const r = removeGroupMembers(organization.id, group.id, members.map((m) => m.id));
    setConfirmRemove(null);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    setSelected(new Set());
    toast({
      tone: 'success', title: members.length === 1 ? 'Member removed' : 'Members removed',
      description: `${members.length === 1 ? members[0].displayName : `${members.length} users`} removed from ${group.name}. Their user records and credentials weren't changed.`,
    });
  };

  const menu = (m: Member): OverflowMenuItem[] => [
    ...(canViewUsers ? [{ key: 'view', label: 'View User Profile', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(`/users/${m.id}`) }] : []),
    ...(canManage ? [{ key: 'remove', label: 'Remove Member', tone: 'danger' as const, icon: <UserMinus className="h-4 w-4" />, onSelect: () => setConfirmRemove([m]) }] : []),
  ];

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-slate-900">Members</h2>
          {canManage && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add Members</Button>}
        </div>
        {rows.length > 0 && (
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
            <SearchInput value={q} onChange={setQ} placeholder="Search name or identifier" label="Search members" className="sm:w-80" />
            <FilterSelect label="Status" value={status} onChange={setStatus}
              options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'pending', label: 'Pending' }, { value: 'inactive', label: 'Inactive' }]} />
          </div>
        )}
        {canManage && selected.size > 0 && (
          <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50/60 px-4 py-2.5">
            <span className="mr-2 text-sm font-medium text-slate-700" aria-live="polite">{selected.size} selected</span>
            <Button size="sm" variant="secondary" icon={<UserMinus className="h-4 w-4" />}
              onClick={() => setConfirmRemove(pageRows.filter((r) => selected.has(r.member.id)).map((r) => r.member))}>Remove from group</Button>
            <button type="button" className="ml-auto text-sm font-medium text-brand-600 hover:text-brand-700" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}
        <DataTable
          rows={pageRows}
          rowKey={(r) => r.member.id}
          empty={rows.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="No members yet"
              description="Add existing users to this group. Adding someone doesn't issue credentials or give them access to FixID."
              action={canManage ? <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add Members</Button> : undefined} />
          ) : <EmptyState title="No matching members" description="Try a different search or status." />}
          columns={[
            ...(canManage ? [{
              key: 'select', className: 'w-10',
              header: <SelectAllBox label="Select all members on this page" checked={allSelected} indeterminate={!allSelected && pageRows.some((r) => selected.has(r.member.id))}
                onChange={() => setSelected(allSelected ? new Set() : new Set(pageRows.map((r) => r.member.id)))} />,
              cell: (r: Row) => <input type="checkbox" checked={selected.has(r.member.id)} onChange={() => toggle(r.member.id)} aria-label={`Select ${r.member.displayName}`}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />,
            }] : []),
            {
              key: 'name', header: 'User Name', cell: (r: Row) => canViewUsers
                ? <Link to={`/users/${r.member.id}`} className="font-medium text-slate-900 hover:text-brand-700">{r.member.displayName}</Link>
                : <span className="font-medium text-slate-900">{r.member.displayName}</span>,
            },
            {
              key: 'identifier', header: 'Primary Identifier', cell: (r: Row) => r.member.identifier ? (
                <span>
                  <span className="block text-[11px] text-slate-500">{identifierConfigById.get(r.member.identifier.configId)?.name}</span>
                  <span className="block font-mono text-xs text-slate-800">{r.member.identifier.value}</span>
                </span>
              ) : <span className="text-slate-400">—</span>,
            },
            {
              key: 'email', header: 'Email', cell: (r: Row) => contacts.status === 'ready'
                ? <span className="text-slate-600">{contacts.byId.get(r.member.idSwitchId)?.email || <span className="text-slate-400">—</span>}</span>
                : contacts.status === 'error' ? <span className="text-xs text-slate-400">Unavailable</span> : <Skeleton className="h-4 w-36" />,
            },
            { key: 'status', header: 'User Status', cell: (r: Row) => <MemberStatusBadge status={r.member.status} /> },
            { key: 'added', header: 'Date Added', cell: (r: Row) => <span className="whitespace-nowrap text-slate-500" title={`Added by ${r.addedBy}`}>{formatDate(r.addedAt)}</span> },
            {
              key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right',
              cell: (r: Row) => { const items = menu(r.member); return items.length ? <OverflowMenu label={`Actions for ${r.member.displayName}`} items={items} /> : null; },
            },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>

      {canManage && <AddMembersDrawer group={group} open={adding} onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!confirmRemove} tone="danger" onCancel={() => setConfirmRemove(null)} onConfirm={() => { if (confirmRemove) remove(confirmRemove); }}
        title={confirmRemove?.length === 1 ? `Remove ${confirmRemove[0].displayName}?` : `Remove ${confirmRemove?.length ?? 0} members?`}
        confirmLabel={confirmRemove?.length === 1 ? 'Remove Member' : 'Remove Members'}
        description={`${confirmRemove?.length === 1 ? 'They' : 'These users'} will be removed from ${group.name} only. User records and credentials stay as they are.`} />
    </>
  );
}
