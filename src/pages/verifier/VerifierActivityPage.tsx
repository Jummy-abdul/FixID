import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Fingerprint, Lock, MapPin, Play, ScanFace, XCircle } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { DisplayStatusBadge } from '@/components/verification/parts';
import { PORTRAIT_BASELINE, describeSource } from '@/domain/activityLifecycle';
import type { ActivityConfig } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { useServices } from '@/services/ServicesProvider';
import { useSession, useStore } from '@/store/AppStore';
import { useVerificationService } from '@/verification/useVerificationService';
import { activityFor, executionUnavailable } from '@/store/sharingOps';
import { HistoryRow, useVerifierActivity } from './verifierParts';

/** An assigned activity in the Verifier Workspace: what it is, how to verify, progress so far, and Start verification. */
export function VerifierActivityPage() {
  const { activityId } = useParams();
  const { organization } = useSession();
  const { state } = useStore();
  const service = useVerificationService();
  // Its own activity, or a shared activity it takes part in, and only when the verifier is assigned to it.
  const activity = activityId ? activityFor(state, organization.id, activityId) : undefined;
  const assigned = activity ? service.listAssignedActivities(organization.id).find((x) => x.activity.id === activity.id) : undefined;

  // Another organization's activity, an unassigned one, or one that doesn't exist, looks the same: nothing is revealed.
  if (!activity || !assigned) {
    const auth = activity ? service.authorize(organization.id, activity.id) : null;
    const refusal = auth && !auth.ok ? auth.error : 'This activity doesn’t exist in this organization, or you don’t have access to it.';
    return (
      <Card className="px-6 py-10 text-center">
        <XCircle className="mx-auto h-8 w-8 text-red-500" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">You can’t perform this verification</h1>
        <p className="mt-1 text-slate-500">{refusal}</p>
        <Link to="/verify" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to your activities</Link>
      </Card>
    );
  }
  return <Details activity={activity} runnable={assigned.runnable} />;
}

function Details({ activity, runnable }: { activity: ActivityConfig; runnable: boolean }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { record, readOnly } = useAuthorization();
  const service = useVerificationService();
  const navigate = useNavigate();
  const { faceVerification } = useServices();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const v = useVerifierActivity(activity);
  const integration = v.policy.integration;
  const process = describeSource(v.policy.effective.identitySource.kind === 'external' ? { kind: 'external', integration } : { kind: 'local' }, v.mode, !faceVerification.available);
  const unavailable = runnable ? executionUnavailable(state, activity, organization.id) : null;
  const faceMode = v.policy.effective.identitySource.kind === 'local' ? service.faceMode(organization.id) : null;
  const mine = state.data.verificationAttempts.filter((a) => a.activityId === activity.id && a.verifierId === record?.id && a.status !== 'in-progress').slice(0, 5);

  const start = () => {
    setError(null);
    setStarting(true);
    const r = service.startAttempt(organization.id, activity.id);
    setStarting(false);
    if (!r.ok) return setError(r.error);
    navigate(`/verify/attempts/${r.attempt.id}`);
  };

  const notRunning = {
    draft: '', active: '',
    scheduled: `This activity hasn’t started yet${activity.schedule?.startsAt ? `: verification opens on ${formatDateTime(activity.schedule.startsAt)}` : ''}.`,
    paused: 'This activity is paused, so new verifications can’t be started. Earlier results are kept.',
    completed: 'This activity is completed, so new verifications can’t be started. Earlier results are kept.',
  }[v.status];
  const c = v.counts;
  const stats = [
    ...(v.eligible !== null ? [{ label: 'Eligible participants', value: v.eligible }, { label: 'Verified participants', value: v.verifiedPeople }] : []),
    { label: 'Total attempts', value: c.attempts },
    { label: 'Verified', value: c.verified },
    { label: 'Unsuccessful', value: c.unsuccessful },
    { label: 'Pending or incomplete', value: c.pending + c.unable },
  ];

  return (
    <>
      <Link to="/verify" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" aria-hidden="true" />My activities</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{activity.name}</h1>
        <DisplayStatusBadge activity={activity} />
      </div>
      {(activity.description || activity.purpose) && <p className="mt-1 text-slate-500">{activity.description || activity.purpose}</p>}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-slate-600">
        {v.schedule && <div className="flex items-center gap-1.5"><dt><CalendarClock className="h-4 w-4 text-slate-400" aria-label="Schedule" /></dt><dd>{v.schedule}</dd></div>}
        {v.place && <div className="flex items-center gap-1.5"><dt><MapPin className="h-4 w-4 text-slate-400" aria-label="Location" /></dt><dd>{v.place}</dd></div>}
        <div className="flex items-center gap-1.5"><dt><Fingerprint className="h-4 w-4 text-slate-400" aria-label="Identity source" /></dt><dd>{v.source}{v.owner ? ` · set by ${v.owner}` : ''}</dd></div>
      </dl>
      {activity.locationCheck?.enabled && <p className="mt-2 text-xs text-slate-500">Your device’s location is checked when you run each verification. It’s reported, and doesn’t block verification or entry.</p>}

      {!runnable ? (
        <p role="status" className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">{notRunning}</p>
      ) : (
        <div className="mt-5">
          {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
          {unavailable && <p role="status" className="mb-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{unavailable}</p>}
          <Button size="lg" className="w-full sm:w-auto" icon={<Play className="h-5 w-5" />} loading={starting} disabled={readOnly || !!unavailable} onClick={start}>Start verification</Button>
          {readOnly && <p className="mt-2 text-sm text-amber-800">Role preview is read-only. Exit the preview to verify.</p>}
        </div>
      )}

      <section aria-label="Verification progress" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((x) => (
          <Card key={x.label} className="p-4">
            <p className="text-xs text-slate-500">{x.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{x.value}</p>
          </Card>
        ))}
      </section>

      <Card className="mt-6 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">How to verify</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-700" aria-label="Verification instructions">
          {process.steps.map((x) => <li key={x}>{x}</li>)}
        </ol>
        <p className="mt-3 text-sm text-slate-600">{PORTRAIT_BASELINE} Results are recorded automatically; you can’t override them.</p>
        {v.owner && <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3 w-3" aria-hidden="true" />Set by {v.owner}.</p>}
        {(process.simulated || faceMode === 'simulated') && (
          <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <ScanFace className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span><span className="font-semibold">Simulated in this prototype.</span> No real identity service, face matching or liveness detection is connected. You choose the simulated outcomes, and results are marked Simulated.</span>
          </p>
        )}
        {faceMode === 'unavailable' && (
          <p className="mt-3 flex gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
            <ScanFace className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span><span className="font-semibold">Biometric verification unavailable.</span> Identity can’t be verified right now. You can find participants and capture a selfie, but every verification records Unable to Verify.</span>
          </p>
        )}
      </Card>

      <section className="mt-6" aria-labelledby="mine">
        <h2 id="mine" className="flex items-center justify-between text-sm font-semibold text-slate-900">Your recent verifications here
          {mine.length > 0 && <Link to={`/verify/history?activity=${encodeURIComponent(activity.id)}`} className="font-medium text-brand-600 hover:text-brand-700">View history for this activity</Link>}</h2>
        {mine.length === 0 ? <p className="mt-3 rounded-xl bg-white px-4 py-4 text-sm text-slate-500 ring-1 ring-slate-200">You haven’t verified anyone for this activity yet.</p> : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {mine.map((a) => <HistoryRow key={a.id} attempt={a} />)}
          </ul>
        )}
      </section>
    </>
  );
}
