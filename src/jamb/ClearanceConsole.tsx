import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Send, CalendarCheck, CheckCircle2, ClipboardList, Home, Loader2, Printer, ScanFace, Search, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, DataTable, Drawer, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Select, StatCard, Tabs, Textarea, usePageSlice, useToast,
} from '@/components/ui';
import { dateTime } from './format';
import type { NavGroup } from '@/layout/navigation';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { ACTIVE_ADMISSION_EVENT, ACTIVE_SESSION, EVENTS, SESSIONS, UNILAG, eventById, institutionByCode, sessionSlug, type Session, type StudentRecord } from './data';
import { CertificatePage } from './certificate';
import { StudentJourney } from './journey';
import { demoFace, ninPortrait, jambPortraitLabel } from './portraits';
import { REGISTRANTS, SCENARIO_CANDIDATES, type Registrant } from './scenarios';
import { EscalationDrawer, EscalationStatusBadge, EscalationStatusPanel, IdentityComparison, UniversityCasePage, lastUpdated } from './escalations';
import {
  confirmClearance, countsOf, exceptionsOf, institutionActivities, lookupForClearance, priorClearanceOf, recordOf, recordUniversityVerification,
  recordsOf, useJambState, type Activity,
} from './store';
import { CASE_TYPE_LABEL, CATEGORY_LABEL, RESOLUTION_LABEL, caseSubject, caseTypeOf, comparisonsFor, escalationFor, resolvedDiscrepancy, escalationStatus, escalationsOf, jambResponse, raiseAdmissionInquiry, recordExistingClearance, type JambException } from './store';
import { SimulatedCapture } from './capture';
import { ActivityList, EventStatusBadge, NotFound, Section, SessionStats, eventPeriod } from './shared';
import { StudentTable } from './students';
import { ConsoleLayout, FaceImage, OrgMark, Portrait, ProgressMeter, fmt, useOfficer } from './ui';

const NAV: NavGroup[] = [
  { label: null, items: [{ label: 'Home', to: '/clearance', end: true, icon: Home, description: 'Your clearance overview' }] },
  {
    label: 'Clearance',
    items: [
      { label: 'Clearance Events', to: '/clearance/events', icon: CalendarCheck, description: 'Events published by JAMB' },
      { label: 'Verify Student', to: '/clearance/verify', icon: ScanFace, description: 'Verify and clear a student' },
      { label: 'My Clearance Records', to: '/clearance/records', icon: ClipboardList, description: 'Your clearance history', alsoActiveOn: ['/clearance/students'] },
      { label: 'Escalations', to: '/clearance/escalations', icon: ShieldAlert, description: 'Cases referred to JAMB' },
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
        <Route path="escalations" element={<EscalationsPage />} />
        <Route path="escalations/:id" element={<UniversityCasePage institution={UNILAG.code} />} />
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
const recordStatus = (r: StudentRecord): { key: 'cleared' | 'failed' | 'blocked' | 'exception' | 'verified' | 'escalated'; label: string; tone: 'success' | 'danger' | 'warning' | 'info' | 'violet' } =>
  r.clearance === 'cleared' ? { key: 'cleared', label: 'Cleared', tone: 'success' }
    : r.verification === 'escalated' ? { key: 'escalated', label: 'Escalated to JAMB', tone: 'violet' }
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
  const [session, setSession] = useState<Session>(ACTIVE_SESSION);
  // Valid JAMB registration, but no admission offer for this institution and session (Scenario 4).
  const [noAdmission, setNoAdmission] = useState<{ registrant: Registrant; session: Session } | null>(null);
  // A record from a closed clearance event: shown, but not verified here.
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<Activity | null>(null);
  const [guide, setGuide] = useState(false);
  const record = reg ? recordOf(reg, state) : undefined;

  const restart = () => { setStep(1); setReg(null); setCapture(null); setResult(null); setEntered(''); setIssue(null); setNoAdmission(null); setClosedFor(null); navigate('/clearance/verify', { replace: true }); };
  const lookup = (value: string, sess: Session = session) => {
    setIssue(null); setReg(null); setNoAdmission(null); setClosedFor(null);
    if (!value.trim()) { setError('Enter the student’s JAMB Registration Number.'); return; }
    setError('');
    const r = lookupForClearance(value, officer, sess);
    if (!r.ok) {
      recordUniversityVerification({ entered: value, officer, captureMode: 'demo', outcome: r.outcome, session: sess });
      if (r.outcome === 'admission-not-found') { setNoAdmission({ registrant: r.registrant, session: r.session }); return; }
      setIssue(r.outcome); return;
    }
    if (sess !== ACTIVE_SESSION) { setClosedFor(r.record.reg); return; }
    // An existing clearance at another institution is found from the record itself: no capture needed.
    if (priorClearanceOf(r.record.reg)) recordExistingClearance(r.record.reg, officer);
    setReg(r.record.reg);
  };
  const restartTo = (value: string) => { setStep(1); setCapture(null); setResult(null); setEntered(value); setSession(ACTIVE_SESSION); lookup(value, ACTIVE_SESSION); };
  const anotherSession = () => { setNoAdmission(null); document.querySelector<HTMLSelectElement>('[data-session-select]')?.focus(); };
  const auto = useRef(false);
  useEffect(() => { if (!auto.current && params.get('reg')) { auto.current = true; lookup(params.get('reg')!); } });

  const verify = (c: Capture) => {
    if (!record) return;
    setVerifying(true);
    window.setTimeout(() => {
      const r = recordUniversityVerification({ entered: record.reg, officer, captureMode: c.mode, record });
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
              <Field label="Admission session" required>
                {(p) => <Select {...p} data-session-select value={session} onChange={(e) => { setSession(e.target.value as Session); setIssue(null); setReg(null); setNoAdmission(null); setClosedFor(null); }}>
                  {[...SESSIONS].reverse().map((x) => <option key={x} value={x}>{x}{x === ACTIVE_SESSION ? ' (active clearance event)' : ' (clearance event closed)'}</option>)}
                </Select>}
              </Field>
              <Field label="JAMB Registration Number" required error={error}>
                {(p) => <Input {...p} value={entered} autoFocus autoComplete="off" placeholder="e.g. 20250190101CN" className="h-12 font-mono text-base uppercase tracking-wide" onChange={(e) => { setEntered(e.target.value); setError(''); setIssue(null); setReg(null); setNoAdmission(null); setClosedFor(null); }} />}
              </Field>
              <Button type="submit" size="lg" className="w-full" icon={<Search className="h-4 w-4" />}>Continue</Button>
            </form>
            <button type="button" onClick={() => setGuide(true)} className="mt-4 text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline">Demo reference</button>
          </Card>
          <div aria-live="polite">
            {issue && (
              <Notice tone="warning" title={issue === 'invalid' ? 'Invalid registration number' : 'Student not found'}>
                {issue === 'invalid' ? 'This isn’t a valid JAMB Registration Number. Check it with the student and try again.' : `No student with this registration number is on ${UNILAG.name}’s ${session} admission list.`}
              </Notice>
            )}
            {noAdmission && <AdmissionNotFound registrant={noAdmission.registrant} session={noAdmission.session} onAnotherSession={anotherSession} />}
            {closedFor && (
              <Notice tone="warning" title={`The ${session} clearance event is closed`}>
                This student is on {UNILAG.name}’s {session} admission list, but clearance for that session has closed. <Link to={`/clearance/students/${closedFor}`} className="font-medium underline">View the student record</Link>.
              </Notice>
            )}
            {record && <StudentCard record={record} onContinue={() => setStep(2)} />}
            {!issue && !record && !noAdmission && !closedFor && <div className="flex h-full min-h-[10rem] items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 text-center text-sm text-slate-500">The student’s record appears here.</div>}
          </div>
        </div>
      )}

      {step === 2 && record && !result && (
        <Card className="px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-sm text-slate-600"><span className="block font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</span><span className="font-mono">{record.reg}</span> · {record.department}</p>
            </div>
            <Button size="sm" variant="ghost" disabled={verifying} onClick={() => { setStep(1); setCapture(null); }}>Change student</Button>
          </div>
          <div className="mt-4 flex justify-center">
            <div>
              <h2 className="mb-2 text-center text-sm font-semibold text-slate-900">Capture the student’s face</h2>
              <SimulatedCapture image={demoFace(record)} subject={`${record.firstName} ${record.lastName}`} captured={capture?.url ?? null}
                onCaptured={(url) => { const c = { url, mode: 'demo' as const }; setCapture(c); verify(c); }}
                status={verifying ? <p role="status" className="flex items-center gap-2 text-sm font-medium text-slate-700"><Loader2 className="h-4 w-4 animate-spin text-emerald-700" aria-hidden="true" />Verifying identity…</p> : null} />
            </div>
          </div>
        </Card>
      )}

      {guide && (
        <Modal open onClose={() => setGuide(false)} title="Demo reference" description="Registration numbers for the four demonstration scenarios." footer={<Button variant="secondary" onClick={() => setGuide(false)}>Close</Button>}>
          <ul className="space-y-2" aria-label="Demo scenarios">
            {[...SCENARIO_CANDIDATES.filter((c) => c.workspace === 'university').map((c) => ({ reg: c.reg, name: `${c.record.firstName} ${c.record.lastName}` })), ...REGISTRANTS.map((g) => ({ reg: g.reg, name: `${g.firstName} ${g.lastName}` }))].map((c, i) => (
              <li key={c.reg} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ring-slate-200">
                <span className="min-w-0 text-sm">
                  <span className="block font-medium text-slate-900">{['Successful verification', 'Identity discrepancy', 'Existing clearance elsewhere', 'Admission record not found'][i]}</span>
                  <span className="block text-slate-600">{c.name} · <span className="font-mono">{c.reg}</span></span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => { setGuide(false); restartTo(c.reg); }}>Use</Button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {result && record && <ResultPanel event={result} record={record} capture={capture} onNext={restart} />}
    </>
  );
}

const INQUIRY_REASONS = ['Candidate holds an admission offer from this institution', 'Candidate appears on the institution’s admission list', 'Admission may be recorded under another session', 'Other'];

/**
 * Scenario 4: the JAMB registration is valid, but no admission offer exists for this institution and session.
 * Clearance stops here: no face capture, no clearance record, and no conclusion about admission elsewhere.
 */
function AdmissionNotFound({ registrant: g, session, onAnotherSession }: { registrant: Registrant; session: Session; onAnotherSession: () => void }) {
  const state = useJambState();
  const officer = useOfficer();
  const toast = useToast();
  const [inquiring, setInquiring] = useState(false);
  const [reason, setReason] = useState(INQUIRY_REASONS[0]);
  const [comment, setComment] = useState(`The candidate presented for admission clearance at ${UNILAG.name} for the ${session} admission session. The JAMB registration is valid, but no admission record was returned for this institution and session. Kindly confirm whether an admission record exists.`);
  const [error, setError] = useState('');
  const inquiry = escalationsOf(state).find((e) => e.reg === g.reg && e.institution === UNILAG.code && e.session === session);
  const open = inquiry && ['open', 'in-review', 'awaiting-information'].includes(escalationStatus(inquiry));
  const submit = () => {
    const r = raiseAdmissionInquiry({ reg: g.reg, session, officer, reason, comment });
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: 'success', title: 'Admission record inquiry sent to JAMB', description: r.value.id });
    setInquiring(false);
  };
  const tile = (label: string, value: string, good: boolean) => (
    <div className={cn('flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 ring-1 ring-inset', good ? 'bg-emerald-50/50 ring-emerald-200' : 'bg-red-50/50 ring-red-200')}>
      <dt className="text-sm text-slate-700">{label}</dt>
      <dd className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', good ? 'text-emerald-700' : 'text-red-700')}>{good ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}{value}</dd>
    </div>
  );
  return (
    <Card className="overflow-hidden" aria-label="Admission record check">
      <div role="alert" className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-6 py-3 text-amber-950">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div><h2 className="text-base font-semibold">Admission Record Not Found</h2><p className="text-sm">The candidate’s JAMB registration details are valid, but no admission offer was found for this institution and admission session. Institutional clearance cannot proceed.</p></div>
      </div>
      <div className="space-y-4 px-6 py-5">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Candidate">
          {([['Full name', `${g.firstName} ${g.middleName} ${g.lastName}`], ['JAMB Registration Number', <span className="font-mono">{g.reg}</span>], ['JAMB registration validity', 'Valid'], ['Institution being checked', UNILAG.name], ['Admission session', session]] as [string, ReactNode][]).map(([k, v]) => (
            <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
          ))}
        </dl>
        <dl className="grid gap-3 sm:grid-cols-2" aria-label="Admission check status">{tile('JAMB Registration', 'Valid', true)}{tile('Admission Record', 'Not Found', false)}</dl>
        <p className="text-xs text-slate-500">No face capture is performed and no clearance record is created. This result covers only {UNILAG.name}, {session} admission session; it does not establish whether the candidate holds an admission elsewhere.</p>
        {inquiry && (
          <div className="rounded-lg bg-violet-50 px-4 py-3 text-sm ring-1 ring-inset ring-violet-200" aria-label="Admission record inquiry">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-violet-950">Admission record inquiry <span className="font-mono text-xs font-medium">{inquiry.id}</span><EscalationStatusBadge e={inquiry} /></p>
            <p className="mt-1 text-violet-900">{inquiry.resolution ? `JAMB decision: ${RESOLUTION_LABEL[inquiry.resolution.outcome]}.` : 'With JAMB for investigation.'} <Link to={`/clearance/escalations/${inquiry.id}`} className="font-medium underline">View case</Link></p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
        <ButtonLink to={`/clearance/events/${ACTIVE_ADMISSION_EVENT.id}`} variant="secondary">Return to Student List</ButtonLink>
        <Button variant="secondary" onClick={onAnotherSession}>Check Another Admission Session</Button>
        {!open && <Button icon={<Send className="h-4 w-4" />} onClick={() => { setError(''); setInquiring(true); }}>Raise Admission Record Inquiry</Button>}
      </div>
      {inquiring && (
        <Drawer open onClose={() => setInquiring(false)} title="Raise Admission Record Inquiry" description="JAMB investigates whether an admission record exists. This is not an identity escalation."
          footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setInquiring(false)}>Cancel</Button><Button icon={<Send className="h-4 w-4" />} onClick={submit}>Submit inquiry</Button></div>}>
          <div className="space-y-4">
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200">
              {([['Candidate', `${g.firstName} ${g.middleName} ${g.lastName}`], ['JAMB Registration Number', <span className="font-mono">{g.reg}</span>], ['Institution', UNILAG.name], ['Admission session', session]] as [string, ReactNode][]).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v}</dd></div>
              ))}
            </dl>
            <Field label="Reason" required>{(p) => <Select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>{INQUIRY_REASONS.map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
            <Field label="Comment" required>{(p) => <Textarea {...p} rows={5} value={comment} onChange={(e) => { setComment(e.target.value); setError(''); }} />}</Field>
          </div>
        </Drawer>
      )}
    </Card>
  );
}

function StudentCard({ record, onContinue }: { record: StudentRecord; onContinue: () => void }) {
  const state = useJambState();
  const [escalating, setEscalating] = useState(false);
  const esc = escalationFor(record.reg, state);
  const live = esc && ['open', 'in-review', 'awaiting-information'].includes(escalationStatus(esc));
  const previous = priorClearanceOf(record.reg);
  if (record.blocked === 'duplicate-clearance' && previous && record.clearance !== 'cleared') {
    const row = (k: string, v: ReactNode) => <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>;
    return (
      <div className="space-y-4">
        <Card className="overflow-hidden" aria-label="Existing clearance record">
          <div className="flex items-center gap-4 bg-amber-500 px-6 py-5 text-amber-950">
            <ShieldAlert className="h-8 w-8" aria-hidden="true" />
            <div><h2 className="text-xl font-semibold">Existing Clearance Record Found</h2><p className="text-sm opacity-90">This student already has an existing clearance record associated with another institution within the same admission session. Further review is required.</p></div>
          </div>
          <div className="grid gap-6 px-6 py-6 md:grid-cols-[auto_1fr]">
            <figure className="w-36"><Portrait record={record} className="h-44 w-full" /><figcaption className="mt-1 text-center text-xs text-slate-500">{jambPortraitLabel(record)}</figcaption></figure>
            <dl className="grid content-start gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {row('Student name', `${record.firstName} ${record.middleName} ${record.lastName}`)}
              {row('JAMB Registration Number', <span className="font-mono">{record.reg}</span>)}
              {row('Previous institution', institutionByCode(previous.institution)?.name)}
              {row('Admission session', previous.session)}
              {row('Clearance date', dateTime(previous.clearedAt))}
              {row('Clearance reference', <span className="font-mono">{previous.reference}</span>)}
              {row('Existing clearance status', <Badge tone="success">Cleared</Badge>)}
              {row('Clearance at University of Lagos', live ? <Badge tone="warning">Pending JAMB review</Badge> : <Badge tone="danger">On hold</Badge>)}
            </dl>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
            {!live && <Button icon={<Send className="h-4 w-4" />} onClick={() => setEscalating(true)}>Escalate to JAMB</Button>}
            <ButtonLink to={`/clearance/events/${ACTIVE_ADMISSION_EVENT.id}`} variant="secondary">Return to Student List</ButtonLink>
          </div>
        </Card>
        {esc && <EscalationStatusPanel e={esc} />}
        {escalating && <EscalationDrawer record={record} category="duplicate-clearance" onClose={() => setEscalating(false)} />}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Card className="px-5 py-5" aria-label="Student record">
        <div className="flex flex-col gap-5 sm:flex-row">
          <figure className="w-32 shrink-0"><Portrait record={record} className="h-40 w-full" /><figcaption className="mt-1 text-center text-xs text-slate-500">{jambPortraitLabel(record)}</figcaption></figure>
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
              <Notice tone="warning" title={live ? 'Clearance pending JAMB review' : 'Clearance blocked'} className="mt-4">
                {record.blocked === 'duplicate-clearance' ? 'An existing clearance record at another institution was found.' : record.blocked === 'exam-mismatch' ? 'The live capture doesn’t match the JAMB examination verification record.' : 'The student’s identity records don’t agree.'}
                {!live && <> <button type="button" onClick={() => setEscalating(true)} className="font-semibold underline">Escalate to JAMB</button></>}
              </Notice>
            ) : (
              <Button className="mt-5" size="lg" icon={<ArrowRight className="h-4 w-4" />} onClick={onContinue}>Confirm and continue</Button>
            )}
          </div>
        </div>
      </Card>
      {esc && record.clearance !== 'cleared' && <EscalationStatusPanel e={esc} />}
      {escalating && <EscalationDrawer record={record} category={record.blocked === 'duplicate-clearance' ? 'duplicate-clearance' : record.blocked === 'exam-mismatch' ? 'exam-impersonation' : 'jamb-nin-discrepancy'} onClose={() => setEscalating(false)} />}
    </div>
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

/** The outcome is the focus: a confident success, the comparison evidence for a discrepancy, or the existing clearance. */
function ResultPanel({ event: e, record, capture, onNext }: { event: Activity; record: StudentRecord; capture: Capture | null; onNext: () => void }) {
  const officer = useOfficer();
  const state = useJambState();
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [submitted, setSubmitted] = useState<JambException | null>(null);
  const cleared = record.clearance === 'cleared';
  const listPath = `/clearance/events/${ACTIVE_ADMISSION_EVENT.id}`;
  const previous = priorClearanceOf(record.reg);
  const esc = submitted ? escalationFor(record.reg, state) ?? submitted : undefined;
  const complete = () => { const r = confirmClearance(record.reg, officer); if (!r.ok) setError(r.error); };
  const o = e.outcome;
  const kind = cleared ? 'cleared' : o === 'identity-confirmed' ? 'verified' : o === 'nin-mismatch' || o === 'exam-mismatch' ? 'discrepancy' : o === 'duplicate-clearance' ? 'existing' : 'failed';
  const head = {
    cleared: { tone: 'success', icon: <ShieldCheck className="h-8 w-8" aria-hidden="true" />, title: 'Clearance Successful', text: `${record.firstName} ${record.lastName} has been cleared by ${UNILAG.name}.` },
    verified: { tone: 'success', icon: <CheckCircle2 className="h-8 w-8" aria-hidden="true" />, title: 'Identity Verified', text: 'The captured face matches the student’s JAMB and NIN identity records.' },
    discrepancy: { tone: 'warning', icon: <AlertTriangle className="h-8 w-8" aria-hidden="true" />, title: 'Identity Discrepancy Detected', text: o === 'exam-mismatch'
      ? 'The captured face matches the NIN identity record but does not match the JAMB examination verification record. Further investigation is required.'
      : 'The captured portrait matches the JAMB registration record but differs from the NIN identity record. Further investigation is required.' },
    existing: { tone: 'warning', icon: <ShieldAlert className="h-8 w-8" aria-hidden="true" />, title: 'Existing Clearance Record Found', text: 'This student already has an existing clearance record associated with another institution within the same admission session. Further review is required.' },
    failed: { tone: 'danger', icon: <XCircle className="h-8 w-8" aria-hidden="true" />, title: 'Identity Could Not Be Confirmed', text: 'The captured face does not match the student’s JAMB registration record.' },
  }[kind];
  const banner = { success: 'bg-emerald-700 text-white', danger: 'bg-red-700 text-white', warning: 'bg-amber-500 text-amber-950' }[head.tone as 'success' | 'danger' | 'warning'];
  const row = (k: string, v: ReactNode) => <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>;
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden" aria-label="Verification result">
        {kind === 'discrepancy' ? (
          // A compact alert: states the issue without dominating the screen.
          <div role="alert" className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-6 py-3 text-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div><h2 className="text-base font-semibold">{head.title}</h2><p className="text-sm">{head.text}</p></div>
          </div>
        ) : (
          <div className={cn('flex items-center gap-4 px-6 py-5', banner)}>
            <span className="shrink-0">{head.icon}</span>
            <div><h2 className="text-xl font-semibold">{head.title}</h2><p className="text-sm opacity-90">{head.text}</p></div>
          </div>
        )}
        {kind === 'discrepancy' ? (
          <div className="space-y-4 px-6 py-5">
            <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</span> · <span className="font-mono">{record.reg}</span> · {record.department}</p>
            <IdentityComparison record={record} capture={capture?.url} comparisons={comparisonsFor(o as 'nin-mismatch' | 'exam-mismatch')} />
            <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-sm" aria-label="Status">
              <div className="flex items-center gap-2"><dt className="text-slate-500">Verification:</dt><dd>{esc ? <Badge tone="violet">Escalated</Badge> : <Badge tone="warning">Escalation required</Badge>}</dd></div>
              <div className="flex items-center gap-2"><dt className="text-slate-500">Clearance:</dt><dd><Badge tone="warning">Pending review</Badge></dd></div>
            </dl>
          </div>
        ) : (
          <div className="grid gap-6 px-6 py-6 md:grid-cols-[auto_1fr]">
            <figure className="w-36"><Portrait record={record} className="h-44 w-full" /><figcaption className="mt-1 text-center text-xs text-slate-500">{jambPortraitLabel(record)}</figcaption></figure>
            {kind === 'cleared' ? (
              <dl className="grid content-start gap-x-6 gap-y-3 text-sm sm:grid-cols-2" aria-label="Clearance record">
                {row('Student', `${record.firstName} ${record.middleName} ${record.lastName}`)}
                {row('JAMB Registration Number', <span className="font-mono">{record.reg}</span>)}
                {row('Institution', UNILAG.name)}
                {row('Department', record.department)}
                {row('Admission session', record.session)}
                {row('Verification outcome', <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{resolvedDiscrepancy(record.reg) === 'exam' ? 'Identity verified · examination record discrepancy resolved by JAMB' : record.nin === 'mismatch' ? 'Identity verified · NIN discrepancy resolved by JAMB' : 'Identity verified'}</span>)}
                {row('Clearance reference', <span className="font-mono">{record.clearanceRef}</span>)}
                {row('Clearance date and time', record.clearedAt ? dateTime(record.clearedAt) : '—')}
                {row('Clearance officer', record.clearedBy)}
                {row('Clearance status', <Badge tone="success">Cleared</Badge>)}
              </dl>
            ) : kind === 'existing' && previous ? (
              <dl className="grid content-start gap-x-6 gap-y-3 rounded-xl bg-amber-50 p-4 text-sm ring-1 ring-inset ring-amber-200 sm:grid-cols-2" aria-label="Existing clearance record">
                {row('Student name', `${record.firstName} ${record.middleName} ${record.lastName}`)}
                {row('JAMB Registration Number', <span className="font-mono">{record.reg}</span>)}
                {row('Previous institution', institutionByCode(previous.institution)?.name)}
                {row('Previous admission session', previous.session)}
                {row('Previous clearance date', dateTime(previous.clearedAt))}
                {row('Previous clearance reference', <span className="font-mono">{previous.reference}</span>)}
                {row('Existing clearance status', <Badge tone="success">Cleared</Badge>)}
                {row('Clearance at University of Lagos', esc ? <Badge tone="warning">Pending review</Badge> : <Badge tone="danger">Blocked</Badge>)}
              </dl>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-slate-600"><span className="font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</span> · <span className="font-mono">{record.reg}</span></p>
                <p className="text-slate-600">{record.department} · {record.course} · {record.session}</p>
                {kind === 'verified' && (
                  <ul className="flex flex-wrap gap-2 pt-1" aria-label="Verification indicators">
                    {[e.checks?.face === 'no-match' ? 'JAMB record: resolved by JAMB' : 'JAMB record: Match', e.checks?.nin === 'mismatch' ? 'NIN record: resolved by JAMB' : 'NIN record: Match'].map((t) => <li key={t}><Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />{t}</Badge></li>)}
                  </ul>
                )}
                {kind === 'verified' && <p className="text-slate-600">The student can proceed with institutional clearance.</p>}
                {kind === 'failed' && e.exceptionId && <p className="text-slate-600">Referred to JAMB: exception <span className="font-mono font-medium text-slate-900">{e.exceptionId}</span>.</p>}
              </div>
            )}
          </div>
        )}
        {cleared && evidence && capture && (
          <section aria-label="Verification details" className="mx-6 mb-5 grid gap-5 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200 sm:grid-cols-[auto_1fr]">
            <div className="flex gap-3">
              <figure className="w-24"><Portrait record={record} className="h-28 w-full" /><figcaption className="mt-1 text-center text-[11px] text-slate-500">JAMB record</figcaption></figure>
              {ninPortrait(record) && <figure className="w-24"><FaceImage src={ninPortrait(record)} label="NIN identity record portrait" className="h-28 w-full" /><figcaption className="mt-1 text-center text-[11px] text-slate-500">NIN record</figcaption></figure>}
              <figure className="w-24"><img src={capture.url} alt="Captured face used for the verification" className="h-28 w-full rounded-lg object-cover ring-1 ring-slate-200" /><figcaption className="mt-1 text-center text-[11px] text-slate-500">Captured face</figcaption></figure>
            </div>
            <dl className="grid content-start gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {([['Verification reference', <span className="font-mono">{e.ref}</span>], ['Verified', dateTime(e.at)], ['JAMB vs Live Capture', e.checks?.face === 'no-match' ? 'Mismatch · resolved by JAMB' : 'Match'], ['NIN vs Live Capture', e.checks?.nin === 'mismatch' ? 'Mismatch · resolved by JAMB' : 'Match']] as [string, ReactNode][]).map(([k, v]) => (
                <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>
              ))}
              <p className="text-xs text-slate-500 sm:col-span-2">The capture was used only for this verification and is not stored.</p>
            </dl>
          </section>
        )}
        {error && <p role="alert" className="px-6 pb-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          {kind === 'cleared' ? (
            <>
              <ButtonLink to={`/clearance/certificate/${record.reg}`} variant="primary" icon={<Printer className="h-4 w-4" />}>Print Clearance Certificate</ButtonLink>
              <ButtonLink to={`/clearance/students/${record.reg}`} variant="secondary">View Clearance Details</ButtonLink>
              <ButtonLink to={listPath} variant="secondary">Return to Student List</ButtonLink>
              <Button variant="secondary" icon={<ScanFace className="h-4 w-4" />} onClick={onNext}>Verify Another Student</Button>
              {capture && <Button variant="ghost" className="sm:ml-auto" aria-expanded={evidence} onClick={() => setEvidence((v) => !v)}>{evidence ? 'Hide verification details' : 'View verification details'}</Button>}
            </>
          ) : kind === 'verified' ? (
            <>
              <Button size="lg" icon={<ShieldCheck className="h-4 w-4" />} onClick={complete}>Complete Clearance</Button>
              <ButtonLink to={listPath} variant="secondary" size="lg">Return to Student List</ButtonLink>
            </>
          ) : (
            <>
              {(kind === 'discrepancy' || kind === 'existing') && !esc && <Button icon={<Send className="h-4 w-4" />} onClick={() => setEscalating(true)}>Escalate to JAMB</Button>}
              {esc && <ButtonLink to={`/clearance/students/${record.reg}`} variant="primary">View escalation</ButtonLink>}
              <ButtonLink to={listPath} variant="secondary">Return to Student List</ButtonLink>
              <Button variant="secondary" icon={<ScanFace className="h-4 w-4" />} onClick={onNext}>Verify Another Student</Button>
            </>
          )}
        </div>
      </Card>
      {esc && <EscalationStatusPanel e={esc} />}
      {escalating && <EscalationDrawer record={record} category={kind === 'existing' ? 'duplicate-clearance' : o === 'exam-mismatch' ? 'exam-impersonation' : 'jamb-nin-discrepancy'} capture={capture?.url} onClose={() => setEscalating(false)} onDone={setSubmitted} />}
    </div>
  );
}

/* ---------------- Escalations to JAMB ---------------- */

function EscalationsPage() {
  const state = useJambState();
  const list = escalationsOf(state).filter((e) => e.institution === UNILAG.code && e.escalation?.source !== 'nysc').sort((a, b) => lastUpdated(b).localeCompare(lastUpdated(a)));
  return (
    <>
      <PageHeader title="Escalations" description="Cases your institution referred to JAMB: their status, JAMB’s decisions and the full case history." />
      <Card>
        <DataTable rows={list} rowKey={(e) => e.id} rowHref={(e) => `/clearance/escalations/${e.id}`} empty={<EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="No escalations yet" description="Cases you escalate to JAMB appear here." />}
          columns={[
            { key: 'id', header: 'Reference', cell: (e) => <Link to={`/clearance/escalations/${e.id}`} className="font-mono text-xs font-medium text-slate-900 hover:text-brand-700">{e.id}</Link> },
            { key: 's', header: 'Candidate', className: '!whitespace-normal min-w-[9rem]', cell: (e) => { const c = caseSubject(e.reg, state); return <span className="font-medium text-slate-900">{c?.firstName} {c?.lastName}<span className="block font-mono text-xs font-normal text-slate-500">{e.reg}</span></span>; } },
            { key: 'c', header: 'Case type', className: '!whitespace-normal min-w-[9rem]', cell: (e) => <span>{CASE_TYPE_LABEL[caseTypeOf(e)]}<span className="block text-xs text-slate-500">{e.escalation?.reason ?? CATEGORY_LABEL[e.category]}</span></span> },
            { key: 'd', header: 'Submitted', cell: (e) => <span className="tabular-nums text-slate-600">{formatDate(e.escalation!.submittedAt)}<span className="block text-xs text-slate-400">{e.escalation!.submittedBy}</span></span> },
            { key: 'st', header: 'Status', cell: (e) => <EscalationStatusBadge e={e} /> },
            { key: 'a', header: 'JAMB officer', cell: (e) => <span className={e.assignedTo ? 'text-slate-700' : 'text-slate-400'}>{e.assignedTo ?? 'Not yet assigned'}</span> },
            { key: 'u', header: 'Last updated', cell: (e) => <span className="tabular-nums text-slate-600">{dateTime(lastUpdated(e))}</span> },
            { key: 'r', header: 'JAMB response', className: '!whitespace-normal min-w-[14rem]', cell: (e) => <span className="text-slate-600">{e.resolution ? <><span className="font-medium text-slate-900">{RESOLUTION_LABEL[e.resolution.outcome]}.</span> {e.resolution.note}</> : jambResponse(e)?.comment ?? 'Awaiting JAMB review'}</span> },
          ]} />
      </Card>
    </>
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
        { value: 'escalated' as 'all', label: 'Escalated', count: count('escalated') },
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
  const [escalating, setEscalating] = useState(false);
  const r = ownRecord(reg, state);
  if (!r) return <NotFound what="Student" back="/clearance/records" />;
  const esc = escalationFor(r.reg, state);
  const escLive = esc && ['open', 'in-review', 'awaiting-information'].includes(escalationStatus(esc));
  const clear = () => { const x = confirmClearance(r.reg, officer); toast(x.ok ? { tone: 'success', title: 'Clearance completed', description: x.value.clearanceRef } : { tone: 'error', title: 'Not cleared', description: x.error }); };
  const active = r.session === ACTIVE_SESSION;
  const actions = (
    <>
      {r.clearance !== 'cleared' && r.blocked && !escLive && <Button icon={<Send className="h-4 w-4" />} onClick={() => setEscalating(true)}>Escalate to JAMB</Button>}
      {active && r.clearance !== 'cleared' && !r.blocked && r.verification !== 'verified' && <ButtonLink to={`/clearance/verify?reg=${r.reg}`} variant="primary" icon={<ScanFace className="h-4 w-4" />}>Verify Student</ButtonLink>}
      {active && r.clearance !== 'cleared' && !r.blocked && r.verification === 'verified' && <Button icon={<ShieldCheck className="h-4 w-4" />} onClick={clear}>Complete Clearance</Button>}
      {r.clearance === 'cleared' && <ButtonLink to={`/clearance/certificate/${r.reg}`} icon={<Printer className="h-4 w-4" />}>Clearance Certificate</ButtonLink>}
    </>
  );
  return (
    <>
      <PageHeader title="" breadcrumbs={[{ label: 'My Clearance Records', to: '/clearance/records' }, { label: `${r.firstName} ${r.lastName}` }]} />
      {esc && r.clearance !== 'cleared' && <EscalationStatusPanel e={esc} />}
      <StudentJourney record={r} actions={actions} />
      {escalating && <EscalationDrawer record={r} category={r.blocked === 'duplicate-clearance' ? 'duplicate-clearance' : r.blocked === 'exam-mismatch' ? 'exam-impersonation' : 'jamb-nin-discrepancy'} onClose={() => setEscalating(false)} />}

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
