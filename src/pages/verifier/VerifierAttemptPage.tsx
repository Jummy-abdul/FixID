import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, CircleSlash, Clock, FlaskConical, Loader2, MapPin, MinusCircle, RotateCcw, ScanFace, Search, ShieldCheck, UserRound, XCircle,
} from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, Field, Input, Modal, Textarea, useToast } from '@/components/ui';
import type { CheckRun, VerificationAttempt } from '@/domain/types';
import { TYPE_INFO, checkById, providersFor } from '@/domain/verification';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useSession, useStore } from '@/store/AppStore';
import type { ParticipantLookup, VerificationInputs } from '@/verification/engine';
import { HOLDER_SCENARIOS } from '@/verification/simulatedProviders';
import { useVerificationService } from '@/verification/useVerificationService';
import { useServices } from '@/services/ServicesProvider';
import { FACE_UNAVAILABLE_REASON } from '@/services/faceVerification';
import type { DeviceLocation } from '@/services/location';
import { CameraCapture } from '@/components/verification/CameraCapture';
import { AccessAndEntry, AttemptBadge, EligibilityBadge, IdentityResultBadge, LocationBadge } from '@/components/verification/attemptParts';

export function VerifierAttemptPage() {
  const { attemptId } = useParams();
  const { state, dispatch } = useStore();
  const service = useVerificationService();
  const attempt = attemptId ? service.getAttempt(attemptId) : undefined;
  // Interrupted attempts past their expiry are closed when looked at.
  useEffect(() => {
    if (attempt?.status === 'in-progress' && new Date(attempt.expiresAt) < new Date()) dispatch({ type: 'verify/expire', organizationId: attempt.organizationId, at: new Date().toISOString() });
  }, [attempt, dispatch]);
  void state;
  if (!attempt) {
    return (
      <Card className="px-6 py-10 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Verification not available</h1>
        <p className="mt-1 text-slate-500">It doesn’t exist, or you don’t have access to it.</p>
        <Link to="/verify" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to your activities</Link>
      </Card>
    );
  }
  return attempt.status === 'in-progress' ? <RunAttempt key={attempt.id} attempt={attempt} /> : <AttemptResult attempt={attempt} />;
}

const STATUS_ICON: Record<CheckRun['status'], { icon: typeof CheckCircle2; tone: string; label: string }> = {
  pending: { icon: CircleDashed, tone: 'text-slate-400', label: 'Pending' },
  'in-progress': { icon: Loader2, tone: 'animate-spin text-brand-600', label: 'In progress' },
  passed: { icon: CheckCircle2, tone: 'text-emerald-600', label: 'Passed' },
  failed: { icon: XCircle, tone: 'text-red-600', label: 'Failed' },
  inconclusive: { icon: AlertTriangle, tone: 'text-amber-600', label: 'Inconclusive' },
  error: { icon: AlertTriangle, tone: 'text-red-500', label: 'Error' },
  skipped: { icon: MinusCircle, tone: 'text-slate-400', label: 'Skipped' },
};

function CheckList({ runs, details }: { runs: CheckRun[]; details?: boolean }) {
  const { organization } = useSession();
  const providers = providersFor(organization);
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" aria-label="Checks">
      {runs.map((r) => {
        const s = STATUS_ICON[r.status];
        return (
          <li key={r.checkId} className="flex items-start gap-3 px-4 py-3">
            <s.icon className={cn('mt-0.5 h-5 w-5 shrink-0', s.tone)} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                {checkById(r.type).name}
                <span className="text-xs font-normal text-slate-500">{r.requirement === 'required' ? 'Required' : r.requirement === 'optional' ? 'Optional' : 'Alternative'}</span>
                {r.simulated && <Badge tone="warning"><FlaskConical className="h-3 w-3" aria-hidden="true" />Simulated</Badge>}
              </span>
              <span className="block text-sm text-slate-600"><span className="font-medium">{s.label}.</span> {r.explanation}</span>
              {details && (
                <span className="mt-1 block text-xs text-slate-500">
                  Provider: {providers.find((p) => p.id === r.providerId)?.name ?? '—'}{r.evidenceRef ? ` · Evidence reference: ${r.evidenceRef}` : ''}{r.completedAt ? ` · ${formatDateTime(r.completedAt)}` : ''}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

type Lookup = Extract<ParticipantLookup, { ok: true }>;

/**
 * Performing a verification. Activities that identify people by an identifier are guided:
 * 1. Find Participant (identifier → the person, their eligibility, whether an enrolled portrait exists),
 * 2. Verify Identity (live selfie for 1:1 facial verification, or the activity's other evidence),
 * then the recorded result. Finding someone proves nothing; only the checks run on submission decide.
 */
function RunAttempt({ attempt }: { attempt: VerificationAttempt }) {
  const service = useVerificationService();
  const navigate = useNavigate();
  const steps = service.requiredSteps(attempt.id)!;
  const { geolocation } = useServices();
  const { state } = useStore();
  const locationCheck = state.data.activityConfigs.find((a) => a.id === attempt.activityId)?.locationCheck;
  const guided = !!steps.identifier;
  const [stage, setStage] = useState<'find' | 'verify'>(guided ? 'find' : 'verify');
  const [identifier, setIdentifier] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [capture, setCapture] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [credMethod, setCredMethod] = useState<'reference' | 'simulated-presentation'>(steps.credential?.methods[0] ?? 'reference');
  const [credValue, setCredValue] = useState('');
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [demo, setDemo] = useState<NonNullable<VerificationInputs['demo']>>({});
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<CheckRun[] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const submission = useRef(`sub_${attempt.id}_${Math.random().toString(36).slice(2, 8)}`);
  const inFlight = useRef(false);

  const find = async (e: FormEvent) => {
    e.preventDefault();
    if (finding) return;
    setFinding(true); setLookup(null); setLookupError(null); setCapture(null); setError(null);
    const r = await service.lookupParticipant(attempt.id, identifier);
    setFinding(false);
    if (r.ok) return setLookup(r);
    setLookupError(r.error);
    if (r.code === 'expired' || r.code === 'not-in-progress') navigate(`/verify/attempts/${attempt.id}`, { replace: true });
  };

  const changeParticipant = () => { setLookup(null); setCapture(null); setAttrs({}); setStage('find'); setError(null); };

  /** Submits for verification. Without evidence, the result records that identity wasn't verified. */
  const submit = async (withEvidence: boolean) => {
    if (inFlight.current) return;
    setError(null);
    // Missing input is reported before the device is asked for anything.
    const missing = !guided && steps.identifier && !identifier.trim() ? `Enter the person’s ${steps.identifier.label.toLowerCase()}.`
      : withEvidence && steps.credential && !credValue.trim() ? 'Enter or present the credential.'
        : withEvidence && steps.biometric && !capture ? 'Capture a selfie of the person first.' : null;
    if (missing) return setError(missing);
    inFlight.current = true;
    // The device is asked for its location only when this activity has a location check.
    let location: DeviceLocation | undefined;
    if (locationCheck?.enabled) {
      setLocating(true);
      location = await geolocation.getCurrentPosition();
      setLocating(false);
    }
    const face = withEvidence && capture ? { image: capture, capturedAt: new Date().toISOString() } : undefined;
    setCapture(null); // the capture is sent once and not kept
    const r = await service.submitInputs(attempt.id, {
      identifier: steps.identifier ? identifier : undefined,
      credential: steps.credential && withEvidence ? { method: credMethod, value: credValue } : undefined,
      attributes: steps.attributes.length && withEvidence ? attrs : undefined,
      demo: withEvidence ? demo : undefined,
      face,
      location,
    }, { submissionId: submission.current, onProgress: setRuns });
    inFlight.current = false;
    if (!r.ok) {
      setRuns(null);
      setError(r.error);
      if (r.code === 'expired' || r.code === 'not-in-progress') navigate(`/verify/attempts/${attempt.id}`, { replace: true });
    }
  };

  const stepNames = guided ? ['Find Participant', 'Verify Identity', 'Result'] : null;
  const current = runs ? 2 : stage === 'find' ? 0 : 1;

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={`/verify/activities/${attempt.activityId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{attempt.activityName}</Link>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{attempt.activityName}</h1>
      <p className="mt-1 text-sm text-slate-500">Reference {attempt.id} · Expires {formatDateTime(attempt.expiresAt)}</p>
      {stepNames && (
        <ol className="mt-4 flex gap-2 text-xs font-medium" aria-label="Verification steps">
          {stepNames.map((n, i) => (
            <li key={n} aria-current={i === current ? 'step' : undefined} className={cn('flex-1 rounded-full px-3 py-1.5 text-center', i === current ? 'bg-brand-600 text-white' : i < current ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>{i + 1}. {n}</li>
          ))}
        </ol>
      )}
      {locating && <p className="mt-4 text-sm text-slate-500" role="status">Getting your device’s location…</p>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}

      {runs ? (
        <section className="mt-6" aria-live="polite">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Running checks…</h2>
          <CheckList runs={runs} />
        </section>
      ) : stage === 'find' ? (
        <div className="mt-5 space-y-4">
          <Card className="px-5 py-5">
            <form onSubmit={find} noValidate className="space-y-4">
              <h2 className="text-base font-semibold text-slate-900">Find participant</h2>
              <Field label={steps.identifier!.label} required hint="Ask the person for it, or read it from their document.">
                {(p) => <Input {...p} autoFocus autoComplete="off" autoCapitalize="characters" enterKeyHint="search" value={identifier} onChange={(e) => { setIdentifier(e.target.value); setLookup(null); setLookupError(null); }} />}
              </Field>
              <Button type="submit" size="lg" className="w-full sm:w-auto" loading={finding} icon={finding ? undefined : <Search className="h-5 w-5" />} disabled={!identifier.trim()}>Find Participant</Button>
            </form>
            {lookupError && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{lookupError}</p>}
          </Card>
          {lookup && (
            <ParticipantCard lookup={lookup} faceAvailable={!!steps.biometric?.available}
              onContinue={() => { setStage('verify'); setError(null); }}
              onRecord={() => void submit(false)} onChange={changeParticipant} />
          )}
          <div className="flex justify-end"><Button variant="ghost" onClick={() => setCancelling(true)}>Cancel verification</Button></div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {lookup && (
            <p className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
              <UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <span className="font-medium text-slate-900">{lookup.participant.name}</span>
              <span className="text-slate-500">{lookup.participant.identifierLabel} {lookup.participant.identifier}</span>
              <span className="flex-1" />
              <button type="button" onClick={changeParticipant} className="text-sm font-medium text-brand-600 hover:text-brand-700">Change participant</button>
            </p>
          )}
          {!guided && steps.identifier && (
            <Card className="px-5 py-5">
              <Field label={steps.identifier.label} required>{(p) => <Input {...p} autoComplete="off" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />}</Field>
            </Card>
          )}
          {steps.biometric && (
            <Card className="space-y-4 px-5 py-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Verify identity</h2>
                <p className="mt-0.5 text-sm text-slate-500">Capture the person’s face now. It’s compared 1:1 with their enrolled portrait{steps.biometric.liveness ? ', with a liveness check' : ''}, then discarded.</p>
              </div>
              {!steps.biometric.available && (
                <div role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-300">
                  <p className="flex items-center gap-1.5 font-semibold"><ScanFace className="h-4 w-4" aria-hidden="true" />Biometric Verification Unavailable: integration required</p>
                  <p className="mt-1">No facial verification provider is connected. You can capture a selfie, but no comparison will be made: identity will be recorded as Unable to Verify. Don’t compare faces by eye instead.</p>
                </div>
              )}
              <CameraCapture captured={capture} onCapture={setCapture} onRetake={() => setCapture(null)} />
            </Card>
          )}
          {(steps.credential || steps.attributes.length > 0 || steps.holderBinding) && (
            <Card className="space-y-5 px-5 py-5">
              <h2 className="text-base font-semibold text-slate-900">{steps.biometric ? 'Additional evidence' : 'Verify identity'}</h2>
              {steps.credential && (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-slate-700">Credential presentation</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {steps.credential.methods.includes('simulated-presentation') && (
                      <MethodOption checked={credMethod === 'simulated-presentation'} onSelect={() => setCredMethod('simulated-presentation')} title="Wallet presentation (simulated)"
                        body="Demonstration only: stands in for a secure presentation from a compatible wallet." simulated />
                    )}
                    <MethodOption checked={credMethod === 'reference'} onSelect={() => setCredMethod('reference')} title="Credential number"
                      body="Finds the record, but a number isn’t proof the credential is genuine." />
                  </div>
                  <div className="mt-3">
                    <Field label="Credential number" required>
                      {(p) => <Input {...p} autoComplete="off" value={credValue} onChange={(e) => setCredValue(e.target.value)} placeholder="As shown on the credential" />}
                    </Field>
                  </div>
                </fieldset>
              )}
              {steps.attributes.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {steps.attributes.map((a) => (
                    <Field key={a} label={a} hint="As stated by the person.">
                      {(p) => <Input {...p} type={a === 'Date of birth' ? 'date' : 'text'} value={attrs[a] ?? ''} onChange={(e) => setAttrs((x) => ({ ...x, [a]: e.target.value }))} />}
                    </Field>
                  ))}
                </div>
              )}
              {steps.holderBinding && (steps.holderBinding.available ? (
                <div className="rounded-xl bg-amber-50/60 p-4 ring-1 ring-inset ring-amber-200">
                  <ScenarioPicker label="Holder proof scenario (simulated)" options={HOLDER_SCENARIOS} value={demo.holderBinding} onChange={(holderBinding) => setDemo((d) => ({ ...d, holderBinding }))} />
                </div>
              ) : <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">Holder binding isn’t available: no presentation proof service is configured.</p>)}
            </Card>
          )}
          {locationCheck?.enabled && (
            <p className="flex items-start gap-1.5 text-xs text-slate-500">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              This activity checks your device’s location when you submit. Your browser may ask for permission. The result is reported; it doesn’t block verification or entry.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel verification</Button>
            <span className="flex-1" />
            <Button size="lg" icon={<ShieldCheck className="h-5 w-5" />} disabled={!!steps.biometric && !capture} onClick={() => void submit(true)}>{guided ? 'Verify Identity' : 'Run verification'}</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={cancelling} tone="danger" title="Cancel this verification?" confirmLabel="Cancel verification" onCancel={() => setCancelling(false)}
        description="It will be recorded as cancelled. No outcome is recorded for the person."
        onConfirm={() => { service.cancelAttempt(attempt.id); setCancelling(false); }} />
    </div>
  );
}

/** The person found for the identifier: only what the officer needs to confirm them and proceed. */
function ParticipantCard({ lookup, faceAvailable, onContinue, onRecord, onChange }: {
  lookup: Lookup; faceAvailable: boolean; onContinue: () => void; onRecord: () => void; onChange: () => void;
}) {
  const { participant: p, eligibility, portrait, faceRequired, history } = lookup;
  const blocked = eligibility === 'not-eligible' ? 'not-eligible' : faceRequired && portrait === 'missing' ? 'no-portrait' : null;
  return (
    <Card className="px-5 py-5">
      <section aria-label="Participant found" className="space-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Participant found</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{p.name}</h2>
          <p className="text-sm text-slate-600">{p.identifierLabel}: <span className="font-mono">{p.identifier}</span></p>
          {(p.relationship || p.unit) && <p className="text-sm text-slate-500">{[p.relationship, p.unit].filter(Boolean).join(' · ')}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500">Eligibility</dt><dd className="mt-0.5">{eligibility === 'eligible' ? <Badge tone="success">Eligible</Badge> : eligibility === 'not-eligible' ? <Badge tone="danger">Not eligible</Badge> : <Badge tone="neutral">Not checked for this activity</Badge>}</dd></div>
          {faceRequired && <div><dt className="text-slate-500">Enrolled portrait</dt><dd className="mt-0.5">{portrait === 'enrolled' ? <Badge tone="success">Available</Badge> : <Badge tone="warning">Not enrolled</Badge>}</dd></div>}
        </dl>
        <p className="text-xs text-slate-500">Finding this record doesn’t verify who is present. {faceRequired ? 'Their face must still be verified.' : 'Their identity must still be verified.'}</p>
        {history.entered && (
          <p role="alert" className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Already granted entry on {formatDateTime(history.entered.at)} by {history.entered.by}. Another entry won’t be recorded for this activity.
          </p>
        )}
        {!history.entered && history.denied && (
          <p className="flex gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-inset ring-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Previously denied entry on {formatDateTime(history.denied.at)} by {history.denied.by}{history.denied.reason ? `: ${history.denied.reason}` : '.'}
          </p>
        )}
        {history.verifiedAt && !history.entered && <p className="text-sm text-slate-600">Already verified for this activity on {formatDateTime(history.verifiedAt)}.</p>}
        {blocked === 'not-eligible' && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-inset ring-red-200">Not an eligible participant for this activity, so they can’t be cleared for it. Record the result, or check the identifier.</p>
        )}
        {blocked === 'no-portrait' && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-300">No enrolled portrait exists for this person, so their face can’t be verified. They need to complete portrait enrollment first.</p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {blocked
            ? <Button size="lg" variant="secondary" onClick={onRecord}>{blocked === 'not-eligible' ? 'Record as not eligible' : 'Record as unable to verify'}</Button>
            : <Button size="lg" icon={<ScanFace className="h-5 w-5" />} onClick={onContinue}>{faceRequired ? (faceAvailable ? 'Continue to face verification' : 'Continue') : 'Continue'}</Button>}
          <Button size="lg" variant="ghost" onClick={onChange}>Find a different participant</Button>
        </div>
      </section>
    </Card>
  );
}

function MethodOption({ checked, onSelect, title, body, disabled, simulated, icon }: { checked?: boolean; onSelect?: () => void; title: string; body: string; disabled?: boolean; simulated?: boolean; icon?: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={!!checked} disabled={disabled} onClick={onSelect}
      className={cn('rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60', checked ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">{icon}{title}{simulated && <Badge tone="warning">Simulated</Badge>}</span>
      <span className="mt-0.5 block text-xs text-slate-500">{body}</span>
    </button>
  );
}

function ScenarioPicker<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value?: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{label}</legend>
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

const IDENTITY_RESULT = {
  verified: { label: 'Verified', tone: 'success', icon: CheckCircle2 },
  'not-verified': { label: 'Failed', tone: 'danger', icon: XCircle },
  'unable-to-verify': { label: 'Unable to verify', tone: 'warning', icon: AlertTriangle },
  'pending-review': { label: 'Pending review', tone: 'violet', icon: Clock },
} as const;

/** Why identity came out as it did, from the identity checks themselves. */
function identityExplanation(a: VerificationAttempt): string {
  const identity = a.checks.filter((c) => ['identity', 'credential'].includes(checkById(c.type).category));
  if (a.verificationResult === 'verified') {
    const face = identity.find((c) => c.type === 'face-match' && c.status === 'passed');
    return face ? face.explanation : 'The required identity checks passed.';
  }
  const problem = identity.find((c) => c.requirement !== 'optional' && c.status !== 'passed' && c.status !== 'skipped') ?? identity.find((c) => c.status !== 'passed');
  return problem?.explanation ?? a.reasons[0] ?? '';
}

/**
 * The officer's result: identity, eligibility and location side by side, never merged into one
 * success indicator. The entry decision follows separately.
 */
function ResultSummary({ attempt }: { attempt: VerificationAttempt }) {
  const id = IDENTITY_RESULT[(attempt.verificationResult === 'not-required' ? 'verified' : attempt.verificationResult) ?? 'unable-to-verify'];
  const biometricUnavailable = attempt.checks.some((c) => c.explanation === FACE_UNAVAILABLE_REASON);
  const loc = attempt.location;
  return (
    <section aria-label="Outcome" className="rounded-2xl bg-white px-5 py-5 ring-1 ring-slate-200">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Participant</p>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">{attempt.subject?.label ?? 'Not identified'}</h1>
      {biometricUnavailable && (
        <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-300">
          <ScanFace className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span><span className="font-semibold">Biometric Verification Unavailable: integration required.</span> No facial verification provider is connected, so no comparison was made and identity wasn’t verified.</span>
        </p>
      )}
      <dl className="mt-4 divide-y divide-slate-100">
        <div className="py-3">
          <dt className="text-sm text-slate-500">Identity verification</dt>
          <dd className="mt-1"><span className={cn('inline-flex items-center gap-1.5 text-lg font-semibold', { success: 'text-emerald-700', danger: 'text-red-700', warning: 'text-amber-700', violet: 'text-violet-700' }[id.tone])}><id.icon className="h-5 w-5" aria-hidden="true" />{id.label}</span>
            <span className="block text-sm text-slate-600">{identityExplanation(attempt)}</span></dd>
        </div>
        <div className="py-3">
          <dt className="text-sm text-slate-500">Activity eligibility</dt>
          <dd className="mt-1"><EligibilityBadge attempt={attempt} /></dd>
        </div>
        <div className="py-3">
          <dt className="text-sm text-slate-500">Location check</dt>
          <dd className="mt-1">{loc && loc.result !== 'not-required' ? <LocationBadge attempt={attempt} /> : <span className="text-sm text-slate-700">Not required</span>}
            {loc?.result === 'outside' && <span className="block text-sm text-amber-800">Your device appears to be outside the configured area. This doesn’t change the identity result.</span>}</dd>
        </div>
      </dl>
    </section>
  );
}

function AttemptResult({ attempt }: { attempt: VerificationAttempt }) {
  const { organization } = useSession();
  const service = useVerificationService();
  const navigate = useNavigate();
  const toast = useToast();
  const { state } = useStore();
  const [details, setDetails] = useState(false);
  const [referring, setReferring] = useState(false);
  const [reason, setReason] = useState('');
  const version = state.data.activityVersions.find((v) => v.id === attempt.versionId);
  const reviewAllowed = !!version && (version.outcome.onRequiredFailure === 'pending-review' || version.outcome.onInconclusive === 'pending-review');
  const isMine = state.data.administrators.find((a) => a.id === attempt.verifierId)?.userId === state.data.admin.id;
  const canRefer = isMine && attempt.status === 'completed' && attempt.outcome !== 'verified' && reviewAllowed && !attempt.review;

  // A new attempt starts empty: nothing about the previous person is carried over.
  const startNew = () => {
    const r = service.startAttempt(organization.id, attempt.activityId);
    if (!r.ok) return toast({ tone: 'error', title: 'Can’t start a new verification', description: r.error });
    navigate(`/verify/attempts/${r.attempt.id}`);
  };

  const done = attempt.status === 'completed' && !!attempt.outcome;
  return (
    <div className="mx-auto max-w-3xl">
      {done ? <ResultSummary attempt={attempt} /> : (
        <section className="rounded-2xl bg-slate-700 px-6 py-6 text-white" aria-label="Outcome">
          {attempt.status === 'cancelled' ? <CircleSlash className="h-8 w-8" aria-hidden="true" /> : <AlertTriangle className="h-8 w-8" aria-hidden="true" />}
          <h1 className="mt-2 text-2xl font-semibold">{attempt.status === 'cancelled' ? 'Verification cancelled' : attempt.status === 'expired' ? 'Verification interrupted' : 'Verification couldn’t be completed'}</h1>
          <p className="mt-1 text-white/90">{attempt.reasons[0] ?? 'No outcome was recorded for the person.'}</p>
        </section>
      )}
      {attempt.simulated && (
        <p className="mt-4 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-300">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Demonstration result: some checks used simulated providers. This is not real identity or credential assurance.
        </p>
      )}
      <div className="mt-4"><AccessAndEntry attempt={attempt} /></div>
      {attempt.review && <p className="mt-4 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900 ring-1 ring-inset ring-violet-200">Pending review since {formatDateTime(attempt.review.referredAt)} ({attempt.review.referredBy}): {attempt.review.reason}</p>}

      <Card className="mt-6 px-5 py-5">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Activity</dt><dd className="font-medium text-slate-900">{attempt.activityName}</dd></div>
          <div><dt className="text-slate-500">Verification type</dt><dd className="text-slate-900">{TYPE_INFO[attempt.type].name}</dd></div>
          <div><dt className="text-slate-500">Date and time</dt><dd className="text-slate-900">{formatDateTime(attempt.completedAt ?? attempt.startedAt)}</dd></div>
          <div><dt className="text-slate-500">Reference</dt><dd className="font-mono text-xs text-slate-900">{attempt.id}</dd></div>
          {attempt.status === 'completed' && <>
            <div><dt className="text-slate-500">Identity and credential</dt><dd className="mt-0.5"><IdentityResultBadge attempt={attempt} /></dd></div>
            <div><dt className="text-slate-500">Eligibility</dt><dd className="mt-0.5"><EligibilityBadge attempt={attempt} /></dd></div>
          </>}
          <div><dt className="text-slate-500">Subject</dt><dd className="text-slate-900">{attempt.subject?.label ?? 'Not identified'}</dd></div>
          <div><dt className="text-slate-500">Verifier</dt><dd className="text-slate-900">{attempt.verifierName}</dd></div>
          <div><dt className="text-slate-500">Organization</dt><dd className="text-slate-900">{organization.name}</dd></div>
          <div><dt className="text-slate-500">Status</dt><dd><AttemptBadge attempt={attempt} /></dd></div>
          {details && <>
            <div><dt className="text-slate-500">Configuration version</dt><dd className="text-slate-900">Version {attempt.versionNumber}</dd></div>
            <div><dt className="text-slate-500">Application</dt><dd className="text-slate-900">{attempt.client.name}</dd></div>
            <div><dt className="text-slate-500">Started</dt><dd className="text-slate-900">{formatDateTime(attempt.startedAt)}</dd></div>
            <div><dt className="text-slate-500">Inputs provided</dt><dd className="text-slate-900">{[attempt.inputs?.identifier && 'Identifier', attempt.inputs?.credential && (attempt.inputs.credential === 'reference' ? 'Credential number' : 'Credential presentation (simulated)'), attempt.inputs?.attributes?.length && `Details: ${attempt.inputs.attributes.join(', ')}`, attempt.inputs?.biometric && 'Live facial capture (not stored)'].filter(Boolean).join(' · ') || '—'}</dd></div>
          </>}
        </dl>
      </Card>
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Checks</h2>
        <CheckList runs={attempt.checks} details={details} />
        {attempt.status === 'completed' && attempt.reasons.length > 0 && (
          <div className="mt-3 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
            <p className="font-medium text-slate-900">Why</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">{attempt.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
      </section>
      <div className="mt-6 flex flex-wrap gap-2">
        {isMine && <Button size="lg" icon={<RotateCcw className="h-5 w-5" />} onClick={startNew}>Verify Next Participant</Button>}
        <Button size="lg" variant="secondary" onClick={() => navigate(isMine ? `/verify/activities/${attempt.activityId}` : '/verify')}>Finish</Button>
        <Button variant="secondary" onClick={() => setDetails((d) => !d)} aria-expanded={details}>{details ? 'Hide Verification Details' : 'View Verification Details'}</Button>
        {canRefer && <Button variant="ghost" onClick={() => setReferring(true)}>Refer for Review</Button>}
      </div>
      {referring && (
        <Modal open onClose={() => setReferring(false)} title="Refer for review" description="A reviewer will look at this verification. The original result and evidence stay as recorded."
          footer={<><Button variant="secondary" onClick={() => setReferring(false)}>Cancel</Button><Button onClick={() => {
            const r = service.referForReview(attempt.id, reason);
            setReferring(false);
            toast(r.ok ? { tone: 'success', title: 'Referred for review' } : { tone: 'error', title: 'Couldn’t refer this verification' });
          }}>Refer</Button></>}>
          <Field label="Reason" hint="What should the reviewer know?">{(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </Modal>
      )}
    </div>
  );
}
