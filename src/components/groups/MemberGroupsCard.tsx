import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Plus, X } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, Modal, SearchInput, useToast } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { groupsForMember, groupsOf } from '@/domain/groups';
import type { Group, Member } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { useActions, useSession, useStore } from '@/store/AppStore';

/**
 * A user's groups, read from the same membership records the Groups pages use, so changes made in
 * either place show up in both.
 */
export function MemberGroupsCard({ member }: { member: Member }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const canManage = can('groups.manage');
  const { addGroupMembers, removeGroupMembers } = useActions();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Group | null>(null);
  const memberships = groupsForMember(state.data, organization.id, member.id);
  const available = groupsOf(state.data, organization.id).filter((g) => !memberships.some((m) => m.group.id === g.id));

  const remove = (g: Group) => {
    const r = removeGroupMembers(organization.id, g.id, [member.id]);
    setRemoving(null);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: 'Removed from group', description: `${member.displayName} is no longer in ${g.name}.` });
  };

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 sm:px-8">
        <h2 className="text-base font-semibold text-slate-900">Groups <span className="font-normal text-slate-500">({memberships.length})</span></h2>
        {canManage && available.length > 0 && <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add to group</Button>}
      </div>
      {memberships.length === 0 ? (
        <EmptyState icon={<Layers className="h-5 w-5" />} title="Not in any groups"
          description={canManage && available.length > 0 ? 'Add this user to a group to organize them with others.' : 'This user doesn\'t belong to any groups yet.'} />
      ) : (
        <ul className="divide-y divide-slate-100" aria-label={`Groups for ${member.displayName}`}>
          {memberships.map(({ group, membership }) => (
            <li key={group.id} className="flex items-center gap-3 px-6 py-3 sm:px-8">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Layers className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <Link to={`/groups/${group.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700">{group.name}</Link>
                <span className="block text-xs text-slate-500">Added {formatDate(membership.addedAt)}</span>
              </span>
              {canManage && (
                <button type="button" onClick={() => setRemoving(group)} aria-label={`Remove from ${group.name}`}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && <AddToGroupsModal open={adding} member={member} groups={available} onClose={() => setAdding(false)}
        onAdd={(ids) => {
          const done: string[] = [];
          for (const id of ids) {
            const r = addGroupMembers(organization.id, id, [member.id]);
            if (r.ok) done.push(id);
          }
          setAdding(false);
          if (done.length === 0) return toast({ tone: 'error', title: 'Nothing was changed', description: 'The user couldn\'t be added to the selected groups.' });
          toast({ tone: 'success', title: 'Added to groups', description: `${member.displayName} was added to ${done.length === 1 ? '1 group' : `${done.length} groups`}.` });
        }} />}
      <ConfirmDialog open={!!removing} tone="danger" onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) remove(removing); }}
        title={`Remove from ${removing?.name ?? 'group'}?`} confirmLabel="Remove Member"
        description={`${member.displayName} will be removed from this group only. Their user record and credentials stay as they are.`} />
    </Card>
  );
}

function AddToGroupsModal({ open, member, groups, onClose, onAdd }: {
  open: boolean; member: Member; groups: Group[]; onClose: () => void; onAdd: (groupIds: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return groups.filter((g) => !query || g.name.toLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name));
  }, [groups, q]);
  const close = () => { setQ(''); setSelected(new Set()); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Add to groups" description={`Choose groups for ${member.displayName}.`}
      footer={(
        <>
          <span className="mr-auto text-sm font-medium text-slate-700" aria-live="polite">{selected.size} selected</span>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button disabled={selected.size === 0} onClick={() => { onAdd([...selected]); setQ(''); setSelected(new Set()); }}>Add to groups</Button>
        </>
      )}>
      <div className="space-y-3">
        {groups.length > 6 && <SearchInput value={q} onChange={setQ} placeholder="Search groups" label="Search groups" />}
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {visible.map((g) => (
            <li key={g.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={selected.has(g.id)}
                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{g.name}</span>
                  {g.description && <span className="block truncate text-xs text-slate-500">{g.description}</span>}
                </span>
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="px-2 py-4 text-sm text-slate-500">No matching groups.</li>}
        </ul>
      </div>
    </Modal>
  );
}
