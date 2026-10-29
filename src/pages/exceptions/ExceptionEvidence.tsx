import { useState } from 'react';
import { Eye, FlaskConical, Lock } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { EligibilityStatusBadge, LivenessBadge, MatchBadge, lookupLabel, sourceName } from '@/components/verification/transactionParts';
import { categoryOf, type VerificationException } from '@/domain/exceptions';
import type { VerificationAttempt } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';

/** Whether the case is about the face match, so a portrait comparison is relevant. */
const isFaceCase = (e: VerificationException, tx?: VerificationAttempt) =>
  categoryOf(e.reason) === 'identity' && !!tx?.match && tx.match.status !== 'not-required' && tx.match.status !== 'record-confirmed';

/**
 * The evidence a reviewer examines. For face-match cases, the reference portrait and the live capture side by
 * side, shown only to authorised reviewers and only when they choose to (the viewing is audited). In this
 * prototype both are simulated illustrations: no captures or reference images are stored or downloadable.
 */
export function ExceptionEvidence({ e, tx, canView, onView }: { e: VerificationException; tx?: VerificationAttempt; canView: boolean; onView: () => void }) {
  const [shown, setShown] = useState(false);
  const face = isFaceCase(e, tx);
  return (
    <Card className="px-5 py-5">
      <h2 className="text-sm font-semibold text-slate-900">Evidence</h2>
      {face && (
        <div className="mt-3">
          {!canView ? (
            <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200"><Lock className="h-4 w-4 text-slate-400" aria-hidden="true" />Only users permitted to review exceptions can view portraits.</p>
          ) : !shown ? (
            <div className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
              <p>The portrait comparison is sensitive. Viewing it is recorded in the exception history and the audit log.</p>
              <Button className="mt-3" variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => { setShown(true); onView(); }}>Show portrait comparison</Button>
            </div>
          ) : (
            <section aria-label="Portrait comparison" onContextMenu={(x) => x.preventDefault()}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Portrait seed={`${e.transactionId}-ref`} title="Reference portrait" detail={`From ${tx ? sourceName(tx) : 'the identity source'}`} />
                <Portrait seed={`${e.transactionId}-live`} title="Live capture" detail={`Captured ${tx ? formatDateTime(tx.completedAt ?? tx.startedAt) : ''} by ${tx?.verifierName ?? 'the verifier'}`} variant />
              </div>
              <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
                <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Simulated illustrations for this prototype. No real portraits, captures or biometric templates are stored, compared or downloadable.
              </p>
            </section>
          )}
        </div>
      )}
      {tx ? (
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Verification evidence">
          <Row label="Identity source">{sourceName(tx)}{tx.simulated && <span className="ml-1"><Badge tone="warning">Simulated</Badge></span>}</Row>
          {tx.lookup && <Row label="Record lookup">{lookupLabel(tx)}</Row>}
          <Row label="Liveness"><LivenessBadge status={tx.liveness?.status} />{tx.liveness?.required && <span className="ml-1 text-xs text-slate-500">Required</span>}</Row>
          <Row label="Portrait match"><MatchBadge status={tx.match?.status} /></Row>
          <Row label="Eligibility"><EligibilityStatusBadge status={tx.eligibilityStatus} />{tx.eligibilityExplanation && <span className="block text-xs text-slate-500">{tx.eligibilityExplanation}</span>}</Row>
          <Row label="Recorded">{formatDateTime(tx.completedAt ?? tx.startedAt)}</Row>
        </dl>
      ) : <p className="mt-3 text-sm text-slate-500">The verification record isn’t available.</p>}
      {categoryOf(e.reason) === 'technical' && <p className="mt-3 text-sm text-slate-600">This is a technical issue, not an identity question. It can be retried with another attempt or escalated; identity can’t be confirmed from it.</p>}
      {tx?.liveness?.required && tx.liveness.status !== 'passed' && <p className="mt-3 text-sm text-slate-600">The required liveness check didn’t pass. A matching face can’t bypass it: identity can only be confirmed after a successful new attempt.</p>}
    </Card>
  );
}

/** A deterministic, clearly illustrative portrait. Not a photograph and not derived from any person. */
function Portrait({ seed, title, detail, variant }: { seed: string; title: string; detail: string; variant?: boolean }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const skin = ['#f1c9a5', '#d9a77e', '#b07a52', '#8a5a3c', '#e7b98f'][h % 5];
  const hair = ['#2f2a26', '#5b3a24', '#1f1f1f', '#7a5230'][(h >> 3) % 4];
  const bg = variant ? '#e2e8f0' : '#e0e7ff';
  return (
    <figure className="overflow-hidden rounded-xl ring-1 ring-slate-200">
      <svg viewBox="0 0 120 140" role="img" aria-label={`${title} (simulated illustration)`} className="h-48 w-full bg-white">
        <rect width="120" height="140" fill={bg} />
        <ellipse cx="60" cy="128" rx="44" ry="28" fill={variant ? '#64748b' : '#4f46e5'} />
        <ellipse cx="60" cy="62" rx="26" ry="31" fill={skin} />
        <path d={`M34 ${variant ? 56 : 52} Q60 ${variant ? 22 : 18} 86 ${variant ? 56 : 52} Q82 36 60 32 Q38 36 34 ${variant ? 56 : 52}Z`} fill={hair} />
        <circle cx="50" cy="62" r="2.6" fill="#1e293b" /><circle cx="70" cy="62" r="2.6" fill="#1e293b" />
        <path d="M52 78 Q60 83 68 78" stroke="#7c2d12" strokeWidth="2" fill="none" strokeLinecap="round" />
        <text x="60" y="12" textAnchor="middle" fontSize="7" fill="#475569">SIMULATED</text>
      </svg>
      <figcaption className="border-t border-slate-100 px-3 py-2 text-sm"><span className="font-medium text-slate-900">{title}</span><span className="block text-xs text-slate-500">{detail}</span></figcaption>
    </figure>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-900">{children}</dd></div>
);
