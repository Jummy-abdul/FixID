import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, XCircle } from 'lucide-react';
import { Badge, Card, type Tone } from '@/components/ui';
import { dateTime } from './format';
import { ExceptionStatusBadge } from '@/pages/exceptions/ExceptionsPage';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { institutionByCode, type StudentRecord } from './data';
import { CATEGORY_LABEL, OUTCOME_LABEL, activitiesFor, exceptionsForReg, outcomeTone, priorClearanceOf, useJambState, type Activity } from './store';
import { ClearanceBadge, Portrait, VerificationBadge } from './ui';

type StageState = 'done' | 'pending' | 'failed' | 'warning' | 'not-available';
const RING: Record<StageState, { icon: ReactNode; ring: string; label: string; tone: Tone }> = {
  done: { icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />, ring: 'bg-emerald-600 text-white', label: 'Completed', tone: 'success' },
  pending: { icon: <Clock className="h-4 w-4" aria-hidden="true" />, ring: 'bg-slate-200 text-slate-600', label: 'Pending', tone: 'neutral' },
  failed: { icon: <XCircle className="h-4 w-4" aria-hidden="true" />, ring: 'bg-red-600 text-white', label: 'Failed', tone: 'danger' },
  warning: { icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />, ring: 'bg-amber-500 text-white', label: 'Under review', tone: 'warning' },
  'not-available': { icon: <CircleDashed className="h-4 w-4" aria-hidden="true" />, ring: 'bg-slate-100 text-slate-400', label: 'Not yet', tone: 'neutral' },
};

/** One recorded activity in the identity journey. */
export interface JourneyEntry { activity: string; organisation: string; at?: string; officer?: string; outcome: ReactNode; reference?: ReactNode; details?: [string, ReactNode][] }

const tone = (a: Activity): Tone => ({ success: 'success', danger: 'danger', warning: 'warning', neutral: 'neutral' } as const)[outcomeTone(a.outcome)];
function activityEntry(a: Activity): JourneyEntry {
  return {
    activity: a.kind === 'nysc' ? 'NYSC identity verification' : a.outcome === 'clearance-completed' ? 'Admission clearance completed' : a.outcome === 'escalated' ? 'Escalated to JAMB' : a.outcome === 'duplicate-clearance' ? 'Existing clearance check' : 'Identity verification at clearance',
    organisation: a.organisation, at: a.at, officer: a.officer, outcome: <Badge tone={tone(a)}>{OUTCOME_LABEL[a.outcome]}</Badge>, reference: <span className="font-mono">{a.ref}</span>,
    details: a.checks ? [
      ...(a.checks.face ? [['Face match (JAMB record)', a.checks.face === 'match' ? 'Match' : 'No match'] as [string, ReactNode]] : []),
      ...(a.checks.nin ? [['NIN verification', a.checks.nin === 'match' ? 'Match' : 'Mismatch'] as [string, ReactNode]] : []),
    ] : undefined,
  };
}

/** The five stages of a candidate's identity journey, read from the shared record. */
export interface JourneyStage { n: number; title: string; state: StageState; entries: JourneyEntry[]; empty?: string }
export function journeyOf(r: StudentRecord, activities: Activity[]): JourneyStage[] {
  const inst = institutionByCode(r.institution)!;
  const prior = priorClearanceOf(r.reg);
  const uni = activities.filter((a) => a.kind === 'university' && a.outcome !== 'clearance-completed');
  const nysc = activities.filter((a) => a.kind === 'nysc');
  const clearanceEntries: JourneyEntry[] = [];
  if (prior) {
    const pi = institutionByCode(prior.institution)!;
    clearanceEntries.push({ activity: 'Previous clearance record (another institution)', organisation: pi.name, at: prior.clearedAt, officer: prior.clearedBy, outcome: <Badge tone="neutral">Previous record: cleared</Badge>, reference: <span className="font-mono">{prior.reference}</span>, details: [['Admission session', prior.session], ['Department', prior.department], ['Course', prior.course]] });
  }
  clearanceEntries.push(...uni.map(activityEntry));
  if (r.clearance === 'cleared') clearanceEntries.push({ activity: 'Admission clearance completed', organisation: inst.name, at: r.clearedAt, officer: r.clearedBy, outcome: <Badge tone="success">Cleared</Badge>, reference: <span className="font-mono">{r.clearanceRef}</span>, details: [['Department', r.department], ['Course', r.course]] });
  clearanceEntries.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  // With a previous clearance elsewhere, state where the current admission record stands, separately.
  const duplicateCase = activities.find((a) => a.outcome === 'duplicate-clearance' && a.exceptionId);
  if (prior && r.clearance !== 'cleared') {
    clearanceEntries.push({
      activity: 'Clearance for the current admission record', organisation: inst.name,
      outcome: r.blocked === 'duplicate-clearance' ? <Badge tone="warning">Blocked: duplicate clearance under JAMB review</Badge> : <Badge tone="neutral">Not cleared</Badge>,
      reference: duplicateCase ? <span className="font-mono">{duplicateCase.exceptionId}</span> : undefined,
      details: [['Admission session', r.session], ['Department', r.department], ['Course', r.course]],
    });
  }
  const clearanceState: StageState = r.clearance === 'cleared' ? 'done' : r.verification === 'failed' ? 'failed' : r.verification === 'exception' || r.blocked ? 'warning' : 'pending';
  const nyscLatest = nysc[0];
  return [
    { n: 1, title: 'JAMB Registration', state: 'done' as StageState, entries: [{ activity: 'Candidate registration and biometric enrolment', organisation: 'Joint Admissions and Matriculation Board', at: r.registeredAt, outcome: <Badge tone="success">Registered</Badge>, reference: <span className="font-mono">{r.reg}</span>, details: [['Registration centre', r.registrationCentre]] }] },
    { n: 2, title: 'JAMB Examination Verification', state: 'done' as StageState, entries: [{ activity: 'Candidate verified for the UTME', organisation: 'Joint Admissions and Matriculation Board', at: r.exam.at, outcome: <Badge tone="success">Verified</Badge>, reference: <span className="font-mono">{r.exam.reference}</span>, details: [['Examination centre', r.exam.centre], ['UTME score', String(r.utmeScore)]] }] },
    { n: 3, title: 'University Admission Clearance', state: clearanceState, entries: clearanceEntries, empty: 'Clearance not yet started.' },
    ...(nysc.length ? [{ n: 4, title: 'NYSC Verification', state: (nyscLatest ? (nyscLatest.outcome === 'confirmed' ? 'done' : nyscLatest.outcome === 'face-mismatch' ? 'failed' : 'warning') : 'not-available') as StageState, entries: nysc.map(activityEntry).reverse(), empty: 'No NYSC verification yet.' }] : []),
  ];
}

/** A candidate's identity profile and journey. Every activity names its organisation, officer, time and reference. */
export function StudentJourney({ record: r, actions, exceptionPath, showAudit }: { record: StudentRecord; actions?: ReactNode; exceptionPath?: (id: string) => string; showAudit?: ReactNode }) {
  const state = useJambState();
  const inst = institutionByCode(r.institution)!;
  const stages = journeyOf(r, activitiesFor(r.reg, state));
  const exceptions = exceptionsForReg(r.reg, state);
  return (
    <div className="space-y-6">
      <Card className="px-5 py-5">
        <div className="flex flex-col gap-5 sm:flex-row">
          <figure className="w-32 shrink-0"><Portrait record={r} className="h-40 w-full" /><figcaption className="mt-1 text-center text-xs text-slate-500">JAMB registration portrait</figcaption></figure>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{r.firstName} {r.middleName} {r.lastName}</h1>
                <p className="mt-0.5 font-mono text-sm text-slate-600">{r.reg}</p>
                <div className="mt-2 flex flex-wrap gap-2"><VerificationBadge status={r.verification} /><ClearanceBadge status={r.clearance} review={r.verification === 'escalated'} /></div>
              </div>
              {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Student biodata">
              {([['Institution', inst.name], ['Admission session', r.session], ['Department', r.department], ['Course', r.course], ['Date of birth', formatDate(r.dateOfBirth)], ['Gender', r.gender], ['State of origin', r.stateOfOrigin]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      </Card>

      <Card className="px-5 py-5">
        <h2 className="text-base font-semibold text-slate-900">Identity journey</h2>
        <ol className="mt-4" aria-label="Identity journey">
          {stages.map((s, i) => (
            <li key={s.n} className="relative grid grid-cols-[2.5rem_1fr] gap-3 pb-6">
              {i < stages.length - 1 && <span className="absolute left-[1.2rem] top-10 h-[calc(100%-2.5rem)] w-px bg-slate-200" aria-hidden="true" />}
              <span className={cn('flex h-10 w-10 items-center justify-center rounded-full', RING[s.state].ring)} aria-hidden="true">{RING[s.state].icon}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-slate-900">{s.n}. {s.title}</h3><Badge tone={RING[s.state].tone}>{RING[s.state].label}</Badge></div>
                {s.entries.length === 0 ? <p className="mt-2 text-sm text-slate-500">{s.empty}</p> : (
                  <ul className="mt-2 space-y-2">
                    {s.entries.map((e, k) => (
                      <li key={k} className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-100">
                        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-slate-900">{e.activity}</span>{e.outcome}</div>
                        <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
                          {([['Organisation', e.organisation], ['Date and time', e.at ? dateTime(e.at) : '—'], ...(e.officer ? [['Responsible officer', e.officer]] : []), ...(e.reference ? [['Reference', e.reference]] : []), ...(e.details ?? [])] as [string, ReactNode][]).map(([k, v]) => (
                            <div key={k}><dt className="text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {exceptions.length > 0 && (
        <Card className="px-5 py-5">
          <h2 className="text-base font-semibold text-slate-900">Exceptions</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm" aria-label="Exceptions">
            {exceptions.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{exceptionPath ? <Link to={e.escalation ? exceptionPath(e.id).replace('/exceptions/', '/escalations/') : exceptionPath(e.id)} className="font-mono text-xs font-medium text-slate-900 hover:text-brand-700">{e.id}</Link> : <span className="font-mono text-xs">{e.id}</span>} <span className="text-slate-700">· {CATEGORY_LABEL[e.category]}</span> <span className="text-slate-500">· raised by {e.raisedBy}, {e.raisedByOrganisation}</span></span>
                <span className="flex items-center gap-2"><ExceptionStatusBadge status={e.status} /><span className="text-slate-500">{dateTime(e.raisedAt)}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {showAudit}
    </div>
  );
}
