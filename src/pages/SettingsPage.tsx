import { PageHeader, Tabs } from '@/components/ui';
import { useQueryState } from '@/hooks/useQueryState';
import { useAuth } from '@/auth/AuthProvider';
import { useSession } from '@/store/AppStore';
import { DemoDataPanel } from './settings/DemoDataPanel';
import { IntegrationsPanel } from './settings/IntegrationsPanel';
import { OrganizationForm } from './settings/OrganizationForm';

type Tab = 'organization' | 'integrations' | 'demo';

export function SettingsPage() {
  const { organization } = useSession();
  const { isDemo } = useAuth();
  const [rawTab, setTab] = useQueryState('tab', 'organization');
  // Demo data (sample organizations, reset) belongs to the demo account only.
  const tab = rawTab === 'demo' && !isDemo ? 'organization' : rawTab;
  return (
    <>
      <PageHeader title="Settings" description={`Configuration for ${organization.name}.`} />
      <div className="mb-6">
        <Tabs<Tab> value={tab as Tab} onChange={setTab} tabs={[
          { value: 'organization', label: 'Organization' },
          { value: 'integrations', label: 'Integrations' },
          ...(isDemo ? [{ value: 'demo' as const, label: 'Demo data' }] : []),
        ]} />
      </div>
      {tab === 'organization' && <OrganizationForm key={organization.id} organization={organization} />}
      {tab === 'integrations' && <IntegrationsPanel key={organization.id} organization={organization} />}
      {tab === 'demo' && isDemo && <DemoDataPanel />}
    </>
  );
}
