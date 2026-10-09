import { useState } from 'react';
import { Activity, CheckCircle2, Fingerprint, Wallet, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import type { Organization } from '@/domain/types';
import type { ServiceHealth } from '@/services/types';
import { formatDateTime } from '@/lib/dates';
import { useServices } from '@/services/ServicesProvider';

function HealthResult({ health }: { health: ServiceHealth }) {
  return (
    <div role="status" className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-sm ${health.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
      {health.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{health.message} <span className="opacity-70">({health.latencyMs} ms · {formatDateTime(health.checkedAt)})</span></span>
    </div>
  );
}

export function IntegrationsPanel({ organization }: { organization: Organization }) {
  const { idSwitch, wallet } = useServices();
  const [checking, setChecking] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ServiceHealth>>({});

  const check = async (key: 'idSwitch' | 'wallet') => {
    setChecking(key);
    const res = key === 'idSwitch' ? await idSwitch.checkHealth(organization) : await wallet.checkHealth(organization);
    setResults((r) => ({ ...r, [key]: res }));
    setChecking(null);
  };

  const { idSwitch: ids, seamfixWallet: sw, fixiam } = organization.integrations;
  const items = [
    {
      key: 'idSwitch' as const, icon: Fingerprint, name: 'Identity service', connected: ids.connected, required: true,
      body: "Keeps each person's identity record, so the same person isn't added twice.",
      meta: ids.connected ? `Tenant ${ids.tenantRef}` : 'Not linked',
    },
    {
      key: 'wallet' as const, icon: Wallet, name: 'Seamfix Wallet', connected: sw.connected, required: false,
      body: 'Provides the credential holder experience. FixID delivers issued credentials and tracks delivery status.',
      meta: sw.connected ? `Issuer ${sw.issuerDid}` : 'Not registered as an issuer',
    },
  ];

  return (
    <div className="space-y-4">
      {items.map((it) => (
        <Card key={it.key}>
          <CardHeader
            title={<span className="flex items-center gap-2"><it.icon className="h-4 w-4 text-slate-500" />{it.name}{it.required && <Badge>Required</Badge>}</span>}
            description={it.body}
            action={<span className="flex gap-1.5"><Badge tone={it.connected ? 'success' : 'warning'} dot>{it.connected ? 'Connected' : 'Not connected'}</Badge></span>}
          />
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-xs text-slate-500">{it.meta}</span>
              <Button variant="secondary" size="sm" icon={<Activity className="h-4 w-4" />} loading={checking === it.key} disabled={checking !== null && checking !== it.key} onClick={() => check(it.key)}>
                {checking === it.key ? 'Checking…' : 'Check connection'}
              </Button>
            </div>
            {results[it.key] && <HealthResult health={results[it.key]} />}
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader
          title="Fixiam"
          description="Independent workforce IAM product. Optional: FixID works without it. When connected, permitted workforce attributes (e.g. employee ID) can be referenced with their source."
          action={<Badge tone={fixiam.connected ? 'success' : 'neutral'} dot>{fixiam.connected ? 'Connected' : 'Not used'}</Badge>}
        />
      </Card>
    </div>
  );
}
