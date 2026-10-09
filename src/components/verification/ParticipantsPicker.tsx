import { useMemo, useState } from 'react';
import { Layers, Users, X } from 'lucide-react';
import { Badge, SearchInput } from '@/components/ui';
import { memberCounts } from '@/domain/groups';
import { eligibleParticipants } from '@/domain/verification';
import { cn } from '@/lib/cn';
import { useOrgData, useSession, useStore } from '@/store/AppStore';

export type Participants = { groupIds: string[]; memberIds: string[] };

/** Unique eligible people for a participant list (people in several selected groups count once). */
export function useEligibleCount(p?: Participants) {
  const { state } = useStore();
  const { organization } = useSession();
  return useMemo(() => eligibleParticipants(state.data, organization.id, p).size, [state.data, organization.id, p]);
}

/**
 * Choose eligible participants: existing groups (evaluated by current membership when someone is
 * verified) and specific existing users. Nothing here creates users, issues credentials or enrols anyone.
 */
export function ParticipantsPicker({ value, onChange, readOnly }: { value: Participants; onChange: (p: Participants) => void; readOnly?: boolean }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { groups, members, identifierConfigById } = useOrgData();
  const [q, setQ] = useState('');
  const counts = useMemo(() => memberCounts(state.data, organization.id), [state.data, organization.id]);
  const total = useEligibleCount(value);
  const query = q.trim().toLowerCase();
  const results = query.length < 2 ? [] : members
    .filter((m) => !value.memberIds.includes(m.id))
    .filter((m) => m.displayName.toLowerCase().includes(query) || (m.identifier?.value.toLowerCase().includes(query) ?? false))
    .slice(0, 8);
  const selectedUsers = value.memberIds.map((id) => members.find((m) => m.id === id)).filter(Boolean) as typeof members;
  const toggleGroup = (id: string) => onChange({ ...value, groupIds: value.groupIds.includes(id) ? value.groupIds.filter((g) => g !== id) : [...value.groupIds, id] });

  return (
    <div className="space-y-6">
      <section aria-labelledby="pp-groups">
        <h3 id="pp-groups" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Layers className="h-4 w-4 text-slate-400" aria-hidden="true" />Groups</h3>
        <p className="mt-0.5 text-sm text-slate-500">Everyone who is a member when they’re verified is eligible, so later membership changes apply.</p>
        {groups.length === 0 ? <p className="mt-2 text-sm text-slate-500">No groups yet. Create them in User Management → Groups.</p> : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Groups">
            {[...groups].sort((a, b) => a.name.localeCompare(b.name)).map((g) => {
              const on = value.groupIds.includes(g.id);
              return (
                <li key={g.id}>
                  <label className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5', readOnly ? '' : 'cursor-pointer', on ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200 hover:border-slate-300')}>
                    <input type="checkbox" checked={on} disabled={readOnly} onChange={() => toggleGroup(g.id)} aria-label={`Select group ${g.name}`}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{g.name}</span>
                    <span className="text-xs text-slate-500">{counts.get(g.id) ?? 0} members</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="pp-users">
        <h3 id="pp-users" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Users className="h-4 w-4 text-slate-400" aria-hidden="true" />Specific users</h3>
        <p className="mt-0.5 text-sm text-slate-500">Add individual users from your organization.</p>
        {!readOnly && (
          <div className="mt-3">
            <SearchInput value={q} onChange={setQ} placeholder="Search users by name or identifier" label="Search users to add" />
            {query.length >= 2 && (
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Matching users">
                {results.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-900">{m.displayName}</span>
                      <span className="block text-xs text-slate-500">{m.identifier ? `${identifierConfigById.get(m.identifier.configId)?.name}: ${m.identifier.value}` : 'No identifier'}</span>
                    </span>
                    <button type="button" onClick={() => { onChange({ ...value, memberIds: [...value.memberIds, m.id] }); setQ(''); }}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700" aria-label={`Add ${m.displayName}`}>Add</button>
                  </li>
                ))}
                {results.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No matching users.</li>}
              </ul>
            )}
          </div>
        )}
        {selectedUsers.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Selected users">
            {selectedUsers.map((m) => (
              <li key={m.id} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-3 pr-1.5 text-sm text-slate-800">
                {m.displayName}
                {!readOnly && (
                  <button type="button" onClick={() => onChange({ ...value, memberIds: value.memberIds.filter((x) => x !== m.id) })} aria-label={`Remove ${m.displayName}`}
                    className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200"><X className="h-3.5 w-3.5" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200" aria-live="polite">
        <Badge tone="brand">{total}</Badge>{' '}
        unique eligible {total === 1 ? 'person' : 'people'} right now · {value.groupIds.length} {value.groupIds.length === 1 ? 'group' : 'groups'} · {value.memberIds.length} {value.memberIds.length === 1 ? 'user' : 'users'}
      </p>
    </div>
  );
}
