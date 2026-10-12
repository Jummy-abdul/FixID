import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Clock, Copy, Eye, Lock, Mail, MailX, Pencil, Plus, ShieldCheck, ShieldOff, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Drawer, EmptyState, Field, FilterSelect, Input, Modal, OverflowMenu, SearchInput, Skeleton, useToast,
  type OverflowMenuItem,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { NoAccess } from '@/auth/authorization';
import {
  CUSTOM_ROLE_PERMISSIONS, PERMISSIONS, PERMISSION_AREAS, canGrantPermission, canGrantRoles, coversRoles, permissionsFor, type Permission, type Role,
} from '@/domain/roles';
import type { OrgAdministrator } from '@/domain/types';
import { formatDate, formatDateTime } from '@/lib/dates';
import { newId } from '@/lib/identifiers';
import { cn } from '@/lib/cn';
import { useQueryState } from '@/hooks/useQueryState';
import {
  adminsOf, invitationExpired, invitationPath, inviteProblems, orgRoles, roleHolders, roleProblems, type InviteErrors, type RoleErrors,
} from '@/store/adminOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { Link, useLocation, useNavigate } from 'react-router-dom';

type View = 'administrators' | 'roles';

/** Invited, Active or Inactive. An invited account also shows whether its invitation is pending or expired. */
export function AdminStatus({ admin }: { admin: OrgAdministrator }) {
  if (admin.status === 'invited') {
    const expired = invitationExpired(admin);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone="info" dot>Invited</Badge>
        <span className={cn('text-xs font-medium', expired ? 'text-amber-700' : 'text-slate-500')}>{expired ? 'Expired' : 'Pending'}</span>
      </span>
    );
  }
  return admin.status === 'active' ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>;
}

/** The roles that exist in the current organization: system roles and its own custom roles. */
function useOrgRoles(): Role[] {
  const { state } = useStore();
  return orgRoles(state, state.session.currentOrganizationId);
}

function RoleName({ roleIds }: { roleIds: string[] }) {
  const roles = useOrgRoles();
  const role = roles.find((r) => r.id === roleIds[0]);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-slate-800">{role?.name ?? 'Unknown role'}</span>
      {role && !role.system && <Badge tone="violet">Custom</Badge>}
    </span>
  );
}

/** Permissions granted by a set of roles, grouped by area. */
function PermissionList({ permissions, compact }: { permissions: Set<Permission>; compact?: boolean }) {
  return (
    <div className={cn('grid gap-4', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
      {PERMISSION_AREAS.map((area) => (
        <div key={area}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{area}</p>
          <ul className="mt-1.5 space-y-1">
            {PERMISSIONS.filter((p) => p.area === area).map((p) => {
              const on = permissions.has(p.id);
              return (
                <li key={p.id} className={cn('flex items-start gap-1.5 text-sm', on ? 'text-slate-800' : 'text-slate-400')}>
                  {on ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <span className="mt-2 h-px w-3.5 shrink-0 bg-slate-300" aria-hidden="true" />}
                  <span>
                    {p.label}<span className="sr-only">{on ? ' (allowed)' : ' (not allowed)'}</span>
                    {on && p.planned && <span className="block text-xs text-slate-500">Workflow coming soon</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Single-select role picker (system and custom roles). Only roles the signed-in administrator may grant can be chosen. */
function RolePicker({ value, onChange, grantable, legend = 'Role', current }: {
  value: string; onChange: (id: string) => void; grantable: (id: string) => boolean; legend?: string; current?: string;
}) {
  const roles = useOrgRoles();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-700">{legend} <span className="text-red-500">*</span></legend>
      <div className="space-y-2">
        {roles.map((r) => {
          const checked = value === r.id;
          const allowed = grantable(r.id);
          return (
            <label key={r.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
              checked ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300', !allowed && 'cursor-not-allowed opacity-60')}>
              <input type="radio" name="admin-role" className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600" checked={checked} disabled={!allowed} onChange={() => onChange(r.id)} />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  {r.name}{r.system ? <Badge tone="neutral">System</Badge> : <Badge tone="violet">Custom</Badge>}
                  {current === r.id && <Badge tone="brand">Current role</Badge>}
                </span>
                <span className="block text-sm text-slate-500">{r.description}</span>
                {!allowed && <span className="block text-xs text-slate-400">You can't grant this role.</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Simulated delivery: no email service is connected, so the invitation link is shown to the inviting
 * administrator to pass on. It is never presented as a sent email.
 */
export function InvitationLink({ token }: { token: string }) {
  const toast = useToast();
  const url = `${window.location.origin}${invitationPath(token)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast({ tone: 'success', title: 'Invitation link copied' }); } catch { toast({ tone: 'error', title: 'Couldn’t copy the link', description: 'Select it and copy it instead.' }); }
  };
  return (
    <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200" role="region" aria-label="Simulated invitation delivery">
      <p className="font-semibold">Simulated delivery: no email was sent</p>
      <p className="mt-0.5">Email delivery isn’t connected in this prototype. Share this single-use link with the invited person yourself.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input readOnly aria-label="Invitation link" value={url} onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-lg border-amber-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-700" />
        <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copy()}>Copy link</Button>
      </div>
    </div>
  );
}

export function AdministratorsPanel() {
  const { can } = useAuthorization();
  const [view, setView] = useQueryState('view', 'administrators');
  if (!can('administrators.view')) return <NoAccess />;
  const tabs = [['administrators', 'Administrators'], ['roles', 'Roles & Permissions']] as const;
  const current: View = tabs.some(([id]) => id === view) ? (view as View) : tabs[0][0];
  return (
    <div>
      <ReturnToActivity />
      <div className="mb-5 inline-flex rounded-lg bg-slate-100 p-0.5 text-sm font-medium" role="tablist" aria-label="Administrators and roles">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={current === id} onClick={() => setView(id)}
            className={cn('rounded-md px-4 py-1.5', current === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
            {label}
          </button>
        ))}
      </div>
      {current === 'administrators' ? <AdministratorsTab /> : <RolesTab />}
    </div>
  );
}

/**
 * Shown when the administrator came here from a verification activity draft (Invite Administrator):
 * the draft was saved before leaving, so they can go straight back to it.
 */
function ReturnToActivity() {
  const returnTo = new URLSearchParams(useLocation().search).get('returnTo');
  // Only links back into Verification Activities are honoured.
  if (!returnTo || !/^\/verification-activities\/[\w-]+\/edit(\?[\w=&-]*)?$/.test(returnTo)) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200" role="region" aria-label="Activity draft">
      <span className="flex-1">Your verification activity draft is saved. Invite the administrator, then go back to continue where you left off.</span>
      <Link to={returnTo} className="inline-flex items-center gap-1 font-semibold text-sky-800 hover:text-sky-950"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to activity</Link>
    </div>
  );
}

/** What the current administrator may do to another administrator. Mirrors the checks in the store. */
function adminAllowed(can: (p: Permission) => boolean, permissions: Set<Permission>, roles: Role[]) {
  return (a: OrgAdministrator) => {
    const covers = coversRoles(permissions, a.roleIds, roles);
    return {
      role: can('roles.assign') && canGrantRoles(permissions, a.roleIds, roles) && a.status !== 'deactivated',
      invitation: can('administrators.invite') && covers && a.status === 'invited',
      access: can('administrators.manage') && covers && a.status !== 'invited',
    };
  };
}

type AdminAction = 'role' | 'resend' | 'revoke' | 'deactivate' | 'reactivate' | 'expire';
type Pending = { kind: Exclude<AdminAction, 'role'>; admin: OrgAdministrator } | null;

const STATUS_ORDER = ['active', 'invited', 'deactivated'];

function AdministratorsTab() {
  const { organization, admin: me } = useSession();
  const { state } = useStore();
  const { can, permissions } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const canInvite = can('administrators.invite');
  const roles = useOrgRoles();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [loading, setLoading] = useState(true);
  // Arriving from an activity's Invite Administrator action opens the invitation straight away.
  const { search } = useLocation();
  const [inviteOpen, setInviteOpen] = useState(() => new URLSearchParams(search).get('invite') === '1');
  const [viewing, setViewing] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [sent, setSent] = useState<{ name: string; email: string; token: string; resent?: boolean } | null>(null);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 250); return () => clearTimeout(t); }, []);

  const admins = adminsOf(state, organization.id);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return admins
      .filter((a) => status === 'all' || a.status === status)
      .filter((a) => role === 'all' || a.roleIds.includes(role))
      .filter((a) => !query || a.email.toLowerCase().includes(query) || (a.name ?? '').toLowerCase().includes(query))
      .sort((a, b) => (a.status === b.status ? (a.name ?? a.email).localeCompare(b.name ?? b.email) : STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)));
  }, [admins, q, status, role]);

  const allowed = adminAllowed(can, permissions, roles);
  const act = (kind: AdminAction, a: OrgAdministrator) => {
    setViewing(null);
    if (kind === 'role') setChanging(a.id);
    else setPending({ kind, admin: a });
  };
  const menu = (a: OrgAdministrator): OverflowMenuItem[] => {
    const items: OverflowMenuItem[] = [{ key: 'view', label: 'View Details', icon: <Eye className="h-4 w-4" />, onSelect: () => setViewing(a.id) }];
    const may = allowed(a);
    if (may.role) items.push({ key: 'role', label: 'Change Role', icon: <Pencil className="h-4 w-4" />, onSelect: () => act('role', a) });
    if (may.invitation) {
      items.push({ key: 'resend', label: 'Resend Invitation', icon: <Mail className="h-4 w-4" />, onSelect: () => act('resend', a) });
      items.push({ key: 'revoke', label: 'Revoke Invitation', tone: 'danger', icon: <MailX className="h-4 w-4" />, onSelect: () => act('revoke', a) });
    }
    if (may.access && a.status === 'active' && a.userId !== me.id) items.push({ key: 'deactivate', label: 'Deactivate', tone: 'danger', icon: <UserX className="h-4 w-4" />, onSelect: () => act('deactivate', a) });
    if (may.access && a.status === 'deactivated') items.push({ key: 'reactivate', label: 'Reactivate', icon: <UserCheck className="h-4 w-4" />, onSelect: () => act('reactivate', a) });
    return items;
  };

  const who = (a: OrgAdministrator) => a.name ?? a.email;
  const confirmCopy = pending && {
    resend: { title: 'Resend invitation?', body: `${who(pending.admin)} gets a new invitation link, valid for 72 hours. The previous link stops working.`, cta: 'Resend Invitation', tone: 'primary' as const },
    revoke: { title: 'Revoke invitation?', body: `${pending.admin.email} won't be able to join with this invitation. Its link stops working.`, cta: 'Revoke Invitation', tone: 'danger' as const },
    deactivate: { title: `Deactivate ${who(pending.admin)}?`, body: `They’ll lose access to FixID for ${organization.name} immediately, including any session they have open. Their name, email, role and history are kept, and you can reactivate them later.`, cta: 'Deactivate', tone: 'danger' as const },
    reactivate: { title: `Reactivate ${who(pending.admin)}?`, body: `They’ll regain access to FixID for ${organization.name} with their role (${roles.find((r) => r.id === pending.admin.roleIds[0])?.name ?? 'unknown role'}).`, cta: 'Reactivate', tone: 'primary' as const },
    expire: { title: 'Simulate invitation expiry?', body: `Prototype only: the invitation to ${pending.admin.email} expires now, as it would after 72 hours. Its link stops working until you resend it.`, cta: 'Expire Invitation', tone: 'danger' as const },
  }[pending.kind];

  const runPending = () => {
    if (!pending) return;
    const a = pending.admin;
    setPending(null);
    if (pending.kind === 'resend') {
      const r = actions.resendAdminInvite(organization.id, a.id);
      if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
      setSent({ name: who(a), email: a.email, token: r.token, resent: true });
      return;
    }
    const r = pending.kind === 'revoke' ? actions.revokeAdminInvite(organization.id, a.id)
      : pending.kind === 'expire' ? actions.expireAdminInvite(organization.id, a.id)
        : actions.setAdminStatus(organization.id, a.id, pending.kind === 'deactivate' ? 'deactivated' : 'active');
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: { revoke: 'Invitation revoked', expire: 'Invitation expired (simulated)', deactivate: `${who(a)} is now inactive`, reactivate: `${who(a)} is active again` }[pending.kind] });
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search name or email" className="sm:w-72" label="Search administrators" />
        <FilterSelect label="Status" value={status} onChange={setStatus}
          options={[{ value: 'all', label: 'All statuses' }, { value: 'invited', label: 'Invited' }, { value: 'active', label: 'Active' }, { value: 'deactivated', label: 'Inactive' }]} />
        <FilterSelect label="Role" value={role} onChange={setRole} options={[{ value: 'all', label: 'All roles' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]} />
        {canInvite && <Button className="sm:ml-auto" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>Invite Administrator</Button>}
      </div>
      {loading ? (
        <div className="space-y-3 p-5" aria-label="Loading administrators">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : (
        <DataTable
          rows={filtered}
          rowKey={(a) => a.id}
          empty={admins.length === 0
            ? <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No administrators yet" description="Invite people to help run FixID for your organization." />
            : <EmptyState title="No matching administrators" description="Try a different search or filter." />}
          columns={[
            {
              key: 'name', header: 'Full Name', cell: (a) => (
                <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  {a.name ?? <span className="font-normal italic text-slate-400">Not provided</span>}
                  {a.userId === me.id && <Badge tone="neutral">You</Badge>}
                </span>
              ),
            },
            { key: 'email', header: 'Email', cell: (a) => <span className="text-slate-600">{a.email}</span> },
            { key: 'role', header: 'Role', cell: (a) => <RoleName roleIds={a.roleIds} /> },
            { key: 'status', header: 'Status', cell: (a) => <AdminStatus admin={a} /> },
            { key: 'actions', header: 'Actions', className: 'w-24 text-right', cell: (a) => <OverflowMenu label={`Actions for ${who(a)}`} items={menu(a)} /> },
          ]}
        />
      )}
      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} onSent={setSent} />
      <AdminDrawer adminId={viewing} onClose={() => setViewing(null)} onAction={act} />
      <ChangeRoleDrawer adminId={changing} onClose={() => setChanging(null)} />
      <ConfirmDialog open={!!pending} title={confirmCopy?.title ?? ''} description={confirmCopy?.body ?? ''} confirmLabel={confirmCopy?.cta ?? ''}
        tone={confirmCopy?.tone} onCancel={() => setPending(null)} onConfirm={runPending} />
      <Modal open={!!sent} onClose={() => setSent(null)} title={sent?.resent ? 'Invitation resent' : 'Invitation created'}
        description={sent ? `${sent.name} (${sent.email}) is listed as Invited. The link works once and expires in 72 hours.` : undefined}
        footer={<Button onClick={() => setSent(null)}>Done</Button>}>
        {sent && <InvitationLink token={sent.token} />}
      </Modal>
    </Card>
  );
}

function InviteDrawer({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: (s: { name: string; email: string; token: string }) => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { permissions } = useAuthorization();
  const { inviteAdmin } = useActions();
  const roles = useOrgRoles();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [errors, setErrors] = useState<InviteErrors & { form?: string }>({});
  const [sending, setSending] = useState(false);
  useEffect(() => { if (open) { setName(''); setEmail(''); setRoleId(''); setErrors({}); } }, [open]);

  const send = async () => {
    const input = { organizationId: organization.id, name, email, roleIds: roleId ? [roleId] : [] };
    const e = inviteProblems(state, input);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSending(true);
    await new Promise((r) => setTimeout(r, 300));
    const r = inviteAdmin({ ...input, id: newId('adm'), at: new Date().toISOString() });
    setSending(false);
    if (!r.ok) return setErrors({ form: r.error });
    onClose();
    onSent({ name: name.trim(), email: email.trim().toLowerCase(), token: r.token });
  };

  return (
    <Drawer open={open} onClose={onClose} width="xl" title="Invite administrator" description={`They’ll join ${organization.name} with the role you choose.`}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void send()} loading={sending} icon={sending ? undefined : <Mail className="h-4 w-4" />}>Send Invitation</Button>
        </>
      )}>
      <div className="space-y-6">
        {errors.form && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{errors.form}</p>}
        <Field label="Full Name" required error={errors.name}>
          {(p) => <Input {...p} autoFocus autoComplete="off" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} />}
        </Field>
        <Field label="Email" required error={errors.email}>
          {(p) => <Input {...p} type="email" autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }} />}
        </Field>
        <div>
          <RolePicker value={roleId} onChange={(v) => { setRoleId(v); setErrors((x) => ({ ...x, role: undefined })); }}
            grantable={(id) => coversRoles(permissions, [id], roles)} />
          {errors.role && <p role="alert" className="mt-2 text-sm text-red-600">{errors.role}</p>}
        </div>
        {roleId && (
          <div>
            <p className="mb-3 text-sm font-medium text-slate-700">They'll be able to</p>
            <PermissionList permissions={permissionsFor([roleId], roles)} compact />
          </div>
        )}
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          The invitation link works once and expires after 72 hours. Email delivery isn’t connected in this prototype: you’ll get the link to share yourself.
        </p>
      </div>
    </Drawer>
  );
}

/** View Details: the administrator's account, role, status and invitation, with the actions the viewer may take. */
function AdminDrawer({ adminId, onClose, onAction }: { adminId: string | null; onClose: () => void; onAction: (kind: AdminAction, a: OrgAdministrator) => void }) {
  const { organization, admin: me } = useSession();
  const { state } = useStore();
  const { can, permissions } = useAuthorization();
  const roles = useOrgRoles();
  const a = adminId ? adminsOf(state, organization.id).find((x) => x.id === adminId) : undefined;
  if (!a) return null;
  const may = adminAllowed(can, permissions, roles)(a);
  const role = roles.find((r) => r.id === a.roleIds[0]);
  const expired = invitationExpired(a);
  const history = state.data.audit.filter((e) => e.organizationId === organization.id && e.resourceType === 'administrator' && e.resourceId === a.id).slice(0, 5);

  return (
    <Drawer open onClose={onClose} width="xl" title={a.name ?? a.email} description={a.name ? a.email : undefined}
      footer={(
        <>
          {may.invitation && <Button variant="ghost" className="mr-auto" icon={<MailX className="h-4 w-4" />} onClick={() => onAction('revoke', a)}>Revoke invitation</Button>}
          {may.access && a.status === 'active' && a.userId !== me.id && <Button variant="ghost" className="mr-auto" icon={<ShieldOff className="h-4 w-4" />} onClick={() => onAction('deactivate', a)}>Deactivate</Button>}
          {may.access && a.status === 'deactivated' && <Button variant="secondary" className="mr-auto" icon={<UserCheck className="h-4 w-4" />} onClick={() => onAction('reactivate', a)}>Reactivate</Button>}
          {may.invitation && <Button variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => onAction('resend', a)}>Resend invitation</Button>}
          {may.role && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => onAction('role', a)}>Change role</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </>
      )}>
      <div className="space-y-7">
        <dl className="grid gap-4 sm:grid-cols-2" aria-label="Administrator details">
          <div><dt className="text-sm text-slate-500">Full Name</dt><dd className="mt-1 text-sm text-slate-900">{a.name ?? 'Not provided'}</dd></div>
          <div><dt className="text-sm text-slate-500">Email</dt><dd className="mt-1 text-sm text-slate-900">{a.email}</dd></div>
          <div><dt className="text-sm text-slate-500">Role</dt><dd className="mt-1 text-sm"><RoleName roleIds={a.roleIds} /></dd></div>
          <div><dt className="text-sm text-slate-500">Status</dt><dd className="mt-1"><AdminStatus admin={a} /></dd></div>
          <div><dt className="text-sm text-slate-500">{a.status === 'invited' ? 'Invited' : 'Added'}</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(a.invitation?.sentAt ?? a.createdAt)}</dd></div>
          <div><dt className="text-sm text-slate-500">Last active</dt><dd className="mt-1 text-sm text-slate-900">{a.lastActiveAt ? formatDateTime(a.lastActiveAt) : '—'}</dd></div>
          {a.status === 'invited' && a.invitation && (
            <div className="sm:col-span-2"><dt className="text-sm text-slate-500">Invitation</dt>
              <dd className="mt-1 text-sm text-slate-900">
                {expired ? 'Expired' : 'Expires'} {formatDateTime(a.invitation.expiresAt)} · sent {a.invitation.sendCount} {a.invitation.sendCount === 1 ? 'time' : 'times'}, last by {a.invitation.invitedBy}
              </dd>
            </div>
          )}
        </dl>
        {a.status === 'invited' && a.invitation?.token && !expired && may.invitation && (
          <div className="space-y-2">
            <InvitationLink token={a.invitation.token} />
            <Button size="sm" variant="ghost" icon={<Clock className="h-4 w-4" />} onClick={() => onAction('expire', a)}>Simulate expiry (prototype)</Button>
          </div>
        )}
        {a.status === 'invited' && expired && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">This invitation has expired and its link no longer works.{may.invitation ? ' Resend it to send a new 72-hour link.' : ''}</p>
        )}
        {a.status === 'deactivated' && (
          <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">This account is inactive and can’t access FixID. Its name, email, role and history are kept.</p>
        )}
        <div>
          <p className="mb-3 text-sm font-medium text-slate-700">Permissions{role ? ` (${role.name})` : ''}</p>
          <PermissionList permissions={permissionsFor(a.roleIds, roles)} compact />
        </div>
        {history.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Recent history</p>
            <ul className="space-y-1.5 text-sm text-slate-600">
              {history.map((e) => <li key={e.id}><span className="text-slate-400">{formatDateTime(e.occurredAt)}</span> · {e.summary}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Change Role: shows the current role and replaces it with exactly one other role. */
function ChangeRoleDrawer({ adminId, onClose }: { adminId: string | null; onClose: () => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { permissions } = useAuthorization();
  const { setAdminRoles } = useActions();
  const roles = useOrgRoles();
  const toast = useToast();
  const a = adminId ? adminsOf(state, organization.id).find((x) => x.id === adminId) : undefined;
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (a) { setRoleId(a.roleIds[0] ?? ''); setError(null); } }, [a?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return null;
  const current = a.roleIds[0];
  const dirty = !!roleId && roleId !== current;
  const save = () => {
    const r = setAdminRoles(organization.id, a.id, [roleId]);
    if (!r.ok) return setError(r.error);
    toast({ tone: 'success', title: 'Role changed', description: `${a.name ?? a.email} is now ${roles.find((x) => x.id === roleId)?.name}. Their access has been updated.` });
    onClose();
  };
  return (
    <Drawer open onClose={onClose} width="xl" title={`Change role: ${a.name ?? a.email}`} description="Each administrator has exactly one role. Their access changes as soon as you save."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!dirty}>Save</Button></>}>
      <div className="space-y-6">
        <p className="text-sm text-slate-600">Current role: <span className="font-semibold text-slate-900">{roles.find((r) => r.id === current)?.name ?? 'Unknown role'}</span></p>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
        <RolePicker legend="New role" value={roleId} current={current} onChange={(v) => { setRoleId(v); setError(null); }}
          grantable={(id) => canGrantRoles(permissions, [id], roles)} />
        {roleId && (
          <div>
            <p className="mb-3 text-sm font-medium text-slate-700">Permissions{dirty ? ' after saving' : ''}</p>
            <PermissionList permissions={permissionsFor([roleId], roles)} compact />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function RolesTab() {
  const { organization } = useSession();
  const { canPreview, can } = useAuthorization();
  const { startRolePreview, deleteRole } = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const { state } = useStore();
  const roles = useOrgRoles();
  const canManageRoles = can('roles.manage');
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const preview = (id: string) => { startRolePreview(id); navigate('/'); };
  const custom = roles.filter((r) => !r.system);

  const remove = () => {
    if (!deleting) return;
    const r = deleteRole(organization.id, deleting.id);
    setDeleting(null);
    toast(r.ok ? { tone: 'success', title: 'Role deleted', description: deleting.name } : { tone: 'error', title: 'Role not deleted', description: r.error });
  };

  const roleCard = (r: Role) => {
    const holders = roleHolders(state, organization.id, r.id).filter((a) => a.status !== 'deactivated').length;
    return (
      <Card key={r.id}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
              {r.name}
              {r.system ? <Badge tone="neutral"><Lock className="h-3 w-3" aria-hidden="true" />System role</Badge> : <Badge tone="violet">Custom role</Badge>}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">{r.description || 'No description.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">{holders} {holders === 1 ? 'administrator' : 'administrators'}</span>
            {canPreview && r.id !== 'organization-admin' && (
              <Button size="sm" variant="secondary" icon={<Eye className="h-4 w-4" />} aria-label={`Preview as ${r.name}`} onClick={() => preview(r.id)}>Preview</Button>
            )}
            {canManageRoles && !r.system && (
              <>
                <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>Edit</Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>Delete</Button>
              </>
            )}
          </div>
        </div>
        <div className={cn('grid gap-6 px-6 py-5', r.highlights && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]')}>
          {r.highlights && (
            <ul className="space-y-1.5 text-sm text-slate-700">
              {r.highlights.map((h) => <li key={h} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />{h}</li>)}
              {r.limits?.map((h) => <li key={h} className="flex gap-2 text-slate-500"><ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />{h}</li>)}
            </ul>
          )}
          <PermissionList permissions={new Set(r.permissions)} compact />
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-slate-500">Each administrator has exactly one role. The system roles (Organization Admin, Verifier and Auditor) can’t be changed or deleted; custom roles belong to {organization.name} only.</p>
        {canPreview && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <Eye className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <span>Preview as role</span>
            <select aria-label="Preview as role" value="" onChange={(e) => e.target.value && preview(e.target.value)}
              className="h-9 rounded-lg border-slate-300 py-0 pl-2.5 pr-8 text-sm text-slate-800 focus:border-brand-500 focus:ring-brand-500">
              <option value="">Choose a role…</option>
              {roles.filter((r) => r.id !== 'organization-admin').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        {canManageRoles && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Create Custom Role</Button>}
      </div>

      <section aria-labelledby="system-roles" className="space-y-4">
        <h2 id="system-roles" className="text-sm font-semibold text-slate-900">System roles</h2>
        {roles.filter((r) => r.system).map(roleCard)}
      </section>
      <section aria-labelledby="custom-roles" className="space-y-4 pt-2">
        <h2 id="custom-roles" className="text-sm font-semibold text-slate-900">Custom roles</h2>
        {custom.length > 0 ? custom.map(roleCard) : (
          <Card><EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No custom roles yet"
            description={canManageRoles
              ? 'Create a role for a specific responsibility, such as a records officer who manages users but not credentials or settings. It will be available when inviting administrators or changing their role.'
              : 'Your organization hasn’t created any custom roles.'}
            action={canManageRoles ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Create Custom Role</Button> : undefined} /></Card>
        )}
      </section>

      {editing && <RoleDrawer role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (() => {
        const holders = roleHolders(state, organization.id, deleting.id);
        return holders.length ? (
          <ConfirmDialog open title={`${deleting.name} can’t be deleted yet`} confirmLabel="OK" onCancel={() => setDeleting(null)} onConfirm={() => setDeleting(null)}
            description={`It’s assigned to ${holders.length} ${holders.length === 1 ? 'administrator' : 'administrators'}: ${holders.map((a) => a.name ?? a.email).join(', ')}. Change their role in the Administrators tab first, so nobody loses or keeps access by accident.`} />
        ) : (
          <ConfirmDialog open tone="danger" title={`Delete ${deleting.name}?`} confirmLabel="Delete Role" onCancel={() => setDeleting(null)} onConfirm={remove}
            description="Nobody has this role. It will be removed from your organization. This can’t be undone." />
        );
      })()}
    </div>
  );
}

/** Create or edit a custom role. Permissions are grouped by area; Organization Admin privileges can’t be chosen. */
function RoleDrawer({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { permissions: mine } = useAuthorization();
  const { saveRole } = useActions();
  const toast = useToast();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Permission[]>(role?.permissions ?? []);
  const [errors, setErrors] = useState<RoleErrors>({});
  const id = useMemo(() => role?.id ?? newId('role'), [role]);
  const holders = role ? roleHolders(state, organization.id, role.id).filter((a) => a.status !== 'deactivated').length : 0;
  const toggle = (p: Permission) => { setPerms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p])); setErrors((e) => ({ ...e, permissions: undefined })); };

  const save = () => {
    const input = { organizationId: organization.id, id, name, description, permissions: perms };
    const e = roleProblems(state, input);
    setErrors(e);
    if (Object.keys(e).length) return;
    const r = saveRole(input);
    if (!r.ok) { setErrors({ form: r.error, ...(r.errors as RoleErrors | undefined) }); return; }
    toast({ tone: 'success', title: role ? 'Role updated' : 'Role created', description: role && holders ? `Changes apply now to ${holders} ${holders === 1 ? 'administrator' : 'administrators'}.` : name.trim() });
    onClose();
  };

  return (
    <Drawer open onClose={onClose} width="xl" title={role ? `Edit ${role.name}` : 'Create custom role'}
      description="Choose what people with this role can see and do in this organization."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>{role ? 'Save Role' : 'Create Role'}</Button></>}>
      <div className="space-y-6">
        {errors.form && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{errors.form}</p>}
        {role && holders > 0 && (
          <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
            {holders} {holders === 1 ? 'administrator has' : 'administrators have'} this role. Changes apply to them as soon as you save, including removed permissions.
          </p>
        )}
        <Field label="Role name" required error={errors.name} hint="e.g. Records Officer">
          {(p) => <Input {...p} autoFocus value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} />}
        </Field>
        <Field label="Description" hint="Optional">
          {(p) => <Input {...p} value={description} maxLength={160} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Permissions <span className="text-red-500">*</span></legend>
          {errors.permissions && <p role="alert" className="mt-1 text-sm text-red-600">{errors.permissions}</p>}
          <div className="mt-3 grid gap-5 sm:grid-cols-2">
            {PERMISSION_AREAS.map((area) => (
              <div key={area} role="group" aria-label={area}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{area}</p>
                <ul className="mt-2 space-y-1.5">
                  {PERMISSIONS.filter((p) => p.area === area).map((p) => {
                    const locked = !CUSTOM_ROLE_PERMISSIONS.includes(p.id);
                    const grantable = canGrantPermission(mine, p.id);
                    return (
                      <li key={p.id}>
                        <label className={cn('flex items-start gap-2.5 text-sm', locked || !grantable ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-800')}>
                          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={perms.includes(p.id)}
                            disabled={locked || (!grantable && !perms.includes(p.id))} onChange={() => toggle(p.id)} />
                          <span>
                            {p.label}
                            {locked && <span className="block text-xs">Organization Admin only</span>}
                            {!locked && p.sensitive && <span className="block text-xs text-amber-700">Sensitive</span>}
                            {!locked && p.planned && <span className="block text-xs text-slate-500">Workflow coming soon</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </fieldset>
      </div>
    </Drawer>
  );
}
