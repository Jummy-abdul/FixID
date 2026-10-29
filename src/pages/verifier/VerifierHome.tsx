import { DecisionBadge } from '@/components/verification/transactionParts';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Fingerprint, MapPin, Play, ScanFace, ShieldOff } from 'lucide-react';
import { Badge, Button, ButtonLink, Card, DataTable, EmptyState, FilterSelect, Pagination, SearchInput, Skeleton, usePageSlice } from '@/components/ui';
import { sourceName } from '@/components/verification/transactionParts';
import type { ActivityConfig } from '@/domain/types';
import { DisplayStatusBadge } from '@/components/verification/parts';
import { ELIGIBILITY_OUTCOME_LABEL, ELIGIBILITY_OUTCOME_TONE, displayStatus, eligibilityOutcome } from '@/domain/activityLifecycle';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { HistoryRow, OUTCOME_TONE, progressLine, useActivityProgress, useSubjectOf, useVerifierActivity, verifierOutcome } from './verifierParts';
import { useAuthorization } from '@/auth/authorization';
import { EntryBadge } from '@/components/verification/attemptParts';
import { useSession, useStore } from '@/store/AppStore';
import { useVerificationService } from '@/verification/useVerificationService';
import { formatDateTime } from '@/lib/dates';
import { AttemptBadge } from '@/components/verification/attemptParts';

const GROUPS: { id: 'active' | 'scheduled' | 'paused' | 'completed'; label: string; empty: string }[] = [
  { id: 'active', label: 'Active', empty: '' },
  { id: 'scheduled', label: 'Upcoming', empty: '' },
  { id: 'paused', label: 'Paused', empty: '' },
  { id: 'completed', label: 'Completed', empty: '' },
];

/**
 * My Verification Activities: every activity the verifier is assigned to, grouped by status. Only Active ones
 * can be started; upcoming, paused and completed ones can still be opened.
 */
export function VerifierHome() {
  const { organization } = useSession();
  const { state } = useStore();
  const { record, readOnly, can } = useAuthorization();
  const service = useVerificationService();
  const navigate = useNavigate();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 200); return () => clearTimeout(t); }, []);
  // What the (possibly previewed) role allows; starting a verification is still checked by the service.
  const canExecute = can('verification.execute');
  const assigned = useMemo(() => service.listAssignedActivities(organization.id), [service, organization.id, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = q.trim().toLowerCase();
  const shown = assigned.filter(({ activity }) => (status === 'all' || displayStatus(activity) === status)
    && (!query || `${activity.name} ${activity.description} ${activity.location ?? ''}`.toLowerCase().includes(query)));
  const recent = state.data.verificationAttempts.filter((a) => a.organizationId === organization.id && a.verifierId === record?.id).slice(0, 8);

  const start = (activityId: string) => {
    setError(null);
    const r = service.startAttempt(organization.id, activityId);
    if (!r.ok) return setError(r.error);
    navigate(`/verify/attempts/${r.attempt.id}`);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Verification Activities</h1>
      <p className="mt-1 text-slate-500">Activities you’re assigned to verify for {organization.name}.</p>

      {readOnly && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">Role preview is read-only, so verifications can’t be performed. Exit the preview to verify.</p>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}

      <div className="mt-6">
        {!canExecute ? <NoExecute />
          : loading ? (
            <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading activities">{[0, 1].map((i) => <Skeleton key={i} className="h-44 w-full" />)}</div>
          ) : assigned.length === 0 ? (
            <Card><EmptyState icon={<ScanFace className="h-5 w-5" />} title="No verification activities assigned to you."
              description="No verification activities are available to you right now. When an administrator assigns you to an activity, it appears here." /></Card>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <SearchInput value={q} onChange={setQ} placeholder="Search activities" label="Search activities" className="sm:w-72" />
                <FilterSelect label="Status" value={status} onChange={setStatus}
                  options={[{ value: 'all', label: 'All statuses' }, ...GROUPS.map((g) => ({ value: g.id, label: g.label }))]} />
              </div>
              {shown.length === 0 && (
                <Card><EmptyState title="No activities match" description="Try a different search or status."
                  action={<Button variant="secondary" onClick={() => { setQ(''); }}>Clear search</Button>} /></Card>
              )}
              {GROUPS.map((g) => {
                const items = shown.filter(({ activity }) => displayStatus(activity) === g.id);
                if (!items.length) return null;
                return (
                  <section key={g.id} aria-labelledby={`group-${g.id}`}>
                    <h2 id={`group-${g.id}`} className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">{g.label}<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{items.length}</span></h2>
                    <ul className="grid gap-4 md:grid-cols-2" aria-label={g.id === 'active' ? 'Your verification activities' : `${g.label} activities`}>
                      {items.map(({ activity, runnable }) => <ActivityCard key={activity.id} activity={activity} canStart={runnable && !readOnly} onStart={() => start(activity.id)} />)}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
      </div>

      {recent.length > 0 && (
        <section className="mt-10" aria-labelledby="recent">
          <h2 id="recent" className="flex items-center justify-between text-sm font-semibold text-slate-900">Your recent verifications<Link to="/verify/history" className="font-medium text-brand-600 hover:text-brand-700">View all</Link></h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {recent.map((a) => <HistoryRow key={a.id} attempt={a} showActivity />)}
          </ul>
        </section>
      )}
    </>
  );
}

function ActivityCard({ activity, canStart, onStart }: { activity: ActivityConfig; canStart: boolean; onStart: () => void }) {
  const v = useVerifierActivity(activity);
  return (
    <li>
      <Card className="flex h-full flex-col p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-900">{activity.name}</h3>
          <DisplayStatusBadge activity={activity} />
        </div>
        {(activity.description || activity.purpose) && <p className="mt-1 text-sm text-slate-500">{activity.description || activity.purpose}</p>}
        <dl className="mt-3 space-y-1 text-sm text-slate-600">
          {v.schedule && <div className="flex items-start gap-1.5"><dt><CalendarClock className="mt-0.5 h-4 w-4 text-slate-400" aria-label="Schedule" /></dt><dd>{v.schedule}</dd></div>}
          {v.place && <div className="flex items-start gap-1.5"><dt><MapPin className="mt-0.5 h-4 w-4 text-slate-400" aria-label="Location" /></dt><dd>{v.place}</dd></div>}
          <div className="flex items-start gap-1.5"><dt><Fingerprint className="mt-0.5 h-4 w-4 text-slate-400" aria-label="Identity source" /></dt><dd>{v.source}{v.owner ? ` · from ${v.owner}` : ''}</dd></div>
        </dl>
        <p className="mt-3 flex-1 text-sm font-medium text-slate-800" aria-label="Progress">{progressLine(v)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {canStart && <Button icon={<Play className="h-4 w-4" />} onClick={onStart} aria-label={`Start verification: ${activity.name}`}>Start verification</Button>}
          <ButtonLink to={`/verify/activities/${activity.id}`} variant="secondary" aria-label={`Open activity: ${activity.name}`}>Open activity</ButtonLink>
        </div>
      </Card>
    </li>
  );
}

/** Shown to a role without verification.execute. Each administrator has one role, so access is changed by an Organization Admin. */
function NoExecute() {
  return (
    <Card>
      <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Your role doesn’t include performing verifications"
        description="Ask an administrator to change your role." />
    </Card>
  );
}

/**
 * My Verification History: the verifications this administrator performed, and nobody else's. Filterable by
 * activity (`?activity=`) and outcome. Identifiers are masked; no images or biometric data are shown.
 */
export function VerifierHistoryPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { record } = useAuthorization();
  const subjectOf = useSubjectOf();
  const [activityId, setActivityId] = useQueryState('activity', 'all');
  const [outcome, setOutcome] = useQueryState('outcome', 'all');
  const [q, setQ] = useQueryState('q');
  const [page, setPage] = usePageParam();
  const mine = state.data.verificationAttempts
    .filter((a) => a.organizationId === organization.id && !!record && a.verifierId === record.id && a.status !== 'in-progress')
    .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt));
  const activities = [...new Map(mine.map((a) => [a.activityId, a.activityName])).entries()];
  const query = q.trim().toLowerCase();
  const rows = mine.filter((a) => (activityId === 'all' || a.activityId === activityId) && (outcome === 'all' || verifierOutcome(a).key === outcome)
    && (!query || `${subjectOf(a).name} ${a.activityName}`.toLowerCase().includes(query)));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 15);
  const activityName = activityId !== 'all' ? activities.find(([id]) => id === activityId)?.[1] : undefined;
  return (
    <>
      {activityName && <Link to={`/verify/activities/${activityId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{activityName}</Link>}
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Verification History</h1>
      <p className="mt-1 text-slate-500">Verifications you performed{activityName ? ` for ${activityName}` : ''}. Identifiers are masked, and no images or biometric data are kept.</p>
      <div className="mt-6">
        {mine.length === 0 ? (
          <Card><EmptyState icon={<ScanFace className="h-5 w-5" />} title="No verifications yet" description="Verifications you perform appear here." /></Card>
        ) : (
          <Card>
            <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
              <SearchInput value={q} onChange={setQ} placeholder="Search by name or activity" label="Search verifications" className="sm:w-64" />
              <FilterSelect label="Activity" value={activityId} onChange={setActivityId} options={[{ value: 'all', label: 'All activities' }, ...activities.map(([value, label]) => ({ value, label }))]} />
              <FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={[{ value: 'all', label: 'All outcomes' }, ...OUTCOME_FILTERS]} />
            </div>
            <DataTable
              rows={pageRows}
              rowKey={(a) => a.id}
              rowHref={(a) => `/verify/attempts/${a.id}`}
              empty={<EmptyState title="No verifications match" description="Try a different search or filter." />}
              columns={[
                { key: 'who', header: 'Person', className: '!whitespace-normal min-w-[9rem]', cell: (a) => { const w = subjectOf(a); return <span><span className="block font-medium text-slate-900">{w.name}</span><span className="font-mono text-xs text-slate-500">{w.identifier}</span></span>; } },
                { key: 'activity', header: 'Activity', className: '!whitespace-normal min-w-[8rem]', cell: (a) => <span className="text-slate-700">{a.activityName}</span> },
                { key: 'at', header: 'Date and time', cell: (a) => <span className="text-slate-600">{formatDateTime(a.completedAt ?? a.startedAt)}</span> },
                { key: 'source', header: 'Identity source', className: '!whitespace-normal min-w-[8rem]', cell: (a) => <span className="text-slate-600">{sourceName(a)}</span> },
                { key: 'outcome', header: 'Verification', cell: (a) => { const o = verifierOutcome(a); return <Badge tone={OUTCOME_TONE[o.key]}>{o.title}</Badge>; } },
                { key: 'eligibility', header: 'Eligibility', cell: (a) => { const e = eligibilityOutcome(a); return <Badge tone={ELIGIBILITY_OUTCOME_TONE[e]}>{ELIGIBILITY_OUTCOME_LABEL[e]}</Badge>; } },
                { key: 'response', header: 'System response', className: '!whitespace-normal min-w-[14rem]', cell: (a) => <span className="text-xs text-slate-600">{verifierOutcome(a).explanation}</span> },
              ]}
            />
            <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={15} onPage={setPage} />
          </Card>
        )}
      </div>
    </>
  );
}

const OUTCOME_FILTERS = [
  { value: 'verified', label: 'Verified' }, { value: 'verified-not-eligible', label: 'Identity verified, not eligible' }, { value: 'not-eligible', label: 'Not eligible' },
  { value: 'unsuccessful', label: 'Unsuccessful' }, { value: 'pending', label: 'Pending' }, { value: 'unable', label: 'Unable to complete' }, { value: 'cancelled', label: 'Cancelled' },
];

/** The dashboard for a role whose only job is verifying: their assignments and their recent work. */
export function VerifierDashboard() {
  const { organization, admin } = useSession();
  const { state } = useStore();
  const { record } = useAuthorization();
  const service = useVerificationService();
  const assigned = useMemo(() => service.listAuthorizedActivities(organization.id), [service, organization.id, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = state.data.verificationAttempts.filter((a) => a.organizationId === organization.id && !!record && a.verifierId === record.id);
  const today = new Date().toISOString().slice(0, 10);
  const todays = mine.filter((a) => (a.completedAt ?? a.startedAt).slice(0, 10) === today);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Dashboard</h1>
      <p className="mt-1 text-slate-500">Welcome, {admin.name.split(' ')[0]}. Your verification work for {organization.name}.</p>
      <section aria-label="Your verification summary" className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5"><p className="text-sm text-slate-500">Assigned activities</p><p className="mt-1 text-2xl font-semibold text-slate-900">{assigned.length}</p></Card>
        <Card className="p-5"><p className="text-sm text-slate-500">Verifications today</p><p className="mt-1 text-2xl font-semibold text-slate-900">{todays.filter((a) => a.status === 'completed').length}</p></Card>
        <Card className="p-5"><p className="text-sm text-slate-500">Verified today</p><p className="mt-1 text-2xl font-semibold text-slate-900">{todays.filter((a) => a.status === 'completed' && (a.reviewDisposition?.decision ?? a.decision) === 'allow').length}</p></Card>
      </section>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/verify" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"><Play className="h-4 w-4" aria-hidden="true" />My Verification Activities</Link>
        <Link to="/verify/history" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">My Verification History</Link>
      </div>
      {assigned.length === 0 ? (
        <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          No activities assigned to you yet.
        </p>
      ) : (
        <section className="mt-8" aria-labelledby="assigned-heading">
          <h2 id="assigned-heading" className="text-sm font-semibold text-slate-900">Your active activities</h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" aria-label="Your active activities">
            {assigned.map(({ activity }) => <AssignedRow key={activity.id} activity={activity} />)}
          </ul>
        </section>
      )}
      {mine.length > 0 && (
        <section className="mt-8" aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="flex items-center justify-between text-sm font-semibold text-slate-900">Recent verifications<Link to="/verify/history" className="font-medium text-brand-600 hover:text-brand-700">View all</Link></h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" aria-label="Recent verifications">
            {mine.slice(0, 5).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{a.subject?.label ?? a.activityName}</span>
                  <span className="block text-xs text-slate-500">{a.activityName} · {formatDateTime(a.completedAt ?? a.startedAt)}</span>
                </span>
                <AttemptBadge attempt={a} />
                {a.decision && <DecisionBadge decision={a.reviewDisposition?.decision ?? a.decision} />}
                {a.entry && <EntryBadge attempt={a} />}
                <Link to={`/verify/attempts/${a.id}`} className="font-medium text-brand-600 hover:text-brand-700">View<span className="sr-only"> {a.id}</span></Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function AssignedRow({ activity }: { activity: ActivityConfig }) {
  const progress = useActivityProgress(activity);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">
        <Link to={`/verify/activities/${activity.id}`} className="block font-medium text-slate-900 hover:text-brand-700">{activity.name}</Link>
        <span className="block text-xs text-slate-500">{useProgressLine(activity, progress)}</span>
      </span>
    </li>
  );
}

/**
 * One short line for an assigned activity: progress against its list of people when it has one, and who
 * shared it when it comes from another organization. Nothing for an open activity with no list.
 */
function useProgressLine(activity: ActivityConfig, progress: ReturnType<typeof useActivityProgress>): string {
  const { state } = useStore();
  const { organization } = useSession();
  const hasList = !!(activity.participants?.groupIds.length || activity.participants?.memberIds.length);
  const parts = [
    ...(activity.organizationId !== organization.id ? [`From ${state.data.organizations.find((o) => o.id === activity.organizationId)?.name ?? 'another organization'}`] : []),
    ...(hasList ? [`${progress.verified} of ${progress.eligible} verified`] : []),
    ...(activity.entryPolicy && activity.entryPolicy !== 'off' ? [`${progress.granted} entered`] : []),
  ];
  return parts.join(' · ');
}
