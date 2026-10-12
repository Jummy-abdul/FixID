import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, CircleSlash, FlaskConical, Lock, Pencil, PlugZap, Power, XCircle } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Modal, PageHeader, Select, useToast } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { DEMO_AUTH_ENABLED } from '@/auth/authCore';
import { AUTH_METHOD_LABEL, canActivateIntegration, type CustomIntegration, type IntegrationCheck, type IntegrationTestRun } from '@/domain/integrations';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { TEST_SCENARIOS, type TestScenario } from '@/services/integrations/integrationService';
import { SIMULATED_LOOKUP_REFERENCES, SIMULATED_MATCH_FIXTURES } from '@/services/integrations/simulatedIdentityService';
import { integrationFor } from '@/store/integrationOps';
import { integrationUsage } from '@/store/programmeOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { CapabilityBadges, IntegrationStatusBadge, SimulatedBadge } from './IntegrationsPanel';
import { ContractReference } from './IntegrationContract';
import { IntegrationWizard } from './IntegrationWizard';

/**
 * One custom identity service, in the organization that owns it. Any other ID (including another
 * organization's) shows the same "not available" page. Connection details are shown only to administrators
 * who manage integrations, and secrets never exist in the browser to be shown.
 */
export function IntegrationDetailPage() {
  const { integrationId = '' } = useParams();
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const i = integrationFor(state, organization.id, integrationId);
  if (!i) {
    return (
      <Card className="px-6 py-10 text-center">
        <PlugZap className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Integration not available</h1>
        <p className="mt-1 text-slate-500">It doesn’t belong to {organization.name}, or it doesn’t exist.</p>
        <Link to="/settings?tab=integrations" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to Integrations</Link>
      </Card>
    );
  }
  const canManage = can('integrations.manage');
  const lastOk = i.tests.find((t) => t.ok);
  const lastFail = i.tests.find((t) => !t.ok);
  const refs = integrationUsage(state, organization.id, i.id);
  const row = (label: string, value: React.ReactNode) => <div><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-0.5 text-sm text-slate-900">{value}</dd></div>;
  const act = (r: { ok: true } | { ok: false; error: string }, title: string) => toast(r.ok ? { tone: 'success', title } : { tone: 'error', title: 'Nothing was changed', description: r.error });

  return (
    <>
      <PageHeader title={i.name} breadcrumbs={[{ label: 'Settings', to: '/settings?tab=integrations' }, { label: 'Integrations', to: '/settings?tab=integrations' }, { label: i.name }]}
        meta={<span className="flex flex-wrap items-center gap-2"><IntegrationStatusBadge status={i.status} />{i.connection.target === 'simulated' && <SimulatedBadge />}</span>}
        description={i.description || 'Custom identity service.'}
        actions={canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} disabled={i.status === 'testing'} onClick={() => setEditing(true)}>Edit configuration</Button>
            <Button variant="secondary" icon={<PlugZap className="h-4 w-4" />} disabled={i.status === 'testing'} onClick={() => setTesting(true)}>Test Connection</Button>
            {i.status === 'active'
              ? <Button variant="ghost" className="text-red-600 hover:text-red-700" icon={<Power className="h-4 w-4" />} onClick={() => setDeactivating(true)}>Deactivate</Button>
              : <Button icon={<Power className="h-4 w-4" />} disabled={!canActivateIntegration(i)} onClick={() => act(actions.activateIntegration(organization.id, i.id), `${i.name} is active`)}>Activate</Button>}
          </div>
        ) : undefined} />

      {canManage && i.status !== 'active' && !canActivateIntegration(i) && i.status !== 'testing' && (
        <p className="mb-6 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          {i.connection.target === 'external'
            ? 'Activation needs a successful connection test. Real external requests are disabled in this prototype, so this integration can’t pass until FixID’s secure integration backend is available.'
            : 'Activation is available after a successful connection test of the current configuration.'}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Integration" />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2" aria-label="Integration details">
              {row('Integration name', i.name)}
              {row('Owning organization', organization.name)}
              {row('Capabilities', <CapabilityBadges integration={i} />)}
              {row('Connection status', <IntegrationStatusBadge status={i.status} />)}
              {row('Authentication method', AUTH_METHOD_LABEL[i.connection.authMethod])}
              {row('API contract version', i.contractVersion)}
              {i.capabilities.includes('lookup') && row('Reference identifier label', i.referenceLabel)}
              {i.capabilities.includes('lookup') && row('Permitted lookup attributes', i.permittedAttributes.join(', '))}
              {row('Last successful test', lastOk ? formatDateTime(lastOk.at) : 'Never')}
              {row('Last failed test', lastFail ? `${formatDateTime(lastFail.at)} · ${lastFail.summary}` : 'Never')}
              {row('Last updated', `${formatDateTime(i.updatedAt)} by ${i.updatedBy}`)}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Connection" />
          <CardBody>
            {canManage ? (
              <dl className="space-y-3" aria-label="Connection configuration">
                {row('Service', i.connection.target === 'simulated' ? 'Simulated Identity Service' : 'External identity service')}
                {row('Base API URL', <span className="break-all font-mono text-xs">{i.connection.baseUrl}</span>)}
                {i.connection.oauth && i.connection.target === 'external' && row('Token endpoint', <span className="break-all font-mono text-xs">{i.connection.oauth.tokenEndpoint}</span>)}
                {i.connection.oauth && i.connection.target === 'external' && row('Client ID', <span className="font-mono text-xs">{i.connection.oauth.clientId}</span>)}
                {i.connection.apiKey && row('API key header', <span className="font-mono text-xs">{i.connection.apiKey.headerName}</span>)}
                {i.connection.mtls && i.connection.target === 'external' && row('Certificate reference', <span className="font-mono text-xs">{i.connection.mtls.certificateRef}</span>)}
                {row('Credential', i.connection.credential === 'simulated' ? 'Simulated (no real secret)' : i.connection.credential === 'stored' ? 'Held by the FixID secret manager (never shown)' : 'Not stored: the secret manager isn’t available in this prototype')}
                {row('Timeout', `${i.connection.timeoutSeconds} seconds`)}
              </dl>
            ) : (
              <p className="flex gap-2 text-sm text-slate-600"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />Connection details are visible only to administrators who manage integrations. Credentials are never shown to anyone.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Test history" description="The last 10 connection tests. Results never include secrets." />
        <CardBody>
          {i.tests.length === 0 ? <p className="text-sm text-slate-500">This integration hasn’t been tested yet.</p> : (
            <ul className="space-y-3" aria-label="Test history">{i.tests.map((t) => <TestRunItem key={t.id} run={t} />)}</ul>
          )}
        </CardBody>
      </Card>

      <details className="mt-6 rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-900">API contract {i.contractVersion}</summary>
        <div className="border-t border-slate-100 px-5 py-4"><ContractReference capabilities={i.capabilities} /></div>
      </details>

      {editing && <IntegrationWizard integration={i} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {testing && <TestDialog integration={i} onClose={() => setTesting(false)} />}
      <ConfirmDialog open={deactivating} tone="danger" title={`Deactivate ${i.name}?`} confirmLabel="Deactivate"
        description={`It can’t be selected for new verification operations. Its configuration, test history and audit records are kept, and earlier verification history isn’t affected. ${refs.length ? `It’s used by: ${refs.join(', ')}.` : 'It isn’t used by any verification configuration.'}`}
        onCancel={() => setDeactivating(false)} onConfirm={() => { setDeactivating(false); act(actions.deactivateIntegration(organization.id, i.id), `${i.name} is inactive`); }} />
    </>
  );
}

const ICON: Record<IntegrationCheck['outcome'], React.ReactNode> = {
  passed: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />,
  failed: <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />,
  skipped: <CircleSlash className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />,
};

function Checks({ checks }: { checks: IntegrationCheck[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li key={c.id} className="flex gap-2 text-sm">
          {ICON[c.outcome]}
          <span><span className="font-medium text-slate-800">{c.label}</span><span className="sr-only"> ({c.outcome})</span><span className="block text-xs text-slate-500">{c.detail}</span></span>
        </li>
      ))}
    </ul>
  );
}

function TestRunItem({ run }: { run: IntegrationTestRun }) {
  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn('font-semibold', run.ok ? 'text-emerald-700' : 'text-red-700')}>{run.summary}</span>
        <span className="text-slate-500">{formatDateTime(run.at)} · {run.by}</span>
        {run.simulated && <span className="text-xs text-amber-700">Simulated{run.scenario && run.scenario !== 'healthy' ? ` (scenario: ${TEST_SCENARIOS.find((s) => s.id === run.scenario)?.label ?? run.scenario})` : ''}</span>}
      </p>
      <details className="mt-2"><summary className="cursor-pointer text-xs font-medium text-brand-600">Test details</summary><div className="mt-2"><Checks checks={run.checks} /></div></details>
    </li>
  );
}

function TestDialog({ integration: i, onClose }: { integration: CustomIntegration; onClose: () => void }) {
  const { organization } = useSession();
  const { testIntegration } = useActions();
  const [scenario, setScenario] = useState<TestScenario>('healthy');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<IntegrationTestRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const simulated = i.connection.target === 'simulated';

  const runTest = async () => {
    setRunning(true); setResult(null); setError(null);
    const r = await testIntegration(organization.id, i.id, scenario);
    setRunning(false);
    if (!r.ok) return setError(r.error);
    setResult(r.run);
  };

  return (
    <Modal open onClose={running ? () => {} : onClose} title={`Test ${i.name}`} description="Runs the FixID contract against the configured service and validates every response."
      footer={<><Button variant="secondary" disabled={running} onClick={onClose}>Close</Button><Button loading={running} icon={<PlugZap className="h-4 w-4" />} onClick={() => void runTest()}>{result ? 'Run again' : 'Run test'}</Button></>}>
      <div className="space-y-4 text-sm">
        {simulated && (
          <p className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-amber-900 ring-1 ring-inset ring-amber-200">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>This tests against the <span className="font-semibold">Simulated Identity Service</span>: fictional records, simulated credentials, and matching outcomes chosen by test fixtures. No real biometric comparison happens.</span>
          </p>
        )}
        {simulated && DEMO_AUTH_ENABLED && (
          <div className="rounded-xl border border-dashed border-amber-300 p-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-amber-800" htmlFor="sim-scenario">Demo tools — simulation only</label>
            <Select id="sim-scenario" className="mt-1.5" value={scenario} disabled={running} onChange={(e) => setScenario(e.target.value as TestScenario)}>
              {TEST_SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
            <details className="mt-2 text-xs text-slate-600">
              <summary className="cursor-pointer font-medium text-amber-800">Simulated test references</summary>
              <ul className="mt-1.5 space-y-0.5">
                {SIMULATED_LOOKUP_REFERENCES.map((r) => <li key={r.value}><span className="font-mono">{r.value}</span> → {r.outcome} ({r.note})</li>)}
                {SIMULATED_MATCH_FIXTURES.map((r) => <li key={r.captureReference}><span className="font-mono">{r.captureReference}</span> (with REF-10001) → {r.outcome}</li>)}
              </ul>
            </details>
          </div>
        )}
        {running && <p role="status" className="text-slate-600">Testing the connection…</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
        {result && (
          <div role="status" aria-label="Test result" className={cn('space-y-3 rounded-xl px-4 py-3 ring-1 ring-inset', result.ok ? 'bg-emerald-50 ring-emerald-200' : 'bg-red-50 ring-red-200')}>
            <p className={cn('font-semibold', result.ok ? 'text-emerald-900' : 'text-red-900')}>{result.summary}{result.simulated ? ' (simulated)' : ''}</p>
            <p className="text-xs text-slate-500">{formatDateTime(result.at)}</p>
            <Checks checks={result.checks} />
          </div>
        )}
      </div>
    </Modal>
  );
}
