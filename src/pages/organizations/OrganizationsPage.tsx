import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, Eye, Lock, Mail, Plus } from 'lucide-react';
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, EmptyState, Field, Input, Modal, OverflowMenu, PageHeader, SearchInput, Select, Skeleton, useToast,
  type OverflowMenuItem,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { INDUSTRY_LABEL } from '@/domain/labels';
import { timezoneOptions } from '@/domain/organization';
import type { Industry, OrgAdministrator, Organization } from '@/domain/types';
import { formatDate, formatDateTime } from '@/lib/dates';
import { adminsOf, invitationExpired } from '@/store/adminOps';
import {
  initialAdministrator, organizationStatus, parentRelationship, subOrganization, subOrganizationProblems, subRelationships,
  type SubOrganizationErrors, type SubOrganizationValues,
} from '@/store/orgOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { InvitationLink } from '../settings/AdministratorsPanel';

/**
 * Organizations: the current organization's sub-organizations (one level in this phase). Each is a separate
 * workspace; the parent sees relationship and onboarding information only, never the sub-organization's
 * people, biometric data, credentials, activities, administrators' details or secrets.
 */

export function OrgStatusBadge({ organization }: { organization: Organization }) {
  const s = organizationStatus(organization);
  return s === 'awaiting-administrator' ? <Badge tone="info" dot>Awaiting administrator</Badge>
    : s === 'active' ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>;
}

/** The initial administrator as the parent may see it: who was invited and where the invitation stands. */
export function InitialAdminState({ admin }: { admin: OrgAdministrator | undefined }) {
  if (!admin) return <span className="text-slate-400">—</span>;
  const state = admin.status === 'invited' ? (invitationExpired(admin) ? 'Invitation expired' : 'Invitation pending') : admin.status === 'active' ? 'Accepted' : 'Inactive';
  const tone = state === 'Accepted' ? 'text-emerald-700' : state === 'Invitation expired' ? 'text-amber-700' : 'text-slate-500';
  return (
    <span className="block min-w-0">
      <span className="block truncate text-slate-800">{admin.status === 'active' && admin.name ? admin.name : admin.email}</span>
      <span className={`block text-xs ${tone}`}>{state}</span>
    </span>
  );
}

export function OrganizationsPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const parent = parentRelationship(state, organization.id);
  const parentOrg = parent && state.data.organizations.find((o) => o.id === parent.parentOrganizationId);

  return (
    <>
      <PageHeader title="Organizations" description="Organizations related to yours. Each has its own workspace." />
      {parent && parentOrg ? (
        <Card>
          <CardHeader title="Parent organization" description="This organization is a sub-organization." />
          <CardBody className="space-y-4 text-sm">
            <dl className="grid gap-4 sm:grid-cols-3" aria-label="Parent relationship">
              <div><dt className="text-slate-500">Parent</dt><dd className="mt-0.5 font-medium text-slate-900">{parentOrg.name}</dd></div>
              <div><dt className="text-slate-500">Relationship</dt><dd className="mt-0.5 text-slate-900">Sub-organization · {parent.status === 'active' ? 'Active' : 'Pending'}</dd></div>
              <div><dt className="text-slate-500">Since</dt><dd className="mt-0.5 text-slate-900">{formatDate(parent.createdAt)}</dd></div>
            </dl>
            <p className="flex gap-2 rounded-xl bg-slate-50 px-4 py-3 text-slate-600 ring-1 ring-inset ring-slate-200">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              {parentOrg.name} can see this relationship and your onboarding status. It can’t see your people, biometric data, credentials, verification activities or administrators’ details, and it can’t manage your workspace.
            </p>
            <p className="text-slate-500">Sub-organizations can’t have sub-organizations of their own.</p>
          </CardBody>
        </Card>
      ) : (
        <SubOrganizationsList canManage={can('organizations.manage')} />
      )}
    </>
  );
}

function SubOrganizationsList({ canManage }: { canManage: boolean }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { resendSubOrganizationInvite } = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sent, setSent] = useState<{ name: string; email: string; token: string; resent?: boolean } | null>(null);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 250); return () => clearTimeout(t); }, []);

  const rows = useMemo(() => subRelationships(state, organization.id).flatMap((r) => {
    const o = state.data.organizations.find((x) => x.id === r.childOrganizationId);
    return o ? [{ organization: o, relationship: r, admin: initialAdministrator(state, r) }] : [];
  }), [state, organization.id]);
  const filtered = rows
    .filter((r) => !q.trim() || `${r.organization.name} ${r.organization.id}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.organization.name.localeCompare(b.organization.name));

  const resend = (r: (typeof rows)[number]) => {
    const res = resendSubOrganizationInvite(organization.id, r.organization.id);
    if (!res.ok) return toast({ tone: 'error', title: 'Invitation not resent', description: res.error });
    setSent({ name: r.organization.name, email: r.admin!.email, token: res.token, resent: true });
  };
  const menu = (r: (typeof rows)[number]): OverflowMenuItem[] => [
    { key: 'view', label: 'View details', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(`/organizations/${r.organization.id}`) },
    ...(canManage && r.admin?.status === 'invited' ? [{ key: 'resend', label: 'Resend invitation', icon: <Mail className="h-4 w-4" />, onSelect: () => resend(r) }] : []),
  ];

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900">Sub-organizations</h2>
            <p className="text-sm text-slate-500">Organizations {organization.name} created. You see their relationship and onboarding, not their records.</p>
          </div>
          {canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Create Organization</Button>}
        </div>
        {rows.length > 0 && (
          <div className="border-b border-slate-100 p-4">
            <SearchInput value={q} onChange={setQ} placeholder="Search name or Organization ID" className="sm:w-80" label="Search organizations" />
          </div>
        )}
        {loading ? (
          <div className="space-y-3 p-5" aria-label="Loading organizations">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : (
          <DataTable
            rows={filtered}
            rowKey={(r) => r.organization.id}
            empty={rows.length === 0
              ? <EmptyState icon={<Building2 className="h-5 w-5" />} title="No sub-organizations yet"
                  description={`${organization.name} operates on its own. Create a sub-organization when part of your organization needs its own workspace, administrators and records.`}
                  action={canManage ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Create Organization</Button> : undefined} />
              : <EmptyState title="No matching organizations" description="Try a different search." />}
            columns={[
              { key: 'name', header: 'Organization Name', cell: (r) => <Link to={`/organizations/${r.organization.id}`} className="font-medium text-slate-900 hover:text-brand-700">{r.organization.name}</Link> },
              { key: 'id', header: 'Organization ID', cell: (r) => <span className="font-mono text-xs text-slate-600">{r.organization.id}</span> },
              { key: 'admin', header: 'Administrator', cell: (r) => <InitialAdminState admin={r.admin} /> },
              { key: 'status', header: 'Status', cell: (r) => <OrgStatusBadge organization={r.organization} /> },
              { key: 'created', header: 'Date Created', cell: (r) => <span className="text-slate-600">{formatDate(r.organization.createdAt)}</span> },
              { key: 'actions', header: 'Actions', className: 'w-24 text-right', cell: (r) => <OverflowMenu label={`Actions for ${r.organization.name}`} items={menu(r)} /> },
            ]}
          />
        )}
      </Card>
      {creating && <CreateOrganizationDrawer onClose={() => setCreating(false)} onCreated={(s) => { setCreating(false); setSent(s); }} />}
      <Modal open={!!sent} onClose={() => setSent(null)} title={sent?.resent ? 'Invitation resent' : 'Organization created'}
        description={sent ? (sent.resent ? `A new invitation link was issued for ${sent.email}. The previous link no longer works.` : `${sent.name} has its own workspace. ${sent.email} is invited as its Organization Admin; the link works once and expires in 72 hours.`) : undefined}
        footer={<Button onClick={() => setSent(null)}>Done</Button>}>
        {sent && <InvitationLink token={sent.token} />}
      </Modal>
    </>
  );
}

const INDUSTRIES = Object.entries(INDUSTRY_LABEL) as [Industry, string][];

function CreateOrganizationDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (s: { name: string; email: string; token: string }) => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { createSubOrganization } = useActions();
  const [v, setV] = useState<SubOrganizationValues>({ name: '', shortName: '', industry: '', contactEmail: '', phone: '', adminEmail: '', memberLabel: organization.memberLabel || 'Member', timezone: organization.timezone });
  const [errors, setErrors] = useState<SubOrganizationErrors & { form?: string }>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof SubOrganizationValues, value: string) => { setV((x) => ({ ...x, [k]: value })); setErrors((e) => ({ ...e, [k]: undefined, form: undefined })); };

  const submit = async () => {
    const e = subOrganizationProblems(state, organization.id, v);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 300));
    const r = createSubOrganization(organization.id, v);
    setBusy(false);
    if (!r.ok) return setErrors({ form: r.error });
    onCreated({ name: v.name.trim(), email: v.adminEmail.trim().toLowerCase(), token: r.token });
  };

  return (
    <Drawer open onClose={onClose} width="xl" title="Create organization" description={`A sub-organization of ${organization.name}, with its own workspace, administrators and records.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Create Organization</Button></>}>
      <div className="space-y-5">
        {errors.form && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{errors.form}</p>}
        <Field label="Organization Name" required error={errors.name}>{(p) => <Input {...p} autoFocus maxLength={80} value={v.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Short Name" error={errors.shortName} hint="Optional. 2–5 letters or numbers; derived from the name if left blank.">{(p) => <Input {...p} maxLength={5} value={v.shortName} onChange={(e) => set('shortName', e.target.value.toUpperCase())} />}</Field>
          <Field label="Industry" hint="Optional">{(p) => (
            <Select {...p} value={v.industry} onChange={(e) => set('industry', e.target.value)}>
              <option value="">Not specified</option>
              {INDUSTRIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </Select>
          )}</Field>
          <Field label="Organization Email" error={errors.contactEmail} hint="Optional">{(p) => <Input {...p} type="email" value={v.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />}</Field>
          <Field label="Organization Phone Number" error={errors.phone} hint="Optional">{(p) => <Input {...p} type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
          <Field label="Default Person Label" required error={errors.memberLabel} hint="What people registered with this organization are called, e.g. Member.">{(p) => <Input {...p} maxLength={30} value={v.memberLabel} onChange={(e) => set('memberLabel', e.target.value)} />}</Field>
          <Field label="Time Zone" required error={errors.timezone}>{(p) => (
            <Select {...p} value={v.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {timezoneOptions(organization.timezone).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          )}</Field>
        </div>
        <Field label="Initial Administrator Email" required error={errors.adminEmail} hint="Invited as the new organization’s Organization Admin. They become active only after accepting.">
          {(p) => <Input {...p} type="email" value={v.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} />}
        </Field>
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          The Organization ID is generated automatically, and the country is the same as {organization.name}’s. Creating the organization doesn’t make you one of its administrators or give you access to its records.
        </p>
      </div>
    </Drawer>
  );
}

/** Organization details, as the parent may see them. Anything else (or a guessed ID) shows the same not-found page. */
export function OrganizationDetailPage() {
  const { orgId = '' } = useParams();
  const { organization: current } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const { resendSubOrganizationInvite } = useActions();
  const toast = useToast();
  const [sent, setSent] = useState<string | null>(null);
  const found = subOrganization(state, current.id, orgId);
  if (!found) {
    return (
      <Card className="px-6 py-10 text-center">
        <Building2 className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Organization not available</h1>
        <p className="mt-1 text-slate-500">It isn’t a sub-organization of {current.name}, or it doesn’t exist.</p>
        <Link to="/organizations" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to Organizations</Link>
      </Card>
    );
  }
  const { organization: o, relationship: r } = found;
  const admin = initialAdministrator(state, r);
  const activeAdmins = adminsOf(state, o.id).filter((a) => a.status === 'active').length;
  const resend = () => {
    const res = resendSubOrganizationInvite(current.id, o.id);
    if (!res.ok) return toast({ tone: 'error', title: 'Invitation not resent', description: res.error });
    setSent(res.token);
  };
  const row = (label: string, value: React.ReactNode) => <div><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-0.5 text-sm text-slate-900">{value}</dd></div>;
  const notProvided = <span className="text-slate-400">Not provided</span>;

  return (
    <>
      <PageHeader title={o.name} breadcrumbs={[{ label: 'Organizations', to: '/organizations' }, { label: o.name }]} meta={<OrgStatusBadge organization={o} />}
        description={`Sub-organization of ${current.name}.`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Organization information" />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2" aria-label="Organization information">
              {row('Organization Name', o.name)}
              {row('Organization ID', <span className="font-mono text-xs">{o.id}</span>)}
              {row('Short Name', o.shortName)}
              {row('Industry', o.industry === 'other' ? notProvided : INDUSTRY_LABEL[o.industry])}
              {row('Organization Email', o.contactEmail || notProvided)}
              {row('Organization Phone Number', o.phone || notProvided)}
              {row('Default Person Label', o.memberLabel)}
              {row('Time Zone', o.timezone)}
              {row('Date Created', formatDate(o.createdAt))}
              {row('Status', <OrgStatusBadge organization={o} />)}
            </dl>
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Relationship" />
            <CardBody>
              <dl className="space-y-3" aria-label="Relationship">
                {row('Parent organization', current.name)}
                {row('Type', 'Sub-organization')}
                {row('Relationship status', r.status === 'active' ? 'Active' : r.status === 'pending' ? 'Pending' : 'Ended')}
                {row('Established', `${formatDate(r.createdAt)} by ${r.createdBy}`)}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Initial administrator" />
            <CardBody className="space-y-3">
              <InitialAdminState admin={admin} />
              {admin?.status === 'invited' && admin.invitation && (
                <p className="text-xs text-slate-500">{invitationExpired(admin) ? 'Expired' : 'Expires'} {formatDateTime(admin.invitation.expiresAt)} · sent {admin.invitation.sendCount} {admin.invitation.sendCount === 1 ? 'time' : 'times'}</p>
              )}
              {admin?.status === 'invited' && can('organizations.manage') && <Button size="sm" variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={resend}>Resend invitation</Button>}
              <p className="text-sm text-slate-600">{activeAdmins} active {activeAdmins === 1 ? 'administrator' : 'administrators'}</p>
            </CardBody>
          </Card>
        </div>
      </div>
      <p className="mt-6 flex gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        {o.name}’s people, biometric data, credentials, verification activities, administrators and settings stay in its own workspace. Being its parent doesn’t give access to them; only its own administrators can manage it.
      </p>
      <Modal open={!!sent} onClose={() => setSent(null)} title="Invitation resent" description={admin ? `A new invitation link was issued for ${admin.email}. The previous link no longer works.` : undefined}
        footer={<Button onClick={() => setSent(null)}>Done</Button>}>
        {sent && <InvitationLink token={sent} />}
      </Modal>
    </>
  );
}
