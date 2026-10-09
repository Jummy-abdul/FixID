import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader, StatCard } from '@/components/ui';
import { ActivityStatusBadge, AssuranceBadge } from '@/components/domain/StatusBadges';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { PolicyFlow } from '@/components/domain/PolicyFlow';
import { TransactionsTable } from '@/components/domain/TransactionsTable';
import { PURPOSE_LABEL } from '@/domain/labels';
import { allowRate, formatPercent } from '@/domain/metrics';
import { formatDate, formatDateTime } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';
import { NotFoundPage } from './NotFoundPage';

export function ActivityDetailPage() {
  const { activityId } = useParams();
  const { activityById, transactions, credentialTypeById, memberById } = useOrgData();
  const activity = activityId ? activityById.get(activityId) : undefined;
  const tx = useMemo(() => transactions.filter((t) => t.activityId === activityId), [transactions, activityId]);
  if (!activity) return <NotFoundPage entity="verification activity" backTo="/activities" />;

  const fallbackCount = tx.filter((t) => t.fallbackUsed).length;
  const topReasons = Object.entries(
    tx.filter((t) => t.decision !== 'allow').reduce<Record<string, number>>((m, t) => { m[t.reason] = (m[t.reason] ?? 0) + 1; return m; }, {}),
  ).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const roster = activity.eligibility.rosterMemberIds;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Verification Events', to: '/activities' }, { label: activity.name }]}
        title={activity.name}
        description={activity.description}
        meta={<><ActivityStatusBadge status={activity.status} /><Badge>{PURPOSE_LABEL[activity.purpose]}</Badge><AssuranceBadge level={activity.assuranceLevel} /></>}
        actions={<PlannedButton icon={<Settings2 className="h-4 w-4" />} info={PLANNED.activityBuilder}>Edit configuration</PlannedButton>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Attempts (30 days)" value={tx.length} />
        <StatCard label="Allowed" value={formatPercent(allowRate(tx))} tone="emerald" />
        <StatCard label="Fallback used" value={fallbackCount} hint={tx.length ? `${formatPercent(fallbackCount / tx.length)} of attempts` : undefined} tone="amber" />
        <StatCard label="Last attempt" value={tx[0] ? formatDateTime(tx[0].occurredAt) : '—'} tone="violet" />
      </div>
      <Card className="mt-6">
        <CardHeader title="Trust policy" description="How a decision is reached at this activity" />
        <CardBody><PolicyFlow activity={activity} /></CardBody>
      </Card>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Configuration" />
          <CardBody>
            <DescriptionList items={[
              { label: 'Location', value: activity.location },
              { label: 'Schedule', value: activity.schedule.kind === 'always' ? 'Always on' : `${formatDate(activity.schedule.startsAt)} – ${formatDate(activity.schedule.endsAt)}` },
              { label: 'Accepted credentials', value: activity.eligibility.credentialTypeIds.map((id) => <Link key={id} to={`/credentials/configurations/${id}`} className="mr-2 text-brand-700 hover:underline">{credentialTypeById.get(id)?.name}</Link>) },
              { label: 'Relationships', value: activity.eligibility.relationships.join(', ') },
              { label: 'Roster', value: roster ? `${roster.length} people` : 'Not restricted', hint: roster ? roster.slice(0, 4).map((id) => memberById.get(id)?.displayName).join(', ') + (roster.length > 4 ? '…' : '') : undefined },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top reasons not allowed" description="Last 30 days" />
          <CardBody>
            {topReasons.length === 0 ? <p className="text-sm text-slate-500">No denied or indeterminate decisions.</p> : (
              <ul className="space-y-2">
                {topReasons.map(([reason, n]) => (
                  <li key={reason} className="flex items-center justify-between text-sm"><span className="text-slate-700">{reason}</span><span className="font-medium tabular-nums text-slate-900">{n}</span></li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Recent transactions"
          action={tx.length > 0 && <Link to={`/verification-history?activity=${activity.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View all {tx.length}</Link>} />
        <TransactionsTable rows={tx.slice(0, 12)} hide={['activity', 'id']} emptyTitle="No attempts yet"
          emptyDescription={activity.status === 'draft' ? 'This activity is still a draft and is not accepting verifications.' : undefined} />
      </Card>
    </>
  );
}
