import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Camera, CheckCircle2, Fingerprint, Loader2, RefreshCcw, ScanFace, UserCheck, XCircle } from 'lucide-react';
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
import { ConsoleShell, DemoNote, FixIdMark, Portrait, ProgressMeter, SERIES, VerificationBadge, fmt, simulatedCaptureDataUrl, useOfficer } from './ui';

const NAV = [
  { label: 'Dashboard', to: '/clearance', end: true }, { label: 'Clearance', to: '/clearance/sessions' },
  { label: 'Verify student', to: '/clearance/verify' }, { label: 'Cleared students', to: '/clearance/cleared' },
];

/** The University Clearance Officer's console: verify and clear the students JAMB assigned to the institution. */
export function ClearanceConsole() {
  const brand = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600"><Fingerprint className="h-6 w-6 text-white" aria-hidden="true" /></span>
      <div className="min-w-0 leading-tight">
        <p className="truncate font-semibold">{UNILAG.name}</p>
        <p className="truncate text-xs text-slate-300">Student Identity Verification &amp; Clearance</p>
        <FixIdMark />
      </div>
    </div>
  );
  return (
    <ConsoleShell brand={brand} tone="university" nav={NAV} roleLabel="University Clearance Officer · UNILAG">
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

function ClearanceDashboard() {
  const state = useJambState();
  const c = institutionCounts(UNILAG.code, state);
  const recent = state.events.filter((e) => e.institution === UNILAG.code).slice(0, 6);
  return (
    <>
      <PageHeader title="Clearance dashboard" description={`Students JAMB admitted to ${UNILAG.name}, and their identity verification and clearance.`}
        actions={<ButtonLink to="/clearance/verify" variant="primary" icon={<ScanFace className="h-4 w-4" />}>Verify Student</ButtonLink>} />
      <DemoNote>Illustrative students and figures. Face matching is simulated: no JAMB service is called and nothing biometric is stored.</DemoNote>
      <section aria-label="Clearance summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Admitted (assigned by JAMB)" value={fmt(c.admitted)} />
        <StatCard label="Cleared" value={fmt(c.cleared)} tone="emerald" to="/clearance/cleared" />
        <StatCard label="Awaiting clearance" value={fmt(c.pending)} tone="amber" />
        <StatCard label="Failed identity verification" value={fmt(c.failed)} />
        <StatCard label="Verification exceptions" value={fmt(c.exceptions)} />
        <StatCard label="Matriculated" value={fmt(c.matriculated)} tone="violet" />
      </section>
      <Card className="px-5 py-5">
        <div className="grid gap-5 md:grid-cols-2">
          <ProgressMeter label="Clearance progress" value={c.cleared} total={c.admitted} />
          <ProgressMeter label="Matriculation confirmed" value={c.matriculated} total={c.admitted} color={SERIES.s2} hint={`${fmt(c.clearedNotMatriculated)} cleared students are awaiting matriculation confirmation.`} />
        </div>
      </Card>
      <SessionsTable />
      <Card>
        <CardHeader title="Recent verifications" />
        {recent.length === 0 ? <EmptyState icon={<ScanFace className="h-5 w-5" />} title="No verifications yet in this demo" description="Choose Verify Student to verify an admitted student against their JAMB record." /> : <EventList events={recent} />}
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
      <CardHeader title="Admission sessions" description="Select a session to open its clearance workspace." />
      <DataTable rows={rows} rowKey={(r) => r.s} rowHref={(r) => `/clearance/sessions/${sessionSlug(r.s)}`}
        columns={[
          { key: 's', header: 'Admission session', cell: ({ s }) => <Link to={`/clearance/sessions/${sessionSlug(s)}`} className="font-medium text-slate-900 hover:text-brand-700">{s}</Link> },
          { key: 'a', header: 'Students assigned', cell: ({ c }) => <span className="tabular-nums">{fmt(c.admitted)}</span> },
          { key: 'c', header: 'Cleared', cell: ({ c }) => <span className="tabular-nums">{fmt(c.cleared)}</span> },
          { key: 'p', header: 'Pending', cell: ({ c }) => <span className="tabular-nums">{fmt(c.pending)}</span> },
          { key: 'f', header: 'Failed verifications', cell: ({ c }) => <span className="tabular-nums">{fmt(c.failed)}</span> },
          { key: 'g', header: 'Clearance progress', className: 'min-w-[10rem]', cell: ({ c }) => (
            <span className="flex items-center gap-2"><span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${(c.cleared / c.admitted) * 100}%`, background: SERIES.s1 }} /></span><span className="tabular-nums text-slate-600">{Math.round((c.cleared / c.admitted) * 100)}%</span></span>
          ) },
        ]} />
    </Card>
  );
}

function SessionsPage() {
  return (
    <>
      <PageHeader title="Clearance" description="Students are organised by the admission session JAMB assigned them to." actions={<ButtonLink to="/clearance/verify" variant="primary" icon={<ScanFace className="h-4 w-4" />}>Verify Student</ButtonLink>} />
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

/* ---------------- Verify Student ---------------- */

const STEPS = ['Student identification', 'Student information', 'Live portrait capture', 'Biometric verification', 'Clearance'];
type Capture = { url: string; mode: 'camera' | 'simulated' };
type DemoResponse = 'record' | Exclude<VerificationOutcome, 'not-found' | 'invalid'>;

function Steps({ current }: { current: number }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-5" aria-label="Clearance steps">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i + 1 === current ? 'step' : undefined} className={cn('rounded-lg px-3 py-2 text-xs font-medium ring-1 ring-inset', i + 1 === current ? 'bg-brand-50 text-brand-800 ring-brand-200' : i + 1 < current ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-white text-slate-500 ring-slate-200')}>
          <span className="block text-[11px] uppercase tracking-wide opacity-70">Step {i + 1}</span>{s}
        </li>
      ))}
    </ol>
  );
}

function VerifyStudentPage() {
  const officer = useOfficer();
  const state = useJambState();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const session = sessionFromSlug(params.get('session') ?? '') ?? '2026/2027';
  const [entered, setEntered] = useState(params.get('reg') ?? '');
  const [error, setError] = useState('');
  const [lookupIssue, setLookupIssue] = useState<{ outcome: 'invalid' | 'not-found'; input: string } | null>(null);
  const [reg, setReg] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [demo, setDemo] = useState<DemoResponse>('record');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerificationEvent | null>(null);
  const record = reg ? recordOf(reg, state) : undefined;
  const reset = () => { setStep(1); setReg(null); setCapture(null); setResult(null); setEntered(''); setLookupIssue(null); setDemo('record'); };

  const find = (e: React.FormEvent) => {
    e.preventDefault();
    setLookupIssue(null);
    if (!entered.trim()) { setError('Enter the student’s JAMB Registration Number.'); return; }
    setError('');
    const r = lookupForClearance(entered, session, officer);
    if (!r.ok) {
      recordVerification({ entered, session, officer, outcome: r.outcome, captureMode: 'simulated' });
      setLookupIssue({ outcome: r.outcome, input: entered.trim() });
      return;
    }
    setReg(r.record.reg);
    setStep(r.record.clearance === 'cleared' ? 1 : 2);
  };

  const verify = () => {
    if (!record || !capture) return;
    setVerifying(true);
    window.setTimeout(() => {
      const outcome = demo === 'record' ? expectedOutcome(record) : demo;
      const r = recordVerification({ entered: record.reg, session, officer, outcome, captureMode: capture.mode, capture: capture.url, record });
      setVerifying(false);
      if (r.ok) setResult(r.value);
    }, 900);
  };

  return (
    <>
      <PageHeader title="Verify student" description={`Verify an admitted student’s identity against their JAMB registration record before clearance · ${UNILAG.name}`} />
      <Steps current={result?.outcome === 'match' && record?.clearance === 'cleared' ? 5 : result ? (result.outcome === 'match' ? 5 : 4) : step} />

      {step === 1 && (
        <Card className="max-w-2xl px-5 py-5">
          <h2 className="text-base font-semibold text-slate-900">Step 1: Student identification</h2>
          <form onSubmit={find} className="mt-4 space-y-4" noValidate>
            <FilterSelect label="Admission session" value={sessionSlug(session)} onChange={(v) => { setParams((p) => { const n = new URLSearchParams(p); n.set('session', v); return n; }, { replace: true }); reset(); }}
              options={SESSIONS.map((s) => ({ value: sessionSlug(s), label: `${s} Admission Session` }))} />
            <Field label="JAMB Registration Number" required error={error} hint="As issued by JAMB, e.g. 20260100012AB">
              {(p) => <Input {...p} value={entered} autoComplete="off" className="font-mono uppercase" onChange={(e) => { setEntered(e.target.value); setError(''); setLookupIssue(null); setReg(null); }} />}
            </Field>
            <Button type="submit" icon={<UserCheck className="h-4 w-4" />}>Find student</Button>
          </form>
          {lookupIssue && (
            <Outcome kind="exception" title={`Exception: ${OUTCOME_LABEL[lookupIssue.outcome]}`}>
              {lookupIssue.outcome === 'invalid'
                ? `“${lookupIssue.input}” isn’t a valid JAMB registration number. Check it with the student and try again.`
                : `No student with this registration number was assigned to ${UNILAG.name} for the ${session} admission session. Check the number and the session.`}
            </Outcome>
          )}
          {record?.clearance === 'cleared' && (
            <Outcome kind="success" title="Already cleared">
              {record.firstName} {record.lastName} was cleared on {record.clearedAt ? formatDateTime(record.clearedAt) : '—'} by {record.clearedBy}. <Link to={`/clearance/certificate/${record.reg}`} className="font-semibold underline">View certificate</Link>
            </Outcome>
          )}
          <p className="mt-4 text-xs text-slate-500">Try one from the session’s student list, for example <button type="button" className="font-mono underline" onClick={() => setEntered(sample(session, state))}>{sample(session, state)}</button>.</p>
        </Card>
      )}

      {step >= 2 && record && (
        <Card className="px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">Step 2: Student information</h2>
            {!result && <Button size="sm" variant="ghost" onClick={reset}>Change student</Button>}
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-[9rem_1fr]">
            <figure className="max-w-[9rem]"><Portrait seed={record.reg} gender={record.gender} stage="registration" label="Original JAMB registration portrait" /><figcaption className="mt-1 text-[11px] text-slate-500">Original JAMB registration portrait (illustrative)</figcaption></figure>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" aria-label="Student information">
              {([['Full name', `${record.firstName} ${record.middleName} ${record.lastName}`], ['JAMB registration number', <span className="font-mono">{record.reg}</span>], ['Institution', UNILAG.name], ['Admission session', record.session], ['Department', `${record.department} (${record.faculty})`], ['Current verification', <VerificationBadge status={record.verification} />]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>
              ))}
            </dl>
          </div>
          {step === 2 && <Button className="mt-5" icon={<Camera className="h-4 w-4" />} onClick={() => setStep(3)}>Continue to live capture</Button>}
        </Card>
      )}

      {step >= 3 && record && !result && (
        <Card className="px-5 py-5">
          <h2 className="text-base font-semibold text-slate-900">Step 3: Live portrait capture</h2>
          <CameraCapture record={record} capture={capture} onCapture={setCapture} />
          {capture && step === 3 && <Button className="mt-5" icon={<ScanFace className="h-4 w-4" />} onClick={() => setStep(4)}>Use this capture</Button>}
        </Card>
      )}

      {step >= 4 && record && capture && (
        <Card className="px-5 py-5">
          <h2 className="text-base font-semibold text-slate-900">Step 4: Biometric identity verification</h2>
          {!result ? (
            <>
              <p className="mt-1 text-sm text-slate-600">The capture is compared with the student’s JAMB registration identity record by JAMB’s identity verification service. In this prototype the service is simulated.</p>
              <div className="mt-4 max-w-md rounded-lg bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
                <FilterSelect label="Simulated service response (demo control)" value={demo} onChange={(v) => setDemo(v as DemoResponse)} options={[
                  { value: 'record', label: `Use the demo record (${OUTCOME_LABEL[expectedOutcome(record)].toLowerCase()})` },
                  { value: 'match', label: 'Force: face match successful' }, { value: 'no-match', label: 'Force: face match unsuccessful' },
                  { value: 'missing-record', label: 'Force: missing identity record' }, { value: 'unavailable', label: 'Force: service unavailable' },
                ]} />
              </div>
              <Button className="mt-4" loading={verifying} icon={<Fingerprint className="h-4 w-4" />} onClick={verify}>{verifying ? 'Contacting JAMB identity service (simulated)…' : 'Verify identity'}</Button>
            </>
          ) : (
            <VerificationResult event={result} record={record} onRetry={() => { setResult(null); if (result.outcome === 'no-match') { setCapture(null); setStep(3); } }} />
          )}
        </Card>
      )}

      {result?.outcome === 'match' && record && <ClearanceStep record={record} onNext={() => { reset(); navigate(`/clearance/verify?session=${sessionSlug(session)}`); }} />}
    </>
  );
}

const sample = (s: Session, state: ReturnType<typeof useJambState>) => recordsOf(UNILAG, s, state).find((r) => r.clearance !== 'cleared' && r.verification === 'not-started')?.reg ?? recordsOf(UNILAG, s, state)[0].reg;

function Outcome({ kind, title, children }: { kind: 'success' | 'failed' | 'exception'; title: string; children: React.ReactNode }) {
  const style = kind === 'success' ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : kind === 'failed' ? 'bg-red-50 text-red-900 ring-red-200' : 'bg-amber-50 text-amber-900 ring-amber-200';
  const Icon = kind === 'success' ? CheckCircle2 : kind === 'failed' ? XCircle : AlertTriangle;
  return (
    <div role="status" className={cn('mt-4 rounded-xl px-4 py-3 text-sm ring-1 ring-inset', style)}>
      <p className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4" aria-hidden="true" />{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function VerificationResult({ event: e, record, onRetry }: { event: VerificationEvent; record: StudentRecord; onRetry: () => void }) {
  const kind = outcomeKind(e.outcome);
  return (
    <>
      {e.outcome === 'match' && (
        <Outcome kind="success" title="SUCCESS: Face match successful">
          Student identity confirmed against the JAMB registration record. {record.firstName} is eligible to proceed with institutional clearance.
          <span className="mt-1 block text-xs">Identity verification is not clearance: confirm the institution’s clearance decision in step 5.</span>
        </Outcome>
      )}
      {e.outcome === 'no-match' && (
        <Outcome kind="failed" title="FAILED: Face match unsuccessful">
          The student’s identity could not be confirmed against the JAMB registration record. Clearance cannot proceed. Retake the capture if it was poor, or refer the student to JAMB.
        </Outcome>
      )}
      {kind === 'exception' && (
        <Outcome kind="exception" title={`EXCEPTION: ${OUTCOME_LABEL[e.outcome]}`}>
          {e.outcome === 'missing-record' ? 'JAMB holds no usable identity record for this student, so the face match couldn’t be performed. This isn’t a mismatch: refer the student to JAMB to resolve the record.' : 'JAMB’s identity verification service didn’t respond. Nothing about the student was decided: try again shortly.'}
        </Outcome>
      )}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-slate-500">Verification reference</dt><dd className="font-mono text-slate-900">{e.ref}</dd></div>
        <div><dt className="text-slate-500">Time</dt><dd className="text-slate-900">{formatDateTime(e.at)}</dd></div>
        <div><dt className="text-slate-500">Capture</dt><dd className="text-slate-900">{e.captureMode === 'camera' ? 'Camera capture' : 'Simulated capture (demo)'}</dd></div>
      </dl>
      {e.outcome !== 'match' && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(e.outcome === 'no-match' || e.outcome === 'unavailable') && <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} onClick={onRetry}>{e.outcome === 'no-match' ? 'Retake and try again' : 'Try again'}</Button>}
          <ButtonLink to={`/clearance/students/${record.reg}`} variant="secondary">Open student profile</ButtonLink>
        </div>
      )}
    </>
  );
}

function ClearanceStep({ record, onNext }: { record: StudentRecord; onNext: () => void }) {
  const officer = useOfficer();
  const toast = useToast();
  const [error, setError] = useState('');
  const cleared = record.clearance === 'cleared';
  const clear = () => {
    const r = confirmClearance(record.reg, officer);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: 'success', title: 'Student cleared', description: `${record.firstName} ${record.lastName}` });
  };
  return (
    <Card className="px-5 py-5">
      <h2 className="text-base font-semibold text-slate-900">Step 5: Clearance confirmation</h2>
      {!cleared ? (
        <>
          <p className="mt-1 text-sm text-slate-600">The identity match is confirmed. Confirm the institution’s clearance decision once the student’s admission documents are in order. Matriculation is confirmed separately later.</p>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
          <Button className="mt-4" icon={<CheckCircle2 className="h-4 w-4" />} onClick={clear}>Confirm clearance</Button>
        </>
      ) : (
        <>
          <Outcome kind="success" title="Clearance recorded">The session dashboard, student list and JAMB’s oversight are updated.</Outcome>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3" aria-label="Clearance record">
            {([['Student', `${record.firstName} ${record.middleName} ${record.lastName}`], ['JAMB registration number', <span className="font-mono">{record.reg}</span>], ['Institution', UNILAG.name], ['Admission session', record.session], ['Verification result', 'Face match successful (simulated)'], ['Clearance status', 'Cleared'], ['Clearance officer', record.clearedBy], ['Date and time', record.clearedAt ? formatDateTime(record.clearedAt) : '—'], ['Verification reference', <span className="font-mono">{clearanceReference(record)}</span>]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <ButtonLink to={`/clearance/certificate/${record.reg}`} variant="primary">View certificate</ButtonLink>
            <ButtonLink to={`/clearance/students/${record.reg}`} variant="secondary">Open identity journey</ButtonLink>
            <Button variant="secondary" onClick={onNext}>Verify next student</Button>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Live capture: the browser camera when available and permitted; otherwise a clearly labelled simulated capture.
 * The image stays in this page's memory and is never stored or sent anywhere.
 */
function CameraCapture({ record, capture, onCapture }: { record: StudentRecord; capture: Capture | null; onCapture: (c: Capture | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'unavailable'>('idle');
  const [message, setMessage] = useState('');
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => stop, []);
  const start = async () => {
    onCapture(null);
    if (!navigator.mediaDevices?.getUserMedia) { setState('unavailable'); setMessage('Camera access isn’t available in this browser.'); return; }
    setState('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      setState('live');
      requestAnimationFrame(() => { if (video.current && stream.current) { video.current.srcObject = stream.current; void video.current.play().catch(() => undefined); } });
    } catch (e) {
      setState('unavailable');
      setMessage((e as DOMException)?.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'The camera couldn’t be started.');
    }
  };
  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    onCapture({ url: canvas.toDataURL('image/jpeg', 0.85), mode: 'camera' });
    stop(); setState('idle');
  };
  const simulate = () => { stop(); setState('idle'); onCapture({ url: simulatedCaptureDataUrl(record.reg, record.gender), mode: 'simulated' }); };

  return (
    <div className="mt-3 space-y-4">
      {!capture && state !== 'live' && (
        <p className="text-sm text-slate-600">Ask the student to face the camera in good light. Your browser will ask for permission to use the camera; the image is used only on this page and isn’t stored.</p>
      )}
      {state === 'live' && (
        <div className="max-w-sm">
          <video ref={video} playsInline muted aria-label="Camera preview" className="aspect-[4/3] w-full rounded-xl bg-slate-900 object-cover [transform:scaleX(-1)]" />
          <div className="mt-3 flex gap-2"><Button icon={<Camera className="h-4 w-4" />} onClick={take}>Capture</Button><Button variant="ghost" onClick={() => { stop(); setState('idle'); }}>Cancel</Button></div>
        </div>
      )}
      {capture && (
        <figure className="max-w-[12rem]">
          <img src={capture.url} alt="Captured portrait" className="aspect-[3/4] w-full rounded-xl object-cover ring-1 ring-slate-200" />
          <figcaption className="mt-1 text-xs text-slate-500">{capture.mode === 'camera' ? 'Camera capture (not stored)' : 'Simulated capture (demo): no camera image'}</figcaption>
        </figure>
      )}
      {state === 'unavailable' && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">{message} You can continue with a clearly labelled simulated capture for this demonstration.</p>}
      {state !== 'live' && (
        <div className="flex flex-wrap gap-2">
          <Button variant={capture ? 'secondary' : 'primary'} icon={state === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} disabled={state === 'starting'} onClick={start}>{capture ? 'Retake' : 'Start camera'}</Button>
          <Button variant="secondary" onClick={simulate}>Use simulated capture (demo)</Button>
        </div>
      )}
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
