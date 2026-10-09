import { useEffect, useMemo, useRef, useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { Button, Drawer, EmptyState, FilterSelect, SearchInput, useToast } from '@/components/ui';
import { MemberStatusBadge } from '@/components/domain/StatusBadges';
import { membershipsOfGroup } from '@/domain/groups';
import type { Group } from '@/domain/types';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';

/**
 * Pick existing users of this organization to add to a group. Users already in the group aren't
 * offered, so a membership can't be duplicated, and no new user is ever created here.
 */
export function AddMembersDrawer({ group, open, onClose }: { group: Group; open: boolean; onClose: () => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { members, identifierConfigById } = useOrgData();
  const { addGroupMembers } = useActions();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setQ(''); setStatus('all'); setSelected(new Set()); setError(null); setBusy(false); } }, [open]);

  const inGroup = useMemo(() => new Set(membershipsOfGroup(state.data, organization.id, group.id).map((m) => m.memberId)), [state.data, organization.id, group.id]);
  const eligible = useMemo(() => members.filter((m) => !inGroup.has(m.id)).sort((a, b) => a.displayName.localeCompare(b.displayName)), [members, inGroup]);
  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return eligible
      .filter((m) => status === 'all' || m.status === status)
      .filter((m) => !query || m.displayName.toLowerCase().includes(query) || (m.identifier?.value.toLowerCase().includes(query) ?? false));
  }, [eligible, q, status]);
  const allVisible = visible.length > 0 && visible.every((m) => selected.has(m.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    for (const m of visible) { if (allVisible) n.delete(m.id); else n.add(m.id); }
    return n;
  });

  const add = async () => {
    if (selected.size === 0) return setError('Select at least one user.');
    setBusy(true);
    await new Promise((r) => setTimeout(r, 250));
    const r = addGroupMembers(organization.id, group.id, [...selected]);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast({ tone: 'success', title: selected.size === 1 ? 'Member added' : 'Members added', description: `${selected.size === 1 ? '1 user was' : `${selected.size} users were`} added to ${group.name}.` });
    onClose();
  };

  return (
    <Drawer open={open} onClose={busy ? () => {} : onClose} width="lg" title="Add members" description={`Choose existing users to add to ${group.name}.`}
      footer={(
        <>
          <span className="mr-auto text-sm font-medium text-slate-700" aria-live="polite">{selected.size} selected</span>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={add} loading={busy} disabled={selected.size === 0} icon={<UserPlus className="h-4 w-4" />}>
            {selected.size > 1 ? `Add ${selected.size} users` : 'Add user'}
          </Button>
        </>
      )}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</p>}
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchInput value={q} onChange={setQ} placeholder="Search name or identifier" label="Search users to add" className="sm:flex-1" />
          <FilterSelect label="Status" value={status} onChange={setStatus}
            options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'pending', label: 'Pending' }, { value: 'inactive', label: 'Inactive' }]} />
        </div>
        {inGroup.size > 0 && <p className="text-sm text-slate-500">{inGroup.size === 1 ? '1 user is' : `${inGroup.size} users are`} already in this group and not shown.</p>}
        {eligible.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title={members.length === 0 ? 'No users yet' : 'Everyone is already a member'}
            description={members.length === 0 ? 'Add users in User Management first, then add them to groups.' : 'All users in your organization already belong to this group.'} />
        ) : visible.length === 0 ? (
          <EmptyState title="No matching users" description="Try a different search or status." />
        ) : (
          <div className="rounded-xl border border-slate-200">
            <label className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700">
              <SelectAllBox checked={allVisible} indeterminate={!allVisible && visible.some((m) => selected.has(m.id))} onChange={toggleAll} />
              Select all {visible.length} shown
            </label>
            <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto" aria-label="Users you can add">
              {visible.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                    <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.displayName}`}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{m.displayName}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {m.identifier ? <>{identifierConfigById.get(m.identifier.configId)?.name}: <span className="font-mono">{m.identifier.value}</span></> : 'No identifier'}
                      </span>
                    </span>
                    <MemberStatusBadge status={m.status} />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  );
}

export function SelectAllBox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: () => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label}
    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />;
}
