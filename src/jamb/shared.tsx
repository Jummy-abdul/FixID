import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, StatCard } from '@/components/ui';
import { dateTime } from './format';
import { formatDate } from '@/lib/dates';
import { institutionByCode, type VerificationEventDef } from './data';
import { OUTCOME_LABEL, outcomeTone, recordOf, useJambState, type Activity, type Counts } from './store';
import { ProgressMeter, SERIES, fmt } from './ui';

export function EventStatusBadge({ status }: { status: VerificationEventDef['status'] }) {
  return status === 'active' ? <Badge tone="success" dot>Active</Badge> : status === 'expired' ? <Badge tone="neutral" dot>Expired</Badge> : <Badge tone="warning" dot>Draft</Badge>;
}
export const eventPeriod = (e: VerificationEventDef) => (e.endsAt ? `${formatDate(e.startsAt)} – ${formatDate(e.endsAt)}` : `From ${formatDate(e.startsAt)} · continuous`);

export function OutcomeBadge({ outcome }: { outcome: Activity['outcome'] }) {
  const t = outcomeTone(outcome);
  return <Badge tone={t === 'success' ? 'success' : t === 'danger' ? 'danger' : t === 'warning' ? 'warning' : 'neutral'}>{OUTCOME_LABEL[outcome]}</Badge>;
}

/** A session's figures: shared by JAMB and the university. */
export function SessionStats({ c, compact }: { c: Counts; compact?: boolean }) {
  return (
    <>
      <section aria-label="Session summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Assigned by JAMB" value={fmt(c.admitted)} />
        <StatCard label="Cleared" value={fmt(c.cleared)} tone="emerald" />
        <StatCard label="Pending clearance" value={fmt(c.pending)} tone="amber" />
        <StatCard label="Failed verification" value={fmt(c.failed)} />
        <StatCard label="Exceptions" value={fmt(c.exceptions)} />
        <StatCard label="Identity verified" value={fmt(c.verified)} tone="violet" />
      </section>
      {!compact && (
        <Card className="px-5 py-4">
          <div className="grid gap-4 md:grid-cols-2">
            <ProgressMeter label="Identity verification" value={c.verified} total={c.admitted} color={SERIES.s2} />
            <ProgressMeter label="Clearance progress" value={c.cleared} total={c.admitted} />
          </div>
        </Card>
      )}
    </>
  );
}

/** Recent verification activities: who, where, which officer, when and the outcome. */
export function ActivityList({ activities, studentPath, label = 'Recent verification activities', showOrganisation = true, showOfficer = true }: { activities: Activity[]; studentPath?: (reg: string) => string; label?: string; showOrganisation?: boolean; showOfficer?: boolean }) {
  const state = useJambState();
  return (
    <ul className="divide-y divide-slate-100" aria-label={label}>
      {activities.map((a) => {
        const r = a.reg ? recordOf(a.reg, state) : undefined;
        return (
          <li key={`${a.ref}-${a.outcome}`} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">
              {r ? (studentPath ? <Link to={studentPath(r.reg)} className="font-medium text-slate-900 hover:text-brand-700">{r.firstName} {r.lastName}</Link> : <span className="font-medium text-slate-900">{r.firstName} {r.lastName}</span>) : <span className="font-mono text-slate-700">{a.input || '—'}</span>}
              <span className="text-slate-500"> · {showOrganisation ? `${a.institution ? institutionByCode(a.institution)?.shortName : 'NYSC'} · ` : ''}{showOfficer ? a.officer : <span className="font-mono text-xs">{a.reg ?? a.input}</span>}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2"><OutcomeBadge outcome={a.outcome} /><span className="whitespace-nowrap text-xs text-slate-500">{dateTime(a.at)}</span></span>
          </li>
        );
      })}
    </ul>
  );
}

export function NotFound({ what, back }: { what: string; back: string }) {
  return (
    <Card className="px-6 py-10 text-center">
      <h1 className="text-lg font-semibold text-slate-900">{what} not available</h1>
      <p className="mt-1 text-slate-500">It doesn’t exist, or it isn’t within your access.</p>
      <Link to={back} className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Go back</Link>
    </Card>
  );
}

export function Section({ title, action, children, description }: { title: string; action?: ReactNode; description?: string; children: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div><h2 className="text-base font-semibold text-slate-900">{title}</h2>{description && <p className="text-sm text-slate-500">{description}</p>}</div>
        {action}
      </div>
      {children}
    </Card>
  );
}
