import { PageHeader, Tabs } from '@/components/ui';
import { useQueryState } from '@/hooks/useQueryState';
import { useAuth } from '@/auth/AuthProvider';
import { DemoDataPanel } from './settings/DemoDataPanel';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { AdministratorsPanel } from './settings/AdministratorsPanel';
import { useSession } from '@/store/AppStore';
import { OrganizationForm } from './settings/OrganizationForm';

type Tab = 'organization' | 'admins';

export function SettingsPage() {
  const { organization } = useSession();
  const { can } = useAuthorization();
  const [tab, setTab] = useQueryState('tab', 'organization');
  // Each tab needs its own permission; a tab the role can't use isn't shown, and its link falls back to one it can.
  // Only Organization and Administrators & Roles are part of the MVP. Integrations and Demo data are hidden
  // (their panels and data are kept): ?tab=integrations falls back to Organization. The demo account keeps
  // its internal prototype tools at ?tab=demo, which isn't in the navigation; for anyone else it falls back too.
  const tabs = [
    ...(can('settings.manage') || can('organization.view') ? [{ value: 'organization' as const, label: 'Organization' }] : []),
    ...(can('administrators.view') ? [{ value: 'admins' as const, label: 'Administrators & Roles' }] : []),
  ];
  const { isDemo } = useAuth();
  const internalDemo = tab === 'demo' && isDemo && can('settings.manage');
  const current = (tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value) as Tab | undefined;
  if (internalDemo) {
    return (
      <>
        <PageHeader title="Settings" description="Prototype demo tools (not part of the product navigation)." />
        <DemoDataPanel />
      </>
    );
  }
  if (!current) return <NoAccess />;
  return (
    <>
      <PageHeader title="Settings" description={`Configuration for ${organization.name}.`} />
      <div className="mb-6">
        <Tabs<Tab> value={current} onChange={setTab} tabs={tabs} />
      </div>
      {current === 'organization' && <OrganizationForm key={organization.id} organization={organization} />}
      {current === 'admins' && <AdministratorsPanel />}
    </>
  );
}
