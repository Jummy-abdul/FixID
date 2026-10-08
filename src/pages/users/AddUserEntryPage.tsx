import { Link } from 'react-router-dom';
import { ArrowRight, FileSpreadsheet, History, UserPlus } from 'lucide-react';
import { Badge, PageHeader } from '@/components/ui';
import { useOrgData } from '@/store/AppStore';
import { hasProgress, loadDraft } from './add/draft';

/** Entry point for adding users, from the dashboard or the Users module. */
export function AddUserEntryPage() {
  const { organization, members } = useOrgData();
  const draft = loadDraft(organization.id);
  const first = members.length === 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users', to: '/users' }, { label: 'Add user' }]}
        title={first ? 'Add your first user' : 'Add users'}
        description="Choose how you'd like to add users to your organization."
      />
      {hasProgress(draft) && (
        <Link to="/users/new/manual" className="mb-6 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-5 py-4 text-sm hover:bg-brand-50">
          <History className="h-5 w-5 text-brand-600" aria-hidden="true" />
          <span className="flex-1 text-slate-700">You have an unfinished user{draft!.person.givenName ? ` (${draft!.person.givenName} ${draft!.person.familyName})`.trimEnd() : ''}.</span>
          <span className="font-medium text-brand-700">Continue where you left off</span>
          <ArrowRight className="h-4 w-4 text-brand-600" aria-hidden="true" />
        </Link>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Link to="/users/new/manual"
          className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-card transition hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white"><UserPlus className="h-6 w-6" aria-hidden="true" /></span>
          <span className="mt-6 text-lg font-semibold text-slate-900">Add manually</span>
          <span className="mt-1 text-slate-500">Add one person and issue their digital ID.</span>
          <span className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 group-hover:gap-2.5 motion-reduce:transition-none">
            Start <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </Link>
        <div aria-disabled="true" className="flex flex-col rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-200 text-slate-500"><FileSpreadsheet className="h-6 w-6" aria-hidden="true" /></span>
          <span className="mt-6 flex items-center gap-2 text-lg font-semibold text-slate-500">Bulk upload <Badge tone="violet">Coming soon</Badge></span>
          <span className="mt-1 text-slate-500">Import multiple users using a file.</span>
          <span className="mt-8 text-sm text-slate-400">Not available in this prototype yet.</span>
        </div>
      </div>
    </>
  );
}
