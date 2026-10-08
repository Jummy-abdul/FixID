import { ArrowLeft, Search, Link2, BadgeCheck, CreditCard } from 'lucide-react';
import { Badge, ButtonLink, Card, PageHeader } from '@/components/ui';

const STEPS = [
  { icon: Search, title: 'Find the person', text: 'Search ID Switch for an existing identity.' },
  { icon: Link2, title: 'Link or create their identity', text: 'Reuse what exists; collect only what your organization needs.' },
  { icon: CreditCard, title: 'Configure your first credential', text: 'Only needed once. Later users reuse it.' },
  { icon: BadgeCheck, title: 'Issue their digital ID', text: 'Delivered to the holder through Seamfix Wallet.' },
];

/**
 * Temporary entry point for the guided Add User journey (next milestone).
 * Nothing on this page creates or changes data.
 */
export function AddUserEntryPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users', to: '/users' }, { label: 'Add user' }]}
        title="Add your first user"
        meta={<Badge tone="violet">Coming next</Badge>}
      />
      <Card className="p-8 sm:p-10">
        <p className="max-w-2xl text-slate-600">
          This guided journey is being designed and isn't available in the prototype yet. Here's what it will cover. Nothing has been created.
        </p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-slate-200 p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><s.icon className="h-5 w-5" aria-hidden="true" /></span>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Step {i + 1}</p>
              <p className="mt-1 font-semibold text-slate-900">{s.title}</p>
              <p className="mt-1 text-sm text-slate-500">{s.text}</p>
            </li>
          ))}
        </ol>
        <ButtonLink to="/" className="mt-8" icon={<ArrowLeft className="h-4 w-4" />}>Back to dashboard</ButtonLink>
      </Card>
    </>
  );
}
