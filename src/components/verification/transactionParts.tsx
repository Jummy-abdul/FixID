import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, FlaskConical, Repeat, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import type { ActivityDecision } from '@/domain/programmes';
import {
  DECISION_LABEL, ELIGIBILITY_STATUS_LABEL, LIVENESS_STATUS_LABEL, LOOKUP_LABEL, MATCH_LABEL, STAGE_LABEL, stageOf,
  type EligibilityStatus, type IdentityMatchStatus, type LivenessStatus, type TransactionStage,
} from '@/domain/transactions';
import type { VerificationAttempt } from '@/domain/types';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';

// Green is reserved for Allow and positive individual results; pending, inconclusive and unavailable never use it.
const DECISION_TONE = { allow: 'success', deny: 'danger', 'pending-review': 'violet', 'unable-to-decide': 'warning' } as const;
const MATCH_TONE: Record<IdentityMatchStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  match: 'success', 'record-confirmed': 'success', 'no-match': 'danger', inconclusive: 'warning', unavailable: 'warning', error: 'warning', 'not-required': 'neutral', 'not-evaluated': 'neutral',
};
const LIVENESS_TONE: Record<LivenessStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  passed: 'success', failed: 'danger', inconclusive: 'warning', unavailable: 'warning', 'not-performed': 'neutral', 'not-required': 'neutral',
};
const ELIGIBILITY_TONE: Record<EligibilityStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  eligible: 'success', ineligible: 'danger', unknown: 'warning', 'not-required': 'neutral', 'not-evaluated': 'neutral',
};
const STAGE_TONE: Record<TransactionStage, 'success' | 'danger' | 'warning' | 'neutral' | 'violet' | 'info'> = {
  initiated: 'info', 'lookup-completed': 'info', 'capture-pending': 'info', matching: 'info', 'eligibility-check': 'info',
  'pending-review': 'violet', completed: 'success', failed: 'danger', cancelled: 'neutral', 'unable-to-complete': 'warning',
};

export const DecisionBadge = ({ decision }: { decision?: ActivityDecision }) => (decision ? <Badge tone={DECISION_TONE[decision]} dot>{DECISION_LABEL[decision]}</Badge> : <span className="text-slate-400">—</span>);
export const MatchBadge = ({ status }: { status?: IdentityMatchStatus }) => (status ? <Badge tone={MATCH_TONE[status]}>{MATCH_LABEL[status]}</Badge> : <span className="text-slate-400">—</span>);
export const LivenessBadge = ({ status }: { status?: LivenessStatus }) => (status ? <Badge tone={LIVENESS_TONE[status]}>{LIVENESS_STATUS_LABEL[status]}</Badge> : <span className="text-slate-400">—</span>);
export const EligibilityStatusBadge = ({ status }: { status?: EligibilityStatus }) => (status ? <Badge tone={ELIGIBILITY_TONE[status]}>{ELIGIBILITY_STATUS_LABEL[status]}</Badge> : <span className="text-slate-400">—</span>);
export const StageBadge = ({ attempt }: { attempt: Parameters<typeof stageOf>[0] }) => { const s = stageOf(attempt); return <Badge tone={STAGE_TONE[s]}>{STAGE_LABEL[s]}</Badge>; };
export const SimulatedBadge = ({ label = 'Simulated' }: { label?: string }) => <Badge tone="warning"><FlaskConical className="h-3 w-3" aria-hidden="true" />{label}</Badge>;

/** "FixID Local Records" or the external service's name. */
export const sourceName = (a: Pick<VerificationAttempt, 'identitySource' | 'serviceName'>) => (a.identitySource === 'external' ? a.serviceName ?? 'External identity service' : 'FixID Local Records');

const PANEL = {
  allow: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-900 ring-emerald-200' },
  deny: { icon: XCircle, cls: 'bg-red-50 text-red-900 ring-red-200' },
  'pending-review': { icon: Clock, cls: 'bg-violet-50 text-violet-900 ring-violet-200' },
  'unable-to-decide': { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-900 ring-amber-300' },
} as const;

/**
 * The unified result of a Verification Transaction, for local and external identities alike: the activity
 * decision with its explanation, then identity, liveness and eligibility as separate results. A biometric
 * match is never presented as approval, and simulated results are labelled as such.
 */
export function TransactionOutcome({ attempt, programmeName }: { attempt: VerificationAttempt; programmeName?: string }) {
  if (!attempt.decision) return null;
  const p = PANEL[attempt.decision];
  return (
    <section aria-label="Verification outcome" className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <div className={cn('flex items-start gap-3 px-5 py-4 ring-1 ring-inset', p.cls)}>
        <p.icon className="mt-0.5 h-7 w-7 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide opacity-80">Verification Outcome</p>
          <p className="text-2xl font-semibold">{DECISION_LABEL[attempt.decision]}</p>
          <p className="mt-0.5 text-sm">{attempt.decisionExplanation}</p>
        </div>
        {attempt.simulated && <SimulatedBadge label="Simulated Result" />}
      </div>
      {attempt.simulated && (
        <p className="border-b border-slate-100 bg-amber-50/60 px-5 py-2 text-xs text-amber-900">
          Simulated results come from a demonstration service: no faces were compared and no real liveness or presentation-attack detection took place. This isn’t an identity assurance claim.
        </p>
      )}
      {attempt.reusedFrom && (
        <p className="flex items-center gap-2 border-b border-slate-100 bg-sky-50 px-5 py-2 text-sm text-sky-900">
          <Repeat className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Identity result reused from transaction <Link to={`/verify/attempts/${attempt.reusedFrom}`} className="font-mono font-semibold underline">{attempt.reusedFrom}</Link> under the activity’s reverification policy. No new biometric match was performed.</span>
        </p>
      )}
      <dl className="grid gap-x-8 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2">
        <Row label="Identity Verification">
          <MatchBadge status={attempt.match?.status} />
          {attempt.match?.simulated && attempt.match.status !== 'not-evaluated' && <span className="ml-1"><SimulatedBadge label="Simulated Matching Result" /></span>}
        </Row>
        {attempt.liveness && attempt.liveness.status !== 'not-required' && (
          <Row label="Liveness">
            <LivenessBadge status={attempt.liveness.status} />
            {attempt.liveness.simulated && <span className="ml-1"><SimulatedBadge label="Simulated Liveness Result" /></span>}
            <span className="ml-1 text-xs text-slate-500">{attempt.liveness.required ? 'Required' : 'Optional'}</span>
          </Row>
        )}
        <Row label="Eligibility">
          <EligibilityStatusBadge status={attempt.eligibilityStatus} />
          {attempt.eligibilityExplanation && <span className="block text-xs text-slate-500">{attempt.eligibilityExplanation}</span>}
        </Row>
        <Row label="Activity">{attempt.activityName}{programmeName ? <span className="block text-xs text-slate-500">Programme: {programmeName}</span> : null}</Row>
        <Row label="Verification Source">{sourceName(attempt)}</Row>
        <Row label="Person">{attempt.subject?.label ?? 'Not identified'}</Row>
        <Row label="Transaction Reference"><span className="font-mono text-xs">{attempt.id}</span></Row>
        <Row label="Date and Time">{formatDateTime(attempt.completedAt ?? attempt.startedAt)}</Row>
        <Row label="Status"><StageBadge attempt={attempt} /></Row>
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-900">{children}</dd></div>;
}

/** The steps the verifier sees, adapted to the method: a lookup-only activity has no capture step. */
export function JourneySteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mt-4 flex gap-2 text-xs font-medium" aria-label="Verification steps">
      {steps.map((n, i) => (
        <li key={n} aria-current={i === current ? 'step' : undefined} className={cn('flex-1 rounded-full px-3 py-1.5 text-center', i === current ? 'bg-brand-600 text-white' : i < current ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>{i + 1}. {n}</li>
      ))}
    </ol>
  );
}

/** The external lookup result in words, for history and details. */
export const lookupLabel = (a: Pick<VerificationAttempt, 'lookup'>) => (a.lookup ? LOOKUP_LABEL[a.lookup.status] : '—');
