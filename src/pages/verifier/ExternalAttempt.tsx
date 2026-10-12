import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, FlaskConical, Lock, Repeat, ScanFace, Search, ShieldCheck, UserRound } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, Field, Input } from '@/components/ui';
import { CameraCapture } from '@/components/verification/CameraCapture';
import { JourneySteps, SimulatedBadge } from '@/components/verification/transactionParts';
import { LIVENESS_LABEL } from '@/domain/programmes';
import { MESSAGES } from '@/domain/transactions';
import type { VerificationAttempt } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { SIMULATED_LOOKUP_REFERENCES, SIMULATED_MATCH_FIXTURES } from '@/services/integrations/simulatedIdentityService';
import { SIMULATED_LIVENESS_OUTCOMES, type SimulatedLivenessOutcome } from '@/services/simulatedFaceVerification';
import { useStore } from '@/store/AppStore';
import { transactionPolicy } from '@/store/transactionOps';
import { useVerificationService } from '@/verification/useVerificationService';

const ATTRIBUTE_LABEL: Record<string, string> = { displayName: 'Display Name', recordStatus: 'Record Status', recordType: 'Record Type' };
const attributeLabel = (k: string) => ATTRIBUTE_LABEL[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/**
 * External identity verification. The person needs no FixID record: the reference identity is held by the
 * activity's configured external service (the programme's, for a programme-linked activity), which FixID
 * calls through the integration framework. Steps adapt to the method: Identify Person → Capture / Verify →
 * Check Eligibility → View Result, without capture for a record-only activity. The verifier can't change the
 * service or the requirements. Captures are transient: never sent to a simulated service, never stored.
 */
export function RunExternal({ attempt }: { attempt: VerificationAttempt }) {
  const service = useVerificationService();
  const navigate = useNavigate();
  const { state } = useStore();
  const policy = transactionPolicy(state, attempt);
  const integration = policy.integration;
  const programme = attempt.programmeId ? state.data.verificationProgrammes.find((p) => p.id === attempt.programmeId) : undefined;
  const simulated = integration?.connection.target === 'simulated';
  const face = policy.settings.method === 'face';
  const found = attempt.lookup?.status === 'FOUND' ? attempt.lookup : null;
  const [reference, setReference] = useState(attempt.lookup?.reference ?? '');
  const [busy, setBusy] = useState<'lookup' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'identify' | 'capture'>(found && face ? 'capture' : 'identify');
  const [capture, setCapture] = useState<string | null>(null);
  const [livenessChoice, setLivenessChoice] = useState<SimulatedLivenessOutcome | undefined>();
  const [matchChoice, setMatchChoice] = useState<string | undefined>();
  const [cancelling, setCancelling] = useState(false);
  const [ending, setEnding] = useState(false);
  const submission = useRef(`sub_${attempt.id}_${Math.random().toString(36).slice(2, 8)}`);
  const reusable = found ? service.reusableResults(attempt.id) : [];
  const label = integration?.referenceLabel || 'External Reference ID';

  const steps = face ? ['Identify Person', 'Capture / Verify', 'Check Eligibility', 'View Result'] : ['Identify Person', 'Check Eligibility', 'View Result'];
  const current = busy === 'verify' ? steps.length - 2 : stage === 'capture' ? 1 : 0;

  const goResult = () => navigate(`/verify/attempts/${attempt.id}`, { replace: true });
  const fail = (r: { error: string; code: string }) => {
    setError(r.error);
    if (r.code === 'expired' || r.code === 'not-in-progress') goResult();
  };

  const find = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy('lookup'); setError(null);
    const r = await service.lookupExternal(attempt.id, reference);
    setBusy(null);
    if (!r.ok) return fail(r);
  };

  const verify = async () => {
    if (busy) return;
    setBusy('verify'); setError(null);
    const captured = !!capture;
    setCapture(null); // the capture is transient: it's used once and not kept
    const r = await service.completeExternal(attempt.id, { captured: face ? captured : false, demo: simulated ? { liveness: livenessChoice, match: matchChoice } : undefined }, { submissionId: submission.current });
    setBusy(null);
    if (!r.ok) return fail(r);
  };

  const reuse = (fromId: string) => {
    if (busy) return;
    const r = service.reuseResult(attempt.id, fromId, { submissionId: submission.current });
    if (!r.ok) setError(r.error);
  };

  const lookupProblem = attempt.lookup && !found ? attempt.lookup.status : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={`/verify/activities/${attempt.activityId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{attempt.activityName}</Link>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{attempt.activityName}</h1>
      <p className="mt-1 text-sm text-slate-500">Transaction {attempt.id} · Expires {formatDateTime(attempt.expiresAt)}</p>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
        <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
        Identity source: <span className="font-medium text-slate-900">{attempt.serviceName}</span>{simulated && <SimulatedBadge />}
        {programme && <span className="text-slate-500">· set by the programme {programme.name}</span>}
      </p>
      <JourneySteps steps={steps} current={current} />
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}

      {stage === 'identify' && (
        <div className="mt-5 space-y-4">
          {!found && (
            <Card className="px-5 py-5">
              <form onSubmit={find} noValidate className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Identify Person</h2>
                  <p className="text-sm text-slate-500">Enter the reference provided for this verification.</p>
                </div>
                <Field label={label} required>
                  {(p) => <Input {...p} autoFocus autoComplete="off" autoCapitalize="characters" enterKeyHint="search" placeholder="Enter reference ID" value={reference} onChange={(e) => setReference(e.target.value)} />}
                </Field>
                <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy === 'lookup'} icon={busy === 'lookup' ? undefined : <Search className="h-5 w-5" />} disabled={!reference.trim()}>Find Identity</Button>
              </form>
              {simulated && (
                <div className="mt-4 rounded-xl bg-amber-50/60 p-3 ring-1 ring-inset ring-amber-200">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800"><FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />Demonstration references (simulated service)</p>
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label="Demonstration references">
                    {SIMULATED_LOOKUP_REFERENCES.map((x) => (
                      <li key={x.value}><button type="button" onClick={() => setReference(x.value)} className="rounded-lg bg-white px-2 py-1 font-mono text-xs ring-1 ring-inset ring-amber-200 hover:ring-amber-400" title={x.note}>{x.value}</button></li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {lookupProblem && (
            <Card className="px-5 py-5">
              <div role="alert" className="flex gap-2 text-sm text-slate-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{lookupProblem === 'NOT_FOUND' ? MESSAGES.notFound : lookupProblem === 'UNAVAILABLE' ? MESSAGES.lookupUnavailable : MESSAGES.lookupError}</p>
                  <p className="mt-1 text-slate-600">{lookupProblem === 'NOT_FOUND' ? 'Correct the reference and search again, or end this verification. Nobody is added to FixID.' : 'You can retry, or end this verification. No other identity source is used instead.'}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {lookupProblem !== 'NOT_FOUND' && <Button variant="secondary" loading={busy === 'lookup'} onClick={(e) => void find(e as unknown as FormEvent)}>Retry</Button>}
                <Button variant="ghost" onClick={() => setEnding(true)}>End Verification</Button>
              </div>
            </Card>
          )}

          {found && (
            <Card className="px-5 py-5">
              <section aria-label="Identity found" className="space-y-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Identity found</p>
                  <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900"><UserRound className="h-5 w-5 text-slate-400" aria-hidden="true" />{found.displayName ?? 'Name not provided by the service'}</h2>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-slate-500">{label}</dt><dd className="font-mono text-slate-900">{found.reference.toUpperCase()}</dd></div>
                  {Object.entries(found.attributes ?? {}).filter(([k]) => k !== 'displayName').map(([k, v]) => (
                    <div key={k}><dt className="text-slate-500">{attributeLabel(k)}</dt><dd className="text-slate-900">{v}</dd></div>
                  ))}
                </dl>
                <p className="text-xs text-slate-500">Only the details this service is permitted to share are shown. Finding the record doesn’t verify who is present.</p>
                {reusable.length > 0 && (
                  <div className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
                    <p className="flex items-center gap-1.5 font-semibold"><Repeat className="h-4 w-4" aria-hidden="true" />A previous verification can be reused</p>
                    <p className="mt-1">This person was verified for this activity on {formatDateTime(reusable[0].completedAt!)} (transaction <span className="font-mono">{reusable[0].id}</span>). The activity allows reuse within its validity period. Eligibility is still checked now.</p>
                    <Button className="mt-3" variant="secondary" icon={<Repeat className="h-4 w-4" />} onClick={() => reuse(reusable[0].id)}>Use previous verification</Button>
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  {face
                    ? <Button size="lg" icon={<ScanFace className="h-5 w-5" />} onClick={() => { setStage('capture'); setError(null); }}>Continue Verification</Button>
                    : <Button size="lg" icon={<ShieldCheck className="h-5 w-5" />} loading={busy === 'verify'} onClick={() => void verify()}>Continue Verification</Button>}
                </div>
              </section>
            </Card>
          )}
          <div className="flex justify-end"><Button variant="ghost" onClick={() => setCancelling(true)}>Cancel verification</Button></div>
        </div>
      )}

      {stage === 'capture' && found && (
        <div className="mt-5 space-y-4">
          <p className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
            <UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <span className="font-medium text-slate-900">{found.displayName ?? 'Identity found'}</span>
            <span className="font-mono text-slate-500">{found.reference.toUpperCase()}</span>
          </p>
          <Card className="space-y-4 px-5 py-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Capture Face</h2>
              <p className="mt-0.5 text-sm text-slate-500">Position the person’s face within the camera frame to continue verification.</p>
              <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  Liveness: {policy.livenessApplies ? LIVENESS_LABEL[policy.livenessRequired ? 'required' : 'optional'] : LIVENESS_LABEL['not-applicable']}
                  {policy.livenessRequired && programme ? ` (required by ${programme.name}; it can’t be skipped)` : policy.livenessRequired ? ' (it can’t be skipped)' : ''}
                  {' · '}Matching by {attempt.serviceName} against the reference it holds
                </span>
              </p>
            </div>
            <CameraCapture captured={capture} onCapture={setCapture} onRetake={() => setCapture(null)} disabled={busy === 'verify'} simulation={simulated} />
            {simulated && (
              <div className="space-y-3 rounded-xl bg-amber-50/60 p-4 ring-1 ring-inset ring-amber-200">
                <p className="text-xs text-amber-900">Simulated service: the capture isn’t sent anywhere. Choose the outcomes the simulation returns. They’re recorded as simulated, never as real biometric or liveness results.</p>
                {policy.livenessApplies && <Choice label="Simulated Liveness Result" options={SIMULATED_LIVENESS_OUTCOMES} value={livenessChoice} onChange={setLivenessChoice} />}
                <Choice label="Simulated Matching Outcome" options={SIMULATED_MATCH_FIXTURES.map((f) => ({ id: f.captureReference, label: f.note }))} value={matchChoice} onChange={setMatchChoice} />
              </div>
            )}
            {busy === 'verify' && <p role="status" className="text-sm text-slate-600">{policy.livenessApplies ? 'Checking liveness, then matching…' : 'Matching…'}</p>}
          </Card>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel verification</Button>
            <span className="flex-1" />
            <Button size="lg" icon={<ShieldCheck className="h-5 w-5" />} loading={busy === 'verify'}
              disabled={!capture || (simulated && (!matchChoice || (policy.livenessApplies && !livenessChoice)))} onClick={() => void verify()}>Verify Identity</Button>
          </div>
        </div>
      )}

      <ConfirmDialog open={cancelling} tone="danger" title="Cancel this verification?" confirmLabel="Cancel verification" onCancel={() => setCancelling(false)}
        description="It will be recorded as cancelled, with what was done so far. No outcome is recorded for the person."
        onConfirm={() => { service.cancelAttempt(attempt.id); setCancelling(false); }} />
      <ConfirmDialog open={ending} title="End this verification?" confirmLabel="End Verification" onCancel={() => setEnding(false)}
        description="The transaction is recorded as unresolved, with the lookup result. Nobody is added to FixID."
        onConfirm={() => { setEnding(false); const r = service.endExternal(attempt.id); if (!r.ok) setError(r.error); }} />
    </div>
  );
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value?: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">{label}<Badge tone="warning">Simulated</Badge></legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-inset', value === o.id ? 'ring-brand-400' : 'ring-slate-200')}>
            <input type="radio" name={label} checked={value === o.id} onChange={() => onChange(o.id)} className="h-4 w-4 border-slate-300 text-brand-600" />{o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
