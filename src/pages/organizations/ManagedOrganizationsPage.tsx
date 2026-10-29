import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Building2, Link2, Pencil, Plus, Power, UserMinus, UserPlus } from 'lucide-react';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Drawer, EmptyState, Field, FilterSelect, Input, PageHeader, Pagination, SearchInput, StatCard, Tabs, Textarea, usePageSlice, useToast,
} from '@/components/ui';
import { DisplayStatusBadge } from '@/components/verification/parts';
import { useAuthorization } from '@/auth/authorization';
import { maskIdentifier, scheduleShort } from '@/domain/activityLifecycle';
import { MANAGED_ORG_STATUS_LABEL, type ManagedOrganization } from '@/domain/managedOrganizations';
import { useQueryState, usePageParam } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { newId } from '@/lib/identifiers';
import { managedOrgFor, managedOrgProblems, managedOrgsOf, organizationOfActivity, type ManagedOrgErrors } from '@/store/managedOrgOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { activityPath } from '../verification/paths';

const PAGE = 20;

export const ManagedOrgStatusBadge = ({ status }: { status: ManagedOrganization['status'] }) =>
  <Badge tone={status === 'active' ? 'success' : 'neutral'} dot>{MANAGED_ORG_STATUS_LABEL[status]}</Badge>;

/**
 * The organizations this workspace manages. They're records, not workspaces: no sign-in, administrators or
 * settings of their own. Counts come from the stored memberships and activity associations.
 */
export function ManagedOrganizationsList() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [from, setFrom] = useQueryState('from');
  const [to, setTo] = useQueryState('to');
  const [page, setPage] = usePageParam();
  const [, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const all = managedOrgsOf(state, organization.id);
  const query = q.trim().toLowerCase();
  const rows = all
    .filter((o) => (status === 'all' || o.status === status) && (!query || `${o.name} ${o.reference}`.toLowerCase().includes(query))
      && (!from || o.createdAt.slice(0, 10) >= from) && (!to || o.createdAt.slice(0, 10) <= to))
    .sort((a, b) => a.name.localeCompare(b.name));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, PAGE);
  const clear = () => setParams((prev) => { const n = new URLSearchParams(prev); ['q', 'status', 'from', 'to', 'page'].forEach((k) => n.delete(k)); return n; }, { replace: true });
  const canCreate = can('organizations.manage');

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900">Organizations</h2>
            <p className="text-sm text-slate-500">Organizations {organization.name} manages, such as campuses, departments or contractors. They have no workspace, sign-in or administrators of their own, and belonging to one grants no administrative access.</p>
          </div>
          {canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Create Organization</Button>}
        </div>
        {all.length > 0 && (
          <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
            <SearchInput value={q} onChange={setQ} placeholder="Search name or reference" className="sm:w-72" label="Search organizations" />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            <label className="text-sm text-slate-600">Created from<Input type="date" value={from} onChange={(x) => setFrom(x.target.value)} className="mt-1" aria-label="Created from" /></label>
            <label className="text-sm text-slate-600">to<Input type="date" value={to} onChange={(x) => setTo(x.target.value)} className="mt-1" aria-label="Created to" /></label>
          </div>
        )}
        <DataTable
          rows={pageRows}
          rowKey={(o) => o.id}
          rowHref={(o) => `/organizations/${o.id}`}
          empty={all.length === 0
            ? <EmptyState icon={<Building2 className="h-5 w-5" />} title="No organizations yet"
                description={canCreate ? 'Create an organization to group users and verification activities, for example a campus or a contractor.' : `${organization.name} doesn’t manage any organizations yet.`}
                action={canCreate ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Create Organization</Button> : undefined} />
            : <EmptyState title="No organizations match" description="Try a different search or filter." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />}
          columns={[
            { key: 'name', header: 'Organization name', cell: (o) => <Link to={`/organizations/${o.id}`} className="font-medium text-slate-900 hover:text-brand-700">{o.name}</Link> },
            { key: 'reference', header: 'Reference', cell: (o) => <span className="font-mono text-xs text-slate-600">{o.reference}</span> },
            { key: 'status', header: 'Status', cell: (o) => <ManagedOrgStatusBadge status={o.status} /> },
            { key: 'users', header: 'Assigned users', cell: (o) => <span className="tabular-nums">{o.members.length}</span> },
            { key: 'activities', header: 'Verification activities', cell: (o) => <span className="tabular-nums">{o.activityIds.length}</span> },
            { key: 'created', header: 'Created', cell: (o) => <span className="text-slate-600">{formatDate(o.createdAt)}</span> },
            { key: 'by', header: 'Created by', cell: (o) => <span className="text-slate-600">{o.createdBy}</span> },
            { key: 'actions', header: <span className="sr-only">Actions</span>, cell: (o) => <Link to={`/organizations/${o.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View<span className="sr-only"> {o.name}</span></Link> },
          ]}
        />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={PAGE} onPage={setPage} />
      </Card>
      {creating && <OrganizationFormDrawer onClose={() => setCreating(false)} />}
    </>
  );
}

/** Create (no organization) or edit. Creating opens the new organization's details. */
function OrganizationFormDrawer({ org, onClose }: { org?: ManagedOrganization; onClose: () => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { saveManagedOrganization } = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const id = useMemo(() => org?.id ?? newId('morg'), [org]);
  const [name, setName] = useState(org?.name ?? '');
  const [description, setDescription] = useState(org?.description ?? '');
  const [contactEmail, setContactEmail] = useState(org?.contactEmail ?? '');
  const [errors, setErrors] = useState<ManagedOrgErrors & { form?: string }>({});
  const save = () => {
    const input = { organizationId: organization.id, id, name, description, contactEmail };
    const e = managedOrgProblems(state, input);
    setErrors(e);
    if (Object.keys(e).length) return;
    const r = saveManagedOrganization(input);
    if (!r.ok) return setErrors({ form: r.error, ...(r.errors as ManagedOrgErrors | undefined) });
    toast({ tone: 'success', title: org ? 'Organization updated' : 'Organization created', description: name.trim() });
    onClose();
    if (!org) navigate(`/organizations/${id}`);
  };
  return (
    <Drawer open onClose={onClose} title={org ? `Edit ${org.name}` : 'Create organization'}
      description={org ? `Reference ${org.reference}. The reference doesn’t change.` : 'It starts Active, with no users or activities. A reference is generated.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>{org ? 'Save Changes' : 'Create Organization'}</Button></>}>
      <div className="space-y-5">
        {errors.form && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{errors.form}</p>}
        <Field label="Organization name" required error={errors.name}>
          {(p) => <Input {...p} autoFocus value={name} maxLength={100} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} />}
        </Field>
        <Field label="Description" hint="Optional">
          {(p) => <Textarea {...p} rows={3} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <Field label="Contact email" hint="Optional. For reference only: no email is sent." error={errors.contactEmail}>
          {(p) => <Input {...p} type="email" value={contactEmail} onChange={(e) => { setContactEmail(e.target.value); setErrors((x) => ({ ...x, contactEmail: undefined })); }} />}
        </Field>
      </div>
    </Drawer>
  );
}

type DetailTab = 'overview' | 'users' | 'activities';

export function ManagedOrganizationDetail({ org }: { org: ManagedOrganization }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const { setManagedOrganizationStatus } = useActions();
  const toast = useToast();
  const [tab, setTab] = useQueryState('tab', 'overview');
  const [editing, setEditing] = useState(false);
  const [statusChange, setStatusChange] = useState(false);
  const canEdit = can('organizations.edit');
  const selected: DetailTab = (['overview', 'users', 'activities'] as const).includes(tab as DetailTab) ? tab as DetailTab : 'overview';
  const changeStatus = () => {
    setStatusChange(false);
    const next = org.status === 'active' ? 'inactive' : 'active';
    const r = setManagedOrganizationStatus(organization.id, org.id, next);
    toast(r.ok ? { tone: 'success', title: next === 'active' ? 'Organization activated' : 'Organization deactivated', description: org.name } : { tone: 'error', title: 'Status not changed', description: r.error });
  };
  const row = (label: string, value: React.ReactNode) => <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-900">{value}</dd></div>;
  void state;

  return (
    <>
      <PageHeader title={org.name} breadcrumbs={[{ label: 'Organizations', to: '/organizations' }, { label: org.name }]}
        description={`Reference ${org.reference}`} meta={<ManagedOrgStatusBadge status={org.status} />}
        actions={canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Power className="h-4 w-4" />} onClick={() => setStatusChange(true)}>{org.status === 'active' ? 'Deactivate' : 'Activate'}</Button>
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>
          </div>
        ) : undefined} />
      {org.status === 'inactive' && (
        <p className="mb-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">This organization is inactive. Its users, activities and every verification and exception record are kept; new users or activities can’t be associated until it’s activated again.</p>
      )}
      <div className="mb-4"><Tabs<DetailTab> value={selected} onChange={(v) => setTab(v === 'overview' ? '' : v)} tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'users', label: 'Users', count: org.members.length }, { value: 'activities', label: 'Verification Activities', count: org.activityIds.length },
      ]} /></div>
      {selected === 'overview' && (
        <div className="space-y-4">
          <section aria-label="Organization summary" className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Assigned users" value={org.members.length} />
            <StatCard label="Verification activities" value={org.activityIds.length} tone="violet" />
          </section>
          <Card className="px-5 py-5">
            <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2" aria-label="Organization details">
              {row('Organization name', org.name)}
              {row('Reference', <span className="font-mono text-xs">{org.reference}</span>)}
              {row('Status', <ManagedOrgStatusBadge status={org.status} />)}
              {row('Contact email', org.contactEmail ?? <span className="text-slate-400">Not provided</span>)}
              {row('Created', `${formatDate(org.createdAt)} by ${org.createdBy}`)}
              {row('Last changed', `${formatDate(org.updatedAt)} by ${org.updatedBy}`)}
              <div className="sm:col-span-2">{row('Description', org.description ?? <span className="text-slate-400">No description</span>)}</div>
            </dl>
            <p className="mt-4 text-xs text-slate-500">Managed by {organization.name}’s administrators. Belonging to this organization gives users no administrative access.</p>
          </Card>
        </div>
      )}
      {selected === 'users' && <OrganizationUsers org={org} />}
      {selected === 'activities' && <OrganizationActivities org={org} />}
      {editing && <OrganizationFormDrawer org={org} onClose={() => setEditing(false)} />}
      {statusChange && (
        <ConfirmDialog open tone={org.status === 'active' ? 'danger' : 'primary'} title={org.status === 'active' ? `Deactivate ${org.name}?` : `Activate ${org.name}?`}
          confirmLabel={org.status === 'active' ? 'Deactivate' : 'Activate'} onCancel={() => setStatusChange(false)} onConfirm={changeStatus}
          description={org.status === 'active'
            ? 'Its users and activities stay associated, and no account, activity, verification or exception record is deleted. Until it’s activated again, no new users or activities can be associated with it.'
            : 'Users and activities can be associated with it again.'} />
      )}
    </>
  );
}

function OrganizationUsers({ org }: { org: ManagedOrganization }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const { removeOrganizationMember } = useActions();
  const toast = useToast();
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const canManage = can('organizations.members');
  const people = org.members.map((m) => ({ ...m, person: state.data.members.find((x) => x.id === m.memberId) }));
  const query = q.trim().toLowerCase();
  const rows = people.filter((r) => !query || `${r.person?.displayName ?? ''} ${r.person?.identifier?.value ?? ''}`.toLowerCase().includes(query));
  const target = people.find((r) => r.memberId === removing);
  const remove = () => {
    if (!removing) return;
    const r = removeOrganizationMember(organization.id, org.id, removing);
    setRemoving(null);
    toast(r.ok ? { tone: 'success', title: 'User removed from organization', description: `${target?.person?.displayName ?? 'The user'} keeps their account and records.` } : { tone: 'error', title: 'Not removed', description: r.error });
  };
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search assigned users" className="sm:w-72" label="Search assigned users" />
        <span className="flex-1" />
        {canManage && <Button icon={<UserPlus className="h-4 w-4" />} disabled={org.status !== 'active'} onClick={() => setAssigning(true)}>Assign Users</Button>}
      </div>
      {canManage && org.status !== 'active' && <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Activate the organization to assign users.</p>}
      <DataTable rows={rows} rowKey={(r) => r.memberId}
        empty={people.length === 0
          ? <EmptyState icon={<UserPlus className="h-5 w-5" />} title="No users assigned" description="Assign existing users to this organization. No accounts are created and no access is granted." />
          : <EmptyState title="No assigned users match" />}
        columns={[
          { key: 'name', header: 'User', cell: (r) => (r.person && can('users.view') ? <Link to={`/users/${r.person.id}`} className="font-medium text-slate-900 hover:text-brand-700">{r.person.displayName}</Link> : <span className="font-medium text-slate-900">{r.person?.displayName ?? 'Removed user'}</span>) },
          { key: 'identifier', header: 'Identifier', cell: (r) => <span className="font-mono text-xs text-slate-600">{maskIdentifier(r.person?.identifier?.value)}</span> },
          { key: 'status', header: 'User status', cell: (r) => <Badge tone={r.person?.status === 'active' ? 'success' : r.person?.status === 'pending' ? 'warning' : 'neutral'}>{r.person ? r.person.status[0].toUpperCase() + r.person.status.slice(1) : '—'}</Badge> },
          { key: 'assigned', header: 'Assigned', cell: (r) => <span className="text-slate-600">{formatDate(r.assignedAt)}<span className="block text-xs text-slate-500">by {r.assignedBy}</span></span> },
          { key: 'actions', header: <span className="sr-only">Actions</span>, cell: (r) => canManage ? <Button size="sm" variant="ghost" icon={<UserMinus className="h-4 w-4" />} aria-label={`Remove ${r.person?.displayName ?? r.memberId}`} onClick={() => setRemoving(r.memberId)}>Remove</Button> : null },
        ]} />
      {assigning && <AssignUsersDrawer org={org} onClose={() => setAssigning(false)} />}
      {removing && (
        <ConfirmDialog open tone="danger" title={`Remove ${target?.person?.displayName ?? 'this user'} from ${org.name}?`} confirmLabel="Remove" onCancel={() => setRemoving(null)} onConfirm={remove}
          description="Only the association is removed. Their account, other organizations, permissions, verification history and exception records stay as they are." />
      )}
    </Card>
  );
}

/** Pick existing users of this workspace. Inactive users and those already assigned can't be chosen. */
function AssignUsersDrawer({ org, onClose }: { org: ManagedOrganization; onClose: () => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { assignOrganizationMembers } = useActions();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState('');
  const assigned = new Set(org.members.map((m) => m.memberId));
  const query = q.trim().toLowerCase();
  const candidates = state.data.members.filter((m) => m.organizationId === organization.id)
    .filter((m) => !query || `${m.displayName} ${m.identifier?.value ?? ''}`.toLowerCase().includes(query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, 50);
  const save = () => {
    const r = assignOrganizationMembers(organization.id, org.id, picked);
    if (!r.ok) return setError(r.error);
    toast({ tone: 'success', title: `${picked.length} ${picked.length === 1 ? 'user' : 'users'} assigned`, description: `${org.name}. No permissions were changed.` });
    onClose();
  };
  return (
    <Drawer open onClose={onClose} title={`Assign users to ${org.name}`} description="Choose existing users. Assignment creates no accounts and grants no administrative access."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!picked.length} onClick={save}>{picked.length ? `Assign ${picked.length}` : 'Assign'}</Button></>}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
        <SearchInput value={q} onChange={setQ} placeholder="Search by name or identifier" label="Search users to assign" />
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200" aria-label="Users">
          {candidates.map((m) => {
            const already = assigned.has(m.id);
            const blocked = already || m.status === 'inactive';
            return (
              <li key={m.id}>
                <label className={blocked ? 'flex cursor-not-allowed items-center gap-3 px-3 py-2 text-sm text-slate-400' : 'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50'}>
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" disabled={blocked} checked={picked.includes(m.id) || already}
                    onChange={() => { setError(''); setPicked((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id])); }} />
                  <span className="min-w-0 flex-1">{m.displayName}<span className="ml-2 font-mono text-xs text-slate-500">{maskIdentifier(m.identifier?.value)}</span></span>
                  <span className="text-xs">{already ? 'Already assigned' : m.status === 'inactive' ? 'Inactive' : m.status === 'pending' ? 'Pending' : ''}</span>
                </label>
              </li>
            );
          })}
          {candidates.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">No users match.</li>}
        </ul>
        <p className="text-xs text-slate-500">Showing up to 50 users; search to narrow the list.</p>
      </div>
    </Drawer>
  );
}

function OrganizationActivities({ org }: { org: ManagedOrganization }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const { linkOrganizationActivity } = useActions();
  const toast = useToast();
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  const canEdit = can('organizations.edit');
  const activities = org.activityIds.map((id) => state.data.activityConfigs.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);
  const available = state.data.activityConfigs.filter((a) => a.organizationId === organization.id && !organizationOfActivity(state, organization.id, a.id));
  const attempts = (id: string) => state.data.verificationAttempts.filter((x) => x.activityId === id && x.status !== 'in-progress').length;
  const link = () => {
    const r = linkOrganizationActivity(organization.id, org.id, choice, true);
    if (!r.ok) return setError(r.error);
    toast({ tone: 'success', title: 'Activity associated', description: `${state.data.activityConfigs.find((a) => a.id === choice)?.name} · ${org.name}` });
    setLinking(false); setChoice('');
  };
  const unlink = () => {
    if (!unlinking) return;
    const r = linkOrganizationActivity(organization.id, org.id, unlinking, false);
    setUnlinking(null);
    toast(r.ok ? { tone: 'success', title: 'Association removed', description: 'The activity and its records are unchanged.' } : { tone: 'error', title: 'Not removed', description: r.error });
  };
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm text-slate-500">Activities stay in Verification Activities; this only records which organization they’re for. Participants and verifiers aren’t changed.</p>
        {canEdit && <Button icon={<Link2 className="h-4 w-4" />} disabled={org.status !== 'active'} onClick={() => { setError(''); setLinking(true); }}>Associate Activity</Button>}
      </div>
      <DataTable rows={activities} rowKey={(a) => a.id} rowHref={(a) => activityPath(a.id)}
        empty={<EmptyState icon={<Link2 className="h-5 w-5" />} title="No activities associated" description="Associate an existing verification activity. New activities are created in Verification Activities." />}
        columns={[
          { key: 'name', header: 'Activity', cell: (a) => <Link to={activityPath(a.id)} className="font-medium text-slate-900 hover:text-brand-700">{a.name}</Link> },
          { key: 'status', header: 'Status', cell: (a) => <DisplayStatusBadge activity={a} /> },
          { key: 'schedule', header: 'Schedule', cell: (a) => <span className="text-slate-600">{scheduleShort(a.schedule) ?? 'No schedule'}</span> },
          { key: 'attempts', header: 'Verification attempts', cell: (a) => <span className="tabular-nums">{attempts(a.id)}</span> },
          { key: 'actions', header: <span className="sr-only">Actions</span>, cell: (a) => canEdit ? <Button size="sm" variant="ghost" aria-label={`Remove association with ${a.name}`} onClick={(e) => { e.stopPropagation(); setUnlinking(a.id); }}>Remove</Button> : null },
        ]} />
      {linking && (
        <Drawer open onClose={() => setLinking(false)} title={`Associate an activity with ${org.name}`} description="Choose an existing verification activity. An activity can be associated with one organization."
          footer={<><Button variant="secondary" onClick={() => setLinking(false)}>Cancel</Button><Button disabled={!choice} onClick={link}>Associate</Button></>}>
          <div className="space-y-3">
            {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
            {available.length === 0 ? <p className="text-sm text-slate-500">Every activity is already associated with an organization.</p> : (
              <fieldset className="space-y-2" aria-label="Activities">
                {available.map((a) => (
                  <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50">
                    <input type="radio" name="activity" checked={choice === a.id} onChange={() => setChoice(a.id)} />
                    <span className="flex-1">{a.name}</span><DisplayStatusBadge activity={a} />
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        </Drawer>
      )}
      {unlinking && (
        <ConfirmDialog open title="Remove this association?" confirmLabel="Remove" onCancel={() => setUnlinking(null)} onConfirm={unlink}
          description="The activity, its participants, verifiers, verification history and exceptions are unchanged; it just won’t be listed under this organization." />
      )}
    </Card>
  );
}

/** For routes: a managed organization of the current workspace, if the ID is one. */
export function useManagedOrganization() {
  const { orgId = '' } = useParams();
  const { organization } = useSession();
  const { state } = useStore();
  return managedOrgFor(state, organization.id, orgId);
}
