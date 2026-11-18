import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarCheck, CheckCircle2, ClipboardList, Home, Loader2, Printer, ScanFace, Search, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, DataTable, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, StatCard, Tabs, usePageSlice, useToast,
} from '@/components/ui';
import { dateTime } from './format';
import { CameraCapture } from '@/components/verification/CameraCapture';
import type { NavGroup } from '@/layout/navigation';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { ACTIVE_ADMISSION_EVENT, ACTIVE_SESSION, EVENTS, SESSIONS, UNILAG, eventById, institutionByCode, sessionSlug, type StudentRecord } from './data';
import { CertificatePage } from './certificate';
import { StudentJourney } from './journey';
import { demoFace } from './portraits';
import {
  confirmClearance, confirmMatriculation, countsOf, exceptionsOf, institutionActivities, lookupForClearance, priorClearanceOf, recordOf, recordUniversityVerification,
  recordsOf, useJambState, type Activity,
} from './store';
import { ActivityList, EventStatusBadge, NotFound, Section, SessionStats, eventPeriod } from './shared';
import { StudentTable } from './students';
import { ConsoleLayout, OrgMark, Portrait, ProgressMeter, fmt, placeholderFaceUrl, useOfficer } from './ui';

const NAV: NavGroup[] = [
  { label: null, items: [{ label: 'Home', to: '/clearance', end: true, icon: Home, description: 'Your clearance overview' }] },
  {
    label: 'Clearance',
    items: [
      { label: 'Clearance Events', to: '/clearance/events', icon: CalendarCheck, description: 'Events published by JAMB' },
      { label: 'Verify Student', to: '/clearance/verify', icon: ScanFace, description: 'Verify and clear a student' },
      { label: 'My Clearance Records', to: '/clearance/records', icon: ClipboardList, description: 'Your clearance history', alsoActiveOn: ['/clearance/students'] },
    ],
  },
];

/** The University Clearance Officer's workspace: verify and clear the students JAMB assigned to the institution. */
export function ClearanceConsole() {
  return (
    <ConsoleLayout nav={NAV} organisation={{ name: UNILAG.name, role: 'Institutional Clearance Officer' }} mark={<OrgMark letters="UNILAG" />}>
      <Routes>
        <Route index element={<ClearanceHome />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:eventId" element={<EventWorkspace />} />
        <Route path="verify" element={<VerifyStudentPage />} />
        <Route path="records" element={<RecordsPage />} />
        <Route path="students/:reg" element={<ClearanceStudentPage />} />
        <Route path="certificate/:reg" element={<CertificateGuard />} />
        <Route path="*" element={<Navigate to="/clearance" replace />} />
      </Routes>
    </ConsoleLayout>
  );
}

const ownRecord = (reg: string, state: ReturnType<typeof useJambState>) => {
  const r = recordOf(reg, state);
  return r && r.institution === UNILAG.code ? r : undefined;
};

/** The officer's own clearance records: students they verified or cleared. */
function useMyRecords() {
  const state = useJambState();
  const officer = useOfficer();
  return useMemo(() => SESSIONS.flatMap((s) => recordsOf(UNILAG, s, state)).filter((r) => r.verifiedBy === officer.name || r.clearedBy === officer.name), [state, officer.name]);
}
const recordStatus = (r: StudentRecord): { key: 'cleared' | 'failed' | 'blocked' | 'exception' | 'verified'; label: string; tone: 'success' | 'danger' | 'warning' | 'info' } =>
  r.clearance === 'cleared' ? { key: 'cleared', label: 'Cleared', tone: 'success' }
    : r.verification === 'failed' ? { key: 'failed', label: 'Failed verification', tone: 'danger' }
      : r.blocked === 'duplicate-clearance' ? { key: 'blocked', label: 'Duplicate blocked', tone: 'warning' }
        : r.verification === 'exception' ? { key: 'exception', label: 'Referred to JAMB', tone: 'warning' }
          : { key: 'verified', label: 'Verified, awaiting clearance', tone: 'info' };

/* ---------------- Home ---------------- */

function ClearanceHome() {
  const state = useJambState();
  const officer = useOfficer();
  const mine = useMyRecords().filter((r) => r.session === ACTIVE_SESSION);
  const c = countsOf(UNILAG.code, ACTIVE_SESSION, state);
  const raised = exceptionsOf(state).filter((e) => e.raisedBy === officer.name && e.institution === UNILAG.code && e.session === ACTIVE_SESSION);
  const recent = institutionActivities(UNILAG.code, state).filter((a) => a.officer === officer.name).slice(0, 8);
  return (
    <>
      <PageHeader title={`Welcome, ${officer.name.split(' ')[0]}`} description={`${UNILAG.name} · ${ACTIVE_ADMISSION_EVENT.name}`}
        actions={<ButtonLink to="/clearance/verify" variant="primary" size="lg" icon={<ScanFace className="h-5 w-5" />}>Verify Student</ButtonLink>} />
      <section aria-label="Clearance summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Students assigned" value={fmt(c.admitted)} hint={ACTIVE_SESSION} to={`/clearance/events/${ACTIVE_ADMISSION_EVENT.id}`} />
        <StatCard label="Cleared by you" value={fmt(mine.filter((r) => r.clearedBy === officer.name).length)} tone="emerald" hint={ACTIVE_SESSION} to="/clearance/records?view=cleared" />
        <StatCard label="Pending verification" value={fmt(c.notStarted + c.awaitingClearance)} tone="amber" hint={ACTIVE_SESSION} />
        <StatCard label="Failed verification" value={fmt(mine.filter((r) => r.verification === 'failed' && r.clearance !== 'cleared').length)} hint="By you" to="/clearance/records?view=failed" />
        <StatCard label="Exceptions raised" value={fmt(raised.length)} hint="By you" to="/clearance/records?view=exception" />
        <StatCard label="Institution cleared" value={`${Math.round((c.cleared / c.admitted) * 100)}%`} hint={`${fmt(c.cleared)} of ${fmt(c.admitted)}`} />
      </section>
      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">{ACTIVE_ADMISSION_EVENT.name}</h2><EventStatusBadge status="active" /></div>
        <p className="text-xs text-slate-500">{eventPeriod(ACTIVE_ADMISSION_EVENT)}</p>
        <div className="mt-4"><ProgressMeter label="Students cleared" value={c.cleared} total={c.admitted} /></div>
      </Card>
      <Section title="Your recent clearance activities" action={<Link to="/clearance/records" className="text-sm font-medium text-brand-600 hover:text-brand-700">All records</Link>}>
        {recent.length ? <ActivityList activities={recent} studentPath={(reg) => `/clearance/students/${reg}`} showOrganisation={false} showOfficer={false} /> : <EmptyState icon={<ScanFace className="h-5 w-5" />} title="No clearance activity yet" />}
      </Section>
    </>
  );
}

/* ---------------- Clearance events ---------------- */

function EventsPage() {
  const state = useJambState();
  const events = EVENTS.filter((e) => e.audience === 'institutions');
  return (
    <>
      <PageHeader title="Clearance Events" description="Admission clearance events published to your institution by JAMB." />
      <Card>
        <DataTable rows={events} rowKey={(e) => e.id} rowHref={(e) => `/clearance/events/${e.id}`}
          columns={[
            { key: 'n', header: 'Event', className: '!whitespace-normal min-w-[12rem]', cell: (e) => <Link to={`/clearance/events/${e.id}`} className="font-medium text-slate-900 hover:text-brand-700">{e.name}</Link> },
            { key: 's', header: 'Status', cell: (e) => <EventStatusBadge status={e.status} /> },
            { key: 'p', header: 'Validity', cell: (e) => <span className="text-slate-600">{eventPeriod(e)}</span> },
            { key: 'a', header: 'Assigned', cell: (e) => <span className="tabular-nums">{fmt(countsOf(UNILAG.code, e.session!, state).admitted)}</span> },
            { key: 'c', header: 'Cleared', cell: (e) => <span className="tabular-nums">{fmt(countsOf(UNILAG.code, e.session!, state).cleared)}</span> },
            { key: 'pe', header: 'Pending', cell: (e) => <span className="tabular-nums">{fmt(countsOf(UNILAG.code, e.session!, state).pending)}</span> },
          ]} />
      </Card>
    </>
  );
}

function EventWorkspace() {
  const { eventId = '' } = useParams();
  const e = eventById(eventId);
  const state = useJambState();
  if (!e?.session || e.audience !== 'institutions') return <NotFound what="Event" back="/clearance/events" />;
  const c = countsOf(UNILAG.code, e.session, state);
  return (
    <>
      <PageHeader title={e.name} description={`${UNILAG.name} · ${e.session} admission session · ${eventPeriod(e)}`} breadcrumbs={[{ label: 'Clearance Events', to: '/clearance/events' }, { label: e.name }]}
        meta={<EventStatusBadge status={e.status} />}
        actions={e.status === 'active' ? <ButtonLink to="/clearance/verify" variant="primary" icon={<ScanFace className="h-4 w-4" />}>Verify Student</ButtonLink> : undefined} />
      <SessionStats c={c} />
      <StudentTable inst={UNILAG} session={e.session} studentPath={(reg) => `/clearance/students/${reg}`} showFaculty={false} />
    </>
  );
}

/* ---------------- Verify Student: two steps ---------------- */

const STEPS = ['Identify student', 'Capture face and verify'];
function Steps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="flex flex-wrap items-center gap-3 text-sm" aria-label="Verification steps">
      {STEPS.map((s, i) => {
        const n = i + 1;
        return (
          <li key={s} aria-current={n === current ? 'step' : undefined} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-8 bg-slate-300" aria-hidden="true" />}
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold', n === current ? 'bg-emerald-700 text-white' : n < current ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500')}>
              {n < current ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : n}
            </span>
            <span className={cn('font-medium', n === current ? 'text-slate-900' : 'text-slate-500')}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

type Capture = { url: string; mode: 'camera' | 'demo' };

function VerifyStudentPage() {
  const officer = useOfficer();
  const state = useJambState();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [entered, setEntered] = useState(params.get('reg') ?? '');
  const [error, setError] = useState('');
  const [issue, setIssue] = useState<'invalid' | 'not-found' | null>(null);
  const [reg, setReg] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<Activity | null>(null);
  const record = reg ? recordOf(reg, state) : undefined;

  const restart = () => { setStep(1); setReg(null); setCapture(null); setResult(null); setEntered(''); setIssue(null); navigate('/clearance/verify', { replace: true }); };
  const lookup = (value: string) => {
    setIssue(null); setReg(null);
    if (!value.trim()) { setError('Enter the student’s JAMB Registration Number.'); return; }
    setError('');
    const r = lookupForClearance(value, officer);
    if (!r.ok) { recordUniversityVerification({ entered: value, officer, captureMode: 'demo', outcome: r.outcome }); setIssue(r.outcome); return; }
    setReg(r.record.reg);
  };
  const auto = useRef(false);
  useEffect(() => { if (!auto.current && params.get('reg')) { auto.current = true; lookup(params.get('reg')!); } });

  const verify = () => {
    if (!record || !capture) return;
    setVerifying(true);
    window.setTimeout(() => {
      const r = recordUniversityVerification({ entered: record.reg, officer, captureMode: capture.mode, record });
      setVerifying(false);
      if (r.ok) setResult(r.value);
    }, 1200);
  };

  return (
    <>
      <PageHeader title="Verify Student" description={`${ACTIVE_ADMISSION_EVENT.name} · ${UNILAG.name}`} />
      {!result && <Steps current={step} />}

      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_1fr]">
          <Card className="px-5 py-5">
            <form onSubmit={(e) => { e.preventDefault(); lookup(entered); }} className="space-y-4" noValidate>
              <Field label="JAMB Registration Number" required error={error}>
                {(p) => <Input {...p} value={entered} autoFocus autoComplete="off" placeholder="e.g. 20250190101CN" className="h-12 font-mono text-base uppercase tracking-wide" onChange={(e) => { setEntered(e.target.value); setError(''); setIssue(null); setReg(null); }} />}
              </Field>
              <Button type="submit" size="lg" className="w-full" icon={<Search className="h-4 w-4" />}>Continue</Button>
            </form>
          </Card>
          <div aria-live="polite">
            {issue && (
              <Notice tone="warning" title={issue === 'invalid' ? 'Invalid registration number' : 'Student not found'}>
                {issue === 'invalid' ? 'This isn’t a valid JAMB Registration Number. Check it with the student and try again.' : `No student with this registration number is on ${UNILAG.name}’s ${ACTIVE_SESSION} admission list.`}
              </Notice>
            )}
            {record && <StudentCard record={record} onContinue={() => setStep(2)} />}
            {!issue && !record && <div className="flex h-full min-h-[10rem] items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 text-center text-sm text-slate-500">The student’s record appears here.</div>}
          </div>
        </div>
      )}

      {step === 2 && record && !result && (
        <Card className="px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <Portrait record={record} className="h-14 w-12" />
              <p className="text-sm text-slate-600"><span className="block font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</span><span className="font-mono">{record.reg}</span> · {record.department}</p>
            </div>
            <Button size="sm" variant="ghost" disabled={verifying} onClick={() => { setStep(1); setCapture(null); }}>Change student</Button>
          </div>
          {verifying ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center" role="status">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-700" aria-hidden="true" />
              <p className="text-lg font-semibold text-slate-900">Verifying identity…</p>
              <p className="text-sm text-slate-500">Checking the face against the JAMB registration record and the NIN response.</p>
            </div>
          ) : (
            <div className="mt-5 grid gap-6 md:grid-cols-[1fr_16rem]">
              <div>
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Capture the student’s face</h2>
                <CameraCapture captured={capture?.url ?? null} startLabel="Start camera" capturedAlt="Captured face"
                  onCapture={(url) => setCapture({ url, mode: 'camera' })} onRetake={() => setCapture(null)}
                  demoFace={{ onUse: () => setCapture({ url: demoFace(record) ?? placeholderFaceUrl(`${record.firstName} ${record.lastName}`), mode: 'demo' }) }} />
                {capture && <div className="mt-4 flex justify-center"><Button size="lg" icon={<ShieldCheck className="h-5 w-5" />} onClick={verify}>Verify identity</Button></div>}
              </div>
              <figure className="hidden md:block"><Portrait record={record} className="h-72 w-full" /><figcaption className="mt-1 text-center text-xs text-slate-500">JAMB registration portrait</figcaption></figure>
            </div>
          )}
        </Card>
      )}

      {result && record && <ResultPanel event={result} record={record} capture={capture} onNext={restart} />}
    </>
  );
}

function StudentCard({ record, onContinue }: { record: StudentRecord; onContinue: () => void }) {
  const state = useJambState();
  const exc = exceptionsOf(state).find((e) => e.reg === record.reg && ['open', 'assigned', 'in-review', 'awaiting-information', 'reopened'].includes(e.status));
  return (
    <Card className="px-5 py-5" aria-label="Student record">
      <div className="flex flex-col gap-5 sm:flex-row">
        <figure className="w-32 shrink-0"><Portrait record={record} className="h-40 w-full" /><figcaption className="mt-1 text-center text-xs text-slate-500">JAMB registration portrait</figcaption></figure>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" aria-label="Student information">
            {([['JAMB Registration Number', <span className="font-mono">{record.reg}</span>], ['Institution', UNILAG.name], ['Department', record.department], ['Course', record.course], ['Admission session', record.session]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
            ))}
          </dl>
          {record.clearance === 'cleared' ? (
            <Notice tone="success" title="Already cleared" className="mt-4">Cleared on {record.clearedAt ? dateTime(record.clearedAt) : '—'} by {record.clearedBy}. <Link to={`/clearance/certificate/${record.reg}`} className="font-semibold underline">View clearance certificate</Link></Notice>
          ) : record.blocked ? (
            <Notice tone="warning" title="Clearance blocked" className="mt-4">{record.blocked === 'duplicate-clearance' ? 'A previous clearance exists for this admission record.' : 'The identity discrepancy is with JAMB for review.'}{exc && <> Exception <span className="font-mono">{exc.id}</span> is {exc.status.replace('-', ' ')}.</>}</Notice>
          ) : (
            <Button className="mt-5" size="lg" icon={<ArrowRight className="h-4 w-4" />} onClick={onContinue}>Confirm and continue</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function Notice({ tone, title, children, className }: { tone: 'success' | 'warning' | 'danger'; title: string; children: ReactNode; className?: string }) {
  const t = { success: 'bg-emerald-50 text-emerald-900 ring-emerald-200', warning: 'bg-amber-50 text-amber-900 ring-amber-200', danger: 'bg-red-50 text-red-900 ring-red-200' }[tone];
  return (
    <div role="status" className={cn('rounded-xl px-5 py-4 text-sm ring-1 ring-inset', t, className)}>
      <p className="flex items-center gap-2 font-semibold">{tone === 'success' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Check({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className={cn('flex items-center gap-1.5 font-semibold', good ? 'text-emerald-700' : 'text-red-700')}>{good ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}{value}</dd>
    </div>
  );
}

/** The outcome is the focus: a clear result, the identity checks, and the next action. */
function ResultPanel({ event: e, record, capture, onNext }: { event: Activity; record: StudentRecord; capture: Capture | null; onNext: () => void }) {
  const officer = useOfficer();
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState(false);
  const [prior, setPrior] = useState(false);
  const cleared = record.clearance === 'cleared';
  const listPath = `/clearance/events/${ACTIVE_ADMISSION_EVENT.id}`;
  const previous = priorClearanceOf(record.reg);
  const complete = () => { const r = confirmClearance(record.reg, officer); if (!r.ok) setError(r.error); };
  const o = e.outcome;
  const head = cleared
    ? { tone: 'success', icon: <ShieldCheck className="h-8 w-8" aria-hidden="true" />, title: 'Clearance Successful', text: `${record.firstName} ${record.lastName} has been cleared by ${UNILAG.name}.` }
    : o === 'identity-confirmed' ? { tone: 'success', icon: <CheckCircle2 className="h-8 w-8" aria-hidden="true" />, title: 'Identity Successfully Verified', text: 'The student’s identity is confirmed. You can complete clearance.' }
      : o === 'nin-mismatch' ? { tone: 'danger', icon: <AlertTriangle className="h-8 w-8" aria-hidden="true" />, title: 'Identity Discrepancy Detected', text: 'The candidate’s identity could not be fully confirmed. Please contact JAMB for further review.' }
        : o === 'duplicate-clearance' ? { tone: 'warning', icon: <ShieldAlert className="h-8 w-8" aria-hidden="true" />, title: 'Previous Clearance Record Found', text: 'This admission record has already been cleared by another institution. Clearance is blocked.' }
          : { tone: 'danger', icon: <XCircle className="h-8 w-8" aria-hidden="true" />, title: 'Identity Could Not Be Confirmed', text: 'The captured face does not match the student’s JAMB registration record.' };
  const banner = { success: 'bg-emerald-700 text-white', danger: 'bg-red-700 text-white', warning: 'bg-amber-500 text-amber-950' }[head.tone as 'success' | 'danger' | 'warning'];
  return (
    <Card className="overflow-hidden" aria-label="Verification result">
      <div className={cn('flex items-center gap-4 px-6 py-5', banner)}>
        {head.icon}
        <div><h2 className="text-xl font-semibold">{head.title}</h2><p className="text-sm opacity-90">{head.text}</p></div>
      </div>
      <div className="grid gap-6 px-6 py-6 md:grid-cols-[auto_1fr]">
        <figure className="w-36"><Portrait record={record} className="h-44 w-full" /><figcaption className="mt-1 text-center text-xs text-slate-500">JAMB registration portrait</figcaption></figure>
        {cleared ? (
          <dl className="grid content-start gap-x-6 gap-y-3 text-sm sm:grid-cols-2" aria-label="Clearance record">
            {([['Student', `${record.firstName} ${record.middleName} ${record.lastName}`], ['JAMB Registration Number', <span className="font-mono">{record.reg}</span>], ['Institution', UNILAG.name], ['Department', record.department],
              ['Admission session', record.session], ['Verification outcome', <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{record.nin === 'mismatch' ? 'Identity verified · NIN discrepancy resolved by JAMB' : 'Identity verified · JAMB and NIN match'}</span>],
              ['Clearance reference', <span className="font-mono">{record.clearanceRef}</span>], ['Clearance date and time', record.clearedAt ? dateTime(record.clearedAt) : '—'], ['Clearance officer', record.clearedBy], ['Clearance status', <Badge tone="success">Cleared</Badge>]] as [string, ReactNode][]).map(([k, v]) => (
              <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
            ))}
          </dl>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</span> · <span className="font-mono">{record.reg}</span> · {record.department}</p>
            <dl className="max-w-md divide-y divide-slate-100 text-sm" aria-label="Identity checks">
              <Check label="JAMB identity" value={e.checks?.face === 'match' ? 'Match' : 'No match'} good={e.checks?.face === 'match'} />
              {e.checks?.nin && <Check label="NIN verification" value={e.checks.nin === 'match' ? 'Match' : o === 'identity-confirmed' ? 'Mismatch · resolved by JAMB' : 'Mismatch'} good={e.checks.nin === 'match' || o === 'identity-confirmed'} />}
              <Check label={o === 'identity-confirmed' ? 'Identity status' : 'Overall identity status'} value={o === 'identity-confirmed' || o === 'duplicate-clearance' ? 'Confirmed' : 'Not confirmed'} good={o === 'identity-confirmed' || o === 'duplicate-clearance'} />
              {o === 'identity-confirmed' ? <Check label="Eligibility to proceed" value="Yes" good /> : <Check label="Clearance status" value="Blocked" good={false} />}
            </dl>
            {o === 'duplicate-clearance' && previous && (
              <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-200" aria-label="Previous clearance record">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {([['Previous institution', institutionByCode(previous.institution)?.name], ['Previous department', previous.department], ['Previous course', previous.course], ['Admission session', previous.session],
                    ['Clearance date and time', dateTime(previous.clearedAt)], ['Clearance officer', previous.clearedBy], ['Clearance reference', <span className="font-mono">{previous.reference}</span>], ['Clearance status', <Badge tone="success">Cleared</Badge>]] as [string, ReactNode][]).map(([k, v]) => (
                    <div key={k}><dt className="text-amber-900/70">{k}</dt><dd className="font-medium text-slate-900">{v}</dd></div>
                  ))}
                </dl>
              </div>
            )}
            {e.exceptionId && <p className="text-sm text-slate-600">Referred to JAMB: exception <span className="font-mono font-medium text-slate-900">{e.exceptionId}</span>.</p>}
          </div>
        )}
      </div>
      {cleared && evidence && capture && (
        <section aria-label="Verification details" className="mx-6 mb-5 grid gap-5 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200 sm:grid-cols-[auto_1fr]">
          <figure className="w-24"><img src={capture.url} alt="Captured face used for the verification" className="h-28 w-full rounded-lg object-cover ring-1 ring-slate-200" /><figcaption className="mt-1 text-center text-[11px] text-slate-500">Live capture</figcaption></figure>
          <dl className="grid content-start gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {([['Verification reference', <span className="font-mono">{e.ref}</span>], ['Verified', dateTime(e.at)], ['JAMB identity', 'Match'], ['NIN verification', e.checks?.nin === 'mismatch' ? 'Mismatch · resolved by JAMB' : 'Match']] as [string, ReactNode][]).map(([k, v]) => (
              <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>
            ))}
            <p className="text-xs text-slate-500 sm:col-span-2">The capture was used only for this verification and is not stored.</p>
          </dl>
        </section>
      )}
      {error && <p role="alert" className="px-6 pb-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
        {cleared ? (
          <>
            <ButtonLink to={`/clearance/certificate/${record.reg}`} variant="primary" icon={<Printer className="h-4 w-4" />}>Print Clearance Certificate</ButtonLink>
            <ButtonLink to={`/clearance/students/${record.reg}`} variant="secondary">View Clearance Details</ButtonLink>
            <ButtonLink to={listPath} variant="secondary">Return to Student List</ButtonLink>
            <Button variant="secondary" icon={<ScanFace className="h-4 w-4" />} onClick={onNext}>Verify Another Student</Button>
            {capture && <Button variant="ghost" className="sm:ml-auto" aria-expanded={evidence} onClick={() => setEvidence((v) => !v)}>{evidence ? 'Hide verification details' : 'View verification details'}</Button>}
          </>
        ) : o === 'identity-confirmed' ? (
          <>
            <Button size="lg" icon={<ShieldCheck className="h-4 w-4" />} onClick={complete}>Complete Clearance</Button>
            <ButtonLink to={listPath} variant="secondary" size="lg">Return to Student List</ButtonLink>
          </>
        ) : (
          <>
            {o === 'duplicate-clearance' && <Button variant="primary" onClick={() => setPrior(true)}>View Previous Clearance Record</Button>}
            <ButtonLink to={listPath} variant="secondary">Return to Student List</ButtonLink>
            <Button variant="secondary" icon={<ScanFace className="h-4 w-4" />} onClick={onNext}>Verify Another Student</Button>
          </>
        )}
      </div>
      {prior && previous && (
        <Modal open onClose={() => setPrior(false)} title="Previous clearance record" description={`${record.firstName} ${record.middleName} ${record.lastName} · ${record.reg}`} footer={<Button variant="secondary" onClick={() => setPrior(false)}>Close</Button>}>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {([['Institution', institutionByCode(previous.institution)?.name], ['Department', previous.department], ['Course', previous.course], ['Admission session', previous.session], ['JAMB Registration Number', <span className="font-mono">{record.reg}</span>],
              ['Cleared', dateTime(previous.clearedAt)], ['Clearance officer', previous.clearedBy], ['Clearance reference', <span className="font-mono">{previous.reference}</span>], ['Status', <Badge tone="success">Cleared</Badge>]] as [string, ReactNode][]).map(([k, v]) => (
              <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
            ))}
          </dl>
        </Modal>
      )}
    </Card>
  );
}

/* ---------------- My clearance records ---------------- */

function RecordsPage() {
  const mine = useMyRecords();
  const [view, setView] = useQueryState('view', 'all');
  const [q, setQ] = useQueryState('q');
  const [sess, setSess] = useQueryState('session', 'all');
  const [page, setPage] = usePageParam();
  const query = q.trim().toLowerCase();
  const rows = mine.filter((r) => (view === 'all' || recordStatus(r).key === view) && (sess === 'all' || sessionSlug(r.session) === sess)
    && (!query || r.reg.toLowerCase().includes(query.replace(/\s/g, '')) || `${r.firstName} ${r.lastName}`.toLowerCase().includes(query)))
    .sort((a, b) => (b.clearedAt ?? b.verifiedAt ?? '').localeCompare(a.clearedAt ?? a.verifiedAt ?? ''));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 20);
  const count = (k: string) => mine.filter((r) => recordStatus(r).key === k).length;
  return (
    <>
      <PageHeader title="My Clearance Records" description="Students you verified or cleared." />
      <Tabs value={view as 'all'} onChange={(v) => setView(v)} tabs={[
        { value: 'all', label: 'All', count: mine.length }, { value: 'cleared' as 'all', label: 'Cleared', count: count('cleared') },
        { value: 'failed' as 'all', label: 'Failed verification', count: count('failed') }, { value: 'blocked' as 'all', label: 'Duplicate blocked', count: count('blocked') },
        { value: 'exception' as 'all', label: 'Referred to JAMB', count: count('exception') },
      ]} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Student name or JAMB registration number" className="sm:w-80" label="Search records" />
          <FilterSelect label="Admission session" value={sess} onChange={setSess} options={[{ value: 'all', label: 'All sessions' }, ...SESSIONS.map((s) => ({ value: sessionSlug(s), label: s }))]} />
        </div>
        <DataTable rows={pageRows} rowKey={(r) => r.reg} rowHref={(r) => `/clearance/students/${r.reg}`} empty={<EmptyState title="No records match" />}
          columns={[
            { key: 'n', header: 'Student', className: '!whitespace-normal min-w-[10rem]', cell: (r) => <Link to={`/clearance/students/${r.reg}`} className="font-medium text-slate-900 hover:text-brand-700">{r.lastName}, {r.firstName}</Link> },
            { key: 'r', header: 'JAMB registration number', cell: (r) => <span className="font-mono text-xs">{r.reg}</span> },
            { key: 'd', header: 'Department', cell: (r) => <span className="text-slate-600">{r.department}</span> },
            { key: 's', header: 'Session', cell: (r) => r.session },
            { key: 'st', header: 'Status', cell: (r) => { const s = recordStatus(r); return <Badge tone={s.tone}>{s.label}</Badge>; } },
            { key: 'at', header: 'Date', cell: (r) => <span className="tabular-nums text-slate-600">{formatDate(r.clearedAt ?? r.verifiedAt ?? r.registeredAt)}</span> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={20} onPage={setPage} />
      </Card>
    </>
  );
}

function ClearanceStudentPage() {
  const { reg = '' } = useParams();
  const state = useJambState();
  const officer = useOfficer();
  const toast = useToast();
  const [matric, setMatric] = useState<string | null>(null);
  const [error, setError] = useState('');
  const r = ownRecord(reg, state);
  if (!r) return <NotFound what="Student" back="/clearance/records" />;
  const clear = () => { const x = confirmClearance(r.reg, officer); toast(x.ok ? { tone: 'success', title: 'Clearance completed', description: x.value.clearanceRef } : { tone: 'error', title: 'Not cleared', description: x.error }); };
  const confirmMatric = () => {
    const x = confirmMatriculation(r.reg, officer, matric ?? undefined);
    if (!x.ok) { setError(x.error); return; }
    setMatric(null);
    toast({ tone: 'success', title: 'Matriculation confirmed', description: x.value.matricNo });
  };
  const active = r.session === ACTIVE_SESSION;
  const actions = (
    <>
      {active && r.clearance !== 'cleared' && !r.blocked && r.verification !== 'verified' && <ButtonLink to={`/clearance/verify?reg=${r.reg}`} variant="primary" icon={<ScanFace className="h-4 w-4" />}>Verify Student</ButtonLink>}
      {active && r.clearance !== 'cleared' && !r.blocked && r.verification === 'verified' && <Button icon={<ShieldCheck className="h-4 w-4" />} onClick={clear}>Complete Clearance</Button>}
      {r.clearance === 'cleared' && <ButtonLink to={`/clearance/certificate/${r.reg}`} icon={<Printer className="h-4 w-4" />}>Clearance Certificate</ButtonLink>}
      {r.clearance === 'cleared' && r.matriculation !== 'matriculated' && <Button onClick={() => { setError(''); setMatric(''); }}>Confirm Matriculation</Button>}
    </>
  );
  return (
    <>
      <PageHeader title="" breadcrumbs={[{ label: 'My Clearance Records', to: '/clearance/records' }, { label: `${r.firstName} ${r.lastName}` }]} />
      <StudentJourney record={r} actions={actions} />
      {matric !== null && (
        <Modal open onClose={() => setMatric(null)} title="Confirm matriculation" description={`${r.firstName} ${r.lastName} · ${UNILAG.name}`}
          footer={<><Button variant="secondary" onClick={() => setMatric(null)}>Cancel</Button><Button onClick={confirmMatric}>Confirm matriculation</Button></>}>
          <div className="space-y-3">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <Field label="Matriculation number" hint="Leave empty to assign the next number.">{(p) => <Input {...p} value={matric} onChange={(e) => setMatric(e.target.value)} />}</Field>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The clearance officer only sees their own institution's certificates. */
function CertificateGuard() {
  const { reg = '' } = useParams();
  const state = useJambState();
  if (!ownRecord(reg, state)) return <NotFound what="Certificate" back="/clearance/records" />;
  return <CertificatePage backTo={(r) => `/clearance/students/${r}`} />;
}
