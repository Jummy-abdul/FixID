import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Camera, CheckCircle2, ChevronRight, Loader2, Printer, RefreshCcw, ScanFace, Search, ShieldCheck, XCircle } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, CardHeader, DataTable, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, StatCard, usePageSlice, useToast,
} from '@/components/ui';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate, formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { SESSIONS, UNILAG, institutionByCode, sessionFromSlug, sessionSlug, type Session, type StudentRecord } from './data';
import { CertificatePage } from './certificate';
import { NotFound, SessionStats } from './JambConsole';
import { StudentJourney } from './journey';
import {
  OUTCOME_LABEL, clearanceReference, confirmClearance, confirmMatriculation, countsOf, expectedOutcome, institutionCounts, lookupForClearance, outcomeKind, recordOf,
  recordVerification, recordsOf, useJambState, type VerificationEvent, type VerificationOutcome,
} from './store';
import { StudentTable } from './students';
import { ConsoleShell, Portrait, ProgressMeter, SERIES, VerificationBadge, fmt, simulatedCaptureDataUrl, useOfficer } from './ui';

const NAV = [
  { label: 'Dashboard', to: '/clearance', end: true }, { label: 'Clearance', to: '/clearance/sessions' },
  { label: 'Verify student', to: '/clearance/verify' }, { label: 'Cleared students', to: '/clearance/cleared' },
];

/** The University Clearance Officer's console: verify and clear the students JAMB assigned to the institution. */
export function ClearanceConsole() {
  return (
    <ConsoleShell context={{ title: UNILAG.name, subtitle: 'University Clearance Officer' }} nav={NAV} roleLabel="University Clearance Officer">
      <Routes>
        <Route index element={<ClearanceDashboard />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="sessions/:session" element={<SessionWorkspace />} />
        <Route path="verify" element={<VerifyStudentPage />} />
        <Route path="cleared" element={<ClearedStudentsPage />} />
        <Route path="students/:reg" element={<ClearanceStudentPage />} />
        <Route path="certificate/:reg" element={<CertificateGuard />} />
        <Route path="*" element={<Navigate to="/clearance" replace />} />
      </Routes>
    </ConsoleShell>
  );
}

const ownRecord = (reg: string, state: ReturnType<typeof useJambState>) => {
  const r = recordOf(reg, state);
  return r && r.institution === UNILAG.code ? r : undefined;
};
const share = (v: number, t: number) => `${t ? Math.round((v / t) * 100) : 0}% of admitted`;

function ClearanceDashboard() {
  const state = useJambState();
  const c = institutionCounts(UNILAG.code, state);
  const recent = state.events.filter((e) => e.institution === UNILAG.code).slice(0, 6);
  return (
    <>
      <PageHeader title="Clearance dashboard" description={`Students admitted to ${UNILAG.name} by JAMB.`} />
      <section aria-label="Start a verification" className="flex flex-col gap-4 rounded-2xl bg-emerald-900 px-6 py-5 text-white sm:flex-row sm:items-center">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10"><ScanFace className="h-6 w-6" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Verify and clear a student</h2>
          <p className="text-sm text-emerald-100">Enter the JAMB Registration Number, capture the student’s face, and complete clearance.</p>
        </div>
        <ButtonLink to="/clearance/verify" variant="secondary" size="lg" icon={<ScanFace className="h-5 w-5" />}>Verify Student</ButtonLink>
      </section>
      <section aria-label="Clearance summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Admitted" value={fmt(c.admitted)} hint="Assigned by JAMB" />
        <StatCard label="Cleared" value={fmt(c.cleared)} tone="emerald" to="/clearance/cleared" hint={share(c.cleared, c.admitted)} />
        <StatCard label="Awaiting clearance" value={fmt(c.pending)} tone="amber" hint={share(c.pending, c.admitted)} />
        <StatCard label="Failed verification" value={fmt(c.failed)} hint="Face match unsuccessful" />
        <StatCard label="Exceptions" value={fmt(c.exceptions)} hint="Identity record issues" />
        <StatCard label="Matriculated" value={fmt(c.matriculated)} tone="violet" hint={share(c.matriculated, c.admitted)} />
      </section>
      <Card className="px-5 py-5">
        <div className="grid gap-6 md:grid-cols-2">
          <ProgressMeter label="Clearance progress" value={c.cleared} total={c.admitted} hint={`${fmt(c.pending)} students still to clear`} />
          <ProgressMeter label="Matriculation confirmed" value={c.matriculated} total={c.admitted} color={SERIES.s2} hint={`${fmt(c.clearedNotMatriculated)} cleared, awaiting matriculation`} />
        </div>
      </Card>
      <SessionsTable />
      <Card>
        <CardHeader title="Recent verifications" />
        {recent.length === 0 ? <EmptyState icon={<ScanFace className="h-5 w-5" />} title="No recent verifications" description="Verified students appear here." /> : <EventList events={recent} />}
      </Card>
    </>
  );
}

function EventList({ events }: { events: VerificationEvent[] }) {
  const state = useJambState();
  return (
    <ul className="divide-y divide-slate-100" aria-label="Recent verifications">
      {events.map((e) => {
        const r = e.reg ? recordOf(e.reg, state) : undefined;
        const kind = outcomeKind(e.outcome);
        return (
          <li key={e.ref} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
            <span>{r ? <Link to={`/clearance/students/${r.reg}`} className="font-medium text-slate-900 hover:text-brand-700">{r.firstName} {r.lastName}</Link> : <span className="font-mono text-slate-700">{e.input || '—'}</span>} <span className="text-slate-500">· {e.session}</span></span>
            <span className="flex items-center gap-2"><Badge tone={kind === 'success' ? 'success' : kind === 'failed' ? 'danger' : 'warning'}>{OUTCOME_LABEL[e.outcome]}</Badge><span className="text-slate-500">{formatDateTime(e.at)}</span></span>
          </li>
        );
      })}
    </ul>
  );
}

function SessionsTable() {
  const state = useJambState();
  const rows = SESSIONS.map((s) => ({ s, c: countsOf(UNILAG.code, s, state) }));
  return (
    <Card>
      <CardHeader title="Admission sessions" />
      <DataTable rows={rows} rowKey={(r) => r.s} rowHref={(r) => `/clearance/sessions/${sessionSlug(r.s)}`}
        columns={[
          { key: 's', header: 'Admission session', cell: ({ s }) => <Link to={`/clearance/sessions/${sessionSlug(s)}`} className="font-semibold text-slate-900 hover:text-brand-700">{s}</Link> },
          { key: 'a', header: 'Assigned', cell: ({ c }) => <span className="tabular-nums">{fmt(c.admitted)}</span> },
          { key: 'c', header: 'Cleared', cell: ({ c }) => <span className="tabular-nums">{fmt(c.cleared)}</span> },
          { key: 'p', header: 'Pending', cell: ({ c }) => <span className="tabular-nums">{fmt(c.pending)}</span> },
          { key: 'f', header: 'Failed', cell: ({ c }) => <span className="tabular-nums">{fmt(c.failed)}</span> },
          { key: 'g', header: 'Clearance progress', className: 'min-w-[11rem]', cell: ({ c }) => (
            <span className="flex items-center gap-2"><span className="h-2 w-28 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${(c.cleared / c.admitted) * 100}%`, background: SERIES.s1 }} /></span><span className="tabular-nums text-slate-600">{Math.round((c.cleared / c.admitted) * 100)}%</span></span>
          ) },
          { key: 'open', header: <span className="sr-only">Open</span>, cell: ({ s }) => <span className="inline-flex items-center gap-0.5 text-sm font-medium text-brand-600">Open<span className="sr-only"> {s}</span><ChevronRight className="h-4 w-4" aria-hidden="true" /></span> },
        ]} />
    </Card>
  );
}

function SessionsPage() {
  return (
    <>
      <PageHeader title="Clearance" description="Students by the admission session JAMB assigned them to." actions={<ButtonLink to="/clearance/verify" variant="primary" icon={<ScanFace className="h-4 w-4" />}>Verify Student</ButtonLink>} />
      <SessionsTable />
    </>
  );
}

function SessionWorkspace() {
  const { session: slug = '' } = useParams();
  const session = sessionFromSlug(slug);
  const state = useJambState();
  if (!session) return <NotFound what="Admission session" back="/clearance/sessions" />;
  const c = countsOf(UNILAG.code, session, state);
  return (
    <>
      <PageHeader title={`${session} Admission Session`} description={UNILAG.name} breadcrumbs={[{ label: 'Clearance', to: '/clearance/sessions' }, { label: session }]}
        actions={<ButtonLink to={`/clearance/verify?session=${slug}`} variant="primary" icon={<ScanFace className="h-4 w-4" />}>Verify Student</ButtonLink>} />
      <SessionStats c={c} compact />
      <StudentTable inst={UNILAG} session={session} studentPath={(reg) => `/clearance/students/${reg}`} showFaculty={false} showMatriculation={false} />
    </>
  );
}

/* ---------------- Verify Student: two steps ---------------- */

const STEPS = ['Identify student', 'Capture face and verify'];
type Capture = { url: string; mode: 'camera' | 'simulated' };
type DemoResponse = 'record' | Exclude<VerificationOutcome, 'not-found' | 'invalid'>;

function Steps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="flex flex-wrap items-center gap-3 text-sm" aria-label="Verification steps">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const done = n < current;
        return (
          <li key={s} aria-current={n === current ? 'step' : undefined} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-8 bg-slate-300" aria-hidden="true" />}
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold', n === current ? 'bg-emerald-700 text-white' : done ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500')}>
              {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : n}
            </span>
            <span className={cn('font-medium', n === current ? 'text-slate-900' : 'text-slate-500')}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

function VerifyStudentPage() {
  const officer = useOfficer();
  const state = useJambState();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const session = sessionFromSlug(params.get('session') ?? '') ?? '2026/2027';
  const slug = sessionSlug(session);
  const [entered, setEntered] = useState(params.get('reg') ?? '');
  const [error, setError] = useState('');
  const [issue, setIssue] = useState<'invalid' | 'not-found' | null>(null);
  const [reg, setReg] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [demo, setDemo] = useState<DemoResponse>('record');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerificationEvent | null>(null);
  const record = reg ? recordOf(reg, state) : undefined;

  const restart = () => { setStep(1); setReg(null); setCapture(null); setResult(null); setEntered(''); setIssue(null); setDemo('record'); };
  const lookup = (value: string) => {
    setIssue(null); setReg(null);
    if (!value.trim()) { setError('Enter the student’s JAMB Registration Number.'); return; }
    setError('');
    const r = lookupForClearance(value, session, officer);
    if (!r.ok) { recordVerification({ entered: value, session, officer, outcome: r.outcome, captureMode: 'simulated' }); setIssue(r.outcome); return; }
    setReg(r.record.reg);
  };
  // Arriving from a student's record: look the student up straight away.
  const auto = useRef(false);
  useEffect(() => { if (!auto.current && params.get('reg')) { auto.current = true; lookup(params.get('reg')!); } });

  const verify = (c: Capture) => {
    if (!record) return;
    setVerifying(true); setResult(null);
    window.setTimeout(() => {
      const outcome = demo === 'record' ? expectedOutcome(record) : demo;
      const r = recordVerification({ entered: record.reg, session, officer, outcome, captureMode: c.mode, capture: c.url, record });
      setVerifying(false);
      if (r.ok) setResult(r.value);
    }, 900);
  };
  const onCapture = (c: Capture | null) => { setCapture(c); setResult(null); if (c) verify(c); };

  return (
    <>
      <PageHeader title="Verify student" breadcrumbs={[{ label: 'Clearance', to: '/clearance/sessions' }, { label: session, to: `/clearance/sessions/${slug}` }, { label: 'Verify student' }]} />
      <Steps current={step} />

      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
          <Card className="px-5 py-5">
            <form onSubmit={(e) => { e.preventDefault(); lookup(entered); }} className="space-y-4" noValidate>
              <div className="[&_select]:w-full">
                <FilterSelect label="Admission session" value={slug} onChange={(v) => { setParams((p) => { const n = new URLSearchParams(p); n.set('session', v); n.delete('reg'); return n; }, { replace: true }); restart(); }}
                  options={SESSIONS.map((s) => ({ value: sessionSlug(s), label: `${s} Admission Session` }))} />
              </div>
              <Field label="JAMB Registration Number" required error={error}>
                {(p) => <Input {...p} value={entered} autoFocus autoComplete="off" placeholder="e.g. 20260100012AB" className="h-12 font-mono text-base uppercase tracking-wide" onChange={(e) => { setEntered(e.target.value); setError(''); setIssue(null); setReg(null); }} />}
              </Field>
              <Button type="submit" size="lg" className="w-full" icon={<Search className="h-4 w-4" />}>Find student</Button>
            </form>
          </Card>
          <div aria-live="polite">
            {issue && (
              <Notice tone="warning" title={issue === 'invalid' ? 'Invalid registration number' : 'Student not found'}>
                {issue === 'invalid' ? 'This isn’t a valid JAMB Registration Number. Check it with the student and try again.' : `No student with this registration number was admitted to ${UNILAG.name} for the ${session} session.`}
              </Notice>
            )}
            {record?.clearance === 'cleared' && (
              <Notice tone="success" title="Already cleared">
                {record.firstName} {record.lastName} was cleared on {record.clearedAt ? formatDateTime(record.clearedAt) : '—'}. <Link to={`/clearance/certificate/${record.reg}`} className="font-semibold underline">View clearance certificate</Link>
              </Notice>
            )}
            {record && record.clearance !== 'cleared' && (
              <Card className="px-5 py-5" aria-label="Student record">
                <div className="flex flex-col gap-5 sm:flex-row">
                  <figure className="w-32 shrink-0"><Portrait seed={record.reg} gender={record.gender} stage="registration" label="JAMB registration portrait" className="h-40" /><figcaption className="mt-1 text-center text-xs text-slate-500">Registration portrait</figcaption></figure>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Student found</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</h2>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" aria-label="Student information">
                      {([['JAMB Registration Number', <span className="font-mono">{record.reg}</span>], ['Institution', UNILAG.name], ['Department', record.department], ['Admission session', record.session]] as const).map(([k, v]) => (
                        <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
                      ))}
                    </dl>
                    {record.verification === 'failed' && <p className="mt-3 text-sm text-amber-800">A previous face match for this student was unsuccessful.</p>}
                    <Button className="mt-5" size="lg" icon={<ArrowRight className="h-4 w-4" />} onClick={() => setStep(2)}>Confirm and continue</Button>
                  </div>
                </div>
              </Card>
            )}
            {!issue && !record && (
              <div className="flex h-full min-h-[10rem] items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 text-center text-sm text-slate-500">
                The student’s record appears here once found.
              </div>
            )}
          </div>
        </div>
      )}

      {step === 2 && record && (
        <>
          {!result && !verifying && (
            <Card className="px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">{record.firstName} {record.lastName}</span> · <span className="font-mono">{record.reg}</span> · {record.department}</p>
                <Button size="sm" variant="ghost" onClick={() => { setStep(1); setCapture(null); }}>Change student</Button>
              </div>
              <CameraCapture record={record} onCapture={onCapture} />
              <details className="mt-6 text-xs text-slate-500">
                <summary className="cursor-pointer select-none">Demo options</summary>
                <div className="mt-2 max-w-sm">
                  <FilterSelect label="Verification response" value={demo} onChange={(v) => setDemo(v as DemoResponse)} options={[
                    { value: 'record', label: 'From the student’s record' }, { value: 'match', label: 'Match' }, { value: 'no-match', label: 'No match' },
                    { value: 'missing-record', label: 'Missing identity record' }, { value: 'unavailable', label: 'Service unavailable' },
                  ]} />
                </div>
              </details>
            </Card>
          )}
          {verifying && (
            <Card className="flex flex-col items-center gap-3 px-5 py-14 text-center" role="status">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-700" aria-hidden="true" />
              <p className="text-lg font-semibold text-slate-900">Verifying identity…</p>
              <p className="text-sm text-slate-500">Matching the captured face against the JAMB registration record.</p>
            </Card>
          )}
          {result && capture && (
            <ResultPanel event={result} record={record} capture={capture} session={session}
              onRetry={() => verify(capture)} onRecapture={() => { setCapture(null); setResult(null); }}
              onNext={() => { restart(); navigate(`/clearance/verify?session=${slug}`, { replace: true }); }} />
          )}
        </>
      )}
    </>
  );
}

function Notice({ tone, title, children }: { tone: 'success' | 'warning'; title: string; children: ReactNode }) {
  return (
    <div role="status" className={cn('rounded-xl px-5 py-4 text-sm ring-1 ring-inset', tone === 'success' ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200')}>
      <p className="flex items-center gap-2 font-semibold">{tone === 'success' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** The result is the focus: a clear outcome, the two portraits side by side, and the next action. */
function ResultPanel({ event: e, record, capture, session, onRetry, onRecapture, onNext }: {
  event: VerificationEvent; record: StudentRecord; capture: Capture; session: Session; onRetry: () => void; onRecapture: () => void; onNext: () => void;
}) {
  const officer = useOfficer();
  const [error, setError] = useState('');
  const cleared = record.clearance === 'cleared';
  const listPath = `/clearance/sessions/${sessionSlug(session)}`;
  const complete = () => { const r = confirmClearance(record.reg, officer); if (!r.ok) setError('Clearance couldn’t be completed. Verify the student again.'); };
  const head = cleared
    ? { tone: 'success', icon: <ShieldCheck className="h-8 w-8" aria-hidden="true" />, title: 'Clearance Successful', text: `${record.firstName} ${record.lastName} has been cleared by ${UNILAG.name}.` }
    : e.outcome === 'match'
      ? { tone: 'success', icon: <CheckCircle2 className="h-8 w-8" aria-hidden="true" />, title: 'Identity Verified', text: 'The student’s identity has been successfully confirmed against the JAMB registration record.' }
      : e.outcome === 'no-match'
        ? { tone: 'failed', icon: <XCircle className="h-8 w-8" aria-hidden="true" />, title: 'Identity Could Not Be Confirmed', text: 'The captured face could not be successfully matched against the student’s registration record.' }
        : e.outcome === 'missing-record'
          ? { tone: 'warning', icon: <AlertTriangle className="h-8 w-8" aria-hidden="true" />, title: 'Identity Record Unavailable', text: 'JAMB holds no complete identity record for this student, so the face couldn’t be matched. Refer the student to JAMB to resolve their record.' }
          : { tone: 'warning', icon: <AlertTriangle className="h-8 w-8" aria-hidden="true" />, title: 'Verification Temporarily Unavailable', text: 'The identity verification service didn’t respond. Nothing has been recorded against the student: please try again.' };
  const banner = { success: 'bg-emerald-700 text-white', failed: 'bg-red-700 text-white', warning: 'bg-amber-500 text-amber-950' }[head.tone as 'success' | 'failed' | 'warning'];
  const rows: [string, ReactNode][] = cleared
    ? [['Clearance reference', <span className="font-mono">{clearanceReference(record)}</span>], ['Date and time', record.clearedAt ? formatDateTime(record.clearedAt) : '—'], ['Student', `${record.firstName} ${record.middleName} ${record.lastName}`],
      ['JAMB Registration Number', <span className="font-mono">{record.reg}</span>], ['Department', record.department], ['Admission session', record.session],
      ['Identity verification', 'Verified: face match successful'], ['Clearance status', <Badge tone="success">Cleared</Badge>], ['Clearance officer', record.clearedBy]]
    : [['Student', `${record.firstName} ${record.middleName} ${record.lastName}`], ['JAMB Registration Number', <span className="font-mono">{record.reg}</span>],
      ['Verification result', OUTCOME_LABEL[e.outcome]], ['Verification reference', <span className="font-mono">{e.ref}</span>]];
  return (
    <Card className="overflow-hidden" aria-label="Verification result">
      <div className={cn('flex items-center gap-4 px-6 py-5', banner)}>
        {head.icon}
        <div><h2 className="text-xl font-semibold">{head.title}</h2><p className="text-sm opacity-90">{head.text}</p></div>
      </div>
      <div className="grid gap-6 px-6 py-6 md:grid-cols-[auto_1fr]">
        <div className="flex gap-4">
          <figure className="w-28"><Portrait seed={record.reg} gender={record.gender} stage="registration" label="JAMB registration portrait" className="h-36" /><figcaption className="mt-1 text-center text-xs text-slate-500">Registration</figcaption></figure>
          <figure className="w-28"><img src={capture.url} alt="Captured portrait" className="h-36 w-full rounded-lg object-cover ring-1 ring-slate-200" /><figcaption className="mt-1 text-center text-xs text-slate-500">{capture.mode === 'camera' ? 'Captured' : 'Captured (demo)'}</figcaption></figure>
        </div>
        <dl className="grid content-start gap-x-6 gap-y-3 text-sm sm:grid-cols-2" aria-label={cleared ? 'Clearance record' : 'Verification details'}>
          {rows.map(([k, v]) => <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>)}
        </dl>
      </div>
      {error && <p role="alert" className="px-6 pb-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
        {cleared ? (
          <>
            <ButtonLink to={`/clearance/certificate/${record.reg}`} variant="primary" icon={<Printer className="h-4 w-4" />}>Print clearance certificate</ButtonLink>
            <ButtonLink to={`/clearance/students/${record.reg}`} variant="secondary">View clearance details</ButtonLink>
            <ButtonLink to={listPath} variant="secondary">Return to student list</ButtonLink>
            <Button variant="secondary" icon={<ScanFace className="h-4 w-4" />} onClick={onNext}>Verify another student</Button>
          </>
        ) : e.outcome === 'match' ? (
          <>
            <Button size="lg" icon={<ShieldCheck className="h-4 w-4" />} onClick={complete}>Complete Clearance</Button>
            <ButtonLink to={listPath} variant="secondary" size="lg">Return to student list</ButtonLink>
          </>
        ) : (
          <>
            {e.outcome !== 'missing-record' && <Button icon={<RefreshCcw className="h-4 w-4" />} onClick={onRetry}>Retry verification</Button>}
            {e.outcome !== 'missing-record' && <Button variant="secondary" icon={<Camera className="h-4 w-4" />} onClick={onRecapture}>Recapture portrait</Button>}
            <ButtonLink to={`/clearance/students/${record.reg}`} variant="secondary">Return to student record</ButtonLink>
            {e.outcome === 'missing-record' && <Button variant="secondary" icon={<ScanFace className="h-4 w-4" />} onClick={onNext}>Verify another student</Button>}
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Face capture: the browser camera when available and permitted; otherwise a demo capture. Capturing hands the
 * image straight to verification. The image stays in this page's memory and is never stored or sent.
 */
function CameraCapture({ record, onCapture }: { record: StudentRecord; onCapture: (c: Capture) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'unavailable'>('idle');
  const [message, setMessage] = useState('');
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => stop, []);
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setState('unavailable'); setMessage('A camera isn’t available on this device.'); return; }
    setState('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      setState('live');
      requestAnimationFrame(() => { if (video.current && stream.current) { video.current.srcObject = stream.current; void video.current.play().catch(() => undefined); } });
    } catch (e) {
      setState('unavailable');
      setMessage((e as DOMException)?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser to capture the student’s face.' : 'The camera couldn’t be started.');
    }
  };
  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    stop(); setState('idle');
    onCapture({ url: canvas.toDataURL('image/jpeg', 0.85), mode: 'camera' });
  };
  const demo = () => { stop(); setState('idle'); onCapture({ url: simulatedCaptureDataUrl(record.reg, record.gender), mode: 'simulated' }); };
  return (
    <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,22rem)_1fr] md:items-center">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-900">
        {state === 'live'
          ? <video ref={video} playsInline muted aria-label="Camera preview" className="h-full w-full object-cover [transform:scaleX(-1)]" />
          : <div className="flex h-full items-center justify-center text-slate-400"><ScanFace className="h-16 w-16" aria-hidden="true" /></div>}
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed border-white/70" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Capture the student’s face</h2>
        <p className="mt-1 text-sm text-slate-600">Position the face inside the oval, looking at the camera in good light.</p>
        {state === 'unavailable' && <p role="status" className="mt-3 text-sm text-amber-800">{message}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {state === 'live'
            ? <Button size="lg" icon={<Camera className="h-5 w-5" />} onClick={take}>Capture and verify</Button>
            : <Button size="lg" icon={state === 'starting' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />} disabled={state === 'starting'} onClick={start}>Start camera</Button>}
          {state === 'unavailable' && <Button size="lg" variant="secondary" onClick={demo}>Use demo capture</Button>}
        </div>
        {state !== 'unavailable' && <button type="button" onClick={demo} className="mt-3 text-xs text-slate-500 underline-offset-2 hover:underline">No camera? Use demo capture</button>}
      </div>
    </div>
  );
}

/* ---------------- cleared students and profiles ---------------- */

function ClearedStudentsPage() {
  const state = useJambState();
  const [q, setQ] = useQueryState('q');
  const [sess, setSess] = useQueryState('session', 'all');
  const [page, setPage] = usePageParam();
  const all = useMemo(() => SESSIONS.flatMap((s) => recordsOf(UNILAG, s, state)).filter((r) => r.clearance === 'cleared'), [state]);
  const query = q.trim().toLowerCase();
  const rows = all.filter((r) => (sess === 'all' || sessionSlug(r.session) === sess) && (!query || r.reg.toLowerCase().includes(query.replace(/\s/g, '')) || `${r.firstName} ${r.lastName}`.toLowerCase().includes(query)))
    .sort((a, b) => (b.clearedAt ?? '').localeCompare(a.clearedAt ?? ''));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 20);
  return (
    <>
      <PageHeader title="Cleared students" description={`Students who completed identity verification and institutional clearance at ${UNILAG.name}.`} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Student name or JAMB registration number" className="sm:w-80" label="Search cleared students" />
          <FilterSelect label="Admission session" value={sess} onChange={setSess} options={[{ value: 'all', label: 'All sessions' }, ...SESSIONS.map((s) => ({ value: sessionSlug(s), label: s }))]} />
        </div>
        <DataTable rows={pageRows} rowKey={(r) => r.reg} rowHref={(r) => `/clearance/students/${r.reg}`} empty={<EmptyState title="No cleared students match" />}
          columns={[
            { key: 'n', header: 'Student', cell: (r) => <Link to={`/clearance/students/${r.reg}`} className="font-medium text-slate-900 hover:text-brand-700">{r.lastName}, {r.firstName}</Link> },
            { key: 'r', header: 'JAMB registration number', cell: (r) => <span className="font-mono text-xs">{r.reg}</span> },
            { key: 'd', header: 'Department', cell: (r) => <span className="text-slate-600">{r.department}</span> },
            { key: 's', header: 'Session', cell: (r) => r.session },
            { key: 'v', header: 'Identity verification', cell: (r) => <VerificationBadge status={r.verification} /> },
            { key: 'c', header: 'Clearance', cell: () => <Badge tone="success">Cleared</Badge> },
            { key: 'at', header: 'Date cleared', cell: (r) => <span className="tabular-nums text-slate-600">{r.clearedAt ? formatDate(r.clearedAt) : '—'}</span> },
            { key: 'o', header: 'Clearance officer', cell: (r) => <span className="text-slate-600">{r.clearedBy}</span> },
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
  if (!r) return <NotFound what="Student" back="/clearance/sessions" />;
  const clear = () => { const x = confirmClearance(r.reg, officer); toast(x.ok ? { tone: 'success', title: 'Student cleared' } : { tone: 'error', title: 'Not cleared', description: x.error }); };
  const confirmMatric = () => {
    const x = confirmMatriculation(r.reg, officer, matric ?? undefined);
    if (!x.ok) { setError(x.error); return; }
    setMatric(null);
    toast({ tone: 'success', title: 'Matriculation confirmed', description: x.value.matricNo });
  };
  const actions = (
    <>
      {r.clearance !== 'cleared' && r.verification !== 'verified' && <ButtonLink to={`/clearance/verify?session=${sessionSlug(r.session)}&reg=${r.reg}`} variant="primary" icon={<ScanFace className="h-4 w-4" />}>Verify student</ButtonLink>}
      {r.clearance !== 'cleared' && r.verification === 'verified' && <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={clear}>Confirm clearance</Button>}
      {r.clearance === 'cleared' && <ButtonLink to={`/clearance/certificate/${r.reg}`} variant="secondary">View certificate</ButtonLink>}
      {r.clearance === 'cleared' && r.matriculation !== 'matriculated' && <Button onClick={() => { setError(''); setMatric(''); }}>Confirm matriculation</Button>}
    </>
  );
  return (
    <>
      <PageHeader title="" breadcrumbs={[{ label: 'Clearance', to: '/clearance/sessions' }, { label: r.session, to: `/clearance/sessions/${sessionSlug(r.session)}` }, { label: `${r.firstName} ${r.lastName}` }]} />
      <StudentJourney record={r} actions={actions} />
      {matric !== null && (
        <Modal open onClose={() => setMatric(null)} title="Confirm matriculation" description={`${r.firstName} ${r.lastName} · ${institutionByCode(r.institution)?.name}`}
          footer={<><Button variant="secondary" onClick={() => setMatric(null)}>Cancel</Button><Button onClick={confirmMatric}>Confirm matriculation</Button></>}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">The institution confirms that this cleared student has matriculated. JAMB sees the confirmation in its reconciliation.</p>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <Field label="Matriculation number" hint="Optional: leave empty to assign the next number.">{(p) => <Input {...p} value={matric} onChange={(e) => setMatric(e.target.value)} />}</Field>
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
  if (!ownRecord(reg, state)) return <NotFound what="Certificate" back="/clearance/cleared" />;
  return <CertificatePage backTo={(r) => `/clearance/students/${r}`} />;
}
