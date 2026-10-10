import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileSpreadsheet, History, Search, UserPlus } from 'lucide-react';
import { Badge, PageHeader } from '@/components/ui';
import { useOrgData } from '@/store/AppStore';
import { useAuthorization } from '@/auth/authorization';
import { hasProgress, loadDraft } from './add/draft';

/** One entry point for adding users, used from the dashboard and the Users module. */
export function AddUserEntryPage() {
  const { organization } = useOrgData();
  const draft = loadDraft(organization.id);
  const { can } = useAuthorization();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users', to: '/users' }, { label: 'Add users' }]}
        title="Add users"
        description="Choose how you'd like to add people to your organization."
      />
      {can('users.create') && hasProgress(draft) && (
        <Link to="/users/new/manual" className="mb-6 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-5 py-4 text-sm hover:bg-brand-50">
          <History className="h-5 w-5 text-brand-600" aria-hidden="true" />
          <span className="flex-1 text-slate-700">You have an unfinished user{draft!.person.givenName ? ` (${`${draft!.person.givenName} ${draft!.person.familyName}`.trim()})` : ''}.</span>
          <span className="font-medium text-brand-700">Continue where you left off</span>
          <ArrowRight className="h-4 w-4 text-brand-600" aria-hidden="true" />
        </Link>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        {can('users.create') && <Link to="/users/new/manual"
          className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-card transition hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white"><UserPlus className="h-6 w-6" aria-hidden="true" /></span>
          <span className="mt-6 text-lg font-semibold text-slate-900">Add manually</span>
          <span className="mt-1 text-slate-500">Enter a person's details and add them to your organization.</span>
          <span className="mt-auto inline-flex items-center gap-1.5 pt-8 text-sm font-semibold text-brand-600 group-hover:gap-2.5 motion-reduce:transition-none">
            Start <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </Link>}
        <PlannedOption icon={<Search className="h-6 w-6" aria-hidden="true" />} title="Select existing"
          text="Find an existing identity and add them to your organization." />
        {can('users.import') && <Link to="/users/import"
          className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-card transition hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white"><FileSpreadsheet className="h-6 w-6" aria-hidden="true" /></span>
          <span className="mt-6 text-lg font-semibold text-slate-900">Import users</span>
          <span className="mt-1 text-slate-500">Add many people at once from a CSV file.</span>
          <span className="mt-auto inline-flex items-center gap-1.5 pt-8 text-sm font-semibold text-brand-600 group-hover:gap-2.5 motion-reduce:transition-none">
            Start <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </Link>}
      </div>
    </>
  );
}

function PlannedOption({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div aria-disabled="true" className="flex flex-col rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-8">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-200 text-slate-500">{icon}</span>
      <span className="mt-6 flex items-center gap-2 text-lg font-semibold text-slate-500">{title} <Badge tone="violet">Planned</Badge></span>
      <span className="mt-1 text-slate-500">{text}</span>
      <span className="mt-auto pt-8 text-sm text-slate-400">Coming soon.</span>
    </div>
  );
}
