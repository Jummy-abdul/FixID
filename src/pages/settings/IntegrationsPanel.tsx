import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, FlaskConical, Pencil, PlugZap, Plus, ScanFace } from 'lucide-react';
import { Badge, Button, Card, CardBody, DataTable, EmptyState, OverflowMenu, Skeleton, type OverflowMenuItem } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { CAPABILITY_LABEL, STATUS_LABEL, type CustomIntegration, type IntegrationStatus } from '@/domain/integrations';
import { formatDateTime } from '@/lib/dates';
import { integrationsOf } from '@/store/integrationOps';
import { useSession, useStore } from '@/store/AppStore';
import { IntegrationWizard } from './IntegrationWizard';

/**
 * Settings → Integrations. Built-in FixID Local Verification (no configuration) and the organization's own
 * custom identity services. Only the current organization's integrations are ever listed: there is no
 * catalogue of other organizations' services.
 */

const TONE: Record<IntegrationStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = { draft: 'neutral', testing: 'info', active: 'success', inactive: 'neutral', error: 'danger' };
export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  return <Badge tone={TONE[status]} dot>{STATUS_LABEL[status]}</Badge>;
}

export function CapabilityBadges({ integration }: { integration: Pick<CustomIntegration, 'capabilities'> }) {
  return <span className="flex flex-wrap gap-1">{integration.capabilities.map((c) => <Badge key={c} tone="brand">{CAPABILITY_LABEL[c]}</Badge>)}</span>;
}

export function SimulatedBadge() {
  return <Badge tone="warning"><FlaskConical className="h-3 w-3" aria-hidden="true" />Simulated Identity Service</Badge>;
}

export function IntegrationsPanel() {
  const { can } = useAuthorization();
  if (!can('integrations.view')) return <NoAccess />;
  return (
    <div className="space-y-8">
      <section aria-labelledby="builtin-verification" className="space-y-3">
        <h2 id="builtin-verification" className="text-sm font-semibold text-slate-900">Built-in Verification</h2>
        <Card>
          <CardBody className="flex flex-wrap items-start gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><ScanFace className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">FixID Local Verification <Badge tone="success" dot>Available</Badge><Badge tone="neutral">Built in</Badge></p>
              <p className="mt-0.5 text-sm text-slate-500">Verify people against identity references enrolled and managed within your organization.</p>
              <p className="mt-2 text-xs text-slate-500">Uses the people and enrollments you manage in Users. Nothing to configure here.</p>
            </div>
          </CardBody>
        </Card>
      </section>
      <CustomServices />
    </div>
  );
}

function CustomServices() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const navigate = useNavigate();
  const canManage = can('integrations.manage');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CustomIntegration | 'new' | null>(null);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 250); return () => clearTimeout(t); }, []);
  const rows = integrationsOf(state, organization.id).sort((a, b) => a.name.localeCompare(b.name));
  const last = (i: CustomIntegration) => i.tests[0];

  const menu = (i: CustomIntegration): OverflowMenuItem[] => [
    { key: 'view', label: 'View details', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(`/settings/integrations/${i.id}`) },
    ...(canManage && i.status !== 'testing' ? [{ key: 'edit', label: 'Edit configuration', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(i) }] : []),
  ];

  return (
    <section aria-labelledby="custom-services" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="custom-services" className="text-sm font-semibold text-slate-900">Custom Identity Services</h2>
          <p className="text-sm text-slate-500">External identity services {organization.name} connects for identity record lookup and biometric matching. Private to {organization.name}.</p>
        </div>
        {canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add Custom Integration</Button>}
      </div>
      <Card>
        {loading ? (
          <div className="space-y-3 p-5" aria-label="Loading integrations">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : (
          <DataTable
            rows={rows}
            rowKey={(i) => i.id}
            empty={<EmptyState icon={<PlugZap className="h-5 w-5" />} title="No custom identity services have been configured."
              description="Connect an authorized identity service to look up identity records and perform verification."
              action={canManage ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add Custom Integration</Button> : undefined} />}
            columns={[
              {
                key: 'name', header: 'Integration Name', cell: (i) => (
                  <span className="block">
                    <Link to={`/settings/integrations/${i.id}`} className="font-medium text-slate-900 hover:text-brand-700">{i.name}</Link>
                    {i.connection.target === 'simulated' && <span className="block text-xs text-amber-700">Simulated Identity Service</span>}
                  </span>
                ),
              },
              { key: 'caps', header: 'Capabilities', cell: (i) => <CapabilityBadges integration={i} /> },
              { key: 'status', header: 'Status', cell: (i) => <IntegrationStatusBadge status={i.status} /> },
              { key: 'tested', header: 'Last Tested', cell: (i) => last(i) ? <span className="text-slate-600">{formatDateTime(last(i)!.at)}<span className={`block text-xs ${last(i)!.ok ? 'text-emerald-700' : 'text-red-700'}`}>{last(i)!.summary}</span></span> : <span className="text-slate-400">Never</span> },
              { key: 'updated', header: 'Last Updated', cell: (i) => <span className="text-slate-600">{formatDateTime(i.updatedAt)}</span> },
              { key: 'actions', header: 'Actions', className: 'w-24 text-right', cell: (i) => <OverflowMenu label={`Actions for ${i.name}`} items={menu(i)} /> },
            ]}
          />
        )}
      </Card>
      {editing && (
        <IntegrationWizard integration={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); navigate(`/settings/integrations/${id}`); }} />
      )}
    </section>
  );
}
