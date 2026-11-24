import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarCheck, CheckCircle2, Fingerprint, History, Home, Loader2, RotateCcw, ScanFace, Search, Send } from 'lucide-react';
import { Badge, Button, ButtonLink, Card, DataTable, EmptyState, Field, FilterSelect, Input, PageHeader, Pagination, SearchInput, StatCard, Textarea, usePageSlice, useToast } from '@/components/ui';
import type { NavGroup } from '@/layout/navigation';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { ConsoleLayout, OrgMark, fmt } from '@/jamb/ui';
import { SimulatedCapture } from '@/jamb/capture';
import { dateTime } from '@/jamb/format';
import {
  captureImageFor, compareIdentity, eventById, eventsFor, fingerprintFor, institutionByCode, lookupCandidate, submitVerification, useIiv, verificationByRef,
  type IdentityRecord, type MatchResult, type Method, type VerificationResult,
} from './store';
import { ComparisonResults, EvidenceImage, FingerprintScanner, MethodLabel, OutcomeBadge, OverallOutcome, VerificationEvidence, useIivUser } from './ui';

const NAV: NavGroup[] = [
  { label: null, items: [{ label: 'Dashboard', to: '/institution', end: true, icon: Home, description: 'Your verification overview' }] },
  {
    label: 'Identity verification',
    items: [
      { label: 'Verify Candidate', to: '/institution/verify', icon: ScanFace, description: 'Verify a candidate’s identity' },
      { label: 'Verification History', to: '/institution/history', icon: History, description: 'Verifications your institution completed' },
    ],
  },
];

/** The institution clearance officer's portal: verify admitted candidates against their JAMB and NIN records. */
export function InstitutionConsole() {
  const me = useIivUser();
  return (
    <ConsoleLayout nav={NAV} organisation={{ name: me.organisation, role: me.title }} mark={<OrgMark letters={me.institution || 'INST'} tone="blue" />} hideEnvironmentLabel user={me}>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="verify" element={<VerifyCandidate />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="history/:ref" element={<RecordPage />} />
        <Route path="*" element={<Navigate to="/institution" replace />} />
      </Routes>
    </ConsoleLayout>
  );
}

function useInstitutionVerifications() {
  const state = useIiv();
  const me = useIivUser();
  return useMemo(() => state.verifications.filter((v) => v.institution === me.institution), [state, me.institution]);
}

/* ---------------- dashboard ---------------- */

function Dashboard() {
  const me = useIivUser();
  const state = useIiv();
  const mine = useInstitutionVerifications();
  const events = eventsFor(me.institution, state);
  const event = events[0];
  const ok = mine.filter((v) => v.outcome === 'verified').length;
  return (
    <>
      <PageHeader title={`Welcome, ${me.name.split(' ')[0]}`} description={`${me.organisation} · Admission identity verification`}
        actions={<ButtonLink to="/institution/verify" variant="primary" size="lg" icon={<ScanFace className="h-5 w-5" />}>Verify Candidate</ButtonLink>} />
      <Card className="mb-6 px-5 py-5" aria-label="Current verification event">
        {event ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Current verification event</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">{event.name}</h2>
              <p className="text-sm text-slate-600">{event.session} admission session · {formatDate(event.startsAt)} to {formatDate(event.endsAt)} · Published by JAMB</p>
            </div>
            <Badge tone="success" dot>Open</Badge>
          </div>
        ) : <p className="text-sm text-slate-600">No verification event is open to {me.organisation}. JAMB publishes admission verification events here.</p>}
      </Card>
      <section aria-label="Verification summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Candidates verified" value={fmt(mine.length)} to="/institution/history" />
        <StatCard label="Successful verifications" value={fmt(ok)} tone="emerald" to="/institution/history?outcome=verified" />
        <StatCard label="Failed verifications" value={fmt(mine.length - ok)} tone="amber" to="/institution/history?outcome=discrepancy" />
      </section>
      <Card className="mt-6">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h2 className="font-semibold text-slate-900">Recent verification activity</h2><Link to="/institution/history" className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</Link></div>
        {mine.length ? (
          <ul className="divide-y divide-slate-100" aria-label="Recent verification activity">
            {mine.slice(0, 6).map((v) => (
              <li key={v.ref}><Link to={`/institution/history/${v.ref}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50">
                <span><span className="font-medium text-slate-900">{v.candidate.fullName}</span> <span className="font-mono text-xs text-slate-500">{v.reg}</span><span className="block text-xs text-slate-500">{dateTime(v.at)} · <MethodLabel method={v.method} /> · {v.officer}</span></span>
                <OutcomeBadge outcome={v.outcome} />
              </Link></li>
            ))}
          </ul>
        ) : <EmptyState icon={<ScanFace className="h-5 w-5" />} title="No verifications yet" description="Candidates you verify appear here." />}
      </Card>
    </>
  );
}

/* ---------------- verify candidate ---------------- */

const STEPS = ['Verification event', 'Candidate', 'Method', 'Capture', 'Identity checks', 'Result'];
function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" aria-label="Verification steps">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', i < current ? 'bg-emerald-100 text-emerald-700' : i === current ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600')}>{i < current ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : i + 1}</span>
          <span className={i === current ? 'font-medium text-slate-900' : 'text-slate-500'}>{s}</span>
          {i < STEPS.length - 1 && <span aria-hidden="true" className="hidden h-px w-6 bg-slate-200 sm:block" />}
        </li>
      ))}
    </ol>
  );
}

type Check = 'pending' | 'running' | MatchResult;
function CheckRow({ label, state }: { label: string; state: Check }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 ring-1 ring-inset ring-slate-200">
      <span className="flex items-center gap-2 text-sm text-slate-800">
        {state === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden="true" /> : state === 'pending' ? <span className="h-4 w-4 rounded-full border-2 border-slate-300" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-slate-400" aria-hidden="true" />}
        {state === 'running' ? `${label}…` : label}
      </span>
      {state === 'match' || state === 'mismatch'
        ? <span className={cn('text-xs font-bold uppercase tracking-wide', state === 'match' ? 'text-emerald-700' : 'text-red-700')}>{state === 'match' ? 'Match' : 'Mismatch'}</span>
        : <span className="text-xs text-slate-400">{state === 'running' ? 'In progress' : 'Waiting'}</span>}
    </li>
  );
}

const LOOKUP_MESSAGE: Record<'invalid' | 'not-found' | 'other-institution' | 'other-session' | 'incomplete', [string, string]> = {
  invalid: ['Invalid registration number', 'A JAMB registration number has 11 digits followed by 2 letters.'],
  'not-found': ['Candidate record not found', 'No JAMB identity record matches this registration number. Check the number with the candidate.'],
  'other-institution': ['Candidate not admitted to your institution', 'This candidate’s admission record is with another institution.'],
  'other-session': ['Candidate not in this admission session', 'This candidate’s admission record is for a different admission session.'],
  incomplete: ['Identity reference unavailable', 'The candidate’s JAMB or NIN reference image is not yet available. Contact JAMB.'],
};

function VerifyCandidate() {
  const me = useIivUser();
  const state = useIiv();
  const toast = useToast();
  const navigate = useNavigate();
  const events = eventsFor(me.institution, state);
  const [eventId, setEventId] = useState<string | null>(events.length === 1 ? events[0].id : null);
  const [step, setStep] = useState(events.length === 1 ? 1 : 0);
  const [entered, setEntered] = useState('');
  const [issue, setIssue] = useState<keyof typeof LOOKUP_MESSAGE | null>(null);
  const [record, setRecord] = useState<IdentityRecord | null>(null);
  const [method, setMethod] = useState<Method>('face');
  const [captured, setCaptured] = useState<{ url: string; at: string } | null>(null);
  const [checks, setChecks] = useState<{ nin: Check; jamb: Check }>({ nin: 'pending', jamb: 'pending' });
  const [remarks, setRemarks] = useState('');
  const [submitted, setSubmitted] = useState<VerificationResult | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const event = eventId ? eventById(eventId, state) : undefined;
  const result = record ? compareIdentity(record, method) : null;

  const restart = () => { timers.current.forEach((t) => window.clearTimeout(t)); setStep(events.length === 1 ? 1 : 0); setEntered(''); setIssue(null); setRecord(null); setMethod('face'); setCaptured(null); setChecks({ nin: 'pending', jamb: 'pending' }); setRemarks(''); setSubmitted(null); };
  const lookup = () => {
    if (!event) return;
    setIssue(null); setRecord(null);
    const r = lookupCandidate(entered, me, event);
    if (!r.ok) { setIssue(r.reason); return; }
    setRecord(r.record);
  };
  const runChecks = () => {
    if (!result) return;
    setStep(4);
    setChecks({ nin: 'running', jamb: 'pending' });
    timers.current.push(window.setTimeout(() => {
      setChecks({ nin: result.ninResult, jamb: 'running' });
      timers.current.push(window.setTimeout(() => {
        setChecks({ nin: result.ninResult, jamb: result.jambResult });
        timers.current.push(window.setTimeout(() => setStep(5), 500));
      }, 1300));
    }, 1300));
  };
  const onCaptured = (url: string) => { setCaptured({ url, at: new Date().toISOString() }); };
  const submit = () => {
    if (!record || !event || !captured) return;
    const r = submitVerification({ reg: record.reg, eventId: event.id, method, officer: me, capturedAt: captured.at, remarks });
    if (!r.ok) { toast({ tone: 'error', title: 'Not submitted', description: r.error }); return; }
    setSubmitted(r.value);
    toast({ tone: 'success', title: 'Verification submitted to JAMB', description: r.value.ref });
  };

  const header = record && (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
      <p className="text-sm text-slate-600"><span className="block font-semibold text-slate-900">{record.fullName}</span><span className="font-mono">{record.reg}</span> · {record.course} · {event?.name}</p>
      {!submitted && step < 4 && <Button size="sm" variant="ghost" onClick={() => { setStep(1); setCaptured(null); }}>Change candidate</Button>}
    </div>
  );

  return (
    <>
      <PageHeader title="Verify Candidate" description={`${me.organisation} · Admission identity verification`} />
      {!submitted && <Steps current={step} />}

      {step === 0 && (
        <Card className="px-5 py-5" aria-label="Select verification event">
          <h2 className="text-base font-semibold text-slate-900">Select verification event</h2>
          <p className="mt-0.5 text-sm text-slate-500">Admission verification events JAMB has published for {me.organisation}.</p>
          {events.length ? (
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {events.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => { setEventId(e.id); setStep(1); }} className="w-full rounded-xl px-4 py-4 text-left ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-brand-300">
                    <span className="flex items-center gap-2 font-semibold text-slate-900"><CalendarCheck className="h-4 w-4 text-brand-600" aria-hidden="true" />{e.name}</span>
                    <span className="mt-1 block text-sm text-slate-600">{e.session} admission session</span>
                    <span className="block text-xs text-slate-500">{formatDate(e.startsAt)} to {formatDate(e.endsAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">No verification event is open to your institution.</p>}
        </Card>
      )}

      {step === 1 && event && (
        <div className="space-y-5">
          <Card className="px-5 py-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-600">Event: <span className="font-medium text-slate-900">{event.name}</span> · {event.session}</span>
              {events.length > 1 && <button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={() => { setStep(0); setRecord(null); }}>Change event</button>}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
              <div className="sm:w-80"><Field label="JAMB Registration Number" required>{(p) => <Input {...p} value={entered} autoFocus autoComplete="off" placeholder="e.g. 20250110421NE" className="h-11 font-mono text-base uppercase tracking-wide" onChange={(e) => { setEntered(e.target.value); setIssue(null); setRecord(null); }} />}</Field></div>
              <Button type="submit" size="lg" icon={<Search className="h-4 w-4" />}>Retrieve candidate</Button>
            </form>
          </Card>
          <div aria-live="polite">
            {issue && (
              <div role="alert" className="rounded-xl bg-amber-50 px-5 py-4 text-sm text-amber-950 ring-1 ring-inset ring-amber-200">
                <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />{LOOKUP_MESSAGE[issue][0]}</p>
                <p className="mt-1">{LOOKUP_MESSAGE[issue][1]}</p>
              </div>
            )}
            {record && (
              <Card className="overflow-hidden" aria-label="Candidate record">
                <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row">
                  <div className="w-28 shrink-0"><EvidenceImage src={record.jambPhoto} label="JAMB profile photograph" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">JAMB record retrieved</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-900">{record.fullName}</h2>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      {([['JAMB registration number', <span className="font-mono">{record.reg}</span>], ['Date of birth', record.dateOfBirth ? formatDate(record.dateOfBirth) : '—'], ['Institution', institutionByCode(record.institution, state)?.name], ['Course of study', record.course], ['Admission session', record.session]] as [string, ReactNode][]).map(([k, v]) => (
                        <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
                      ))}
                    </dl>
                  </div>
                </div>
                <div className="border-t border-slate-100 bg-slate-50 px-5 py-4"><Button size="lg" icon={<ArrowRight className="h-4 w-4" />} onClick={() => setStep(2)}>Continue</Button></div>
              </Card>
            )}
          </div>
        </div>
      )}

      {step === 2 && record && (
        <Card className="px-5 py-5" aria-label="Select verification method">
          {header}
          <h2 className="mt-4 text-base font-semibold text-slate-900">Select verification method</h2>
          <div role="radiogroup" aria-label="Verification method" className="mt-3 grid gap-3 sm:grid-cols-2">
            {([['face', ScanFace, 'Face verification', 'Capture the candidate’s face and compare it with the NIN and JAMB reference images.'], ['fingerprint', Fingerprint, 'Fingerprint verification', 'Scan the candidate’s fingerprint and compare it with the NIN and JAMB fingerprint references.']] as const).map(([m, Icon, title, text]) => {
              const disabled = m === 'fingerprint' && !record.fingerprint;
              return (
                <button key={m} type="button" role="radio" aria-checked={method === m} disabled={disabled} onClick={() => setMethod(m)}
                  className={cn('rounded-xl px-4 py-4 text-left ring-1', method === m ? 'bg-brand-50/60 ring-2 ring-brand-500' : 'ring-slate-200 hover:bg-slate-50', disabled && 'cursor-not-allowed opacity-50')}>
                  <span className="flex items-center gap-2 font-semibold text-slate-900"><Icon className="h-5 w-5 text-brand-600" aria-hidden="true" />{title}</span>
                  <span className="mt-1 block text-sm text-slate-600">{disabled ? 'No fingerprint reference is on record for this candidate.' : text}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex gap-2"><Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(1)}>Back</Button><Button icon={<ArrowRight className="h-4 w-4" />} onClick={() => { setCaptured(null); setStep(3); }}>Continue to capture</Button></div>
        </Card>
      )}

      {step >= 3 && record && result && !submitted && (
        <Card className="px-5 py-5">
          {header}
          <div className="mt-4 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <div>
              <h2 className="mb-2 text-center text-sm font-semibold text-slate-900">{method === 'face' ? 'Capture the candidate’s face' : 'Scan the candidate’s fingerprint'}</h2>
              {method === 'face'
                ? <SimulatedCapture image={captureImageFor(record)} subject={record.fullName} instruction="Position the candidate’s face within the frame" captured={captured?.url ?? null} onCaptured={onCaptured}
                    status={captured && step === 3 ? <CaptureActions onRetake={() => setCaptured(null)} onVerify={runChecks} /> : captured ? <p className="text-xs text-slate-500">Captured {dateTime(captured.at)}</p> : null} />
                : <FingerprintScanner image={fingerprintFor(record)} captured={captured?.url ?? null} onCaptured={onCaptured}
                    status={captured && step === 3 ? <CaptureActions onRetake={() => setCaptured(null)} onVerify={runChecks} /> : captured ? <p className="text-xs text-slate-500">Captured {dateTime(captured.at)}</p> : null} />}
            </div>
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Identity checks</h2>
                <ul className="mt-2 space-y-2" aria-label="Identity checks">
                  <CheckRow label="Checking against National Identity Record" state={checks.nin} />
                  <CheckRow label="Checking against JAMB Record" state={checks.jamb} />
                </ul>
                {step === 3 && <p className="mt-2 text-xs text-slate-500">{captured ? 'Run the identity checks when the capture is clear.' : 'Capture the candidate’s identity to begin the checks.'}</p>}
              </div>
              {step === 5 && captured && (
                <div className="space-y-4">
                  <ComparisonResults v={{ method, capture: captured.url, ninImage: result.ninImage, jambImage: result.jambImage, ninResult: result.ninResult, jambResult: result.jambResult }} />
                  <OverallOutcome outcome={result.outcome} />
                  <Field label="Remarks (optional)">{(p) => <Textarea {...p} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Anything JAMB should know about this verification" />}</Field>
                  <div className="flex flex-wrap gap-2">
                    <Button icon={<Send className="h-4 w-4" />} onClick={submit}>Submit Verification</Button>
                    <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { setCaptured(null); setChecks({ nin: 'pending', jamb: 'pending' }); setStep(3); }}>Recapture</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {submitted && (
        <div className="space-y-5">
          <Card className="px-5 py-5" aria-label="Verification submitted">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-base font-semibold text-slate-900"><CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />Verification submitted to JAMB</p>
                <p className="text-sm text-slate-600">Reference <span className="font-mono font-medium text-slate-900">{submitted.ref}</span> · {dateTime(submitted.at)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => navigate(`/institution/history/${submitted.ref}`)}>View record</Button>
                <Button icon={<ScanFace className="h-4 w-4" />} onClick={restart}>Verify Another Candidate</Button>
              </div>
            </div>
          </Card>
          <VerificationEvidence v={submitted} />
        </div>
      )}
    </>
  );
}

function CaptureActions({ onRetake, onVerify }: { onRetake: () => void; onVerify: () => void }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Button className="w-full" icon={<ArrowRight className="h-4 w-4" />} onClick={onVerify}>Verify Identity</Button>
      <Button className="w-full" size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={onRetake}>Recapture</Button>
    </div>
  );
}

/* ---------------- history ---------------- */

function HistoryPage() {
  const mine = useInstitutionVerifications();
  const [q, setQ] = useQueryState('q');
  const [outcome, setOutcome] = useQueryState('outcome', 'all');
  const [method, setMethod] = useQueryState('method', 'all');
  const [page, setPage] = usePageParam();
  const query = q.trim().toLowerCase();
  const rows = mine.filter((v) => (outcome === 'all' || v.outcome === outcome) && (method === 'all' || v.method === method) && (!query || `${v.candidate.fullName} ${v.reg} ${v.ref}`.toLowerCase().includes(query)));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 20);
  return (
    <>
      <PageHeader title="Verification History" description="Verifications completed by your institution and submitted to JAMB." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Candidate, registration number or reference" className="sm:w-80" label="Search verifications" />
          <FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={[{ value: 'all', label: 'All outcomes' }, { value: 'verified', label: 'Identity Verified' }, { value: 'discrepancy', label: 'Identity Discrepancy' }]} />
          <FilterSelect label="Method" value={method} onChange={setMethod} options={[{ value: 'all', label: 'All methods' }, { value: 'face', label: 'Face verification' }, { value: 'fingerprint', label: 'Fingerprint verification' }]} />
        </div>
        <DataTable rows={pageRows} rowKey={(v) => v.ref} rowHref={(v) => `/institution/history/${v.ref}`} empty={<EmptyState icon={<History className="h-5 w-5" />} title={mine.length ? 'No verifications match' : 'No verifications yet'} />}
          columns={[
            { key: 'c', header: 'Candidate', className: '!whitespace-normal min-w-[10rem]', cell: (v) => <Link to={`/institution/history/${v.ref}`} className="font-medium text-slate-900 hover:text-brand-700">{v.candidate.fullName}</Link> },
            { key: 'r', header: 'JAMB registration number', cell: (v) => <span className="font-mono text-xs">{v.reg}</span> },
            { key: 'e', header: 'Verification event', className: '!whitespace-normal', cell: (v) => <span className="text-slate-600">{v.eventName}</span> },
            { key: 'd', header: 'Date', cell: (v) => <span className="tabular-nums text-slate-600">{dateTime(v.at)}</span> },
            { key: 'm', header: 'Verification method', cell: (v) => <MethodLabel method={v.method} /> },
            { key: 'o', header: 'Outcome', cell: (v) => <OutcomeBadge outcome={v.outcome} /> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={20} onPage={setPage} />
      </Card>
    </>
  );
}

function RecordPage() {
  const { ref = '' } = useParams();
  const state = useIiv();
  const me = useIivUser();
  const v = verificationByRef(ref, state);
  if (!v || v.institution !== me.institution) {
    return <EmptyState title="Verification not found" description="It may belong to another institution." action={<ButtonLink to="/institution/history" variant="secondary">Back to Verification History</ButtonLink>} />;
  }
  return (
    <>
      <PageHeader title={v.candidate.fullName} breadcrumbs={[{ label: 'Verification History', to: '/institution/history' }, { label: v.ref }]} meta={<OutcomeBadge outcome={v.outcome} />} />
      <VerificationEvidence v={v} />
    </>
  );
}
