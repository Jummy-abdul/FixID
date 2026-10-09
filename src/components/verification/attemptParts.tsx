import { useState } from 'react';
import { CheckCircle2, DoorOpen, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useAuthorization } from '@/auth/authorization';
import { Badge, Button, ConfirmDialog, useToast } from '@/components/ui';
import type { VerificationAttempt } from '@/domain/types';
import { OUTCOME_LABEL } from '@/domain/verification';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { entryProblem } from '@/store/attemptOps';
import { useStore } from '@/store/AppStore';
import { useVerificationService } from '@/verification/useVerificationService';

type Access = NonNullable<VerificationAttempt['accessDecision']>;
type Eligibility = NonNullable<VerificationAttempt['eligibilityResult']>;

export const ACCESS_LABEL: Record<Access, string> = { permitted: 'Permitted', 'not-permitted': 'Not Permitted', 'review-required': 'Review Required' };
const ACCESS_TONE = { permitted: 'success', 'not-permitted': 'danger', 'review-required': 'warning' } as const;
export const ELIGIBILITY_LABEL: Record<Eligibility, string> = { eligible: 'Eligible', 'not-eligible': 'Not eligible', unable: 'Unable to confirm', review: 'Pending review', 'not-required': 'Not required' };
const ELIGIBILITY_TONE = { eligible: 'success', 'not-eligible': 'danger', unable: 'warning', review: 'violet', 'not-required': 'neutral' } as const;
const RESULT_TONE = { verified: 'success', 'not-verified': 'danger', 'unable-to-verify': 'warning', 'pending-review': 'violet', 'not-required': 'neutral' } as const;

export function AccessBadge({ attempt }: { attempt: Pick<VerificationAttempt, 'accessDecision'> }) {
  return attempt.accessDecision ? <Badge tone={ACCESS_TONE[attempt.accessDecision]} dot>{ACCESS_LABEL[attempt.accessDecision]}</Badge> : <span className="text-slate-400">—</span>;
}

export function IdentityResultBadge({ attempt }: { attempt: Pick<VerificationAttempt, 'verificationResult'> }) {
  const r = attempt.verificationResult;
  if (!r) return <span className="text-slate-400">—</span>;
  return <Badge tone={RESULT_TONE[r]}>{r === 'not-required' ? 'Not required' : OUTCOME_LABEL[r]}</Badge>;
}

export function EligibilityBadge({ attempt }: { attempt: Pick<VerificationAttempt, 'eligibilityResult'> }) {
  const r = attempt.eligibilityResult;
  return r ? <Badge tone={ELIGIBILITY_TONE[r]}>{ELIGIBILITY_LABEL[r]}</Badge> : <span className="text-slate-400">—</span>;
}

export function EntryBadge({ attempt }: { attempt: Pick<VerificationAttempt, 'entry' | 'status'> }) {
  if (attempt.entry) return <Badge tone="brand"><DoorOpen className="h-3 w-3" aria-hidden="true" />Entered</Badge>;
  return <span className="text-sm text-slate-500">{attempt.status === 'completed' ? 'Not recorded' : '—'}</span>;
}

const ACCESS_PANEL = {
  permitted: { icon: ShieldCheck, ring: 'bg-emerald-50 ring-emerald-200 text-emerald-900', text: 'The activity’s conditions are met. Entry isn’t recorded until an officer records it.' },
  'not-permitted': { icon: ShieldX, ring: 'bg-red-50 ring-red-200 text-red-900', text: 'The activity’s conditions aren’t met. Don’t admit the person on the basis of this verification.' },
  'review-required': { icon: ShieldAlert, ring: 'bg-amber-50 ring-amber-200 text-amber-900', text: 'The conditions couldn’t be confirmed. Follow your organization’s review procedure.' },
} as const;

/**
 * Verification outcome, access decision and entry status, kept visibly separate. Recording entry is a
 * deliberate action by an authorized officer and is never done automatically.
 */
export function AccessAndEntry({ attempt }: { attempt: VerificationAttempt }) {
  const { state } = useStore();
  const { can, previewRole } = useAuthorization();
  const service = useVerificationService();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  if (attempt.status !== 'completed' || !attempt.accessDecision) return null;
  const panel = ACCESS_PANEL[attempt.accessDecision];
  const problem = entryProblem(state, attempt.id);
  const mayRecord = can('verification.execute') && !previewRole;
  const canRecord = mayRecord && !attempt.entry && !problem;

  return (
    <section aria-label="Access and entry" className="grid gap-3 sm:grid-cols-2">
      <div className={cn('rounded-xl px-4 py-4 ring-1 ring-inset', panel.ring)}>
        <p className="text-xs font-medium uppercase tracking-wide opacity-80">Access decision</p>
        <p className="mt-1 flex items-center gap-2 text-lg font-semibold"><panel.icon className="h-5 w-5" aria-hidden="true" />{ACCESS_LABEL[attempt.accessDecision]}</p>
        <p className="mt-1 text-sm">{panel.text}</p>
        {attempt.accessReasons && attempt.accessReasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{attempt.accessReasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      </div>
      <div className="rounded-xl bg-white px-4 py-4 ring-1 ring-inset ring-slate-200">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Entry status</p>
        {attempt.entry ? (
          <>
            <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900"><CheckCircle2 className="h-5 w-5 text-brand-600" aria-hidden="true" />Entered</p>
            <p className="mt-1 text-sm text-slate-600">Recorded {formatDateTime(attempt.entry.recordedAt)} by {attempt.entry.recordedBy}.</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-lg font-semibold text-slate-900">Not recorded</p>
            <p className="mt-1 text-sm text-slate-600">{attempt.accessDecision !== 'permitted' ? 'Entry can only be recorded when access is permitted.' : !mayRecord ? 'A verifier records entry when the person goes in.' : canRecord ? 'Record entry once the person actually goes in.' : problem}</p>
            {canRecord && <Button className="mt-3" icon={<DoorOpen className="h-4 w-4" />} onClick={() => setConfirming(true)}>Record Entry</Button>}
          </>
        )}
      </div>
      <ConfirmDialog open={confirming} title="Record entry?" confirmLabel="Record Entry" onCancel={() => setConfirming(false)}
        description={`Confirm that ${attempt.subject?.label ?? 'the person'} has entered. This is recorded with your name and the time.`}
        onConfirm={() => {
          setConfirming(false);
          const r = service.recordEntry(attempt.id);
          toast(r.ok ? { tone: 'success', title: 'Entry recorded' } : { tone: 'error', title: 'Entry wasn’t recorded', description: r.error });
        }} />
    </section>
  );
}
