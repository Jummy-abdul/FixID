import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Check, ScrollText } from 'lucide-react';
import { Button, ButtonLink, Card, CardHeader, PageHeader } from '@/components/ui';
import { getSetupProgress, isConfiguredActivity, type SetupMilestoneId } from '@/domain/setupProgress';
import { formatRelative } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { IdentityIllustration } from './IdentityIllustration';
import type { DashboardData } from './preview';

const MILESTONES: Record<SetupMilestoneId, { title: string; description: string }> = {
  'first-id': {
    title: 'Add your first user and issue an ID',
    description: 'Add a person, configure your first credential and issue their digital ID.',
  },
  'first-verification': {
    title: 'Set up your first verification activity',
    description: 'Define how and where issued credentials can be verified.',
  },
};

const WELCOME: Record<SetupMilestoneId, { heading: (name: string) => string; message: string }> = {
  'first-id': {
    heading: (name) => `Welcome to FixID, ${name}.`,
    message: "Let's get your organization ready to issue its first digital ID.",
  },
  'first-verification': {
    heading: () => 'Your first digital ID is live.',
    message: 'Next, decide where and how your credentials can be verified.',
  },
};

export function FirstTimeDashboard({ data, adminName, headerActions }: { data: DashboardData; adminName: string; headerActions?: ReactNode }) {
  const progress = getSetupProgress(data);
  const welcome = WELCOME[progress.next ?? 'first-verification'];
  const firstName = adminName.split(' ')[0];

  const metrics = [
    { label: 'Users', value: data.members.length, to: '/users' },
    { label: 'Active credentials', value: data.credentials.filter((c) => c.status === 'active').length, to: '/credentials' },
    { label: 'Verification activities', value: data.activities.filter(isConfiguredActivity).length, to: '/activities' },
    { label: 'Verifications', value: data.transactions.length, to: '/verification-history' },
  ];

  return (
    <>
      <PageHeader title="Dashboard" actions={headerActions} />

      <section aria-labelledby="welcome-heading" className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-brand-50/70 shadow-card">
        <div className="grid items-center gap-6 px-6 pt-8 sm:px-10 lg:grid-cols-12 lg:gap-10 lg:px-14 lg:pt-12">
          <div className="lg:col-span-7 lg:pb-10">
            <h2 id="welcome-heading" className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
              {welcome.heading(firstName)}
            </h2>
            <p className="mt-4 max-w-xl text-lg text-slate-600">{welcome.message}</p>
          </div>
          <div className="mx-auto w-full max-w-md lg:col-span-5 lg:max-w-none">
            <IdentityIllustration />
          </div>
        </div>

        <div className="border-t border-slate-200/80 bg-white/80 px-6 py-6 sm:px-10 lg:px-14">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-slate-900">Your setup</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">{progress.completed} of {progress.total} complete</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Setup progress"
                aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}>
                <div className="h-full rounded-full bg-brand-600 transition-all motion-reduce:transition-none" style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
              </div>
            </div>
          </div>
          <ol className="grid gap-3 md:grid-cols-2 md:gap-6">
            {progress.milestones.map((m, i) => {
              const isNext = progress.next === m.id;
              const info = MILESTONES[m.id];
              return (
                <li key={m.id} aria-current={isNext ? 'step' : undefined}
                  className={cn('relative flex gap-4 rounded-2xl border p-4 transition-colors',
                    isNext ? 'border-brand-200 bg-brand-50/60' : 'border-transparent')}>
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    m.done ? 'bg-emerald-500 text-white' : isNext ? 'bg-brand-600 text-white ring-4 ring-brand-100' : 'bg-slate-100 text-slate-500')}>
                    {m.done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {info.title}
                      {isNext && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">Next</span>}
                      {m.done && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Done</span>}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">{info.description}</p>
                    {m.id === 'first-id' && !m.done && progress.firstUserCreated && (
                      <ul className="mt-3 space-y-1 text-sm" aria-label="First milestone progress">
                        <li className="flex items-center gap-2 text-slate-700"><Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />First user added</li>
                        <li className="flex items-center gap-2 text-slate-500"><span className="h-4 w-4 rounded-full border-2 border-slate-300" aria-hidden="true" />First digital ID issued</li>
                      </ul>
                    )}
                    {!m.done && <MilestoneAction id={m.id} available={m.id === 'first-id' || progress.milestones[0].done}
                      resumeMemberId={m.id === 'first-id' && progress.firstUserCreated
                        ? data.members.find((u) => !data.credentials.some((c) => c.memberId === u.id))?.id
                        : undefined} />}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section aria-label="Overview" className="mt-10">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {metrics.map((mt) => (
            <Link key={mt.label} to={mt.to}
              className="group rounded-xl border border-slate-200 bg-white px-5 py-4 transition hover:border-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <p className="text-sm text-slate-500">{mt.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{mt.value}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Verification decisions" />
          <EmptyPanel icon={<BarChart3 className="h-6 w-6" />} title="No verifications yet"
            message="Once a verification activity is live, allowed and denied decisions will be charted here." />
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          {data.audit.length === 0 ? (
            <EmptyPanel icon={<ScrollText className="h-6 w-6" />} title="Nothing recorded yet"
              message="Adding users, issuing IDs and configuration changes will be recorded here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.audit.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <Link to={e.href ?? '/audit'} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                    <span className="min-w-0 flex-1 text-sm text-slate-800">{e.summary}</span>
                    <span className="shrink-0 text-xs text-slate-500">{formatRelative(e.occurredAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function MilestoneAction({ id, available, resumeMemberId }: { id: SetupMilestoneId; available: boolean; resumeMemberId?: string }) {
  if (id === 'first-id' && resumeMemberId) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ButtonLink to={`/users/${resumeMemberId}/issue`} variant="primary" size="sm" icon={null}>
          Issue digital ID <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </ButtonLink>
        <ButtonLink to="/users/new" variant="ghost" size="sm">Add another user</ButtonLink>
      </div>
    );
  }
  if (id === 'first-id') {
    return (
      <ButtonLink to="/users/new" variant="primary" size="sm" className="mt-4" icon={null}>
        Get started <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </ButtonLink>
    );
  }
  if (available) {
    return <ButtonLink to="/activities" variant="secondary" size="sm" className="mt-4">Set up verification</ButtonLink>;
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" disabled aria-describedby="verification-locked">Set up verification</Button>
      <span id="verification-locked" className="text-xs text-slate-400">Available after your first digital ID is issued</span>
    </div>
  );
}

function EmptyPanel({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">{icon}</span>
      <p className="mt-4 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500">{message}</p>
    </div>
  );
}
