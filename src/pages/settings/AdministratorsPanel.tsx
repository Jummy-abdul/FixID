import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Eye, Mail, MailX, Pencil, ShieldCheck, ShieldOff, UserCheck, UserPlus, UserX } from 'lucide-react';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Drawer, EmptyState, Field, FilterSelect, Input, OverflowMenu, SearchInput, Skeleton, useToast,
  type OverflowMenuItem,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { PERMISSIONS, ROLES, canGrantRoles, permissionsFor, roleById, type Permission } from '@/domain/roles';
import type { OrgAdministrator } from '@/domain/types';
import { formatDate, formatDateTime } from '@/lib/dates';
import { newId } from '@/lib/identifiers';
import { cn } from '@/lib/cn';
import { useQueryState } from '@/hooks/useQueryState';
import { adminsOf, invitationExpired, inviteProblem } from '@/store/adminOps';
import { useActions, useSession, useStore } from '@/store/AppStore';

type View = 'administrators' | 'roles';

function StatusBadge({ admin }: { admin: OrgAdministrator }) {
  if (admin.status === 'invited') {
    return invitationExpired(admin) ? <Badge tone="warning" dot>Invitation expired</Badge> : <Badge tone="info" dot>Invited</Badge>;
  }
  return admin.status === 'active' ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Deactivated</Badge>;
}

function RoleBadges({ roleIds }: { roleIds: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {roleIds.map((id) => <Badge key={id} tone="brand">{roleById(id)?.name ?? id}</Badge>)}
    </span>
  );
}

/** Permissions granted by a set of roles, grouped by area. */
function PermissionList({ permissions, compact }: { permissions: Set<Permission>; compact?: boolean }) {
  const areas = [...new Set(PERMISSIONS.map((p) => p.area))];
  return (
    <div className={cn('grid gap-4', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
      {areas.map((area) => (
        <div key={area}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{area}</p>
          <ul className="mt-1.5 space-y-1">
            {PERMISSIONS.filter((p) => p.area === area).map((p) => {
              const on = permissions.has(p.id);
              return (
                <li key={p.id} className={cn('flex items-start gap-1.5 text-sm', on ? 'text-slate-800' : 'text-slate-400')}>
                  {on ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <span className="mt-2 h-px w-3.5 shrink-0 bg-slate-300" aria-hidden="true" />}
                  {p.label}<span className="sr-only">{on ? ' (allowed)' : ' (not allowed)'}</span>
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
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-700">Roles <span className="text-red-500">*</span></legend>
      <div className="space-y-2">
        {ROLES.map((r) => {
          const checked = value.includes(r.id);
          const allowed = grantable(r.id);
          return (
            <label key={r.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
              checked ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300', !allowed && 'cursor-not-allowed opacity-60')}>
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={checked} disabled={!allowed}
                onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))} />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  {r.name}{!r.portalAccess && <Badge tone="neutral">No portal access</Badge>}
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
  const [view, setView] = useQueryState('view', 'administrators');
  const current: View = view === 'roles' ? 'roles' : 'administrators';
  return (
    <div>
      <div className="mb-5 inline-flex rounded-lg bg-slate-100 p-0.5 text-sm font-medium" role="tablist" aria-label="Administrators and roles">
        {([['administrators', 'Administrators'], ['roles', 'Roles & Permissions']] as const).map(([id, label]) => (
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

type Pending =
  | { kind: 'resend' | 'revoke' | 'deactivate' | 'reactivate'; admin: OrgAdministrator }
  | null;

function AdministratorsTab() {
  const { organization, admin: me } = useSession();
  const { state } = useStore();
  const { can, permissions } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const canManage = can('admins.manage');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
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

  const canChange = (a: OrgAdministrator) => canManage && canGrantRoles(permissions, a.roleIds);
  const menu = (a: OrgAdministrator): OverflowMenuItem[] => {
    const items: OverflowMenuItem[] = [{ key: 'view', label: 'View Administrator', icon: <Eye className="h-4 w-4" />, onSelect: () => setViewing(a.id) }];
    if (!canChange(a)) return items;
    if (a.status !== 'deactivated') items.push({ key: 'roles', label: 'Edit Role Assignment', icon: <Pencil className="h-4 w-4" />, onSelect: () => setViewing(a.id) });
    if (a.status === 'invited') {
      items.push({ key: 'resend', label: 'Resend Invitation', icon: <Mail className="h-4 w-4" />, onSelect: () => setPending({ kind: 'resend', admin: a }) });
      items.push({ key: 'revoke', label: 'Revoke Invitation', tone: 'danger', icon: <MailX className="h-4 w-4" />, onSelect: () => setPending({ kind: 'revoke', admin: a }) });
    }
    if (a.status === 'active' && a.userId !== me.id) items.push({ key: 'deactivate', label: 'Deactivate Access', tone: 'danger', icon: <UserX className="h-4 w-4" />, onSelect: () => setPending({ kind: 'deactivate', admin: a }) });
    if (a.status === 'deactivated') items.push({ key: 'reactivate', label: 'Reactivate Access', icon: <UserCheck className="h-4 w-4" />, onSelect: () => setPending({ kind: 'reactivate', admin: a }) });
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
        <FilterSelect label="Role" value={role} onChange={setRole} options={[{ value: 'all', label: 'All roles' }, ...ROLES.map((r) => ({ value: r.id, label: r.name }))]} />
        {canManage && <Button className="sm:ml-auto" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>Invite Administrator</Button>}
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

  const perms = permissionsFor(roleIds);
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
              grantable={(id) => canGrantRoles(permissions, [id])} />
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
  const toast = useToast();
  const a = adminId ? adminsOf(state, organization.id).find((x) => x.id === adminId) : undefined;
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (a) { setRoleIds(a.roleIds); setError(null); } }, [a?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return null;
  const editable = can('admins.manage') && canGrantRoles(permissions, a.roleIds) && a.status !== 'deactivated';
  const dirty = [...roleIds].sort().join() !== [...a.roleIds].sort().join();
  const save = () => {
    const r = setAdminRoles(organization.id, a.id, roleIds);
    if (!r.ok) return setError(r.error);
    toast({ tone: 'success', title: 'Roles updated', description: `${a.name ?? a.email} now has ${roleIds.map((id) => roleById(id)?.name).join(', ')}.` });
    onClose();
  };

  return (
    <Drawer open onClose={onClose} width="xl" title={a.name ?? a.email} description={a.name ? a.email : 'Invitation pending'}
      footer={(
        <>
          {editable && a.status === 'invited' && <Button variant="ghost" className="mr-auto" icon={<MailX className="h-4 w-4" />} onClick={() => onAction('revoke', a)}>Revoke invitation</Button>}
          {editable && a.status === 'active' && a.userId !== me.id && <Button variant="ghost" className="mr-auto" icon={<ShieldOff className="h-4 w-4" />} onClick={() => onAction('deactivate', a)}>Deactivate access</Button>}
          {can('admins.manage') && a.status === 'deactivated' && canGrantRoles(permissions, a.roleIds) && <Button variant="secondary" className="mr-auto" icon={<UserCheck className="h-4 w-4" />} onClick={() => onAction('reactivate', a)}>Reactivate access</Button>}
          {editable && a.status === 'invited' && <Button variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => onAction('resend', a)}>Resend invitation</Button>}
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
          <RolePicker value={roleIds} onChange={(v) => { setRoleIds(v); setError(null); }} grantable={(id) => canGrantRoles(permissions, [id])} />
        ) : (
          <div><p className="mb-2 text-sm font-medium text-slate-700">Roles</p><RoleBadges roleIds={a.roleIds} /></div>
        )}
        <div>
          <p className="mb-3 text-sm font-medium text-slate-700">Permissions{editable && dirty ? ' after saving' : ''}</p>
          <PermissionList permissions={permissionsFor(editable ? roleIds : a.roleIds)} compact />
        </div>
      </div>
    </Drawer>
  );
}

function RolesTab() {
  const { organization } = useSession();
  const { state } = useStore();
  const admins = adminsOf(state, organization.id);
  return (
    <div className="space-y-4">
      {ROLES.map((r) => {
        const count = admins.filter((a) => a.status !== 'deactivated' && a.roleIds.includes(r.id)).length;
        return (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
                  {r.name}
                  {!r.portalAccess && <Badge tone="neutral">No portal access</Badge>}
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">{r.description}</p>
              </div>
              <span className="text-sm text-slate-500">{count} {count === 1 ? 'administrator' : 'administrators'}</span>
            </div>
            <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div>
                <ul className="space-y-1.5 text-sm text-slate-700">
                  {r.highlights.map((h) => <li key={h} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />{h}</li>)}
                  {r.limits?.map((h) => <li key={h} className="flex gap-2 text-slate-500"><ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />{h}</li>)}
                </ul>
              </div>
              <PermissionList permissions={new Set(r.permissions)} compact />
            </div>
          </Card>
        );
      })}
      <p className="text-sm text-slate-500">Built-in roles can't be edited. Verifiers work through approved verifier apps and are assigned to specific verification activities.</p>
    </div>
  );
}
