import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Eye, Lock, Mail, MailX, Pencil, Plus, ShieldCheck, ShieldOff, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Drawer, EmptyState, Field, FilterSelect, Input, OverflowMenu, SearchInput, Skeleton, useToast,
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
import { adminsOf, invitationExpired, inviteProblem, orgRoles, roleHolders, roleProblems, type RoleErrors } from '@/store/adminOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { Link, useLocation, useNavigate } from 'react-router-dom';

type View = 'administrators' | 'roles';

function StatusBadge({ admin }: { admin: OrgAdministrator }) {
  if (admin.status === 'invited') {
    return invitationExpired(admin) ? <Badge tone="warning" dot>Invitation expired</Badge> : <Badge tone="info" dot>Invited</Badge>;
  }
  return admin.status === 'active' ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Deactivated</Badge>;
}

/** The roles that exist in the current organization: system roles and its own custom roles. */
function useOrgRoles(): Role[] {
  const { state } = useStore();
  return orgRoles(state, state.session.currentOrganizationId);
}

function RoleBadges({ roleIds }: { roleIds: string[] }) {
  const roles = useOrgRoles();
  return (
    <span className="flex flex-wrap gap-1">
      {roleIds.map((id) => <Badge key={id} tone="brand">{roles.find((r) => r.id === id)?.name ?? 'Unknown role'}</Badge>)}
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

/** Role picker that only offers roles the signed-in administrator may grant. */
function RolePicker({ value, onChange, grantable }: { value: string[]; onChange: (ids: string[]) => void; grantable: (id: string) => boolean }) {
  const roles = useOrgRoles();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-700">Roles <span className="text-red-500">*</span></legend>
      <div className="space-y-2">
        {roles.map((r) => {
          const checked = value.includes(r.id);
          const allowed = grantable(r.id);
          return (
            <label key={r.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
              checked ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300', !allowed && 'cursor-not-allowed opacity-60')}>
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={checked} disabled={!allowed}
                onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))} />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  {r.name}{!r.system && <Badge tone="violet">Custom</Badge>}
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
      roles: can('roles.assign') && canGrantRoles(permissions, a.roleIds, roles) && a.status !== 'deactivated',
      invitation: can('administrators.invite') && covers && a.status === 'invited',
      access: can('administrators.manage') && covers && a.status !== 'invited',
    };
  };
}

type Pending =
  | { kind: 'resend' | 'revoke' | 'deactivate' | 'reactivate'; admin: OrgAdministrator }
  | null;

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
  const [pending, setPending] = useState<Pending>(null);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 250); return () => clearTimeout(t); }, []);

  const admins = adminsOf(state, organization.id);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return admins
      .filter((a) => status === 'all' || a.status === status)
      .filter((a) => role === 'all' || a.roleIds.includes(role))
      .filter((a) => !query || a.email.toLowerCase().includes(query) || (a.name ?? '').toLowerCase().includes(query))
      .sort((a, b) => (a.status === b.status ? (a.name ?? a.email).localeCompare(b.name ?? b.email) : ['active', 'invited', 'deactivated'].indexOf(a.status) - ['active', 'invited', 'deactivated'].indexOf(b.status)));
  }, [admins, q, status, role]);

  const allowed = adminAllowed(can, permissions, roles);
  const menu = (a: OrgAdministrator): OverflowMenuItem[] => {
    const items: OverflowMenuItem[] = [{ key: 'view', label: 'View Administrator', icon: <Eye className="h-4 w-4" />, onSelect: () => setViewing(a.id) }];
    const may = allowed(a);
    if (may.roles) items.push({ key: 'roles', label: 'Edit Role Assignment', icon: <Pencil className="h-4 w-4" />, onSelect: () => setViewing(a.id) });
    if (may.invitation) {
      items.push({ key: 'resend', label: 'Resend Invitation', icon: <Mail className="h-4 w-4" />, onSelect: () => setPending({ kind: 'resend', admin: a }) });
      items.push({ key: 'revoke', label: 'Revoke Invitation', tone: 'danger', icon: <MailX className="h-4 w-4" />, onSelect: () => setPending({ kind: 'revoke', admin: a }) });
    }
    if (may.access && a.status === 'active' && a.userId !== me.id) items.push({ key: 'deactivate', label: 'Deactivate Access', tone: 'danger', icon: <UserX className="h-4 w-4" />, onSelect: () => setPending({ kind: 'deactivate', admin: a }) });
    if (may.access && a.status === 'deactivated') items.push({ key: 'reactivate', label: 'Reactivate Access', icon: <UserCheck className="h-4 w-4" />, onSelect: () => setPending({ kind: 'reactivate', admin: a }) });
    return items;
  };

  const confirmCopy = pending && {
    resend: { title: 'Resend invitation?', body: `A new invitation for ${pending.admin.email} will be valid for 7 days. The previous one stops working. No email is sent; let them know directly.`, cta: 'Resend Invitation', tone: 'primary' as const },
    revoke: { title: 'Revoke invitation?', body: `${pending.admin.email} won't be able to join with this invitation.`, cta: 'Revoke Invitation', tone: 'danger' as const },
    deactivate: { title: 'Deactivate access?', body: `${pending.admin.name ?? pending.admin.email} will immediately lose access to FixID for ${organization.name}.`, cta: 'Deactivate Access', tone: 'danger' as const },
    reactivate: { title: 'Reactivate access?', body: `${pending.admin.name ?? pending.admin.email} will regain access with their assigned roles.`, cta: 'Reactivate Access', tone: 'primary' as const },
  }[pending.kind];

  const runPending = () => {
    if (!pending) return;
    const a = pending.admin;
    const r = pending.kind === 'resend' ? actions.resendAdminInvite(organization.id, a.id)
      : pending.kind === 'revoke' ? actions.revokeAdminInvite(organization.id, a.id)
        : actions.setAdminStatus(organization.id, a.id, pending.kind === 'deactivate' ? 'deactivated' : 'active');
    setPending(null);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({
      tone: 'success',
      title: { resend: 'Invitation renewed', revoke: 'Invitation revoked', deactivate: 'Access deactivated', reactivate: 'Access reactivated' }[pending.kind],
      description: pending.kind === 'resend' ? `${a.email} can join by signing up with this email address within 7 days. No email was sent.` : undefined,
    });
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search name or email" className="sm:w-72" label="Search administrators" />
        <FilterSelect label="Status" value={status} onChange={setStatus}
          options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'invited', label: 'Invited' }, { value: 'deactivated', label: 'Deactivated' }]} />
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
              key: 'name', header: 'Name', cell: (a) => (
                <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  {a.name ?? <span className="font-normal italic text-slate-400">Invitation pending</span>}
                  {a.userId === me.id && <Badge tone="neutral">You</Badge>}
                </span>
              ),
            },
            { key: 'email', header: 'Email address', cell: (a) => <span className="text-slate-600">{a.email}</span> },
            { key: 'roles', header: 'Roles', cell: (a) => <RoleBadges roleIds={a.roleIds} /> },
            { key: 'status', header: 'Status', cell: (a) => <StatusBadge admin={a} /> },
            { key: 'last', header: 'Last active', cell: (a) => <span className="text-slate-500">{a.lastActiveAt ? formatDate(a.lastActiveAt) : '—'}</span> },
            { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right', cell: (a) => <OverflowMenu label={`Actions for ${a.name ?? a.email}`} items={menu(a)} /> },
          ]}
        />
      )}
      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <AdminDrawer adminId={viewing} onClose={() => setViewing(null)} onAction={(kind, a) => { setViewing(null); setPending({ kind, admin: a }); }} />
      <ConfirmDialog open={!!pending} title={confirmCopy?.title ?? ''} description={confirmCopy?.body ?? ''} confirmLabel={confirmCopy?.cta ?? ''}
        tone={confirmCopy?.tone} onCancel={() => setPending(null)} onConfirm={runPending} />
    </Card>
  );
}

function InviteDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { permissions } = useAuthorization();
  const { inviteAdmin } = useActions();
  const roles = useOrgRoles();
  const toast = useToast();
  const [step, setStep] = useState<'details' | 'review'>('details');
  const [email, setEmail] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ email?: string; roles?: string; form?: string }>({});
  const [sending, setSending] = useState(false);
  useEffect(() => { if (open) { setStep('details'); setEmail(''); setRoleIds([]); setErrors({}); } }, [open]);

  const next = () => {
    const e: typeof errors = {};
    const problem = inviteProblem(state, { organizationId: organization.id, email, roleIds });
    if (problem) e.email = problem;
    if (roleIds.length === 0) e.roles = 'Choose at least one role.';
    setErrors(e);
    if (!Object.keys(e).length) setStep('review');
  };

  const send = async () => {
    setSending(true);
    await new Promise((r) => setTimeout(r, 300));
    const r = inviteAdmin({ organizationId: organization.id, id: newId('adm'), email, roleIds, at: new Date().toISOString() });
    setSending(false);
    if (!r.ok) { setErrors({ form: r.error }); setStep('details'); return; }
    onClose();
    // No email service is connected: the invitation is recorded and accepted by signing up with this address.
    toast({ tone: 'success', title: 'Invitation created', description: `${email.trim()} can join by signing up with this email address within 7 days. No email was sent.` });
  };

  const perms = permissionsFor(roleIds, roles);
  return (
    <Drawer open={open} onClose={onClose} width="xl" title={step === 'details' ? 'Invite administrator' : 'Review invitation'}
      onBack={step === 'review' ? () => setStep('details') : undefined}
      footer={step === 'details' ? (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={next}>Review invitation</Button>
        </>
      ) : (
        <>
          <Button variant="ghost" className="mr-auto" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep('details')}>Back</Button>
          <Button onClick={send} loading={sending} icon={sending ? undefined : <Mail className="h-4 w-4" />}>Create invitation</Button>
        </>
      )}>
      {step === 'details' ? (
        <div className="space-y-6">
          {errors.form && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{errors.form}</p>}
          <Field label="Email address" required error={errors.email}>
            {(p) => <Input {...p} type="email" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }} />}
          </Field>
          <div>
            <RolePicker value={roleIds} onChange={(v) => { setRoleIds(v); setErrors((x) => ({ ...x, roles: undefined })); }}
              grantable={(id) => coversRoles(permissions, [id], roles)} />
            {errors.roles && <p role="alert" className="mt-2 text-sm text-red-600">{errors.roles}</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-sm text-slate-500">Email address</dt><dd className="mt-1 font-medium text-slate-900">{email.trim()}</dd></div>
            <div><dt className="text-sm text-slate-500">Organization</dt><dd className="mt-1 font-medium text-slate-900">{organization.name}</dd></div>
            <div className="sm:col-span-2"><dt className="text-sm text-slate-500">Roles</dt><dd className="mt-1"><RoleBadges roleIds={roleIds} /></dd></div>
          </dl>
          <div>
            <p className="mb-3 text-sm font-medium text-slate-700">They'll be able to</p>
            <PermissionList permissions={perms} compact />
          </div>
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
            Email delivery isn't connected yet, so no email will be sent. Let them know to sign up to FixID with this email address. The invitation is valid for 7 days.
          </p>
        </div>
      )}
    </Drawer>
  );
}

function AdminDrawer({ adminId, onClose, onAction }: {
  adminId: string | null; onClose: () => void; onAction: (kind: 'resend' | 'revoke' | 'deactivate' | 'reactivate', a: OrgAdministrator) => void;
}) {
  const { organization, admin: me } = useSession();
  const { state } = useStore();
  const { can, permissions } = useAuthorization();
  const { setAdminRoles } = useActions();
  const roles = useOrgRoles();
  const toast = useToast();
  const a = adminId ? adminsOf(state, organization.id).find((x) => x.id === adminId) : undefined;
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (a) { setRoleIds(a.roleIds); setError(null); } }, [a?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return null;
  const may = adminAllowed(can, permissions, roles)(a);
  const editable = may.roles;
  const dirty = [...roleIds].sort().join() !== [...a.roleIds].sort().join();
  const save = () => {
    const r = setAdminRoles(organization.id, a.id, roleIds);
    if (!r.ok) return setError(r.error);
    toast({ tone: 'success', title: 'Roles updated', description: `${a.name ?? a.email} now has ${roleIds.map((id) => roles.find((r) => r.id === id)?.name).join(', ')}.` });
    onClose();
  };

  return (
    <Drawer open onClose={onClose} width="xl" title={a.name ?? a.email} description={a.name ? a.email : 'Invitation pending'}
      footer={(
        <>
          {may.invitation && <Button variant="ghost" className="mr-auto" icon={<MailX className="h-4 w-4" />} onClick={() => onAction('revoke', a)}>Revoke invitation</Button>}
          {may.access && a.status === 'active' && a.userId !== me.id && <Button variant="ghost" className="mr-auto" icon={<ShieldOff className="h-4 w-4" />} onClick={() => onAction('deactivate', a)}>Deactivate access</Button>}
          {may.access && a.status === 'deactivated' && <Button variant="secondary" className="mr-auto" icon={<UserCheck className="h-4 w-4" />} onClick={() => onAction('reactivate', a)}>Reactivate access</Button>}
          {may.invitation && <Button variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => onAction('resend', a)}>Resend invitation</Button>}
          {editable ? <Button onClick={save} disabled={!dirty || roleIds.length === 0}>Save roles</Button> : <Button variant="secondary" onClick={onClose}>Close</Button>}
        </>
      )}>
      <div className="space-y-7">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div><dt className="text-sm text-slate-500">Status</dt><dd className="mt-1"><StatusBadge admin={a} /></dd></div>
          <div><dt className="text-sm text-slate-500">Last active</dt><dd className="mt-1 text-sm text-slate-900">{a.lastActiveAt ? formatDateTime(a.lastActiveAt) : '—'}</dd></div>
          <div><dt className="text-sm text-slate-500">{a.status === 'invited' ? 'Invited' : 'Added'}</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(a.invitation?.sentAt ?? a.createdAt)}</dd></div>
          {a.status === 'invited' && a.invitation && (
            <div className="sm:col-span-3"><dt className="text-sm text-slate-500">Invitation</dt>
              <dd className="mt-1 text-sm text-slate-900">
                {invitationExpired(a) ? 'Expired' : 'Expires'} {formatDate(a.invitation.expiresAt)} · issued {a.invitation.sendCount} {a.invitation.sendCount === 1 ? 'time' : 'times'} by {a.invitation.invitedBy}
              </dd>
            </div>
          )}
        </dl>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
        {editable ? (
          <RolePicker value={roleIds} onChange={(v) => { setRoleIds(v); setError(null); }} grantable={(id) => canGrantRoles(permissions, [id], roles)} />
        ) : (
          <div><p className="mb-2 text-sm font-medium text-slate-700">Roles</p><RoleBadges roleIds={a.roleIds} /></div>
        )}
        <div>
          <p className="mb-3 text-sm font-medium text-slate-700">Permissions{editable && dirty ? ' after saving' : ''}</p>
          <PermissionList permissions={permissionsFor(editable ? roleIds : a.roleIds, roles)} compact />
        </div>
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-slate-500">An administrator’s access is everything their roles allow together. System roles can’t be changed; custom roles belong to {organization.name} only.</p>
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

      {roles.map((r) => {
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
      })}
      {custom.length === 0 && (
        <Card><EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No custom roles yet"
          description="Create a role for a specific responsibility, such as a records officer who manages users but not credentials or settings."
          action={canManageRoles ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Create Custom Role</Button> : undefined} /></Card>
      )}

      {editing && <RoleDrawer role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (() => {
        const holders = roleHolders(state, organization.id, deleting.id);
        return holders.length ? (
          <ConfirmDialog open title={`${deleting.name} can’t be deleted yet`} confirmLabel="OK" onCancel={() => setDeleting(null)} onConfirm={() => setDeleting(null)}
            description={`It’s assigned to ${holders.length} ${holders.length === 1 ? 'administrator' : 'administrators'}: ${holders.map((a) => a.name ?? a.email).join(', ')}. Give them other roles in the Administrators tab first, so nobody loses or keeps access by accident.`} />
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
