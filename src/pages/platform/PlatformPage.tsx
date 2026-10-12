import { Navigate, useNavigate } from 'react-router-dom';
import { Fingerprint, Lock, LogOut, ServerCog } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, StatCard } from '@/components/ui';
import { displayName, homeFor, useAuth } from '@/auth/AuthProvider';
import { formatDate } from '@/lib/dates';
import { parentRelationship, organizationStatus, subRelationships } from '@/store/orgOps';
import { useStore } from '@/store/AppStore';
import { OrgStatusBadge } from '../organizations/OrganizationsPage';
import { IntegrationStatusBadge } from '../settings/IntegrationsPanel';

/**
 * Platform Administrator overview: FixID-level operations, separate from every organization workspace.
 * Shows organization metadata only (names, IDs, statuses, relationships, administrator counts), never
 * people, identity records, biometric data, credentials or integration secrets. Platform controls that
 * need backend services (such as suspending an organization) aren't part of this prototype.
 */
export function PlatformPage() {
  const { account, signOut } = useAuth();
  const { state } = useStore();
  const navigate = useNavigate();
  if (!account) return <Navigate to="/signin" replace />;
  if (!account.platformRole) return <Navigate to={homeFor(account)} replace />;

  const orgs = [...state.data.organizations].sort((a, b) => a.name.localeCompare(b.name));
  const relationships = (state.data.organizationRelationships ?? []).filter((r) => r.status !== 'ended');
  const integrations = [...(state.data.customIntegrations ?? [])].sort((a, b) => a.organizationId.localeCompare(b.organizationId));
  const nameOf = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const activeAdmins = (id: string) => state.data.administrators.filter((a) => a.organizationId === id && a.status === 'active').length;
  const stats = [
    { label: 'Registered organizations', value: orgs.length },
    { label: 'Top-level organizations', value: orgs.filter((o) => !parentRelationship(state, o.id)).length },
    { label: 'Sub-organizations', value: relationships.length },
    { label: 'Awaiting administrator', value: orgs.filter((o) => organizationStatus(o) === 'awaiting-administrator').length },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex h-16 items-center gap-3 border-b border-slate-200 bg-slate-950 px-4 text-white sm:px-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><Fingerprint className="h-5 w-5" aria-hidden="true" /></span>
        <p className="font-semibold">FixID</p>
        <Badge tone="violet">Platform</Badge>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-slate-300 sm:inline">{displayName(account)} · Platform Administrator</span>
          <Button size="sm" variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={() => { signOut(); navigate('/signin', { replace: true }); }}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Platform overview</h1>
          <p className="mt-1 text-slate-500">Organizations registered on FixID, their status and relationships. Platform context: not an organization workspace.</p>
        </div>
        <p role="note" className="flex gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Platform Administrators see organization metadata only. People, identity records, biometric data, credentials and integration secrets stay inside each organization’s workspace and aren’t available here.</span>
        </p>
        <section aria-label="Platform summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => <StatCard key={s.label} label={s.label} value={s.value} />)}
        </section>
        <Card>
          <CardHeader title="Registered organizations" />
          <DataTable
            rows={orgs}
            rowKey={(o) => o.id}
            columns={[
              { key: 'name', header: 'Organization Name', cell: (o) => <span className="font-medium text-slate-900">{o.name}</span> },
              { key: 'id', header: 'Organization ID', cell: (o) => <span className="font-mono text-xs text-slate-600">{o.id}</span> },
              { key: 'parent', header: 'Parent', cell: (o) => { const p = parentRelationship(state, o.id); return p ? nameOf(p.parentOrganizationId) : <span className="text-slate-400">—</span>; } },
              { key: 'subs', header: 'Sub-organizations', cell: (o) => subRelationships(state, o.id).length || <span className="text-slate-400">—</span> },
              { key: 'admins', header: 'Active administrators', cell: (o) => activeAdmins(o.id) },
              // Operational counts only: no transactions, people, references or results are opened from here.
              { key: 'tx', header: 'Verification transactions', cell: (o) => state.data.verificationAttempts.filter((x) => x.organizationId === o.id && x.status !== 'in-progress').length },
              { key: 'exc', header: 'Open exceptions', cell: (o) => (state.data.verificationExceptions ?? []).filter((e) => e.organizationId === o.id && !['resolved', 'closed'].includes(e.status)).length },
              { key: 'status', header: 'Status', cell: (o) => <OrgStatusBadge organization={o} /> },
              { key: 'created', header: 'Date Created', cell: (o) => formatDate(o.createdAt) },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Organization relationships" />
          <CardBody>
            {relationships.length === 0 ? <p className="text-sm text-slate-500">No organization relationships.</p> : (
              <ul className="divide-y divide-slate-100 text-sm" aria-label="Organization relationships">
                {relationships.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <span className="font-medium text-slate-900">{nameOf(r.childOrganizationId)}</span>
                    <span className="text-slate-500">is a sub-organization of</span>
                    <span className="font-medium text-slate-900">{nameOf(r.parentOrganizationId)}</span>
                    <Badge tone={r.status === 'active' ? 'success' : 'info'}>{r.status === 'active' ? 'Active' : 'Pending'}</Badge>
                    <span className="text-xs text-slate-400">since {formatDate(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Custom identity services" description="Operational status only. Configuration, endpoints and credentials stay with each organization." />
          {integrations.length === 0 ? <CardBody><p className="text-sm text-slate-500">No custom identity services are configured.</p></CardBody> : (
            <DataTable
              rows={integrations}
              rowKey={(i) => i.id}
              columns={[
                { key: 'org', header: 'Organization', cell: (i) => nameOf(i.organizationId) },
                { key: 'name', header: 'Integration', cell: (i) => <span className="font-medium text-slate-900">{i.name}</span> },
                { key: 'status', header: 'Status', cell: (i) => <IntegrationStatusBadge status={i.status} /> },
                { key: 'last', header: 'Last test', cell: (i) => i.tests[0] ? <span className={i.tests[0].ok ? 'text-emerald-700' : 'text-red-700'}>{i.tests[0].summary} <span className="text-xs text-slate-400">{formatDate(i.tests[0].at)}</span></span> : <span className="text-slate-400">Never</span> },
              ]}
            />
          )}
        </Card>
        <p className="flex gap-2 text-sm text-slate-500">
          <ServerCog className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Platform controls such as suspending an organization or support access need FixID backend services and aren’t part of this prototype.
        </p>
      </main>
    </div>
  );
}
