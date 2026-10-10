import { PageHeader, Tabs } from '@/components/ui';
import { useQueryState } from '@/hooks/useQueryState';
import { useAuth } from '@/auth/AuthProvider';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { AdministratorsPanel } from './settings/AdministratorsPanel';
import { useSession } from '@/store/AppStore';
import { DemoDataPanel } from './settings/DemoDataPanel';
import { OrganizationForm } from './settings/OrganizationForm';

type Tab = 'organization' | 'admins' | 'demo';

export function SettingsPage() {
  const { organization } = useSession();
  const { isDemo } = useAuth();
  const { can } = useAuthorization();
  const [rawTab, setTab] = useQueryState('tab', 'organization');
  // Demo data (sample organizations, reset) belongs to the demo account only.
  const tab = rawTab === 'demo' && !isDemo ? 'organization' : rawTab;
  // Each tab needs its own permission; a tab the role can't use isn't shown, and its link falls back to one it can.
  // Integrations isn't part of the MVP administrator experience: old ?tab=integrations links fall back to Organization.
  const tabs = [
    ...(can('settings.manage') ? [{ value: 'organization' as const, label: 'Organization' }] : []),
    ...(can('administrators.view') ? [{ value: 'admins' as const, label: 'Administrators & Roles' }] : []),
    ...(isDemo && can('settings.manage') ? [{ value: 'demo' as const, label: 'Demo data' }] : []),
  ];
  const current = (tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value) as Tab | undefined;
  if (!current) return <NoAccess />;
  return (
    <>
      <PageHeader title="Settings" description={`Configuration for ${organization.name}.`} />
      <div className="mb-6">
        <Tabs<Tab> value={current} onChange={setTab} tabs={tabs} />
      </div>
      {current === 'organization' && <OrganizationForm key={organization.id} organization={organization} />}
      {current === 'admins' && <AdministratorsPanel />}
      {current === 'demo' && <DemoDataPanel />}
    </>
  );
}
