import { useState } from 'react';
import { Ban, CheckCircle2, DoorOpen, MapPin, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useAuthorization } from '@/auth/authorization';
import { Badge, Button, ConfirmDialog, Field, Modal, Textarea, useToast } from '@/components/ui';
import { LOCATION_LABEL, formatCoordinate, formatRadius, type LocationResult } from '@/domain/location';
import type { VerificationAttempt, VerificationOutcome } from '@/domain/types';
import { OUTCOME_LABEL } from '@/domain/verification';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { denyProblem, entryProblem } from '@/store/attemptOps';
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
  if (attempt.entry?.status === 'entered') return <Badge tone="brand"><DoorOpen className="h-3 w-3" aria-hidden="true" />Entered</Badge>;
  if (attempt.entry?.status === 'denied') return <Badge tone="danger"><Ban className="h-3 w-3" aria-hidden="true" />Denied</Badge>;
  return <span className="text-sm text-slate-500">{attempt.status === 'completed' ? 'Not recorded' : '—'}</span>;
}

const ACCESS_PANEL = {
  permitted: { icon: ShieldCheck, ring: 'bg-emerald-50 ring-emerald-200 text-emerald-900', text: 'The activity’s conditions are met. Entry isn’t recorded until an officer records it.' },
  'not-permitted': { icon: ShieldX, ring: 'bg-red-50 ring-red-200 text-red-900', text: 'The activity’s conditions aren’t met. Don’t admit the person on the basis of this verification.' },
  'review-required': { icon: ShieldAlert, ring: 'bg-amber-50 ring-amber-200 text-amber-900', text: 'The conditions couldn’t be confirmed. Follow your organization’s review procedure.' },
} as const;

const LOCATION_TONE = { within: 'success', outside: 'warning', unavailable: 'neutral', inconclusive: 'warning', 'not-required': 'neutral' } as const;

export function LocationBadge({ attempt }: { attempt: Pick<VerificationAttempt, 'location'> }) {
  const r = attempt.location?.result;
  if (!r || r === 'not-required') return <span className="text-sm text-slate-400">{r ? 'Not required' : '—'}</span>;
  return <Badge tone={LOCATION_TONE[r]}><MapPin className="h-3 w-3" aria-hidden="true" />{LOCATION_LABEL[r]}</Badge>;
}

const LOCATION_TEXT: Record<Exclude<LocationResult, 'not-required'>, string> = {
  within: 'The verifier’s device reported a position inside the activity’s area.',
  outside: 'The verifier’s device reported a position outside the activity’s area.',
  unavailable: 'No usable position was reported, so the location couldn’t be checked.',
  inconclusive: 'The reported position isn’t accurate enough to tell whether the device was inside the area.',
};

/** The location check, reported on its own. It's the verifier device's position, not proof of where the participant is. */
export function LocationCheckDetails({ attempt }: { attempt: Pick<VerificationAttempt, 'location'> }) {
  const loc = attempt.location;
  if (!loc || loc.result === 'not-required') return null;
  return (
    <div className="rounded-xl bg-white px-4 py-4 ring-1 ring-inset ring-slate-200" aria-label="Location check" role="group">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Location check</p>
      <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900"><MapPin className="h-5 w-5 text-slate-400" aria-hidden="true" />{LOCATION_LABEL[loc.result]}</p>
      <p className="mt-1 text-sm text-slate-600">{LOCATION_TEXT[loc.result]} It doesn’t change the identity or eligibility result, or decide entry.</p>
      <dl className="mt-2 space-y-1 text-xs text-slate-500">
        {loc.reported && <div><dt className="inline">Reported by device: </dt><dd className="inline">{formatCoordinate(loc.reported.lat)}, {formatCoordinate(loc.reported.lng)} (accuracy ±{loc.reported.accuracyM} m, {formatDateTime(loc.reported.capturedAt)})</dd></div>}
        {loc.distanceM !== undefined && <div><dt className="inline">Distance from centre: </dt><dd className="inline">{formatRadius(loc.distanceM)}</dd></div>}
        {loc.reason && <div><dt className="inline">Reason: </dt><dd className="inline">{loc.reason}</dd></div>}
        {loc.configured && <div><dt className="inline">Area used: </dt><dd className="inline">{loc.configured.label ? `${loc.configured.label}, ` : ''}{formatCoordinate(loc.configured.lat)}, {formatCoordinate(loc.configured.lng)} within {formatRadius(loc.configured.radiusM)}</dd></div>}
      </dl>
    </div>
  );
}

/**
 * Access decision, location check and the officer's entry decision, kept visibly separate. Entry is
 * an explicit Allow Entry or Deny Entry decision by an authorized officer, never automatic.
 */
export function AccessAndEntry({ attempt }: { attempt: VerificationAttempt }) {
  const { state } = useStore();
  const { can, previewRole } = useAuthorization();
  const service = useVerificationService();
  const toast = useToast();
  const [confirming, setConfirming] = useState<'allow' | 'deny' | null>(null);
  const [reason, setReason] = useState('');
  if (attempt.status !== 'completed' || !attempt.accessDecision) return null;
  const panel = ACCESS_PANEL[attempt.accessDecision];
  const mayDecide = can('verification.execute') && !previewRole;
  const allowProblem = entryProblem(state, attempt.id);
  const canAllow = mayDecide && !attempt.entry && !allowProblem;
  const canDeny = mayDecide && !attempt.entry && !denyProblem(state, attempt.id);
  const showLocation = !!attempt.location && attempt.location.result !== 'not-required';

  return (
    <section aria-label="Access and entry" className={cn('grid gap-3', showLocation ? 'lg:grid-cols-3 sm:grid-cols-2' : 'sm:grid-cols-2')}>
      <div className={cn('rounded-xl px-4 py-4 ring-1 ring-inset', panel.ring)}>
        <p className="text-xs font-medium uppercase tracking-wide opacity-80">Access decision</p>
        <p className="mt-1 flex items-center gap-2 text-lg font-semibold"><panel.icon className="h-5 w-5" aria-hidden="true" />{ACCESS_LABEL[attempt.accessDecision]}</p>
        <p className="mt-1 text-sm">{panel.text}</p>
        {attempt.accessReasons && attempt.accessReasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{attempt.accessReasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      </div>
      {showLocation && <LocationCheckDetails attempt={attempt} />}
      <div className="rounded-xl bg-white px-4 py-4 ring-1 ring-inset ring-slate-200">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Entry decision</p>
        {attempt.entry ? (
          <>
            <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900">
              {attempt.entry.status === 'entered' ? <><CheckCircle2 className="h-5 w-5 text-brand-600" aria-hidden="true" />Entered</> : <><Ban className="h-5 w-5 text-red-600" aria-hidden="true" />Entry denied</>}
            </p>
            <p className="mt-1 text-sm text-slate-600">Recorded {formatDateTime(attempt.entry.recordedAt)} by {attempt.entry.recordedBy}.{attempt.entry.reason ? ` Reason: ${attempt.entry.reason}` : ''}</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-lg font-semibold text-slate-900">Not recorded</p>
            <p className="mt-1 text-sm text-slate-600">{!mayDecide ? 'The verifier records the entry decision.' : canAllow ? 'Record your decision when the person enters or is turned away.' : attempt.accessDecision !== 'permitted' ? 'Entry can only be allowed when access is permitted. You can still record that entry was denied.' : allowProblem}</p>
            {(canAllow || canDeny) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {canAllow && <Button icon={<DoorOpen className="h-4 w-4" />} onClick={() => setConfirming('allow')}>Allow Entry</Button>}
                {canDeny && <Button variant="secondary" icon={<Ban className="h-4 w-4" />} onClick={() => { setReason(''); setConfirming('deny'); }}>Deny Entry</Button>}
              </div>
            )}
          </>
        )}
      </div>
      <ConfirmDialog open={confirming === 'allow'} title="Allow entry?" confirmLabel="Allow Entry" onCancel={() => setConfirming(null)}
        description={`Confirm that ${attempt.subject?.label ?? 'the person'} is entering. This is recorded with your name and the time.`}
        onConfirm={() => {
          setConfirming(null);
          const r = service.recordEntry(attempt.id);
          toast(r.ok ? { tone: 'success', title: 'Entry allowed' } : { tone: 'error', title: 'Entry wasn’t recorded', description: r.error });
        }} />
      <Modal open={confirming === 'deny'} onClose={() => setConfirming(null)} title="Deny entry?" description="This is recorded with your name and the time."
        footer={<><Button variant="secondary" onClick={() => setConfirming(null)}>Cancel</Button><Button variant="danger" onClick={() => {
          setConfirming(null);
          const r = service.denyEntry(attempt.id, reason);
          toast(r.ok ? { tone: 'success', title: 'Entry denied' } : { tone: 'error', title: 'The decision wasn’t recorded', description: r.error });
        }}>Deny Entry</Button></>}>
        <Field label="Reason" hint="Optional">{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Modal>
    </section>
  );
}

const OUTCOME_TONE: Record<VerificationOutcome, 'success' | 'danger' | 'warning' | 'violet'> = {
  verified: 'success', 'not-verified': 'danger', 'unable-to-verify': 'warning', 'pending-review': 'violet',
};

export function AttemptBadge({ attempt }: { attempt: Pick<VerificationAttempt, 'status' | 'outcome'> }) {
  if (attempt.status === 'completed' && attempt.outcome) return <Badge tone={OUTCOME_TONE[attempt.outcome]} dot>{OUTCOME_LABEL[attempt.outcome]}</Badge>;
  const map = { 'in-progress': ['info', 'In progress'], cancelled: ['neutral', 'Cancelled'], expired: ['neutral', 'Interrupted'], error: ['danger', 'System error'], completed: ['neutral', 'Completed'] } as const;
  const [tone, label] = map[attempt.status];
  return <Badge tone={tone} dot>{label}</Badge>;
}
