import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Download, FileText, Home, Loader2, Printer, ScanFace, Search, Send, ShieldCheck, XCircle } from 'lucide-react';
import { Badge, Button, ButtonLink, Card, DataTable, Drawer, EmptyState, Field, FilterSelect, Input, PageHeader, Pagination, SearchInput, StatCard, Textarea, usePageSlice, useToast, type Tone } from '@/components/ui';
import { dateTime } from './format';
import { SimulatedCapture } from './capture';
import type { NavGroup } from '@/layout/navigation';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { NYSC_EVENT_ID, eventById, institutionByCode, type StudentRecord } from './data';
import { downloadPdf } from './certificate';
import { StudentJourney } from './journey';
import { EscalationStatusBadge, IdentityComparison } from './escalations';
import { demoFace, ninPortrait, registrationPortrait } from './portraits';
import {
  activitiesFor, allActivities, exceptionById, jambResponse, lookupForNysc, nyscComparisons, nyscStatuses, recordNyscVerification, recordOf, referToJamb, useJambState,
  type Activity, type NyscOutcome,
} from './store';
import { EventStatusBadge, NotFound, Section, eventPeriod } from './shared';
import { ConsoleLayout, FaceImage, JambLogo, OrgMark, fmt, useOfficer } from './ui';

const NAV: NavGroup[] = [
  { label: null, items: [{ label: 'Home', to: '/nysc', end: true, icon: Home, description: 'Your verification overview' }] },
  {
    label: 'Verification',
    items: [
      { label: 'Verify Candidate', to: '/nysc/verify', icon: ScanFace, description: 'Verify a prospective corps member' },
      { label: 'My Verifications', to: '/nysc/verifications', icon: ClipboardList, description: 'Your verification history', alsoActiveOn: ['/nysc/candidates', '/nysc/report'] },
    ],
  },
];

/**
 * The NYSC Verification Officer's workspace. NYSC comes after admission and graduation: it establishes that the
 * graduate presenting is the person JAMB registered (and NIN identifies), and retrieves the historical university
 * admission clearance from the shared records. NYSC performs no admission clearance of its own.
 */
export function NyscConsole() {
  return (
    <ConsoleLayout nav={NAV} organisation={{ name: 'National Youth Service Corps', role: 'NYSC Verification Officer' }} mark={<OrgMark letters="NYSC" tone="blue" />}>
      <Routes>
        <Route index element={<NyscHome />} />
        <Route path="verify" element={<VerifyCandidatePage />} />
        <Route path="verifications" element={<VerificationsPage />} />
        <Route path="verifications/:ref" element={<VerificationRecordPage />} />
        <Route path="candidates/:reg" element={<CandidatePage />} />
        <Route path="report/:ref" element={<NyscReportPage backTo={(reg) => `/nysc/candidates/${reg}`} />} />
        <Route path="*" element={<Navigate to="/nysc" replace />} />
      </Routes>
    </ConsoleLayout>
  );
}

/* ---------------- shared pieces ---------------- */

type Outcome = Exclude<NyscOutcome, 'not-found' | 'invalid'>;
const NYSC_LABEL: Record<NyscOutcome, string> = {
  confirmed: 'Identity confirmed', 'face-mismatch': 'Identity not confirmed', 'clearance-not-confirmed': 'Admission clearance not confirmed',
  'not-found': 'Record not found', invalid: 'Invalid registration number',
};
const NYSC_TONE: Record<NyscOutcome, Tone> = { confirmed: 'success', 'face-mismatch': 'danger', 'clearance-not-confirmed': 'warning', 'not-found': 'neutral', invalid: 'neutral' };
const NyscOutcomeBadge = ({ outcome }: { outcome: NyscOutcome }) => <Badge tone={NYSC_TONE[outcome]}>{NYSC_LABEL[outcome]}</Badge>;
const isNyscOutcome = (o: Activity['outcome']): o is NyscOutcome => o in NYSC_LABEL;

/** The historical university admission clearance, read from the shared FixID record (never created by NYSC). */
export function historicalClearance(r: StudentRecord) {
  if (r.clearance !== 'cleared' || !r.clearanceRef) return undefined;
  return {
    institution: institutionByCode(r.institution)?.name ?? r.institution, session: r.session, reference: r.clearanceRef, at: r.clearedAt, officer: r.clearedBy,
    outcome: r.nin === 'mismatch' ? 'Identity verified (NIN discrepancy resolved by JAMB)' : 'Identity verified (JAMB and NIN match)', verificationRef: r.verificationRef,
  };
}

const Rows = ({ rows, label, cols = 'sm:grid-cols-2' }: { rows: [string, ReactNode][]; label?: string; cols?: string }) => (
  <dl aria-label={label} className={cn('grid gap-x-6 gap-y-2 text-sm', cols)}>
    {rows.map(([k, v]) => <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>)}
  </dl>
);

function ClearanceRecord({ record: r }: { record: StudentRecord }) {
  const h = historicalClearance(r);
  if (!h) {
    return (
      <div role="status" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-inset ring-amber-200">
        <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />No confirmed admission clearance record found</p>
        <p className="mt-1">FixID holds no completed admission clearance for {institutionByCode(r.institution)?.name}, {r.session} admission session.</p>
      </div>
    );
  }
  return (
    <Rows label="Historical admission clearance" cols="sm:grid-cols-2 lg:grid-cols-3" rows={[
      ['Institution', h.institution], ['Admission session', h.session], ['Clearance status', <Badge tone="success">Cleared</Badge>],
      ['Clearance reference', <span className="font-mono">{h.reference}</span>], ['Clearance date and time', h.at ? dateTime(h.at) : '—'], ['Clearance officer', h.officer ?? '—'],
      ['Verification outcome at clearance', h.outcome],
    ]} />
  );
}

/** The candidate's identity and clearance history: three historical stages and the current NYSC verification. */
interface Stage { n: number; title: string; current?: boolean; state: 'done' | 'warning' | 'failed'; status: string; at?: string; rows: [string, ReactNode][] }
function nyscStages(r: StudentRecord, a: Activity): Stage[] {
  const h = historicalClearance(r);
  const inst = institutionByCode(r.institution)?.name ?? r.institution;
  const [jamb, nin] = nyscComparisons(a);
  const o = a.outcome as Outcome;
  return [
    { n: 1, title: 'JAMB Registration', state: 'done', status: 'Registered', at: r.registeredAt, rows: [['Registration number', <span className="font-mono">{r.reg}</span>], ['Registration centre', r.registrationCentre]] },
    { n: 2, title: 'JAMB Examination Verification', state: 'done', status: 'Verified for the UTME', at: r.exam.at, rows: [['Examination reference', <span className="font-mono">{r.exam.reference}</span>], ['Examination centre', r.exam.centre]] },
    h
      ? { n: 3, title: 'University Admission Clearance', state: 'done', status: 'Cleared', at: h.at, rows: [['Institution', h.institution], ['Clearance reference', <span className="font-mono">{h.reference}</span>], ['Clearance officer', h.officer ?? '—'], ['Verification result', h.outcome]] }
      : { n: 3, title: 'University Admission Clearance', state: 'warning', status: 'Not confirmed', rows: [['Institution', inst], ['Admission session', r.session], ['Record', 'No confirmed admission clearance record found']] },
    {
      n: 4, title: 'NYSC Identity Verification', current: true, state: o === 'confirmed' ? 'done' : o === 'face-mismatch' ? 'failed' : 'warning', status: NYSC_LABEL[o], at: a.at,
      rows: [['Verification reference', <span className="font-mono">{a.ref}</span>], ['NYSC officer', a.officer], ['JAMB vs Live Capture', jamb.result === 'match' ? 'Match' : 'Mismatch'], ['NIN vs Live Capture', nin.result === 'match' ? 'Match' : 'Mismatch'],
        ...(a.exceptionId ? [['Referred to JAMB', <span className="font-mono">{a.exceptionId}</span>] as [string, ReactNode]] : [])],
    },
  ];
}
const STAGE_RING = { done: 'bg-emerald-600 text-white', warning: 'bg-amber-500 text-white', failed: 'bg-red-600 text-white' };
const STAGE_ICON = { done: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />, warning: <AlertTriangle className="h-4 w-4" aria-hidden="true" />, failed: <XCircle className="h-4 w-4" aria-hidden="true" /> };
const STAGE_TONE: Record<Stage['state'], Tone> = { done: 'success', warning: 'warning', failed: 'danger' };

function NyscHistory({ record, activity }: { record: StudentRecord; activity: Activity }) {
  const stages = nyscStages(record, activity);
  return (
    <section aria-label="Candidate Identity & Clearance History">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Candidate Identity &amp; Clearance History</h3>
        <p className="text-xs text-slate-500">Stages 1–3 are retrieved from existing FixID records. Stage 4 is this verification.</p>
      </div>
      <ol className="mt-3">
        {stages.map((s, i) => (
          <li key={s.n} className="relative grid grid-cols-[2rem_1fr] gap-3 pb-4 last:pb-0">
            {i < stages.length - 1 && <span aria-hidden="true" className="absolute left-[0.95rem] top-8 h-[calc(100%-2rem)] w-px bg-slate-200" />}
            <span aria-hidden="true" className={cn('flex h-8 w-8 items-center justify-center rounded-full', STAGE_RING[s.state])}>{STAGE_ICON[s.state]}</span>
            <div className={cn('min-w-0 rounded-lg px-3 py-2.5 ring-1 ring-inset', s.current ? 'bg-sky-50/60 ring-sky-200' : 'bg-slate-50 ring-slate-100')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{s.n}. {s.title}</p>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={s.current ? 'info' : 'neutral'}>{s.current ? 'Current verification' : 'Historical record'}</Badge>
                  <Badge tone={STAGE_TONE[s.state]}>{s.status}</Badge>
                </span>
              </div>
              <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {([['Date and time', s.at ? dateTime(s.at) : '—'], ...s.rows] as [string, ReactNode][]).map(([k, v]) => (
                  <div key={k}><dt className="text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function useMine() {
  const state = useJambState();
  const officer = useOfficer();
  return useMemo(() => allActivities(state).filter((a) => a.kind === 'nysc' && a.officer === officer.name), [state, officer.name]);
}

/* ---------------- dashboard ---------------- */

function NyscHome() {
  const officer = useOfficer();
  const state = useJambState();
  const mine = useMine();
  const event = eventById(NYSC_EVENT_ID)!;
  const withRecord = mine.filter((a) => a.reg);
  const count = (o: NyscOutcome) => withRecord.filter((a) => a.outcome === o).length;
  return (
    <>
      <PageHeader title={`Welcome, ${officer.name.split(' ')[0]}`} description="National Youth Service Corps · NYSC Identity Verification"
        actions={<ButtonLink to="/nysc/verify" variant="primary" size="lg" icon={<ScanFace className="h-5 w-5" />}>Verify Candidate</ButtonLink>} />
      <section aria-label="Verification summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Candidates verified" value={fmt(withRecord.length)} to="/nysc/verifications" />
        <StatCard label="Identity confirmed" value={fmt(count('confirmed') + count('clearance-not-confirmed'))} tone="emerald" to="/nysc/verifications?outcome=identity-confirmed" hint={`${fmt(count('confirmed'))} with clearance confirmed`} />
        <StatCard label="Identity discrepancies" value={fmt(count('face-mismatch'))} to="/nysc/verifications?outcome=face-mismatch" />
        <StatCard label="Institutional clearance not confirmed" value={fmt(count('clearance-not-confirmed'))} tone="amber" to="/nysc/verifications?outcome=clearance-not-confirmed" />
        <StatCard label="Cases referred to JAMB" value={fmt(withRecord.filter((a) => a.exceptionId).length)} tone="violet" to="/nysc/verifications?outcome=referred" />
      </section>
      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">{event.name}</h2><EventStatusBadge status="active" /></div>
        <p className="text-xs text-slate-500">{eventPeriod(event)} · Published by JAMB</p>
      </Card>
      <Section title="Your recent verifications" action={<Link to="/nysc/verifications" className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</Link>}>
        {withRecord.length ? (
          <ul className="divide-y divide-slate-100" aria-label="Recent verifications">
            {withRecord.slice(0, 8).map((a) => { const r = recordOf(a.reg!, state)!; return (
              <li key={a.ref}>
                <Link to={`/nysc/verifications/${a.ref}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50">
                  <span><span className="font-medium text-slate-900">{r.firstName} {r.lastName}</span> <span className="font-mono text-xs text-slate-500">{r.reg}</span><span className="block text-xs text-slate-500">{institutionByCode(r.institution)?.name} · {dateTime(a.at)}</span></span>
                  <span className="flex items-center gap-2">{a.exceptionId && <Badge tone="violet">Referred to JAMB</Badge>}{isNyscOutcome(a.outcome) && <NyscOutcomeBadge outcome={a.outcome} />}</span>
                </Link>
              </li>
            ); })}
          </ul>
        ) : <EmptyState icon={<ScanFace className="h-5 w-5" />} title="No verifications yet" />}
      </Section>
    </>
  );
}

/* ---------------- verify candidate ---------------- */

type Capture = { url: string; mode: 'camera' | 'demo' };

function VerifyCandidatePage() {
  const officer = useOfficer();
  const state = useJambState();
  const [entered, setEntered] = useState('');
  const [error, setError] = useState('');
  const [issue, setIssue] = useState<'invalid' | 'not-found' | null>(null);
  const [reg, setReg] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<Activity | null>(null);
  const record = reg ? recordOf(reg, state) : undefined;
  const restart = () => { setStep(1); setReg(null); setCapture(null); setResult(null); setEntered(''); setIssue(null); };
  const lookup = () => {
    setIssue(null); setReg(null);
    if (!entered.trim()) { setError('Enter the candidate’s JAMB Registration Number.'); return; }
    setError('');
    const r = lookupForNysc(entered);
    if (!r.ok) { recordNyscVerification({ entered, officer, captureMode: 'demo', outcome: r.outcome }); setIssue(r.outcome); return; }
    setReg(r.record.reg);
  };
  const verify = (c: Capture) => {
    if (!record) return;
    setVerifying(true);
    window.setTimeout(() => {
      const r = recordNyscVerification({ entered: record.reg, officer, captureMode: c.mode, record });
      setVerifying(false);
      if (r.ok) setResult(r.value);
    }, 1200);
  };
  const inst = record ? institutionByCode(record.institution)?.name : '';
  return (
    <>
      <PageHeader title="Verify Candidate" description="NYSC Identity Verification" />
      {step === 1 && (
        <div className="space-y-5">
          <Card className="px-5 py-5">
            <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
              <div className="sm:w-80">
                <Field label="JAMB Registration Number" required error={error}>
                  {(p) => <Input {...p} value={entered} autoFocus autoComplete="off" placeholder="e.g. 20220290101EO" className="h-11 font-mono text-base uppercase tracking-wide" onChange={(e) => { setEntered(e.target.value); setError(''); setIssue(null); setReg(null); }} />}
                </Field>
              </div>
              <Button type="submit" size="lg" icon={<Search className="h-4 w-4" />}>Retrieve records</Button>
            </form>
          </Card>
          <div aria-live="polite">
            {issue && <div role="status" className="rounded-xl bg-amber-50 px-5 py-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{issue === 'invalid' ? 'Invalid registration number' : 'No JAMB record found'}</p><p className="mt-1">{issue === 'invalid' ? 'This isn’t a valid JAMB Registration Number.' : 'JAMB holds no record with this registration number.'}</p></div>}
            {record && (
              <Card className="overflow-hidden" aria-label="Candidate records">
                <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row">
                  <div className="flex shrink-0 gap-3">
                    <figure className="w-24"><FaceImage src={registrationPortrait(record)} label={`JAMB profile photograph: ${record.firstName} ${record.lastName}`} className="aspect-[4/5] h-auto w-full" /><figcaption className="mt-1 text-center text-[11px] font-medium leading-tight text-slate-600">JAMB profile photograph</figcaption></figure>
                    <figure className="w-24"><FaceImage src={ninPortrait(record)} label={`NIN identity photograph: ${record.firstName} ${record.lastName}`} className="aspect-[4/5] h-auto w-full" /><figcaption className="mt-1 text-center text-[11px] font-medium leading-tight text-slate-600">NIN identity photograph</figcaption></figure>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">JAMB and NIN records retrieved</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</h2>
                    <div className="mt-3"><Rows rows={[['JAMB Registration Number', <span className="font-mono">{record.reg}</span>], ['Institution', inst], ['Course of study', record.course], ['Admission session', record.session]]} /></div>
                  </div>
                </div>
                <div className="border-t border-slate-100 px-5 py-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-slate-900">Historical university admission clearance</h3><Badge tone="neutral">Historical record</Badge></div>
                  <ClearanceRecord record={record} />
                </div>
                <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
                  <Button size="lg" icon={<ArrowRight className="h-4 w-4" />} onClick={() => setStep(2)}>Continue to face capture</Button>
                </div>
              </Card>
            )}
            {!issue && !record && <div className="flex min-h-[8rem] items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 text-center text-sm text-slate-500">The candidate’s JAMB, NIN and clearance records appear here.</div>}
          </div>
        </div>
      )}
      {step === 2 && record && !result && (
        <Card className="px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <p className="text-sm text-slate-600"><span className="block font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</span><span className="font-mono">{record.reg}</span> · {inst} · {record.course}</p>
            <Button size="sm" variant="ghost" disabled={verifying} onClick={() => { setStep(1); setCapture(null); }}>Change candidate</Button>
          </div>
          <div className="mt-4 flex justify-center">
            <div>
              <h2 className="mb-2 text-center text-sm font-semibold text-slate-900">Capture the candidate’s face</h2>
              <SimulatedCapture image={demoFace(record)} subject={`${record.firstName} ${record.lastName}`} instruction="Position the candidate’s face within the frame" captured={capture?.url ?? null}
                onCaptured={(url) => { const c = { url, mode: 'demo' as const }; setCapture(c); verify(c); }}
                status={verifying ? <p role="status" className="flex items-center gap-2 text-sm font-medium text-slate-700"><Loader2 className="h-4 w-4 animate-spin text-emerald-700" aria-hidden="true" />Verifying identity and retrieving history…</p> : null} />
            </div>
          </div>
        </Card>
      )}
      {result && record && <NyscResult activity={result} record={record} capture={capture?.url} onNext={restart} onRetake={() => { setResult(null); setCapture(null); }} />}
    </>
  );
}

/* ---------------- result ---------------- */

const HEAD: Record<Outcome, { cls: string; icon: ReactNode; title: string; text: string }> = {
  confirmed: {
    cls: 'bg-emerald-50 text-emerald-950 border-emerald-200', icon: <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />, title: 'Candidate Identity Confirmed',
    text: 'The captured face matches the candidate’s JAMB profile and NIN identity records, and a historical university admission clearance record was found.',
  },
  'face-mismatch': {
    cls: 'bg-red-50 text-red-950 border-red-200', icon: <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />, title: 'Candidate Identity Could Not Be Confirmed',
    text: 'The captured face matches the NIN identity record but does not match the JAMB profile record. Further investigation is required.',
  },
  'clearance-not-confirmed': {
    cls: 'bg-amber-50 text-amber-950 border-amber-200', icon: <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />, title: 'Admission Clearance Not Confirmed',
    text: 'The candidate’s identity is confirmed, but FixID cannot establish that the required institutional admission clearance was completed.',
  },
};

function StatusTile({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'hold' }) {
  const t = { good: ['text-emerald-700', <CheckCircle2 key="i" className="h-4 w-4" aria-hidden="true" />], bad: ['text-red-700', <XCircle key="i" className="h-4 w-4" aria-hidden="true" />], hold: ['text-amber-700', <AlertTriangle key="i" className="h-4 w-4" aria-hidden="true" />] }[tone];
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 ring-1 ring-inset ring-slate-200">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', t[0] as string)}>{t[1]}{value}</dd>
    </div>
  );
}

function referralComment(o: Outcome, r: StudentRecord) {
  return o === 'face-mismatch'
    ? 'The candidate’s live captured face matches the NIN identity photograph but does not match the JAMB profile photograph. Kindly review the candidate’s identity records and advise on the appropriate next steps.'
    : `The candidate’s identity was confirmed against the JAMB profile and NIN identity photographs, but no confirmed institutional admission clearance record was found for ${institutionByCode(r.institution)?.name} (${r.session} admission session). Kindly review and advise whether the candidate’s admission clearance can be confirmed.`;
}

/** The outcome of an NYSC verification: shown after capture, and again when the officer opens a past record. */
function NyscResult({ activity, record: r, capture, onNext, onRetake }: { activity: Activity; record: StudentRecord; capture?: string; onNext?: () => void; onRetake?: () => void }) {
  const state = useJambState();
  const a = state.activities.find((x) => x.ref === activity.ref) ?? activity;
  const o = a.outcome as Outcome;
  const head = HEAD[o];
  const statuses = nyscStatuses(a);
  const referral = a.exceptionId ? exceptionById(a.exceptionId, state) : undefined;
  const response = referral ? jambResponse(referral) : undefined;
  const [refer, setRefer] = useState(false);
  return (
    <Card className="overflow-hidden" aria-label="Verification result">
      <div role="status" className={cn('flex items-start gap-3 border-b px-6 py-3', head.cls)}>
        {head.icon}
        <div><h2 className="text-base font-semibold">{head.title}</h2><p className="text-sm">{head.text}</p></div>
      </div>
      <div className="space-y-5 px-6 py-5">
        <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">{r.firstName} {r.middleName} {r.lastName}</span> · <span className="font-mono">{r.reg}</span> · {institutionByCode(r.institution)?.name} · {r.course}</p>
        <dl aria-label="Verification status" className="grid gap-3 sm:grid-cols-2">
          <StatusTile label="Identity Assurance" value={statuses.identity === 'confirmed' ? 'Confirmed' : 'Not Confirmed'} tone={statuses.identity === 'confirmed' ? 'good' : 'bad'} />
          <StatusTile label="Institutional Clearance" value={statuses.clearance === 'confirmed' ? 'Confirmed' : statuses.clearance === 'not-confirmed' ? 'Not Confirmed' : 'On hold: identity not confirmed'} tone={statuses.clearance === 'confirmed' ? 'good' : statuses.clearance === 'not-confirmed' ? 'bad' : 'hold'} />
        </dl>
        <IdentityComparison record={r} capture={capture} comparisons={nyscComparisons(a)} captureNote="Live capture not retained" />
        <div className="border-t border-slate-100 pt-4"><NyscHistory record={r} activity={a} /></div>
        {referral && (
          <div className="rounded-lg bg-violet-50 px-4 py-3 text-sm ring-1 ring-inset ring-violet-200" aria-label="Referral to JAMB">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-violet-950">Referred to JAMB <span className="font-mono text-xs font-medium">{referral.id}</span><EscalationStatusBadge e={referral} /></p>
            <p className="mt-1 text-violet-900">{referral.escalation?.comment}</p>
            {response && <p className="mt-2 text-slate-700"><span className="font-medium text-slate-900">JAMB:</span> {response.comment} <span className="text-xs text-slate-500">({response.actorName}, {dateTime(response.at)})</span></p>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
        {o === 'confirmed' && <ButtonLink to={`/nysc/report/${a.ref}`} variant="primary" icon={<FileText className="h-4 w-4" />}>View Verification Report</ButtonLink>}
        {o !== 'confirmed' && !referral && <Button icon={<Send className="h-4 w-4" />} onClick={() => setRefer(true)}>{o === 'face-mismatch' ? 'Refer to JAMB' : 'Refer for clearance review'}</Button>}
        {o === 'face-mismatch' && onRetake && !referral && <Button variant="secondary" onClick={onRetake}>Retake capture</Button>}
        <ButtonLink to={`/nysc/candidates/${r.reg}`} variant="secondary">Candidate profile</ButtonLink>
        {onNext ? <Button variant="secondary" icon={<ScanFace className="h-4 w-4" />} onClick={onNext}>Verify Another Candidate</Button> : <ButtonLink to="/nysc/verify" variant="secondary" icon={<ScanFace className="h-4 w-4" />}>Verify Candidate</ButtonLink>}
      </div>
      {refer && <ReferDrawer activity={a} record={r} capture={capture} onClose={() => setRefer(false)} />}
    </Card>
  );
}

function ReferDrawer({ activity: a, record: r, capture, onClose }: { activity: Activity; record: StudentRecord; capture?: string; onClose: () => void }) {
  const officer = useOfficer();
  const toast = useToast();
  const o = a.outcome as Outcome;
  const [comment, setComment] = useState(referralComment(o, r));
  const [error, setError] = useState('');
  const submit = () => {
    const x = referToJamb(a.ref, officer, comment, o === 'face-mismatch' ? capture : undefined);
    if (!x.ok) { setError(x.error); return; }
    toast({ tone: 'success', title: 'Referred to JAMB', description: x.value.id });
    onClose();
  };
  return (
    <Drawer open onClose={onClose} title={o === 'face-mismatch' ? 'Refer to JAMB' : 'Refer for clearance review'} description="JAMB reviews the case. The candidate is not classified as fraudulent."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={<Send className="h-4 w-4" />} onClick={submit}>Submit referral</Button></div>}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <Rows rows={[['Candidate', `${r.firstName} ${r.middleName} ${r.lastName}`], ['JAMB Registration Number', <span className="font-mono">{r.reg}</span>], ['Institution', institutionByCode(r.institution)?.name], ['Case', o === 'face-mismatch' ? 'Identity exception' : 'Institutional clearance not confirmed']]} />
        </div>
        <p className="text-sm text-slate-600">Attached: comparison results (JAMB vs Live Capture, NIN vs Live Capture){o === 'face-mismatch' ? ', the live capture' : ''} and the historical clearance record.</p>
        <Field label="Comment" required>{(p) => <Textarea {...p} rows={5} value={comment} onChange={(e) => { setComment(e.target.value); setError(''); }} />}</Field>
      </div>
    </Drawer>
  );
}

/* ---------------- history ---------------- */

const FILTERS: [string, string][] = [
  ['all', 'All outcomes'], ['identity-confirmed', 'Identity confirmed'], ['confirmed', 'Identity and clearance confirmed'], ['face-mismatch', 'Identity discrepancy'],
  ['clearance-not-confirmed', 'Institutional clearance not confirmed'], ['referred', 'Referred to JAMB'], ['not-found', 'Record not found'], ['invalid', 'Invalid registration number'],
];
function matches(a: Activity, f: string) {
  if (f === 'all') return true;
  if (f === 'identity-confirmed') return a.outcome === 'confirmed' || a.outcome === 'clearance-not-confirmed';
  if (f === 'referred') return !!a.exceptionId;
  return a.outcome === f;
}

function VerificationsPage() {
  const state = useJambState();
  const mine = useMine();
  const [q, setQ] = useQueryState('q');
  const [outcome, setOutcome] = useQueryState('outcome', 'all');
  const [page, setPage] = usePageParam();
  const query = q.trim().toLowerCase();
  const rows = mine.filter((a) => matches(a, outcome) && (!query || `${a.input} ${a.ref}`.toLowerCase().includes(query.replace(/\s/g, '')) || (a.reg && `${recordOf(a.reg, state)?.firstName} ${recordOf(a.reg, state)?.lastName}`.toLowerCase().includes(query))));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 20);
  return (
    <>
      <PageHeader title="My Verifications" description="Candidates you verified for NYSC. Open a record to see its result, history and report." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Candidate name, registration number or reference" className="sm:w-80" label="Search verifications" />
          <FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={FILTERS.map(([value, label]) => ({ value, label }))} />
        </div>
        <DataTable rows={pageRows} rowKey={(a) => a.ref} rowHref={(a) => (a.reg ? `/nysc/verifications/${a.ref}` : '')} empty={<EmptyState title="No verifications match" />}
          columns={[
            { key: 't', header: 'Date and time', cell: (a) => <span className="tabular-nums text-slate-600">{dateTime(a.at)}</span> },
            { key: 'c', header: 'Candidate', className: '!whitespace-normal min-w-[10rem]', cell: (a) => { const r = a.reg ? recordOf(a.reg, state) : undefined; return r ? <Link to={`/nysc/verifications/${a.ref}`} className="font-medium text-slate-900 hover:text-brand-700">{r.firstName} {r.lastName}<span className="block font-mono text-xs font-normal text-slate-500">{r.reg}</span></Link> : <span className="font-mono text-xs">{a.input}</span>; } },
            { key: 'i', header: 'Institution', className: '!whitespace-normal', cell: (a) => <span className="text-slate-600">{a.reg ? institutionByCode(recordOf(a.reg, state)!.institution)?.name : '—'}</span> },
            { key: 'o', header: 'Outcome', className: '!whitespace-normal', cell: (a) => <span className="flex flex-wrap gap-1">{isNyscOutcome(a.outcome) && <NyscOutcomeBadge outcome={a.outcome} />}{a.exceptionId && <Badge tone="violet">Referred to JAMB</Badge>}</span> },
            { key: 'r', header: 'Reference', cell: (a) => <span className="font-mono text-xs text-slate-600">{a.ref}</span> },
            { key: 'rep', header: 'Report', cell: (a) => (a.outcome === 'confirmed' ? <Link to={`/nysc/report/${a.ref}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View report</Link> : <span className="text-xs text-slate-400">—</span>) },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={20} onPage={setPage} />
      </Card>
    </>
  );
}

/** A previous NYSC verification, opened from the history. */
function VerificationRecordPage() {
  const { ref = '' } = useParams();
  const state = useJambState();
  const a = allActivities(state).find((x) => x.ref === ref && x.kind === 'nysc');
  const r = a?.reg ? recordOf(a.reg, state) : undefined;
  if (!a || !r) return <NotFound what="Verification" back="/nysc/verifications" />;
  return (
    <>
      <PageHeader title="Verification record" breadcrumbs={[{ label: 'My Verifications', to: '/nysc/verifications' }, { label: a.ref }]} description={`${dateTime(a.at)} · ${a.officer}`} />
      <NyscResult activity={a} record={r} capture={a.captureMode === 'demo' ? demoFace(r) : undefined} />
    </>
  );
}

function CandidatePage() {
  const { reg = '' } = useParams();
  const state = useJambState();
  const r = recordOf(reg, state);
  if (!r) return <NotFound what="Candidate" back="/nysc/verifications" />;
  const latest = activitiesFor(r.reg, state).find((a) => a.kind === 'nysc' && a.outcome === 'confirmed');
  return (
    <>
      <PageHeader title="" breadcrumbs={[{ label: 'My Verifications', to: '/nysc/verifications' }, { label: `${r.firstName} ${r.lastName}` }]} />
      <StudentJourney record={r} actions={<>{latest && <ButtonLink to={`/nysc/report/${latest.ref}`} icon={<FileText className="h-4 w-4" />}>Verification report</ButtonLink>}<ButtonLink to="/nysc/verify" variant="secondary" icon={<ScanFace className="h-4 w-4" />}>Verify Candidate</ButtonLink></>} />
    </>
  );
}

/* ---------------- printable report ---------------- */

/** The NYSC verification report: only for a confirmed identity with a confirmed historical clearance. No captured image is included. */
export function NyscReportPage({ backTo }: { backTo: (reg: string) => string }) {
  const { ref = '' } = useParams();
  const state = useJambState();
  const toast = useToast();
  const navigate = useNavigate();
  const inNysc = useLocation().pathname.startsWith('/nysc');
  const el = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const a = allActivities(state).find((x) => x.ref === ref && x.kind === 'nysc');
  const r = a?.reg ? recordOf(a.reg, state) : undefined;
  const h = r ? historicalClearance(r) : undefined;
  if (!a || !r || a.outcome !== 'confirmed' || !h) return <NotFound what="Verification report" back="/nysc/verifications" />;
  const inst = institutionByCode(r.institution)!;
  const [jamb, nin] = nyscComparisons(a);
  const stages = nyscStages(r, a);
  const save = async () => {
    if (!el.current) return;
    setSaving(true);
    try { await downloadPdf(el.current, `nysc-verification-${r.reg}.pdf`, 'NYSC identity verification report'); toast({ tone: 'success', title: 'Report saved', description: `nysc-verification-${r.reg}.pdf` }); } catch { toast({ tone: 'error', title: 'Couldn’t create the PDF', description: 'Use Print and choose “Save as PDF” instead.' }); }
    setSaving(false);
  };
  const row = (k: string, v: ReactNode) => <div key={k}><dt className="text-[11px] uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>;
  const heading = (t: string) => <h2 className="mt-6 border-b border-slate-200 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{t}</h2>;
  const result = (v: 'match' | 'mismatch' | 'pending') => <span className={cn('inline-flex items-center gap-1 font-semibold', v === 'match' ? 'text-emerald-700' : 'text-red-700')}>{v === 'match' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}{v === 'match' ? 'Match' : 'Mismatch'}</span>;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={inNysc ? `/nysc/verifications/${a.ref}` : backTo(r.reg)} className="text-sm font-medium text-brand-600 hover:text-brand-700">{inNysc ? '← Verification record' : '← Identity history'}</Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={saving} onClick={save}>Download</Button>
          <Button variant="secondary" icon={<Search className="h-4 w-4" />} onClick={() => navigate('/nysc/verify')}>Return to candidate search</Button>
        </div>
      </div>
      <div ref={el} className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-card print:border-slate-400 print:shadow-none" aria-label="NYSC verification report">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-800 pb-4">
          <div className="flex items-center gap-3"><JambLogo /><span><span className="block font-semibold text-slate-900">JAMB Identity Verification</span><span className="block text-xs text-slate-500">Joint Admissions and Matriculation Board</span></span></div>
          <div className="text-right"><p className="font-semibold text-slate-900">National Youth Service Corps</p><p className="text-xs text-slate-500">NYSC Identity Verification Report</p><p className="mt-1 font-mono text-xs text-slate-600">{a.ref}</p></div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-emerald-50 px-4 py-3 ring-1 ring-inset ring-emerald-200">
          <div className="flex items-center gap-2 text-emerald-800"><ShieldCheck className="h-5 w-5" aria-hidden="true" /><h1 className="text-lg font-semibold">Candidate Identity Confirmed</h1></div>
          <p className="text-xs font-medium text-emerald-900">Identity Assurance: Confirmed · Institutional Clearance: Confirmed</p>
        </div>

        {heading('Candidate')}
        <div className="mt-3 grid gap-5 sm:grid-cols-[6.5rem_1fr]">
          <figure><FaceImage src={registrationPortrait(r)} label={`JAMB profile photograph: ${r.firstName} ${r.lastName}`} className="aspect-[4/5] h-auto w-full" /><figcaption className="mt-1 text-center text-[10px] text-slate-500">JAMB profile photograph</figcaption></figure>
          <dl className="grid content-start gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {row('Candidate name', `${r.firstName} ${r.middleName} ${r.lastName}`)}
            {row('JAMB registration number', <span className="font-mono">{r.reg}</span>)}
            {row('Institution', inst.name)}
            {row('Course of study', r.course)}
            {row('Admission session', r.session)}
            {row('Date of birth', formatDate(r.dateOfBirth))}
          </dl>
        </div>

        {heading('Identity verification (NYSC)')}
        <table className="mt-2 w-full text-sm" aria-label="Identity verification results">
          <tbody>
            <tr className="border-b border-slate-100"><td className="py-1.5 text-slate-600">JAMB profile photograph vs live capture</td><td className="py-1.5 text-right">{result(jamb.result)}</td></tr>
            <tr className="border-b border-slate-100"><td className="py-1.5 text-slate-600">NIN identity photograph vs live capture</td><td className="py-1.5 text-right">{result(nin.result)}</td></tr>
            <tr className="border-b border-slate-100"><td className="py-1.5 text-slate-600">NYSC verification date and time</td><td className="py-1.5 text-right font-medium text-slate-900">{dateTime(a.at)}</td></tr>
            <tr><td className="py-1.5 text-slate-600">NYSC verification officer</td><td className="py-1.5 text-right font-medium text-slate-900">{a.officer}</td></tr>
          </tbody>
        </table>

        {heading('Historical university admission clearance')}
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3" aria-label="Historical clearance">
          {row('Institution', h.institution)}
          {row('Admission session', h.session)}
          {row('Clearance status', 'Cleared')}
          {row('Clearance reference', <span className="font-mono">{h.reference}</span>)}
          {row('Clearance officer', h.officer ?? '—')}
          {row('Clearance date and time', h.at ? dateTime(h.at) : '—')}
          {row('Verification outcome at clearance', h.outcome)}
        </dl>

        {heading('Identity and clearance history')}
        <table className="mt-2 w-full text-xs" aria-label="Identity history">
          <thead><tr className="text-left uppercase tracking-wide text-slate-500"><th className="pb-1 pr-2 font-semibold">Stage</th><th className="pb-1 pr-2 font-semibold">Date</th><th className="pb-1 pr-2 font-semibold">Status</th><th className="pb-1 font-semibold">Record</th></tr></thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.n} className="border-t border-slate-100 align-top">
                <td className="py-1.5 pr-2 text-slate-900">{s.n}. {s.title}</td>
                <td className="py-1.5 pr-2 text-slate-600">{s.at ? formatDate(s.at) : '—'}</td>
                <td className="py-1.5 pr-2 text-slate-600">{s.status}</td>
                <td className="py-1.5 text-slate-600">{s.current ? 'Current NYSC verification' : 'Historical FixID record'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 rounded-lg border border-slate-300 px-4 py-3 text-sm">
          <p className="font-semibold text-slate-900">Final identity assurance result: Confirmed</p>
          <p className="mt-1 text-slate-700">The graduate presenting for NYSC verification is the person associated with JAMB registration {r.reg} and the NIN identity record, and holds a historical admission clearance record from {h.institution}.</p>
        </div>
        <p className="mt-6 border-t border-slate-200 pt-4 text-[11px] text-slate-500">Generated {dateTime(new Date().toISOString())}. The live capture image is not included in this report. Demo environment.</p>
      </div>
    </>
  );
}
