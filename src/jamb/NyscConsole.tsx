import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Download, FileText, Home, Loader2, Printer, ScanFace, Search, ShieldCheck, XCircle } from 'lucide-react';
import { Button, ButtonLink, Card, DataTable, EmptyState, Field, FilterSelect, Input, PageHeader, Pagination, SearchInput, StatCard, usePageSlice, useToast } from '@/components/ui';
import { dateTime } from './format';
import { SimulatedCapture } from './capture';
import type { NavGroup } from '@/layout/navigation';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { NYSC_EVENT_ID, eventById, institutionByCode, type StudentRecord } from './data';
import { downloadPdf } from './certificate';
import { StudentJourney, journeyOf } from './journey';
import { demoFace, jambPortraitLabel } from './portraits';
import { OUTCOME_LABEL, activitiesFor, priorClearanceOf, allActivities, lookupForNysc, recordNyscVerification, recordOf, referToJamb, useJambState, type Activity } from './store';
import { ActivityList, EventStatusBadge, NotFound, OutcomeBadge, Section, eventPeriod } from './shared';
import { ConsoleLayout, JambLogo, OrgMark, Portrait, fmt, useOfficer } from './ui';

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

/** The NYSC Clearance Officer's workspace: confirm a candidate's identity and educational history. */
export function NyscConsole() {
  return (
    <ConsoleLayout nav={NAV} organisation={{ name: 'National Youth Service Corps', role: 'NYSC Verification Officer' }} mark={<OrgMark letters="NYSC" tone="blue" />}>
      <Routes>
        <Route index element={<NyscHome />} />
        <Route path="verify" element={<VerifyCandidatePage />} />
        <Route path="verifications" element={<VerificationsPage />} />
        <Route path="candidates/:reg" element={<CandidatePage />} />
        <Route path="report/:ref" element={<NyscReportPage backTo={(reg) => `/nysc/candidates/${reg}`} />} />
        <Route path="*" element={<Navigate to="/nysc" replace />} />
      </Routes>
    </ConsoleLayout>
  );
}

function useMine() {
  const state = useJambState();
  const officer = useOfficer();
  return useMemo(() => allActivities(state).filter((a) => a.kind === 'nysc' && a.officer === officer.name), [state, officer.name]);
}

function NyscHome() {
  const officer = useOfficer();
  const mine = useMine();
  const event = eventById(NYSC_EVENT_ID)!;
  const count = (o: Activity['outcome']) => mine.filter((a) => a.outcome === o).length;
  return (
    <>
      <PageHeader title={`Welcome, ${officer.name.split(' ')[0]}`} description="National Youth Service Corps · NYSC Identity Verification"
        actions={<ButtonLink to="/nysc/verify" variant="primary" size="lg" icon={<ScanFace className="h-5 w-5" />}>Verify Candidate</ButtonLink>} />
      <section aria-label="Verification summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Candidates verified" value={fmt(mine.filter((a) => a.reg).length)} to="/nysc/verifications" />
        <StatCard label="Successful verifications" value={fmt(count('confirmed'))} tone="emerald" to="/nysc/verifications?outcome=confirmed" />
        <StatCard label="Failed identity verification" value={fmt(count('face-mismatch'))} to="/nysc/verifications?outcome=face-mismatch" />
        <StatCard label="Clearance not confirmed" value={fmt(count('clearance-not-confirmed'))} tone="amber" to="/nysc/verifications?outcome=clearance-not-confirmed" />
      </section>
      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">{event.name}</h2><EventStatusBadge status="active" /></div>
        <p className="text-xs text-slate-500">{eventPeriod(event)} · Published by JAMB</p>
      </Card>
      <Section title="Your recent verifications" action={<Link to="/nysc/verifications" className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</Link>}>
        {mine.length ? <ActivityList activities={mine.slice(0, 8)} studentPath={(reg) => `/nysc/candidates/${reg}`} showOrganisation={false} showOfficer={false} /> : <EmptyState icon={<ScanFace className="h-5 w-5" />} title="No verifications yet" />}
      </Section>
    </>
  );
}

/* ---------------- Verify candidate ---------------- */

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
  return (
    <>
      <PageHeader title="Verify Candidate" description="NYSC Identity Verification" />
      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_1fr]">
          <Card className="px-5 py-5">
            <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="space-y-4" noValidate>
              <Field label="JAMB Registration Number" required error={error}>
                {(p) => <Input {...p} value={entered} autoFocus autoComplete="off" placeholder="e.g. 20220290101EO" className="h-12 font-mono text-base uppercase tracking-wide" onChange={(e) => { setEntered(e.target.value); setError(''); setIssue(null); setReg(null); }} />}
              </Field>
              <Button type="submit" size="lg" className="w-full" icon={<Search className="h-4 w-4" />}>Retrieve JAMB record</Button>
            </form>
          </Card>
          <div aria-live="polite">
            {issue && <div role="status" className="rounded-xl bg-amber-50 px-5 py-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{issue === 'invalid' ? 'Invalid registration number' : 'No JAMB record found'}</p><p className="mt-1">{issue === 'invalid' ? 'This isn’t a valid JAMB Registration Number.' : 'JAMB holds no record with this registration number.'}</p></div>}
            {record && (
              <Card className="px-5 py-5" aria-label="JAMB record">
                <div className="flex flex-col gap-5 sm:flex-row">
                  <figure className="w-32 shrink-0"><Portrait record={record} className="h-40 w-full" /><figcaption className="mt-1 text-center text-xs text-slate-500">{jambPortraitLabel(record)}</figcaption></figure>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">JAMB record found</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</h2>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      {([['JAMB Registration Number', <span className="font-mono">{record.reg}</span>], ['Date of birth', formatDate(record.dateOfBirth)], ['Admitted to', institutionByCode(record.institution)?.name], ['Admission session', record.session]] as [string, ReactNode][]).map(([k, v]) => (
                        <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
                      ))}
                    </dl>
                    <Button className="mt-5" size="lg" icon={<ArrowRight className="h-4 w-4" />} onClick={() => setStep(2)}>Continue to face capture</Button>
                  </div>
                </div>
              </Card>
            )}
            {!issue && !record && <div className="flex h-full min-h-[10rem] items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 text-center text-sm text-slate-500">The candidate’s JAMB record appears here.</div>}
          </div>
        </div>
      )}
      {step === 2 && record && !result && (
        <Card className="px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div><p className="text-sm text-slate-600"><span className="block font-semibold text-slate-900">{record.firstName} {record.middleName} {record.lastName}</span><span className="font-mono">{record.reg}</span></p></div>
            <Button size="sm" variant="ghost" disabled={verifying} onClick={() => { setStep(1); setCapture(null); }}>Change candidate</Button>
          </div>
          <div className="mt-4 flex justify-center">
            <div>
              <h2 className="mb-2 text-center text-sm font-semibold text-slate-900">Capture the candidate’s face</h2>
              <SimulatedCapture image={demoFace(record)} subject={`${record.firstName} ${record.lastName}`} instruction="Position the candidate’s face within the frame" captured={capture?.url ?? null}
                onCaptured={(url) => { const c = { url, mode: 'demo' as const }; setCapture(c); verify(c); }}
                status={verifying ? <p role="status" className="flex items-center gap-2 text-sm font-medium text-slate-700"><Loader2 className="h-4 w-4 animate-spin text-emerald-700" aria-hidden="true" />Verifying candidate…</p> : null} />
            </div>
          </div>
        </Card>
      )}
      {result && record && <NyscResult activity={result} record={record} onNext={restart} onRetake={() => { setResult(null); setCapture(null); }} />}
    </>
  );
}

function Row({ label, value, good }: { label: string; value: string; good: boolean | null }) {
  return (
    <tr className="border-t border-slate-100">
      <th scope="row" className="py-2 pr-4 text-left font-normal text-slate-600">{label}</th>
      <td className={cn('py-2 font-semibold', good === null ? 'text-slate-700' : good ? 'text-emerald-700' : 'text-red-700')}>
        <span className="inline-flex items-center gap-1.5">{good === null ? null : good ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}{value}</span>
      </td>
    </tr>
  );
}

function NyscResult({ activity: a, record: r, onNext, onRetake }: { activity: Activity; record: StudentRecord; onNext: () => void; onRetake: () => void }) {
  const officer = useOfficer();
  const toast = useToast();
  const state = useJambState();
  const current = state.activities.find((x) => x.ref === a.ref) ?? a;
  const inst = institutionByCode(r.institution)!;
  const cleared = r.clearance === 'cleared';
  const prior = priorClearanceOf(r.reg);
  const o = a.outcome;
  const head = o === 'confirmed'
    ? { cls: 'bg-emerald-700 text-white', icon: <ShieldCheck className="h-8 w-8" aria-hidden="true" />, title: 'Candidate Identity Confirmed', text: 'Identity, examination and admission clearance records are confirmed.' }
    : o === 'face-mismatch'
      ? { cls: 'bg-red-700 text-white', icon: <XCircle className="h-8 w-8" aria-hidden="true" />, title: 'Candidate Identity Could Not Be Confirmed', text: 'The person presenting does not match the JAMB registration record.' }
      : { cls: 'bg-amber-500 text-amber-950', icon: <AlertTriangle className="h-8 w-8" aria-hidden="true" />, title: 'Admission Clearance Not Confirmed', text: 'The candidate’s identity is confirmed, but no completed admission clearance is on record. The candidate is not confirmed for NYSC processing.' };
  const refer = () => { const x = referToJamb(a.ref, officer); toast(x.ok ? { tone: 'success', title: 'Referred to JAMB', description: x.value.id } : { tone: 'error', title: 'Not referred', description: x.error }); };
  return (
    <Card className="overflow-hidden" aria-label="Verification result">
      <div className={cn('flex items-center gap-4 px-6 py-5', head.cls)}>{head.icon}<div><h2 className="text-xl font-semibold">{head.title}</h2><p className="text-sm opacity-90">{head.text}</p></div></div>
      <div className="grid gap-6 px-6 py-6 md:grid-cols-[auto_1fr]">
        <figure className="w-36"><Portrait record={r} className="h-44 w-full" /><figcaption className="mt-1 text-center text-xs text-slate-500">{jambPortraitLabel(r)}</figcaption></figure>
        <div>
          <p className="text-sm text-slate-600"><span className="font-semibold text-slate-900">{r.firstName} {r.middleName} {r.lastName}</span> · <span className="font-mono">{r.reg}</span></p>
          <table className="mt-3 w-full max-w-lg text-sm" aria-label="Verification checks">
            <thead><tr><th scope="col" className="pb-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Check</th><th scope="col" className="pb-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Outcome</th></tr></thead>
            <tbody>
              {o === 'confirmed' ? (
                <>
                  <Row label="JAMB Registration" value="Valid" good />
                  <Row label="Face Verification" value="Match" good />
                  <Row label="Examination Verification" value="Recorded" good />
                  <Row label="University Admission Clearance" value="Completed" good />
                </>
              ) : o === 'face-mismatch' ? (
                <>
                  <Row label="JAMB record" value="Found" good />
                  <Row label="Face verification" value="Failed" good={false} />
                  <Row label="University admission clearance" value={cleared ? 'Completed' : 'Not completed'} good={null} />
                  <Row label="Overall verification" value="Failed" good={false} />
                </>
              ) : (
                <>
                  <Row label="JAMB record" value="Found" good />
                  <Row label="Face verification" value="Match" good />
                  <Row label="Examination verification" value="Recorded" good />
                  <Row label={prior ? 'University clearance (current record)' : 'University clearance'} value={cleared ? 'Completed' : r.blocked === 'duplicate-clearance' ? 'Blocked: duplicate under JAMB review' : 'Not completed'} good={cleared} />
                  {prior && <Row label="Previous clearance record" value={`${institutionByCode(prior.institution)?.name}, ${formatDate(prior.clearedAt)}`} good={null} />}
                </>
              )}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">Reference <span className="font-mono">{a.ref}</span> · {dateTime(a.at)} · {a.officer}</p>
          {o === 'face-mismatch' && <p className="mt-3 text-sm text-slate-700">No verification report is issued. Retake the capture, or refer the candidate to JAMB for further review.{current.exceptionId && <> Referred: exception <span className="font-mono font-medium">{current.exceptionId}</span>.</>}</p>}
        </div>
      </div>
      {o === 'confirmed' && (
        <div className="border-t border-slate-100 px-6 py-5">
          <h3 className="text-sm font-semibold text-slate-900">Educational identity timeline</h3>
          <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4" aria-label="Educational identity timeline">
            {([['JAMB registration', formatDate(r.registeredAt)], ['Examination verification', `Verified for UTME, ${formatDate(r.exam.at)}`], ['Institution', inst.name], ['Course and department', `${r.course}, Department of ${r.department}`],
              ['University clearance', r.clearedAt ? dateTime(r.clearedAt) : '—'], ['Clearance officer', r.clearedBy ?? '—'], ['Clearance reference', <span className="font-mono">{r.clearanceRef}</span>]] as [string, ReactNode][]).map(([k, v]) => (
              <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
            ))}
          </dl>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
        {o === 'confirmed' && <ButtonLink to={`/nysc/report/${a.ref}`} variant="primary" icon={<FileText className="h-4 w-4" />}>View Verification Report</ButtonLink>}
        {o === 'face-mismatch' && <Button onClick={refer} disabled={!!current.exceptionId}>{current.exceptionId ? 'Referred to JAMB' : 'Refer to JAMB for review'}</Button>}
        {o === 'face-mismatch' && <Button variant="secondary" onClick={onRetake}>Retake capture</Button>}
        <ButtonLink to={`/nysc/candidates/${r.reg}`} variant="secondary">View identity history</ButtonLink>
        <Button variant="secondary" icon={<ScanFace className="h-4 w-4" />} onClick={onNext}>Verify Another Candidate</Button>
      </div>
    </Card>
  );
}

/* ---------------- history ---------------- */

function VerificationsPage() {
  const state = useJambState();
  const mine = useMine();
  const [q, setQ] = useQueryState('q');
  const [outcome, setOutcome] = useQueryState('outcome', 'all');
  const [page, setPage] = usePageParam();
  const query = q.trim().toLowerCase();
  const rows = mine.filter((a) => (outcome === 'all' || a.outcome === outcome) && (!query || `${a.input} ${a.ref}`.toLowerCase().includes(query.replace(/\s/g, '')) || (a.reg && `${recordOf(a.reg, state)?.firstName} ${recordOf(a.reg, state)?.lastName}`.toLowerCase().includes(query))));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 20);
  return (
    <>
      <PageHeader title="My Verifications" description="Candidates you verified for NYSC." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Candidate name, registration number or reference" className="sm:w-80" label="Search verifications" />
          <FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={[{ value: 'all', label: 'All outcomes' }, ...(['confirmed', 'face-mismatch', 'clearance-not-confirmed', 'not-found', 'invalid'] as const).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))]} />
        </div>
        <DataTable rows={pageRows} rowKey={(a) => a.ref} rowHref={(a) => (a.reg ? (a.outcome === 'confirmed' ? `/nysc/report/${a.ref}` : `/nysc/candidates/${a.reg}`) : '')} empty={<EmptyState title="No verifications match" />}
          columns={[
            { key: 't', header: 'Date and time', cell: (a) => <span className="tabular-nums text-slate-600">{dateTime(a.at)}</span> },
            { key: 'c', header: 'Candidate', className: '!whitespace-normal min-w-[10rem]', cell: (a) => { const r = a.reg ? recordOf(a.reg, state) : undefined; return r ? <Link to={`/nysc/candidates/${r.reg}`} className="font-medium text-slate-900 hover:text-brand-700">{r.firstName} {r.lastName}<span className="block font-mono text-xs font-normal text-slate-500">{r.reg}</span></Link> : <span className="font-mono text-xs">{a.input}</span>; } },
            { key: 'i', header: 'Institution', className: '!whitespace-normal', cell: (a) => <span className="text-slate-600">{a.reg ? institutionByCode(recordOf(a.reg, state)!.institution)?.name : '—'}</span> },
            { key: 'o', header: 'Outcome', cell: (a) => <OutcomeBadge outcome={a.outcome} /> },
            { key: 'r', header: 'Reference', cell: (a) => <span className="font-mono text-xs text-slate-600">{a.ref}</span> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={20} onPage={setPage} />
      </Card>
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

/** The NYSC verification report: only for a successful verification. */
export function NyscReportPage({ backTo }: { backTo: (reg: string) => string }) {
  const { ref = '' } = useParams();
  const state = useJambState();
  const toast = useToast();
  const navigate = useNavigate();
  const el = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const a = allActivities(state).find((x) => x.ref === ref && x.kind === 'nysc');
  const r = a?.reg ? recordOf(a.reg, state) : undefined;
  if (!a || !r || a.outcome !== 'confirmed') return <NotFound what="Verification report" back="/nysc/verifications" />;
  const inst = institutionByCode(r.institution)!;
  const stages = journeyOf(r, activitiesFor(r.reg, state).filter((x) => x.at <= a.at || x.ref === a.ref));
  const save = async () => {
    if (!el.current) return;
    setSaving(true);
    try { await downloadPdf(el.current, `nysc-verification-${r.reg}.pdf`, 'NYSC identity verification report'); toast({ tone: 'success', title: 'Report saved', description: `nysc-verification-${r.reg}.pdf` }); } catch { toast({ tone: 'error', title: 'Couldn’t create the PDF', description: 'Use Print and choose “Save as PDF” instead.' }); }
    setSaving(false);
  };
  const row = (k: string, v: ReactNode) => <div key={k}><dt className="text-[11px] uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={backTo(r.reg)} className="text-sm font-medium text-brand-600 hover:text-brand-700">← Identity history</Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={saving} onClick={save}>Download</Button>
          <Button variant="secondary" icon={<Search className="h-4 w-4" />} onClick={() => navigate('/nysc/verify')}>Return to candidate search</Button>
        </div>
      </div>
      <div ref={el} className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-card print:border-slate-400 print:shadow-none" aria-label="NYSC verification report">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3"><JambLogo /><span><span className="block font-semibold text-slate-900">JAMB Identity Verification</span><span className="block text-xs text-slate-500">Joint Admissions and Matriculation Board</span></span></div>
          <div className="text-right"><p className="font-semibold text-slate-900">National Youth Service Corps</p><p className="text-xs text-slate-500">Identity Verification Report</p></div>
        </div>
        <div className="mt-5 flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /><h1 className="text-xl font-semibold">Candidate Identity Confirmed</h1></div>
        <div className="mt-5 grid gap-6 sm:grid-cols-[8rem_1fr]">
          <figure><Portrait record={r} className="h-40 w-full" /><figcaption className="mt-1 text-center text-[11px] text-slate-500">{jambPortraitLabel(r)}</figcaption></figure>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {row('Candidate', `${r.firstName} ${r.middleName} ${r.lastName}`)}
            {row('JAMB registration number', <span className="font-mono">{r.reg}</span>)}
            {row('Date of birth', formatDate(r.dateOfBirth))}
            {row('Institution', inst.name)}
            {row('Course', r.course)}
            {row('Clearance reference', <span className="font-mono">{r.clearanceRef}</span>)}
            {row('Verification reference', <span className="font-mono">{a.ref}</span>)}
            {row('Verified', `${dateTime(a.at)} by ${a.officer}`)}
          </dl>
        </div>
        <table className="mt-6 w-full text-sm" aria-label="Verification outcome">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500"><th className="pb-1 font-semibold">Check</th><th className="pb-1 font-semibold">Outcome</th></tr></thead>
          <tbody>{[['JAMB Registration', 'Valid'], ['Face Verification', 'Match'], ['Examination Verification', 'Recorded'], ['University Admission Clearance', 'Completed']].map(([k, v]) => <tr key={k} className="border-t border-slate-100"><td className="py-1.5 text-slate-600">{k}</td><td className="py-1.5 font-medium text-emerald-700">{v}</td></tr>)}</tbody>
        </table>
        <h2 className="mt-6 text-sm font-semibold text-slate-900">Identity history and audit trail</h2>
        <table className="mt-2 w-full text-xs" aria-label="Identity history">
          <thead><tr className="text-left uppercase tracking-wide text-slate-500"><th className="pb-1 pr-2 font-semibold">Stage</th><th className="pb-1 pr-2 font-semibold">Organisation</th><th className="pb-1 pr-2 font-semibold">Date</th><th className="pb-1 pr-2 font-semibold">Officer</th><th className="pb-1 font-semibold">Reference</th></tr></thead>
          <tbody>
            {stages.flatMap((s) => s.entries.map((e, k) => (
              <tr key={`${s.n}-${k}`} className="border-t border-slate-100 align-top"><td className="py-1.5 pr-2 text-slate-900">{s.n}. {e.activity}</td><td className="py-1.5 pr-2 text-slate-600">{e.organisation}</td><td className="py-1.5 pr-2 text-slate-600">{e.at ? formatDate(e.at) : '—'}</td><td className="py-1.5 pr-2 text-slate-600">{e.officer ?? '—'}</td><td className="py-1.5 font-mono text-slate-600">{e.reference}</td></tr>
            )))}
          </tbody>
        </table>
        <p className="mt-6 border-t border-slate-200 pt-4 text-[11px] text-slate-500">Generated {dateTime(new Date().toISOString())}. Demo environment.</p>
      </div>
    </>
  );
}

