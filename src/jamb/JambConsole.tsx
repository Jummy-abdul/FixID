import { useMemo } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, BarChart3, Building2, CalendarCheck, CheckCircle2, CircleDashed, History, Home, Printer, ScrollText, Search, Settings, ShieldAlert, UserCog, XCircle,
} from 'lucide-react';
import { Badge, Button, Card, DataTable, DescriptionList, EmptyState, FilterSelect, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { dateTime } from './format';
import type { NavGroup } from '@/layout/navigation';
import { useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import {
  ACTIVE_ADMISSION_EVENT, ACTIVE_SESSION, EVENTS, INSTITUTIONS, NYSC_EVENT_ID, ONBOARDING_INSTITUTIONS, SESSIONS, eventById, eventForSession, institutionByCode, officersOf, sessionSlug,
  type Institution, type Session,
} from './data';
import { CertificatePage } from './certificate';
import { EscalationDetailPage, EscalationsPage } from './escalations';
import { ActivityPage, AuditPage, ExceptionDetailPage, ExceptionsPage, JambStudentPage, SettingsPage, StudentSearchPage, UsersPage } from './jambAdmin';
import {
  NYSC_OFFICERS, allActivities, countsOf, eventSummary, exceptionsOf, institutionActivities, institutionCounts, isOpenException, nationalCounts, sessionTotals, useJambState, type Counts,
} from './store';
import { ActivityList, EventStatusBadge, NotFound, Section, SessionStats, eventPeriod } from './shared';
import { StudentTable } from './students';
import { NyscReportPage } from './NyscConsole';
import { ConsoleLayout, Distribution, Legend, OrgMark, ProgressMeter, SERIES, STATUS, StackedBars, fmt, pct } from './ui';
import { CATEGORY_LABEL } from './store';
import { ExceptionStatusBadge } from '@/pages/exceptions/ExceptionsPage';


export const JAMB_NAV: NavGroup[] = [
  { label: null, items: [{ label: 'Home', to: '/jamb', end: true, icon: Home, description: 'Overview' }] },
  {
    label: 'Verification',
    items: [
      { label: 'Verification Events', to: '/jamb/events', icon: CalendarCheck, description: 'Events published to institutions and NYSC' },
      { label: 'Verification Activity', to: '/jamb/activity', icon: History, description: 'Every verification performed' },
      { label: 'Exceptions & Escalations', to: '/jamb/escalations', icon: ShieldAlert, description: 'Identity exceptions and institutions’ escalations', alsoActiveOn: ['/jamb/exceptions'] },
      { label: 'Student Records', to: '/jamb/students', icon: Search, description: 'Search student identity records' },
    ],
  },
  {
    label: 'Institutions',
    items: [
      { label: 'Institutions', to: '/jamb/institutions', icon: Building2, description: 'Participating institutions' },
      { label: 'Reports', to: '/jamb/reports', icon: BarChart3, description: 'Institution and session reports' },
    ],
  },
  { label: 'Users & Access', items: [{ label: 'Users & Access', to: '/jamb/users', icon: UserCog, description: 'Delegated users and roles' }] },
  {
    label: 'Administration',
    items: [
      { label: 'Audit Logs', to: '/jamb/audit', icon: ScrollText, description: 'Every recorded action' },
      { label: 'Settings', to: '/jamb/settings', icon: Settings, description: 'Platform settings' },
    ],
  },
];

/** The JAMB Officer's workspace: central oversight of events, institutions, exceptions and identity records. */
export function JambConsole() {
  return (
    <ConsoleLayout nav={JAMB_NAV} organisation={{ name: 'Joint Admissions and Matriculation Board', role: 'Central Administrator' }} mark={<OrgMark letters="JAMB" tone="green" />}>
      <Routes>
        <Route index element={<JambHome />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:eventId" element={<EventPage />} />
        <Route path="events/:eventId/institutions/:code" element={<InstitutionEventPage via="events" />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="escalations" element={<EscalationsPage />} />
        <Route path="escalations/:id" element={<EscalationDetailPage />} />
        <Route path="exceptions" element={<ExceptionsPage />} />
        <Route path="exceptions/:id" element={<ExceptionDetailPage />} />
        <Route path="students" element={<StudentSearchPage />} />
        <Route path="students/:reg" element={<JambStudentPage />} />
        <Route path="institutions" element={<InstitutionsPage />} />
        <Route path="institutions/:code" element={<InstitutionPage />} />
        <Route path="institutions/:code/events/:eventId" element={<InstitutionEventPage via="institutions" />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="certificate/:reg" element={<CertificatePage backTo={(reg) => `/jamb/students/${reg}`} />} />
        <Route path="nysc-report/:ref" element={<NyscReportPage backTo={(reg) => `/jamb/students/${reg}`} />} />
        <Route path="*" element={<Navigate to="/jamb" replace />} />
      </Routes>
    </ConsoleLayout>
  );
}

/* ---------------- Home ---------------- */

function JambHome() {
  const state = useJambState();
  const navigate = useNavigate();
  const n = nationalCounts(state);
  const exceptions = exceptionsOf(state);
  const open = exceptions.filter(isOpenException);
  const openEscalations = open.filter((e) => e.escalation).length;
  const active = sessionTotals(ACTIVE_SESSION, state);
  const nysc = eventSummary(NYSC_EVENT_ID, state);
  const perf = INSTITUTIONS.map((i) => ({ inst: i, c: countsOf(i.code, ACTIVE_SESSION, state) })).sort((a, b) => b.c.admitted - a.c.admitted).slice(0, 10);
  const recent = allActivities(state).slice(0, 8);
  return (
    <>
      <PageHeader title="Home" description="Identity verification and admission clearance across participating institutions." />
      <section aria-label="Key statistics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Participating institutions" value={INSTITUTIONS.length} to="/jamb/institutions" />
        <StatCard label="Students admitted by JAMB" value={fmt(n.admitted)} />
        <StatCard label="Identity verification completed" value={fmt(n.verified)} tone="violet" />
        <StatCard label="Students cleared" value={fmt(n.cleared)} tone="emerald" to="/jamb/reports" />
        <StatCard label="Pending clearance" value={fmt(n.pending)} tone="amber" />
        <StatCard label="Failed identity verifications" value={fmt(n.failed)} to="/jamb/activity?outcome=face-mismatch" />
        <StatCard label="Open identity exceptions" value={fmt(open.length)} to="/jamb/exceptions" />
        <StatCard label="Open escalations" value={fmt(openEscalations)} to="/jamb/escalations" />
      </section>

      <section aria-label="Active events" className="grid gap-4 lg:grid-cols-2">
        <Link to={`/jamb/events/${ACTIVE_ADMISSION_EVENT.id}`} className="block rounded-xl border border-slate-200 bg-white p-5 shadow-card hover:border-brand-300">
          <div className="flex items-center justify-between gap-2"><p className="font-semibold text-slate-900">{ACTIVE_ADMISSION_EVENT.name}</p><EventStatusBadge status="active" /></div>
          <p className="mt-0.5 text-xs text-slate-500">{eventPeriod(ACTIVE_ADMISSION_EVENT)} · {INSTITUTIONS.length} institutions</p>
          <div className="mt-4"><ProgressMeter label="Students cleared" value={active.cleared} total={active.admitted} /></div>
        </Link>
        <Link to={`/jamb/events/${NYSC_EVENT_ID}`} className="block rounded-xl border border-slate-200 bg-white p-5 shadow-card hover:border-brand-300">
          <div className="flex items-center justify-between gap-2"><p className="font-semibold text-slate-900">NYSC Identity Verification</p><EventStatusBadge status="active" /></div>
          <p className="mt-0.5 text-xs text-slate-500">{eventPeriod(eventById(NYSC_EVENT_ID)!)} · National Youth Service Corps</p>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-slate-500">Verifications</dt><dd className="text-lg font-semibold tabular-nums text-slate-900">{fmt(nysc.verifications)}</dd></div>
            <div><dt className="text-slate-500">Confirmed</dt><dd className="text-lg font-semibold tabular-nums text-slate-900">{fmt(nysc.cleared)}</dd></div>
            <div><dt className="text-slate-500">Not confirmed</dt><dd className="text-lg font-semibold tabular-nums text-slate-900">{fmt(nysc.failed + nysc.notConfirmed)}</dd></div>
          </dl>
        </Link>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="px-5 py-5">
          <h2 className="text-base font-semibold text-slate-900">Progress, all sessions</h2>
          <div className="mt-4 space-y-5">
            <ProgressMeter label="Clearance" value={n.cleared} total={n.admitted} hint={`${fmt(n.pending)} admitted students not yet cleared`} />
            <ProgressMeter label="Identity verification" value={n.verified} total={n.admitted} color={SERIES.s2} hint={`${fmt(n.awaitingClearance)} verified students awaiting clearance`} />
          </div>
        </Card>
        <Card className="px-5 py-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Verification outcomes</h2>
          <Distribution ariaLabel="Verification outcomes" parts={[
            { label: 'Verified', value: n.verified, color: STATUS.good, icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> },
            { label: 'Not yet verified', value: n.notStarted, color: STATUS.neutral, icon: <CircleDashed className="h-4 w-4" aria-hidden="true" /> },
            { label: 'Failed', value: n.failed, color: STATUS.critical, icon: <XCircle className="h-4 w-4" aria-hidden="true" /> },
            { label: 'Exception', value: n.exceptions, color: STATUS.serious, icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" /> },
          ]} />
        </Card>
      </div>

      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Institution performance · {ACTIVE_SESSION}</h2>
          <Link to="/jamb/reports" className="text-sm font-medium text-brand-600 hover:text-brand-700">Full report</Link>
        </div>
        <div className="mb-3 mt-2"><Legend items={[{ label: 'Cleared', color: SERIES.s1 }, { label: 'Verified, awaiting clearance', color: SERIES.s2 }, { label: 'Not yet cleared', color: SERIES.rest }]} /></div>
        <StackedBars ariaLabel="Institution performance" rows={perf.map(({ inst, c }) => ({
          key: inst.code, label: inst.name, onSelect: () => navigate(`/jamb/institutions/${inst.code}/events/${ACTIVE_ADMISSION_EVENT.id}`),
          segments: [{ label: 'Cleared', value: c.cleared, color: SERIES.s1 }, { label: 'Verified, awaiting clearance', value: c.awaitingClearance, color: SERIES.s2 }, { label: 'Not yet cleared', value: c.pending - c.awaitingClearance, color: SERIES.rest }],
        }))} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Recent verification activities" action={<Link to="/jamb/activity" className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</Link>}>
          <ActivityList activities={recent} studentPath={(reg) => `/jamb/students/${reg}`} />
        </Section>
        <Section title="Recent exceptions" action={<Link to="/jamb/exceptions" className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</Link>}>
          <ExceptionMiniList ids={open.slice(0, 8).map((e) => e.id)} />
        </Section>
      </div>
    </>
  );
}

export function ExceptionMiniList({ ids }: { ids: string[] }) {
  const state = useJambState();
  const all = exceptionsOf(state);
  const list = ids.map((id) => all.find((e) => e.id === id)!).filter(Boolean);
  if (!list.length) return <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="No open exceptions" />;
  return (
    <ul className="divide-y divide-slate-100" aria-label="Exceptions">
      {list.map((e) => (
        <li key={e.id}>
          <Link to={e.escalation ? `/jamb/escalations/${e.id}` : `/jamb/exceptions/${e.id}`} className="flex flex-col gap-1 px-5 py-3 text-sm hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0"><span className="font-medium text-slate-900">{CATEGORY_LABEL[e.category]}</span><span className="text-slate-500"> · {institutionByCode(e.institution)?.shortName} · {e.session}</span></span>
            <span className="flex shrink-0 items-center gap-2"><ExceptionStatusBadge status={e.status} /><span className="whitespace-nowrap text-xs text-slate-500">{dateTime(e.raisedAt)}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Verification events ---------------- */

function EventsPage() {
  const state = useJambState();
  const [status, setStatus] = useQueryState('status', 'all');
  const rows = EVENTS.filter((e) => status === 'all' || e.status === status).map((e) => ({ e, s: eventSummary(e.id, state) }));
  return (
    <>
      <PageHeader title="Verification Events" description="Events JAMB has published to participating institutions and NYSC." />
      <Card>
        <div className="border-b border-slate-100 p-4"><FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All events' }, { value: 'active', label: 'Active' }, { value: 'expired', label: 'Expired' }]} /></div>
        <DataTable rows={rows} rowKey={(r) => r.e.id} rowHref={(r) => `/jamb/events/${r.e.id}`} empty={<EmptyState title="No events match" />}
          columns={[
            { key: 'n', header: 'Event', className: '!whitespace-normal min-w-[12rem]', cell: ({ e }) => <Link to={`/jamb/events/${e.id}`} className="font-medium text-slate-900 hover:text-brand-700">{e.name}<span className="block font-mono text-xs font-normal text-slate-500">{e.id}</span></Link> },
            { key: 'c', header: 'Category', cell: ({ e }) => <span className="text-slate-600">{e.category}</span> },
            { key: 's', header: 'Status', cell: ({ e }) => <EventStatusBadge status={e.status} /> },
            { key: 'p', header: 'Validity', className: '!whitespace-normal', cell: ({ e }) => <span className="text-slate-600">{e.endsAt ? `${formatDate(e.startsAt)} – ${formatDate(e.endsAt)}` : <>From {formatDate(e.startsAt)}<span className="block text-xs text-slate-500">No fixed end date</span></>}</span> },
            { key: 'o', header: 'Published to', cell: ({ e }) => <span className="text-slate-600">{e.audience === 'nysc' ? 'National Youth Service Corps' : `${INSTITUTIONS.length} institutions`}</span> },
            { key: 'g', header: 'Progress', className: 'min-w-[10rem]', cell: ({ e, s }) => e.session
              ? <span className="flex items-center gap-2"><span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${pct(s.cleared, s.assigned)}%`, background: SERIES.s1 }} /></span><span className="tabular-nums text-slate-600">{pct(s.cleared, s.assigned)}% cleared</span></span>
              : <span className="tabular-nums text-slate-600">{fmt(s.verifications)} verifications</span> },
          ]} />
      </Card>
    </>
  );
}

function EventPage() {
  const { eventId = '' } = useParams();
  const e = eventById(eventId);
  const state = useJambState();
  const [q, setQ] = useQueryState('q');
  if (!e) return <NotFound what="Event" back="/jamb/events" />;
  const s = eventSummary(e.id, state);
  const acts = allActivities(state).filter((a) => a.eventId === e.id).slice(0, 8);
  const exc = exceptionsOf(state).filter((x) => x.eventId === e.id);
  const openExc = exc.filter(isOpenException);
  const insts = e.session ? INSTITUTIONS.filter((i) => !q.trim() || `${i.name} ${i.code}`.toLowerCase().includes(q.trim().toLowerCase())).map((i) => ({ inst: i, c: countsOf(i.code, e.session!, state) })) : [];
  return (
    <>
      <PageHeader title={e.name} breadcrumbs={[{ label: 'Verification Events', to: '/jamb/events' }, { label: e.name }]} meta={<><EventStatusBadge status={e.status} /><Badge tone="neutral">{e.category}</Badge></>} />
      <Card className="px-5 py-5">
        <DescriptionList items={[
          { label: 'Event reference', value: <span className="font-mono">{e.id}</span> },
          { label: 'Category', value: e.category },
          { label: 'Status', value: <EventStatusBadge status={e.status} /> },
          { label: 'Start date', value: formatDate(e.startsAt) },
          { label: 'End date', value: e.endsAt ? formatDate(e.endsAt) : 'Continuous: no fixed end date' },
          { label: 'Published to', value: e.audience === 'nysc' ? 'National Youth Service Corps' : `${INSTITUTIONS.length} participating institutions` },
          ...(e.session ? [{ label: 'Admission session', value: e.session }] : []),
          { label: 'Published', value: e.publishedAt ? `${formatDate(e.publishedAt)} by ${e.createdBy}` : '—' },
        ]} />
      </Card>
      {e.session ? (
        <>
          <section aria-label="Event summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Assigned students" value={fmt(s.assigned)} />
            <StatCard label="Cleared" value={fmt(s.cleared)} tone="emerald" />
            <StatCard label="Pending clearance" value={fmt(s.pending)} tone="amber" />
            <StatCard label="Failed verification" value={fmt(s.failed)} />
            <StatCard label="Open exceptions" value={fmt(openExc.length)} to={`/jamb/exceptions?event=${e.id}`} />
            <StatCard label="Identity verified" value={fmt(s.verifications - s.failed - s.exceptions)} tone="violet" />
          </section>
          <Card className="px-5 py-4"><ProgressMeter label="Verification progress (students cleared)" value={s.cleared} total={s.assigned} /></Card>
          <Section title="Participating institutions" description="Select an institution to inspect its clearance activities.">
            <div className="border-b border-slate-100 p-4"><SearchInput value={q} onChange={setQ} placeholder="Institution name or code" className="sm:w-72" label="Search institutions" /></div>
            <DataTable rows={insts} rowKey={(r) => r.inst.code} rowHref={(r) => `/jamb/events/${e.id}/institutions/${r.inst.code}`} empty={<EmptyState title="No institutions match" />}
              columns={[
                { key: 'n', header: 'Institution', className: '!whitespace-normal min-w-[12rem]', cell: ({ inst }) => <Link to={`/jamb/events/${e.id}/institutions/${inst.code}`} className="font-medium text-slate-900 hover:text-brand-700">{inst.name}</Link> },
                ...countColumns(),
              ]} />
          </Section>
        </>
      ) : (
        <>
          <section aria-label="Event summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Verifications" value={fmt(s.verifications)} />
            <StatCard label="Identity confirmed" value={fmt(s.cleared)} tone="emerald" />
            <StatCard label="Face verification failed" value={fmt(s.failed)} />
            <StatCard label="Clearance not confirmed" value={fmt(s.notConfirmed)} tone="amber" />
          </section>
          <Section title="Participating organisation">
            <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
              <OrgMark letters="NYSC" tone="blue" />
              <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">National Youth Service Corps</p><p className="text-sm text-slate-500">Verifies prospective corps members’ identity and admission clearance history.</p></div>
              <ul className="text-sm text-slate-600" aria-label="NYSC officers">{NYSC_OFFICERS.map((o) => <li key={o}>{o} · {fmt(allActivities(state).filter((a) => a.kind === 'nysc' && a.officer === o).length)} verifications</li>)}</ul>
            </div>
          </Section>
        </>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Recent activities"><ActivityList activities={acts} studentPath={(reg) => `/jamb/students/${reg}`} /></Section>
        <Section title="Exceptions" action={<Link to={`/jamb/exceptions?event=${e.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View all ({fmt(exc.length)})</Link>}>
          <ExceptionMiniList ids={(openExc.length ? openExc : exc).slice(0, 6).map((x) => x.id)} />
        </Section>
      </div>
    </>
  );
}

function countColumns() {
  return [
    { key: 'a', header: 'Assigned', cell: ({ c }: { c: Counts }) => <span className="tabular-nums">{fmt(c.admitted)}</span> },
    { key: 'cl', header: 'Cleared', cell: ({ c }: { c: Counts }) => <span className="tabular-nums">{fmt(c.cleared)}</span> },
    { key: 'p', header: 'Pending', cell: ({ c }: { c: Counts }) => <span className="tabular-nums">{fmt(c.pending)}</span> },
    { key: 'f', header: 'Failed', cell: ({ c }: { c: Counts }) => <span className="tabular-nums">{fmt(c.failed)}</span> },
    { key: 'x', header: 'Exceptions', cell: ({ c }: { c: Counts }) => <span className="tabular-nums">{fmt(c.exceptions)}</span> },
    { key: 'v', header: 'Identity verified', cell: ({ c }: { c: Counts }) => <span className="tabular-nums">{fmt(c.verified)}</span> },
    { key: 'g', header: 'Progress', className: 'min-w-[9rem]', cell: ({ c }: { c: Counts }) => <span className="flex items-center gap-2"><span className="h-2 w-20 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${pct(c.cleared, c.admitted)}%`, background: SERIES.s1 }} /></span><span className="tabular-nums text-slate-600">{pct(c.cleared, c.admitted)}%</span></span> },
  ];
}

/** One institution within one admission clearance event: its session figures, activity and student records. */
function InstitutionEventPage({ via }: { via: 'events' | 'institutions' }) {
  const { eventId = '', code = '' } = useParams();
  const e = eventById(eventId);
  const inst = institutionByCode(code);
  const state = useJambState();
  if (!e?.session || !inst) return <NotFound what="Institution event" back="/jamb/events" />;
  const session = e.session;
  const c = countsOf(inst.code, session, state);
  const acts = institutionActivities(inst.code, state).filter((a) => a.session === session).slice(0, 8);
  const crumbs = via === 'events'
    ? [{ label: 'Verification Events', to: '/jamb/events' }, { label: e.name, to: `/jamb/events/${e.id}` }, { label: inst.shortName }]
    : [{ label: 'Institutions', to: '/jamb/institutions' }, { label: inst.shortName, to: `/jamb/institutions/${inst.code}` }, { label: e.name }];
  return (
    <>
      <PageHeader title={inst.name} description={`${e.name} · ${session} admission session`} breadcrumbs={crumbs} meta={<EventStatusBadge status={e.status} />}
        actions={<Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print report</Button>} />
      <SessionStats c={c} />
      <Section title="Recent verification activities" description="Student, officer, date and outcome.">
        {acts.length ? <ActivityList activities={acts} studentPath={(reg) => `/jamb/students/${reg}`} showOrganisation={false} /> : <EmptyState title="No verification activity yet" />}
      </Section>
      <StudentTable inst={inst} session={session} studentPath={(reg) => `/jamb/students/${reg}`} />
    </>
  );
}

/* ---------------- Institutions ---------------- */

function InstitutionsPage() {
  const state = useJambState();
  const [q, setQ] = useQueryState('q');
  const [type, setType] = useQueryState('type', 'all');
  const query = q.trim().toLowerCase();
  const match = (name: string, code: string, t: string, loc: string) => (type === 'all' || t === type) && (!query || `${name} ${code} ${loc}`.toLowerCase().includes(query));
  const rows = [
    ...INSTITUTIONS.filter((i) => match(i.name, i.code, i.type, `${i.city} ${i.state}`)).map((i) => ({ code: i.code, name: i.name, type: i.type, location: `${i.city}, ${i.state} State`, participating: true, c: countsOf(i.code, ACTIVE_SESSION, state) })),
    ...ONBOARDING_INSTITUTIONS.filter((i) => match(i.name, i.code, i.type, `${i.city} ${i.state}`)).map((i) => ({ code: i.code, name: i.name, type: i.type, location: `${i.city}, ${i.state} State`, participating: false, c: null as Counts | null })),
  ];
  return (
    <>
      <PageHeader title="Institutions" description="Tertiary institutions taking part in JAMB verification events." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Name, code or location" className="sm:w-72" label="Search institutions" />
          <FilterSelect label="Institution type" value={type} onChange={setType} options={[{ value: 'all', label: 'All types' }, ...[...new Set(INSTITUTIONS.map((i) => i.type))].map((t) => ({ value: t, label: t }))]} />
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500" role="status">{rows.length} institutions</p>
        <DataTable rows={rows} rowKey={(r) => r.code} rowHref={(r) => (r.participating ? `/jamb/institutions/${r.code}` : '')} empty={<EmptyState title="No institutions match" />}
          columns={[
            { key: 'n', header: 'Institution', className: '!whitespace-normal min-w-[12rem]', cell: (r) => r.participating ? <Link to={`/jamb/institutions/${r.code}`} className="font-medium text-slate-900 hover:text-brand-700">{r.name}</Link> : <span className="font-medium text-slate-900">{r.name}</span> },
            { key: 't', header: 'Type', cell: (r) => <span className="text-slate-600">{r.type}</span> },
            { key: 'c', header: 'Code', cell: (r) => <span className="font-mono text-xs text-slate-600">{r.code}</span> },
            { key: 'l', header: 'Location', className: '!whitespace-normal', cell: (r) => <span className="text-slate-600">{r.location}</span> },
            { key: 'p', header: 'Participation', cell: (r) => r.participating ? <Badge tone="success" dot>Participating</Badge> : <Badge tone="warning" dot>Onboarding</Badge> },
            { key: 'e', header: 'Active events', className: '!whitespace-normal', cell: (r) => <span className="text-slate-600">{r.participating ? ACTIVE_ADMISSION_EVENT.name : '—'}</span> },
            { key: 'g', header: `Cleared (${ACTIVE_SESSION})`, cell: (r) => r.c ? <span className="tabular-nums text-slate-600">{pct(r.c.cleared, r.c.admitted)}%</span> : <span className="text-slate-400">—</span> },
          ]} />
      </Card>
    </>
  );
}

function InstitutionPage() {
  const { code = '' } = useParams();
  const inst = institutionByCode(code);
  const state = useJambState();
  if (!inst) return <NotFound what="Institution" back="/jamb/institutions" />;
  const all = institutionCounts(inst.code, state);
  const exc = exceptionsOf(state).filter((e) => e.institution === inst.code);
  const acts = institutionActivities(inst.code, state).slice(0, 8);
  return (
    <>
      <PageHeader title={inst.name} breadcrumbs={[{ label: 'Institutions', to: '/jamb/institutions' }, { label: inst.shortName }]} meta={<Badge tone="success" dot>Participating</Badge>} />
      <Card className="px-5 py-5">
        <DescriptionList items={[
          { label: 'Institution code', value: <span className="font-mono">{inst.code}</span> },
          { label: 'Type', value: inst.type },
          { label: 'Location', value: `${inst.city}, ${inst.state} State` },
          { label: 'Clearance officers', value: officersOf(inst.code).join(', ') },
          { label: 'Active events', value: ACTIVE_ADMISSION_EVENT.name },
        ]} />
      </Card>
      <section aria-label="Institution summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Admitted (all sessions)" value={fmt(all.admitted)} />
        <StatCard label="Cleared" value={fmt(all.cleared)} tone="emerald" />
        <StatCard label="Pending clearance" value={fmt(all.pending)} tone="amber" />
        <StatCard label="Identity verified" value={fmt(all.verified)} tone="violet" />
        <StatCard label="Failed verifications" value={fmt(all.failed)} />
        <StatCard label="Open exceptions" value={fmt(exc.filter(isOpenException).length)} to={`/jamb/exceptions?institution=${inst.code}`} />
      </section>
      <Section title="Verification events and admission sessions" description="Open an event to see its admission session and student records.">
        <DataTable rows={SESSIONS.slice().reverse().map((s) => ({ s, e: eventForSession(s), c: countsOf(inst.code, s, state) }))} rowKey={(r) => r.s} rowHref={(r) => `/jamb/institutions/${inst.code}/events/${r.e.id}`}
          columns={[
            { key: 'e', header: 'Event', className: '!whitespace-normal min-w-[12rem]', cell: ({ e }) => <Link to={`/jamb/institutions/${inst.code}/events/${e.id}`} className="font-medium text-slate-900 hover:text-brand-700">{e.name}</Link> },
            { key: 's', header: 'Status', cell: ({ e }) => <EventStatusBadge status={e.status} /> },
            ...countColumns(),
          ]} />
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="px-5 py-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Verification outcomes</h2>
          <Distribution ariaLabel="Verification outcomes" parts={[
            { label: 'Verified', value: all.verified, color: STATUS.good, icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> },
            { label: 'Not yet verified', value: all.notStarted, color: STATUS.neutral, icon: <CircleDashed className="h-4 w-4" aria-hidden="true" /> },
            { label: 'Failed', value: all.failed, color: STATUS.critical, icon: <XCircle className="h-4 w-4" aria-hidden="true" /> },
            { label: 'Exception', value: all.exceptions, color: STATUS.serious, icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" /> },
          ]} />
          <div className="mt-5 space-y-4">
            <ProgressMeter label="Clearance" value={all.cleared} total={all.admitted} />
            <ProgressMeter label="Identity verification" value={all.verified} total={all.admitted} color={SERIES.s2} />
          </div>
        </Card>
        <Section title="Exceptions" action={<Link to={`/jamb/exceptions?institution=${inst.code}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View all ({fmt(exc.length)})</Link>}>
          <ExceptionMiniList ids={exc.slice(0, 6).map((e) => e.id)} />
        </Section>
      </div>
      <Section title="Recent activities"><ActivityList activities={acts} studentPath={(reg) => `/jamb/students/${reg}`} showOrganisation={false} /></Section>
    </>
  );
}

/* ---------------- Reports ---------------- */

function ReportsPage() {
  const state = useJambState();
  const [code, setCode] = useQueryState('institution', 'all');
  const [sess, setSess] = useQueryState('session', sessionSlug(ACTIVE_SESSION));
  const inst = code === 'all' ? undefined : institutionByCode(code);
  const session = SESSIONS.find((s) => sessionSlug(s) === sess);
  const rows = useMemo(() => (inst
    ? (session ? [session] : [...SESSIONS]).map((s: Session) => ({ key: s, label: `${s} admission session`, c: countsOf(inst.code, s, state) }))
    : INSTITUTIONS.map((i: Institution) => ({ key: i.code, label: i.name, c: session ? countsOf(i.code, session, state) : institutionCounts(i.code, state) }))), [inst, session, state]);
  const total = rows.reduce((t, r) => ({ ...t, admitted: t.admitted + r.c.admitted, cleared: t.cleared + r.c.cleared, pending: t.pending + r.c.pending, failed: t.failed + r.c.failed, exceptions: t.exceptions + r.c.exceptions, verified: t.verified + r.c.verified }), { admitted: 0, cleared: 0, pending: 0, failed: 0, exceptions: 0, verified: 0 });
  return (
    <>
      <PageHeader title="Reports" description="Identity verification and admission clearance by institution and admission session."
        actions={<Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print report</Button>} />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end print:hidden">
          <div className="min-w-0 max-w-full [&_select]:w-full [&_select]:max-w-full"><FilterSelect label="Institution" value={code} onChange={setCode} options={[{ value: 'all', label: 'All institutions' }, ...INSTITUTIONS.map((i) => ({ value: i.code, label: i.name }))]} /></div>
          <FilterSelect label="Admission session" value={sess} onChange={setSess} options={[{ value: 'all', label: 'All sessions' }, ...SESSIONS.map((s) => ({ value: sessionSlug(s), label: s }))]} />
        </div>
        <dl className="grid gap-4 px-5 py-5 text-sm sm:grid-cols-3 lg:grid-cols-6" aria-label="Report summary">
          {([['Admitted by JAMB', total.admitted], ['Identity verified', total.verified], ['Cleared', total.cleared], ['Pending clearance', total.pending], ['Failed verifications', total.failed], ['Identity exceptions', total.exceptions]] as const).map(([k, v]) => (
            <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{fmt(v)}</dd></div>
          ))}
        </dl>
        <p className="mx-5 mb-5 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
          {fmt(total.cleared)} cleared + {fmt(total.pending)} pending = {fmt(total.admitted)} admitted by JAMB. Every cleared student has a successful identity verification.
        </p>
      </Card>
      <Section title={inst ? `${inst.name}: by admission session` : `All institutions${session ? ` · ${session}` : ' · all sessions'}`}>
        <DataTable rows={rows} rowKey={(r) => r.key} rowHref={(r) => (inst ? `/jamb/institutions/${inst.code}/events/${eventForSession(r.key as Session).id}` : `/jamb/institutions/${r.key}`)}
          columns={[
            { key: 'n', header: inst ? 'Session' : 'Institution', className: '!whitespace-normal min-w-[12rem]', cell: (r) => <span className="font-medium text-slate-900">{r.label}</span> },
            ...countColumns().map((col) => ({ ...col, cell: (r: { c: Counts }) => col.cell({ c: r.c }) })),
            { key: 'cr', header: 'Clearance rate', cell: (r) => <span className="tabular-nums">{pct(r.c.cleared, r.c.admitted)}%</span> },
          ]} />
      </Section>
    </>
  );
}
