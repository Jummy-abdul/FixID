import { useMemo } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, ScrollText, XCircle } from 'lucide-react';
import { Badge, Card, CardHeader, DataTable, EmptyState, FilterSelect, PageHeader, SearchInput, StatCard, Tabs } from '@/components/ui';
import { useQueryState } from '@/hooks/useQueryState';
import { formatDateTime } from '@/lib/dates';
import { INSTITUTIONS, SESSIONS, institutionByCode, sessionFromSlug, sessionSlug, type Institution, type Session } from './data';
import { CertificatePage } from './certificate';
import { StudentJourney } from './journey';
import { OUTCOME_LABEL, countsOf, institutionCounts, nationalCounts, outcomeKind, recordOf, recordsOf, sessionTotals, useJambState, type Counts } from './store';
import { StudentTable } from './students';
import {
  ConsoleShell, Distribution, GroupedColumns, Legend, ProgressMeter, SERIES, STATUS, StackedBars, fmt, pct,
} from './ui';

const NAV = [
  { label: 'Overview', to: '/jamb', end: true }, { label: 'Institutions', to: '/jamb/institutions' },
  { label: 'Matriculation reconciliation', to: '/jamb/reconciliation' }, { label: 'Find a student', to: '/jamb/students' },
];

/** The JAMB Officer's console: central oversight of identity verification, clearance and matriculation. */
export function JambConsole() {
  return (
    <ConsoleShell nav={NAV} roleLabel="JAMB Officer · Central Identity Assurance Administrator">
      <Routes>
        <Route index element={<JambOverview />} />
        <Route path="institutions" element={<InstitutionsPage />} />
        <Route path="institutions/:code" element={<InstitutionPage />} />
        <Route path="institutions/:code/sessions/:session" element={<SessionPage />} />
        <Route path="reconciliation" element={<ReconciliationPage />} />
        <Route path="students" element={<FindStudentPage />} />
        <Route path="students/:reg" element={<JambStudentPage />} />
        <Route path="certificate/:reg" element={<CertificatePage backTo={(reg) => `/jamb/students/${reg}`} />} />
        <Route path="*" element={<Navigate to="/jamb" replace />} />
      </Routes>
    </ConsoleShell>
  );
}

type Health = 'on-track' | 'monitor' | 'behind';
const healthOf = (c: Counts): Health => (c.cleared / c.admitted >= 0.72 ? 'on-track' : c.cleared / c.admitted >= 0.62 ? 'monitor' : 'behind');
const HealthBadge = ({ h }: { h: Health }) => (h === 'on-track' ? <Badge tone="success" dot>On track</Badge> : h === 'monitor' ? <Badge tone="warning" dot>Monitor</Badge> : <Badge tone="danger" dot>Behind schedule</Badge>);
const issues = (c: Counts) => c.failed + c.exceptions;

function JambOverview() {
  const state = useJambState();
  const navigate = useNavigate();
  const n = nationalCounts(state);
  const byInst = INSTITUTIONS.map((i) => ({ inst: i, c: institutionCounts(i.code, state) }));
  const top = [...byInst].sort((a, b) => b.c.admitted - a.c.admitted).slice(0, 10);
  const sessions = SESSIONS.map((s) => ({ s, c: sessionTotals(s, state) }));
  const recent = state.events.slice(0, 6);
  return (
    <>
      <PageHeader title="National identity assurance overview" description="Identity verification, institutional clearance and matriculation across participating institutions, from JAMB registration to matriculation." />
      <section aria-label="Key statistics" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Participating institutions" value={INSTITUTIONS.length} to="/jamb/institutions" />
        <StatCard label="Students admitted" value={fmt(n.admitted)} />
        <StatCard label="Students cleared" value={fmt(n.cleared)} tone="emerald" />
        <StatCard label="Students matriculated" value={fmt(n.matriculated)} tone="violet" to="/jamb/reconciliation" />
        <StatCard label="Pending clearance" value={fmt(n.pending)} tone="amber" />
        <StatCard label="Failed identity verifications" value={fmt(n.failed)} />
        <StatCard label="Verification exceptions" value={fmt(n.exceptions)} />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="px-5 py-5">
          <h2 className="text-base font-semibold text-slate-900">Progress</h2>
          <div className="mt-4 space-y-5">
            <ProgressMeter label="Clearance progress" value={n.cleared} total={n.admitted} hint={`${fmt(n.pending)} admitted students are not yet cleared.`} />
            <ProgressMeter label="Matriculation progress" value={n.matriculated} total={n.admitted} color={SERIES.s2} hint={`${fmt(n.clearedNotMatriculated)} cleared students await their institution’s matriculation confirmation.`} />
          </div>
        </Card>
        <Card className="px-5 py-5">
          <h2 className="text-base font-semibold text-slate-900">Identity verification outcomes</h2>
          <p className="mb-4 mt-1 text-sm text-slate-500">All admitted students, by their current identity verification status.</p>
          <Distribution ariaLabel="Identity verification outcomes" parts={[
            { label: 'Verified', value: n.verified, color: STATUS.good, icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> },
            { label: 'Not verified yet', value: n.notStarted, color: STATUS.neutral, icon: <CircleDashed className="h-4 w-4" aria-hidden="true" /> },
            { label: 'Failed', value: n.failed, color: STATUS.critical, icon: <XCircle className="h-4 w-4" aria-hidden="true" /> },
            { label: 'Exception', value: n.exceptions, color: STATUS.serious, icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" /> },
          ]} />
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="px-5 py-5 xl:col-span-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Institution performance</h2>
            <Link to="/jamb/institutions" className="text-sm font-medium text-brand-600 hover:text-brand-700">All 25 institutions</Link>
          </div>
          <p className="mb-3 mt-1 text-sm text-slate-500">Share of admitted students at each stage, ten largest intakes. Select a bar to open the institution.</p>
          <div className="mb-3"><Legend items={[{ label: 'Matriculated', color: SERIES.s1 }, { label: 'Cleared, not matriculated', color: SERIES.s2 }, { label: 'Not yet cleared', color: SERIES.rest }]} /></div>
          <StackedBars ariaLabel="Institution performance" rows={top.map(({ inst, c }) => ({
            key: inst.code, label: inst.name, onSelect: () => navigate(`/jamb/institutions/${inst.code}`),
            segments: [{ label: 'Matriculated', value: c.matriculated, color: SERIES.s1 }, { label: 'Cleared, not matriculated', value: c.clearedNotMatriculated, color: SERIES.s2 }, { label: 'Not yet cleared', value: c.pending, color: SERIES.rest }],
          }))} />
        </Card>
        <Card className="px-5 py-5 xl:col-span-2">
          <h2 className="text-base font-semibold text-slate-900">Admission session trends</h2>
          <p className="mb-3 mt-1 text-sm text-slate-500">All institutions, by admission session.</p>
          <div className="mb-2"><Legend items={[{ label: 'Admitted', color: SERIES.s1 }, { label: 'Cleared', color: SERIES.s2 }, { label: 'Matriculated', color: SERIES.s3 }]} /></div>
          <GroupedColumns ariaLabel="Admission session trends" series={[{ label: 'Admitted', color: SERIES.s1 }, { label: 'Cleared', color: SERIES.s2 }, { label: 'Matriculated', color: SERIES.s3 }]}
            groups={sessions.map(({ s, c }) => ({ label: s, values: [c.admitted, c.cleared, c.matriculated] }))} />
          <table className="mt-2 w-full text-left text-xs text-slate-600">
            <thead><tr className="text-slate-400"><th className="py-1 font-medium">Session</th><th className="py-1 text-right font-medium">Admitted</th><th className="py-1 text-right font-medium">Cleared</th><th className="py-1 text-right font-medium">Matriculated</th></tr></thead>
            <tbody>{sessions.map(({ s, c }) => <tr key={s} className="border-t border-slate-100"><td className="py-1">{s}</td><td className="py-1 text-right tabular-nums">{fmt(c.admitted)}</td><td className="py-1 text-right tabular-nums">{fmt(c.cleared)}</td><td className="py-1 text-right tabular-nums">{fmt(c.matriculated)}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
      <Card>
        <CardHeader title="Recent clearance verifications" description="Latest verifications performed by institutions." />
        {recent.length === 0 ? <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No recent verifications" description="Verifications performed by institutions appear here." /> : (
          <ul className="divide-y divide-slate-100" aria-label="Recent clearance verifications">
            {recent.map((e) => {
              const r = e.reg ? recordOf(e.reg, state) : undefined;
              return (
                <li key={e.ref} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>{r ? <Link to={`/jamb/students/${r.reg}`} className="font-medium text-slate-900 hover:text-brand-700">{r.firstName} {r.lastName}</Link> : <span className="font-mono text-slate-700">{e.input || '—'}</span>} <span className="text-slate-500">· {institutionByCode(e.institution)?.shortName} · {e.session}</span></span>
                  <span className="flex items-center gap-2"><Badge tone={outcomeKind(e.outcome) === 'success' ? 'success' : outcomeKind(e.outcome) === 'failed' ? 'danger' : 'warning'}>{OUTCOME_LABEL[e.outcome]}</Badge><span className="text-slate-500">{formatDateTime(e.at)}</span></span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function InstitutionsPage() {
  const state = useJambState();
  const [q, setQ] = useQueryState('q');
  const [type, setType] = useQueryState('type', 'all');
  const rows = INSTITUTIONS.map((inst) => ({ inst, c: institutionCounts(inst.code, state) }))
    .filter(({ inst }) => (type === 'all' || inst.type === type) && (!q.trim() || `${inst.name} ${inst.code}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <>
      <PageHeader title="Institutions" description="Participating tertiary institutions, with the students JAMB assigned to each and their clearance and matriculation progress." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Institution name or code" className="sm:w-72" label="Search institutions" />
          <FilterSelect label="Institution type" value={type} onChange={setType} options={[{ value: 'all', label: 'All types' }, ...[...new Set(INSTITUTIONS.map((i) => i.type))].map((t) => ({ value: t, label: t }))]} />
        </div>
        <DataTable rows={rows} rowKey={(r) => r.inst.code} rowHref={(r) => `/jamb/institutions/${r.inst.code}`}
          empty={<EmptyState title="No institutions match" />}
          columns={[
            { key: 'name', header: 'Institution', className: '!whitespace-normal min-w-[12rem]', cell: ({ inst }) => <Link to={`/jamb/institutions/${inst.code}`} className="font-medium text-slate-900 hover:text-brand-700">{inst.name}</Link> },
            { key: 'type', header: 'Type', className: '!whitespace-normal', cell: ({ inst }) => <span className="text-slate-600">{inst.type}</span> },
            { key: 'code', header: 'Code', cell: ({ inst }) => <span className="font-mono text-xs text-slate-600">{inst.code}</span> },
            { key: 'admitted', header: 'Admitted', cell: ({ c }) => <span className="tabular-nums">{fmt(c.admitted)}</span> },
            { key: 'cleared', header: 'Cleared', cell: ({ c }) => <span className="tabular-nums">{fmt(c.cleared)}</span> },
            { key: 'matric', header: 'Matriculated', cell: ({ c }) => <span className="tabular-nums">{fmt(c.matriculated)}</span> },
            { key: 'pending', header: 'Pending', cell: ({ c }) => <span className="tabular-nums">{fmt(c.pending)}</span> },
            { key: 'issues', header: 'Failed / exceptions', cell: ({ c }) => <span className="tabular-nums" title={`${fmt(c.failed)} failed face matches, ${fmt(c.exceptions)} verification exceptions`}>{fmt(c.failed)} / {fmt(c.exceptions)}</span> },
            { key: 'status', header: 'Status', cell: ({ c }) => <HealthBadge h={healthOf(c)} /> },
          ]} />
      </Card>
      <p className="text-xs text-slate-500">Failed / exceptions: failed face matches, and verification exceptions (such as missing identity records), among students not yet cleared. Status reflects clearance progress: on track from 72% cleared, monitor from 62%.</p>
    </>
  );
}

function useInstitution(): Institution | undefined {
  const { code = '' } = useParams();
  return institutionByCode(code);
}

function InstitutionPage() {
  const inst = useInstitution();
  const state = useJambState();
  if (!inst) return <NotFound what="Institution" back="/jamb/institutions" />;
  const c = institutionCounts(inst.code, state);
  return (
    <>
      <PageHeader title={inst.name} breadcrumbs={[{ label: 'Institutions', to: '/jamb/institutions' }, { label: inst.shortName }]}
        description={`${inst.type} · ${inst.state} State · Code ${inst.code}`} meta={<HealthBadge h={healthOf(c)} />} />
      <section aria-label="Institution summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Admitted by JAMB" value={fmt(c.admitted)} />
        <StatCard label="Cleared" value={fmt(c.cleared)} tone="emerald" />
        <StatCard label="Matriculated" value={fmt(c.matriculated)} tone="violet" />
        <StatCard label="Pending clearance" value={fmt(c.pending)} tone="amber" />
        <StatCard label="Failed verifications" value={fmt(c.failed)} />
        <StatCard label="Exceptions" value={fmt(c.exceptions)} />
      </section>
      <Card>
        <CardHeader title="Admission sessions" description="Open a session for its dashboard and student records." />
        <ul className="divide-y divide-slate-100" aria-label="Admission sessions">
          {SESSIONS.map((s) => {
            const sc = countsOf(inst.code, s, state);
            return (
              <li key={s}>
                <Link to={`/jamb/institutions/${inst.code}/sessions/${sessionSlug(s)}`} className="grid gap-3 px-5 py-4 hover:bg-slate-50 sm:grid-cols-[12rem_1fr_auto] sm:items-center">
                  <span className="font-medium text-slate-900">{s} Admission Session</span>
                  <ProgressMeter label={`${fmt(sc.admitted)} admitted · cleared`} value={sc.cleared} total={sc.admitted} />
                  <span className="text-sm text-slate-500">{fmt(sc.matriculated)} matriculated · {fmt(sc.failed)} failed · {fmt(sc.exceptions)} exceptions</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
      <Link to={`/jamb/reconciliation?institution=${inst.code}`} className="inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Reconcile matriculation for {inst.shortName}</Link>
    </>
  );
}

function SessionPage() {
  const inst = useInstitution();
  const { session: slug = '' } = useParams();
  const session = sessionFromSlug(slug);
  const state = useJambState();
  if (!inst || !session) return <NotFound what="Admission session" back="/jamb/institutions" />;
  const c = countsOf(inst.code, session, state);
  return (
    <>
      <PageHeader title={`${session} Admission Session`} description={inst.name}
        breadcrumbs={[{ label: 'Institutions', to: '/jamb/institutions' }, { label: inst.shortName, to: `/jamb/institutions/${inst.code}` }, { label: session }]} />
      <SessionStats c={c} />
      <StudentTable inst={inst} session={session} studentPath={(reg) => `/jamb/students/${reg}`} />
    </>
  );
}

/** A session's figures: shared by JAMB and the university. */
export function SessionStats({ c, compact }: { c: Counts; compact?: boolean }) {
  return (
    <>
      <section aria-label="Session summary" className={compact ? 'grid grid-cols-2 gap-3 md:grid-cols-5' : 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'}>
        <StatCard label="Assigned by JAMB" value={fmt(c.admitted)} />
        {!compact && <StatCard label="Identity verified" value={fmt(c.verified)} hint={`${fmt(c.awaitingClearance)} awaiting clearance`} />}
        <StatCard label="Cleared" value={fmt(c.cleared)} tone="emerald" />
        <StatCard label="Pending clearance" value={fmt(c.pending)} tone="amber" />
        <StatCard label="Failed verification" value={fmt(c.failed)} />
        {compact ? <StatCard label="Verification exceptions" value={fmt(c.exceptions)} /> : <StatCard label="Matriculated" value={fmt(c.matriculated)} tone="violet" />}
      </section>
      <Card className="px-5 py-4">
        <div className="grid gap-4 md:grid-cols-2">
          <ProgressMeter label="Clearance progress" value={c.cleared} total={c.admitted} />
          <ProgressMeter label="Matriculation confirmed" value={c.matriculated} total={c.admitted} color={SERIES.s2} />
        </div>
      </Card>
    </>
  );
}

function ReconciliationPage() {
  const state = useJambState();
  const [code, setCode] = useQueryState('institution', 'UNILAG');
  const [sessionParam, setSession] = useQueryState('session', 'all');
  const [view, setView] = useQueryState('view', 'cleared-not-matriculated');
  const inst = institutionByCode(code) ?? INSTITUTIONS[0];
  const session = sessionFromSlug(sessionParam);
  const c = session ? countsOf(inst.code, session, state) : institutionCounts(inst.code, state);
  const records = useMemo(() => (session ? [session] : [...SESSIONS]).flatMap((s: Session) => recordsOf(inst, s, state)), [inst, session, state]);
  const matriculatedWithoutClearance = records.filter((r) => r.matriculation === 'matriculated' && r.clearance !== 'cleared').length;
  const list = records.filter((r) => (view === 'cleared-not-matriculated' ? r.clearance === 'cleared' && r.matriculation !== 'matriculated'
    : view === 'not-cleared' ? r.clearance !== 'cleared' : r.clearance !== 'cleared' && (r.verification === 'failed' || r.verification === 'exception')));
  const national = INSTITUTIONS.map((i) => ({ inst: i, c: institutionCounts(i.code, state) }));
  return (
    <>
      <PageHeader title="Matriculation reconciliation" description="JAMB’s original admission list compared with what each institution reports. Institutions confirm matriculation themselves: clearance alone never matriculates a student." />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <div className="min-w-0 max-w-full [&_select]:w-full [&_select]:max-w-full"><FilterSelect label="Institution" value={inst.code} onChange={setCode} options={INSTITUTIONS.map((i) => ({ value: i.code, label: i.name }))} /></div>
          <FilterSelect label="Admission session" value={sessionParam} onChange={setSession} options={[{ value: 'all', label: 'All sessions' }, ...SESSIONS.map((s) => ({ value: sessionSlug(s), label: s }))]} />
        </div>
        <dl className="grid gap-4 px-5 py-5 text-sm sm:grid-cols-3 lg:grid-cols-6" aria-label="Reconciliation summary">
          {([['Original admission (JAMB)', c.admitted], ['Cleared', c.cleared], ['Confirmed matriculation', c.matriculated], ['Admitted, not cleared', c.pending], ['Cleared, not matriculated', c.clearedNotMatriculated], ['Failed verifications or exceptions', issues(c)]] as const).map(([k, v]) => (
            <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{fmt(v)}</dd></div>
          ))}
        </dl>
        <p className={`mx-5 mb-5 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${matriculatedWithoutClearance ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-emerald-50 text-emerald-800 ring-emerald-200'}`}>
          {matriculatedWithoutClearance ? `${fmt(matriculatedWithoutClearance)} students are matriculated without clearance.` : 'Integrity check passed: no student is matriculated without a cleared identity verification.'}
          {' '}Reconciles: {fmt(c.cleared)} cleared + {fmt(c.pending)} not cleared = {fmt(c.admitted)} admitted; {fmt(c.matriculated)} matriculated + {fmt(c.clearedNotMatriculated)} awaiting = {fmt(c.cleared)} cleared.
        </p>
      </Card>
      <Card>
        <CardHeader title="Inspect discrepancies" description={`${inst.name}${session ? ` · ${session}` : ' · all sessions'}`} />
        <div className="px-4 pt-3"><Tabs value={view} onChange={setView} tabs={[
          { value: 'cleared-not-matriculated', label: 'Cleared, not matriculated', count: c.clearedNotMatriculated },
          { value: 'not-cleared', label: 'Admitted, not cleared', count: c.pending },
          { value: 'issues', label: 'Failed or exceptions', count: issues(c) },
        ]} /></div>
        <DataTable rows={list.slice(0, 50)} rowKey={(r) => r.reg} rowHref={(r) => `/jamb/students/${r.reg}`} empty={<EmptyState title="No discrepancies in this view" />}
          columns={[
            { key: 'name', header: 'Student', cell: (r) => <Link to={`/jamb/students/${r.reg}`} className="font-medium text-slate-900 hover:text-brand-700">{r.lastName}, {r.firstName}</Link> },
            { key: 'reg', header: 'JAMB registration number', cell: (r) => <span className="font-mono text-xs">{r.reg}</span> },
            { key: 'session', header: 'Session', cell: (r) => r.session },
            { key: 'dept', header: 'Department', cell: (r) => <span className="text-slate-600">{r.department}</span> },
            { key: 'state', header: 'Position', cell: (r) => <span className="text-slate-600">{r.clearance === 'cleared' ? `Cleared ${r.clearedAt ? formatDateTime(r.clearedAt) : ''}` : r.verification === 'failed' ? 'Face match failed' : r.verification === 'exception' ? 'Identity record incomplete' : r.verification === 'verified' ? 'Verified, awaiting clearance' : 'Not yet verified'}</span> },
          ]} />
        {list.length > 50 && <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">Showing 50 of {fmt(list.length)}. Narrow by admission session, or open the session’s student records for the full list.</p>}
      </Card>
      <Card>
        <CardHeader title="All institutions" />
        <DataTable rows={national} rowKey={(r) => r.inst.code} rowHref={(r) => `/jamb/reconciliation?institution=${r.inst.code}`}
          columns={[
            { key: 'name', header: 'Institution', className: '!whitespace-normal min-w-[12rem]', cell: ({ inst: i }) => <span className="font-medium text-slate-900">{i.name}</span> },
            { key: 'a', header: 'Original admission', cell: ({ c: x }) => <span className="tabular-nums">{fmt(x.admitted)}</span> },
            { key: 'c', header: 'Cleared', cell: ({ c: x }) => <span className="tabular-nums">{fmt(x.cleared)}</span> },
            { key: 'm', header: 'Matriculated', cell: ({ c: x }) => <span className="tabular-nums">{fmt(x.matriculated)}</span> },
            { key: 'p', header: 'Not cleared', cell: ({ c: x }) => <span className="tabular-nums">{fmt(x.pending)}</span> },
            { key: 'g', header: 'Cleared, not matriculated', cell: ({ c: x }) => <span className="tabular-nums">{fmt(x.clearedNotMatriculated)}</span> },
            { key: 'r', header: 'Matriculation rate', cell: ({ c: x }) => <span className="tabular-nums">{pct(x.matriculated, x.admitted)}%</span> },
          ]} />
      </Card>
    </>
  );
}

function FindStudentPage() {
  const navigate = useNavigate();
  const [q, setQ] = useQueryState('reg');
  const r = q.trim() ? recordOf(q.trim().toUpperCase().replace(/\s+/g, '')) : undefined;
  return (
    <>
      <PageHeader title="Find a student" description="Open any admitted student’s identity journey by their JAMB registration number." />
      <Card className="max-w-2xl px-5 py-5">
        <form onSubmit={(e) => { e.preventDefault(); if (r) navigate(`/jamb/students/${r.reg}`); }} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-slate-700">JAMB Registration Number
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 20250100000GA" className="mt-1.5 block w-full rounded-lg border-slate-300 font-mono text-sm focus:border-brand-500 focus:ring-brand-500" />
          </label>
          <button type="submit" disabled={!r} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white disabled:opacity-50">Open profile</button>
        </form>
        {q.trim() && !r && <p className="mt-2 text-sm text-slate-600" role="status">No admitted student has this registration number.</p>}
        {r && <p className="mt-2 text-sm text-slate-600" role="status">{r.firstName} {r.lastName} · {institutionByCode(r.institution)?.name} · {r.session}</p>}
        <p className="mt-3 text-xs text-slate-500">Or browse by institution and admission session under Institutions.</p>
      </Card>
    </>
  );
}

function JambStudentPage() {
  const { reg = '' } = useParams();
  const state = useJambState();
  const r = recordOf(reg, state);
  if (!r) return <NotFound what="Student" back="/jamb/students" />;
  const inst = institutionByCode(r.institution)!;
  return (
    <>
      <PageHeader title="" breadcrumbs={[{ label: 'Institutions', to: '/jamb/institutions' }, { label: inst.shortName, to: `/jamb/institutions/${inst.code}` }, { label: r.session, to: `/jamb/institutions/${inst.code}/sessions/${sessionSlug(r.session)}` }, { label: `${r.firstName} ${r.lastName}` }]} />
      <StudentJourney record={r} actions={r.clearance === 'cleared' ? <Link to={`/jamb/certificate/${r.reg}`} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">View clearance certificate</Link> : undefined} />
    </>
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
