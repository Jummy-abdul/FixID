import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CalendarRange, MapPin, Plus, ScanLine } from 'lucide-react';
import { Badge, Card, EmptyState, FilterSelect, PageHeader } from '@/components/ui';
import { ActivityStatusBadge, AssuranceBadge } from '@/components/domain/StatusBadges';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { PolicyFlow } from '@/components/domain/PolicyFlow';
import { useQueryState } from '@/hooks/useQueryState';
import { PURPOSE_LABEL } from '@/domain/labels';
import { allowRate, formatPercent, transactionsSince } from '@/domain/metrics';
import { addDays, formatDate, startOfDay } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

export function ActivitiesPage() {
  const { activities, transactions } = useOrgData();
  const [status, setStatus] = useQueryState('status', 'all');
  const now = useMemo(() => new Date(), []);
  const week = useMemo(() => transactionsSince(transactions, addDays(startOfDay(now), -6)), [transactions, now]);
  const shown = activities.filter((a) => status === 'all' || a.status === status);

  return (
    <>
      <PageHeader
        title="Activities"
        description="Verification activities define why, where and how people are verified, and what happens when they are. One engine, configured per purpose."
        actions={
          <>
            <PlannedButton icon={<ScanLine className="h-4 w-4" />} info={PLANNED.verifierSimulator}>Simulate verification</PlannedButton>
            <PlannedButton variant="primary" icon={<Plus className="h-4 w-4" />} info={PLANNED.activityBuilder}>New activity</PlannedButton>
          </>
        }
      />
      <div className="mb-4 flex items-center gap-3">
        <FilterSelect label="Status" value={status} onChange={setStatus}
          options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'draft', label: 'Draft' }, { value: 'completed', label: 'Completed' }]} />
        <span className="text-sm text-slate-500">{shown.length} of {activities.length} activities</span>
      </div>
      {shown.length === 0 ? (
        <Card><EmptyState icon={<Activity className="h-5 w-5" />} title="No activities match" description="Change the status filter to see other activities." /></Card>
      ) : (
        <div className="space-y-4">
          {shown.map((a) => {
            const tx = week.filter((t) => t.activityId === a.id);
            return (
              <Card key={a.id} className="transition hover:border-brand-300">
                <Link to={`/activities/${a.id}`} className="block p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-slate-900">{a.name}</h2>
                        <ActivityStatusBadge status={a.status} />
                        <Badge>{PURPOSE_LABEL[a.purpose]}</Badge>
                        <AssuranceBadge level={a.assuranceLevel} />
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{a.description}</p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{a.location}</span>
                        <span className="flex items-center gap-1"><CalendarRange className="h-3.5 w-3.5" />
                          {a.schedule.kind === 'always' ? 'Always on' : `${formatDate(a.schedule.startsAt)} – ${formatDate(a.schedule.endsAt)}`}
                        </span>
                      </p>
                    </div>
                    <div className="flex gap-6 text-right">
                      <div><p className="text-lg font-semibold tabular-nums text-slate-900">{tx.length}</p><p className="text-xs text-slate-500">attempts 7d</p></div>
                      <div><p className="text-lg font-semibold tabular-nums text-slate-900">{formatPercent(allowRate(tx))}</p><p className="text-xs text-slate-500">allowed</p></div>
                    </div>
                  </div>
                  <div className="mt-4"><PolicyFlow activity={a} /></div>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
