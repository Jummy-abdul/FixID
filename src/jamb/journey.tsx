import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, ShieldCheck, XCircle } from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { institutionByCode, type StudentRecord } from './data';
import { OUTCOME_LABEL, eventsFor, liveCaptureOf, useJambState } from './store';
import { ClearanceBadge, MatriculationBadge, Portrait, VerificationBadge } from './ui';

type Checkpoint = 'verified' | 'pending' | 'failed' | 'exception' | 'not-available';

const CHECK: Record<Checkpoint, { label: string; tone: 'success' | 'neutral' | 'danger' | 'warning'; icon: ReactNode; ring: string }> = {
  verified: { label: 'Verified', tone: 'success', icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />, ring: 'bg-emerald-600 text-white' },
  pending: { label: 'Pending', tone: 'neutral', icon: <Clock className="h-4 w-4" aria-hidden="true" />, ring: 'bg-slate-200 text-slate-600' },
  failed: { label: 'Failed', tone: 'danger', icon: <XCircle className="h-4 w-4" aria-hidden="true" />, ring: 'bg-red-600 text-white' },
  exception: { label: 'Exception', tone: 'warning', icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />, ring: 'bg-amber-500 text-white' },
  'not-available': { label: 'Not yet available', tone: 'neutral', icon: <CircleDashed className="h-4 w-4" aria-hidden="true" />, ring: 'bg-slate-100 text-slate-400' },
};
const CheckBadge = ({ c }: { c: Checkpoint }) => <Badge tone={CHECK[c].tone}>{CHECK[c].icon}{CHECK[c].label}</Badge>;

/** The four checkpoints, read only from what the record actually contains. */
export function checkpointsOf(r: StudentRecord): { registration: Checkpoint; exam: Checkpoint; clearance: Checkpoint; matriculation: Checkpoint } {
  return {
    registration: 'verified',
    exam: r.exam ? 'verified' : 'not-available',
    clearance: r.verification === 'verified' ? 'verified' : r.verification === 'failed' ? 'failed' : r.verification === 'exception' ? 'exception' : 'pending',
    matriculation: r.matriculation === 'matriculated' ? 'verified' : r.clearance === 'cleared' ? 'pending' : 'not-available',
  };
}

/**
 * How the student's identity was established and checked: JAMB registration → examination → university
 * clearance → matriculation. The summary only claims comparisons the record holds evidence for.
 */
export function StudentJourney({ record: r, actions }: { record: StudentRecord; actions?: ReactNode }) {
  const state = useJambState();
  const inst = institutionByCode(r.institution)!;
  const cp = checkpointsOf(r);
  const identity = [cp.registration, cp.exam, cp.clearance];
  const verifiedCount = Object.values(cp).filter((c) => c === 'verified').length;
  const failedCount = Object.values(cp).filter((c) => c === 'failed').length;
  const overall: Checkpoint = cp.clearance === 'failed' ? 'failed' : cp.clearance === 'exception' ? 'exception' : cp.clearance === 'verified' ? 'verified' : 'pending';
  const capture = liveCaptureOf(r.reg);
  const events = eventsFor(r.reg, state);
  const lastVerification = [r.verifiedAt, r.exam?.at, r.registeredAt].filter(Boolean).sort().at(-1)!;

  const summary = overall === 'verified'
    ? `Identity verification successful. The live portrait captured at clearance was matched against the original JAMB registration identity record (simulated face match).${r.exam ? ' The examination-day check recorded by JAMB was also verified against the registration record.' : ' No examination-day verification evidence is held in this record, so that checkpoint isn’t counted.'}`
    : overall === 'failed'
      ? 'Identity could not be confirmed: the live portrait captured at clearance did not match the JAMB registration identity record. Clearance cannot proceed.'
      : overall === 'exception'
        ? 'Identity verification could not be completed because the student’s identity record is incomplete. This isn’t a mismatch: it needs to be resolved with JAMB before clearance.'
        : 'Awaiting identity verification at university clearance. Registration' + (r.exam ? ' and examination checkpoints are' : ' checkpoint is') + ' on record.';

  return (
    <div className="space-y-6">
      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Student identity profile</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{r.firstName} {r.middleName} {r.lastName}</h1>
            <p className="mt-1 text-sm text-slate-600"><span className="font-mono">{r.reg}</span> · {inst.name} · {r.session} · {r.department}</p>
            <div className="mt-2 flex flex-wrap gap-2"><VerificationBadge status={r.verification} /><ClearanceBadge status={r.clearance} /><MatriculationBadge status={r.matriculation} /></div>
          </div>
          {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
        </div>
      </Card>

      <section aria-label="Identity assurance summary" className={cn('rounded-xl px-5 py-5 ring-1 ring-inset', overall === 'verified' ? 'bg-emerald-50 ring-emerald-200' : overall === 'failed' ? 'bg-red-50 ring-red-200' : overall === 'exception' ? 'bg-amber-50 ring-amber-200' : 'bg-slate-50 ring-slate-200')}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><ShieldCheck className="h-5 w-5" aria-hidden="true" />Identity assurance summary</h2>
        <p className="mt-2 text-sm text-slate-800">{summary}</p>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Checkpoints verified</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{verifiedCount} of 4</dd></div>
          <div><dt className="text-slate-500">Checkpoints failed</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{failedCount}</dd></div>
          <div><dt className="text-slate-500">Last verification</dt><dd className="mt-0.5 text-slate-900">{formatDateTime(lastVerification)}</dd></div>
          <div><dt className="text-slate-500">Overall identity assurance</dt><dd className="mt-1"><CheckBadge c={overall} /></dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-600">Identity checkpoints: {identity.filter((c) => c === 'verified').length} of 3 verified. Matriculation is the institution’s confirmation, not an identity check. Portraits below are illustrative drawings and face matches are simulated.</p>
      </section>

      <Card className="px-5 py-5">
        <h2 className="text-base font-semibold text-slate-900">Identity journey</h2>
        <ol className="mt-4 space-y-0" aria-label="Identity journey">
          <Stage n={1} title="JAMB registration" status={cp.registration}
            portrait={<Portrait seed={r.reg} gender={r.gender} stage="registration" label="Original JAMB registration portrait" />}
            rows={[['JAMB registration number', <span className="font-mono">{r.reg}</span>], ['Registration date', formatDate(r.registeredAt)], ['UTME score', String(r.utmeScore)], ['State of origin', r.stateOfOrigin], ['Registration verification', 'Biometric enrolment completed (demo record)']]} />
          <Stage n={2} title="Examination verification" status={cp.exam}
            portrait={r.exam ? <Portrait seed={r.reg} gender={r.gender} stage="exam" label="Examination verification portrait" /> : undefined}
            rows={r.exam ? [['Examination date', formatDate(r.exam.at)], ['Centre', r.exam.centre], ['Outcome', 'Verified against registration record'], ['Verification reference', <span className="font-mono">{r.exam.reference}</span>]] : [['Evidence', 'No examination-day verification is held in this demo record.']]} />
          <Stage n={3} title="University clearance" status={cp.clearance}
            portrait={capture
              ? <figure><img src={capture} alt="Live portrait captured at clearance" className="h-36 w-full rounded-lg object-cover" /><figcaption className="mt-1 text-[11px] text-slate-500">Captured in this visit; not stored.</figcaption></figure>
              : r.verification !== 'not-started' ? <figure><Portrait seed={r.reg} gender={r.gender} stage="clearance" label="Live clearance capture" /><figcaption className="mt-1 text-[11px] text-slate-500">Capture not retained in this prototype.</figcaption></figure> : undefined}
            rows={r.verification === 'not-started' ? [['Status', 'Awaiting identity verification at clearance.']] : [
              ['Face match outcome', r.verification === 'verified' ? 'Match: identity confirmed (simulated)' : r.verification === 'failed' ? 'No match: identity not confirmed (simulated)' : 'Exception: missing identity record'],
              ['Verification date', r.verifiedAt ? formatDateTime(r.verifiedAt) : '—'],
              ['Verification reference', <span className="font-mono">{r.verificationRef ?? '—'}</span>],
              ['Clearance', r.clearance === 'cleared' ? `Cleared ${r.clearedAt ? formatDateTime(r.clearedAt) : ''} by ${r.clearedBy ?? '—'}` : 'Not cleared'],
            ]} />
          <Stage n={4} title="Matriculation" status={cp.matriculation} last
            rows={r.matriculation === 'matriculated'
              ? [['Matriculation status', 'Confirmed by the institution'], ['Matriculation number', <span className="font-mono">{r.matricNo}</span>], ['Confirmation date', r.matriculatedAt ? formatDate(r.matriculatedAt) : '—']]
              : [['Matriculation status', r.clearance === 'cleared' ? 'Cleared; awaiting the institution’s matriculation confirmation' : 'Not yet available: clearance comes first']]} />
        </ol>
      </Card>

      {events.length > 0 && (
        <Card className="px-5 py-5">
          <h2 className="text-base font-semibold text-slate-900">Verification attempts in this prototype</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm" aria-label="Verification attempts">
            {events.map((e) => (
              <li key={e.ref} className="flex flex-wrap justify-between gap-2 py-2">
                <span><span className="font-medium text-slate-900">{OUTCOME_LABEL[e.outcome]}</span> <span className="text-slate-500">· {e.captureMode === 'camera' ? 'camera capture' : 'simulated capture'} · {e.by}</span></span>
                <span className="text-slate-500"><span className="font-mono text-xs">{e.ref}</span> · {formatDateTime(e.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stage({ n, title, status, portrait, rows, last }: { n: number; title: string; status: Checkpoint; portrait?: ReactNode; rows: [string, ReactNode][]; last?: boolean }) {
  return (
    <li className="relative grid grid-cols-[2.5rem_1fr] gap-3 pb-6">
      {!last && <span className="absolute left-[1.2rem] top-10 h-[calc(100%-2.5rem)] w-px bg-slate-200" aria-hidden="true" />}
      <span className={cn('flex h-10 w-10 items-center justify-center rounded-full', CHECK[status].ring)} aria-hidden="true">{CHECK[status].icon}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Stage {n}: {title}</h3>
          <CheckBadge c={status} />
        </div>
        <div className={cn('mt-3 grid gap-4', portrait && 'sm:grid-cols-[9rem_1fr]')}>
          {portrait && <div className="max-w-[9rem]">{portrait}</div>}
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows.map(([k, v]) => <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>)}
          </dl>
        </div>
      </div>
    </li>
  );
}
