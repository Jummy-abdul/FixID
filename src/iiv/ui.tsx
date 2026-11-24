import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Fingerprint, Loader2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { dateTime } from '@/jamb/format';
import { iivPersonaFor } from './personas';
import {
  EVENT_STATUS_LABEL, INSTITUTION_STATUS_LABEL, METHOD_LABEL, OUTCOME_LABEL, institutionByCode, useIiv,
  type EventStatus, type InstitutionStatus, type MatchResult, type Method, type OfficerRef, type Outcome, type VerificationResult,
} from './store';

/** The signed-in person, as the store records them. */
export function useIivUser(): OfficerRef & { title: string; organisation: string } {
  const { account } = useAuth();
  const p = iivPersonaFor(account?.email);
  const state = useIiv();
  const inst = p?.institution ? institutionByCode(p.institution, state) : undefined;
  return { name: p ? `${p.firstName} ${p.lastName}` : '', email: p?.email ?? '', institution: p?.institution ?? '', title: p?.role ?? '', organisation: inst?.name ?? p?.organization ?? '' };
}

export const OutcomeBadge = ({ outcome }: { outcome: Outcome }) => (
  <Badge tone={outcome === 'verified' ? 'success' : 'danger'} dot>{OUTCOME_LABEL[outcome]}</Badge>
);
export const InstitutionStatusBadge = ({ status }: { status: InstitutionStatus }) => (
  <Badge tone={status === 'active' ? 'success' : status === 'invited' ? 'info' : 'neutral'} dot>{INSTITUTION_STATUS_LABEL[status]}</Badge>
);
export const EventStatusBadge = ({ status }: { status: EventStatus }) => (
  <Badge tone={status === 'published' ? 'success' : status === 'draft' ? 'warning' : 'neutral'} dot>{EVENT_STATUS_LABEL[status]}</Badge>
);
export const MethodLabel = ({ method }: { method: Method }) => <span className="inline-flex items-center gap-1.5">{method === 'fingerprint' ? <Fingerprint className="h-4 w-4 text-slate-400" aria-hidden="true" /> : null}{METHOD_LABEL[method]}</span>;
export function ResultPill({ result }: { result: MatchResult }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ring-1 ring-inset', result === 'match' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-red-50 text-red-800 ring-red-200')}>
      {result === 'match' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}{result === 'match' ? 'Match' : 'Mismatch'}
    </span>
  );
}

/** A reference or captured image with its caption. */
export function EvidenceImage({ src, label, caption, fingerprint }: { src?: string; label: string; caption?: ReactNode; fingerprint?: boolean }) {
  return (
    <figure className="w-full min-w-0">
      {src
        ? <img src={src} alt={label} className={cn('aspect-[4/5] w-full rounded-lg ring-1 ring-slate-200', fingerprint ? 'bg-slate-50 object-contain p-2' : 'object-cover')} />
        : <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 px-2 text-center text-xs text-slate-500">Not on record</div>}
      <figcaption className="mt-1.5 text-center text-[11px] font-semibold leading-tight text-slate-700">{label}{caption && <span className="block font-normal text-slate-500">{caption}</span>}</figcaption>
    </figure>
  );
}

/**
 * A fingerprint scan, in the style of the face capture: a scanner frame, one "Scan Fingerprint" action, a brief
 * scan, then the captured print in the frame.
 */
export function FingerprintScanner({ image, captured, status, onCaptured }: { image: string; captured: string | null; status?: ReactNode; onCaptured: (url: string) => void }) {
  const [phase, setPhase] = useState<'idle' | 'scanning'>('idle');
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const scan = () => { setPhase('scanning'); timer.current = window.setTimeout(() => { setPhase('idle'); onCaptured(image); }, 1100); };
  return (
    <div className="mx-auto w-full max-w-[14rem]">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-800" aria-label="Fingerprint scanner" role="img">
        {captured ? <img src={captured} alt="Captured fingerprint" className="h-full w-full bg-slate-50 object-contain p-3" /> : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
            <Fingerprint className={cn('h-14 w-14', phase === 'scanning' && 'animate-pulse text-emerald-400')} aria-hidden="true" />
            <p className="max-w-[70%] text-center text-xs text-slate-300">{phase === 'scanning' ? 'Scanning… keep the finger still' : 'Place the candidate’s right thumb on the scanner'}</p>
          </div>
        )}
        {phase === 'scanning' && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 animate-pulse bg-emerald-400/80 shadow-[0_0_12px_2px_rgba(52,211,153,0.6)]" />}
      </div>
      <div className="mt-3 flex flex-col items-center gap-2" aria-live="polite">
        {captured ? status : (
          <Button className="w-full" icon={phase === 'idle' ? <Fingerprint className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />} disabled={phase !== 'idle'} onClick={scan}>
            {phase === 'idle' ? 'Scan Fingerprint' : 'Scanning…'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The overall outcome, distinct from the individual comparisons. */
export function OverallOutcome({ outcome }: { outcome: Outcome }) {
  const ok = outcome === 'verified';
  return (
    <div role="status" aria-label="Overall verification outcome" className={cn('flex items-start gap-3 rounded-xl px-5 py-4 ring-1 ring-inset', ok ? 'bg-emerald-50 text-emerald-950 ring-emerald-200' : 'bg-red-50 text-red-950 ring-red-200')}>
      {ok ? <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden="true" /> : <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-600" aria-hidden="true" />}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Overall verification outcome</p>
        <h2 className="text-lg font-semibold">{OUTCOME_LABEL[outcome]}</h2>
        <p className="text-sm">{ok ? 'The candidate matches both the National Identity record and the JAMB record.' : 'The candidate does not match every identity record. Further review is required before clearance.'}</p>
      </div>
    </div>
  );
}

/** The comparison results, each beside the images it compared. */
export function ComparisonResults({ v }: { v: Pick<VerificationResult, 'method' | 'capture' | 'ninImage' | 'jambImage' | 'ninResult' | 'jambResult'> }) {
  const fp = v.method === 'fingerprint';
  const what = fp ? 'Captured fingerprint' : 'Captured face';
  const rows: [string, string, string, MatchResult][] = [
    [`${what} vs NIN record`, fp ? 'NIN fingerprint reference' : 'NIN reference image', v.ninImage, v.ninResult],
    [`${what} vs JAMB record`, fp ? 'JAMB fingerprint reference' : 'JAMB reference image', v.jambImage, v.jambResult],
  ];
  return (
    <ul aria-label="Comparison results" className="grid gap-3 xl:grid-cols-2">
      {rows.map(([title, refLabel, ref, result]) => (
        <li key={title} aria-label={`${title}: ${result === 'match' ? 'Match' : 'Mismatch'}`} className={cn('rounded-xl p-3 ring-1', result === 'match' ? 'bg-emerald-50/40 ring-emerald-200' : 'bg-red-50/40 ring-red-200')}>
          <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{title}</p><ResultPill result={result} /></div>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:max-w-[16rem]">
            <EvidenceImage src={v.capture} label={what} fingerprint={fp} />
            <EvidenceImage src={ref} label={refLabel} fingerprint={fp} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The complete record of a submitted verification, as the institution submitted it and JAMB reviews it. */
export function VerificationEvidence({ v }: { v: VerificationResult }) {
  const fp = v.method === 'fingerprint';
  const row = (k: string, val: ReactNode) => <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{val}</dd></div>;
  return (
    <div className="space-y-5">
      <OverallOutcome outcome={v.outcome} />
      <section aria-label="Candidate" className="rounded-xl bg-white px-5 py-4 ring-1 ring-slate-200">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Candidate</h3>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {row('Full name', v.candidate.fullName)}
          {row('JAMB registration number', <span className="font-mono">{v.reg}</span>)}
          {row('Date of birth', v.candidate.dateOfBirth ? formatDate(v.candidate.dateOfBirth) : '—')}
          {row('Institution', v.institutionName)}
          {row('Course of study', v.candidate.course)}
          {row('Admission session', v.session)}
        </dl>
      </section>
      <section aria-label="Identity evidence" className="rounded-xl bg-white px-5 py-4 ring-1 ring-slate-200">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Identity evidence</h3>
        <div className="grid max-w-xl grid-cols-3 gap-4">
          <EvidenceImage src={v.capture} label={fp ? 'Captured fingerprint' : 'Captured face'} caption={dateTime(v.capturedAt)} fingerprint={fp} />
          <EvidenceImage src={v.ninImage} label={fp ? 'NIN fingerprint reference' : 'NIN reference image'} fingerprint={fp} />
          <EvidenceImage src={v.jambImage} label={fp ? 'JAMB fingerprint reference' : 'JAMB reference image'} fingerprint={fp} />
        </div>
        <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-900">Comparison results</h3>
        <ComparisonResults v={v} />
      </section>
      <section aria-label="Verification details" className="rounded-xl bg-white px-5 py-4 ring-1 ring-slate-200">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Verification details</h3>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {row('Verification reference', <span className="font-mono">{v.ref}</span>)}
          {row('Verification event', v.eventName)}
          {row('Verification method', <MethodLabel method={v.method} />)}
          {row('Date and time', dateTime(v.at))}
          {row('Verified by', `${v.officer}, ${v.institutionName}`)}
          {row('Officer email', v.officerEmail)}
          {v.remarks ? row('Officer’s remarks', v.remarks) : null}
        </dl>
      </section>
    </div>
  );
}
