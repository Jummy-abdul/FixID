import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, MapPin, Play, ScanFace, XCircle } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { ActivityStatusBadge } from '@/components/verification/parts';
import { AccessBadge, AttemptBadge, EntryBadge } from '@/components/verification/attemptParts';
import { formatCoordinate, formatRadius } from '@/domain/location';
import { participantProgress, participantStatuses } from '@/domain/participantStatus';
import type { ActivityConfig } from '@/domain/types';
import { activeAssignments, describeRequirements, eligibleParticipants } from '@/domain/verification';
import { ELIGIBILITY_LABEL, LIVENESS_LABEL, METHOD_LABEL } from '@/domain/programmes';
import { formatDateTime } from '@/lib/dates';
import { useOrgData, useSession, useStore } from '@/store/AppStore';
import { useVerificationService } from '@/verification/useVerificationService';
import { activityPolicy, executionUnavailable } from '@/store/programmeOps';

/** Where the activity takes place, from its location check or its descriptive location. */
export function activityPlace(a: ActivityConfig): string | null {
  const loc = a.locationCheck;
  if (loc?.enabled) return `${loc.label ? `${loc.label.split(',')[0]} · ` : ''}${formatCoordinate(loc.lat)}, ${formatCoordinate(loc.lng)} · within ${formatRadius(loc.radiusM)}`;
  return a.location || null;
}

/** Progress for the people eligible for an activity, from persisted verification results. */
export function useActivityProgress(activity: ActivityConfig) {
  const { state } = useStore();
  return participantProgress(participantStatuses(state.data.verificationAttempts, activity.id), eligibleParticipants(state.data, activity.organizationId, activity.participants));
}

/** An assigned activity in the Verifier Workspace: what it is, progress so far, and Start Verification. */
export function VerifierActivityPage() {
  const { activityId } = useParams();
  const { organization } = useSession();
  const { state } = useStore();
  const service = useVerificationService();
  const activity = state.data.activityConfigs.find((a) => a.id === activityId && a.organizationId === organization.id);
  const auth = activityId ? service.authorize(organization.id, activityId) : null;

  // Another organization's activity, or one that doesn't exist, looks the same: nothing is revealed.
  if (!activity || !auth || (!auth.ok && auth.code !== 'inactive')) {
    return (
      <Card className="px-6 py-10 text-center">
        <XCircle className="mx-auto h-8 w-8 text-red-500" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">You can’t perform this verification</h1>
        <p className="mt-1 text-slate-500">{activity && auth && !auth.ok ? auth.error : 'This activity doesn’t exist in this organization, or you don’t have access to it.'}</p>
        <Link to="/verify" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to your activities</Link>
      </Card>
    );
  }
  return <Details activity={activity} inactive={!auth.ok} />;
}

function Details({ activity, inactive }: { activity: ActivityConfig; inactive: boolean }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { record, readOnly } = useAuthorization();
  const { credentialTypeById } = useOrgData();
  const service = useVerificationService();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const version = state.data.activityVersions.find((v) => v.id === activity.activeVersionId);
  const progress = useActivityProgress(activity);
  const place = activityPlace(activity);
  const usesFace = !!version?.checks.some((c) => c.type === 'face-match');
  const policy = activityPolicy(state, activity);
  const unavailable = executionUnavailable(state, activity);
  const verifiers = activeAssignments(state.data, organization.id, activity.id).map((x) => { const a = state.data.administrators.find((y) => y.id === x.administratorId); return a?.name ?? a?.email ?? 'Former administrator'; });
  const mine = state.data.verificationAttempts.filter((a) => a.activityId === activity.id && a.verifierId === record?.id && a.status !== 'in-progress').slice(0, 5);

  const start = () => {
    setError(null);
    const r = service.startAttempt(organization.id, activity.id);
    if (!r.ok) return setError(r.error);
    navigate(`/verify/attempts/${r.attempt.id}`);
  };

  const stats = [
    { label: 'Eligible participants', value: progress.eligible },
    { label: 'Verified', value: progress.verified },
    { label: 'Pending verification', value: progress.pending },
    { label: 'Entry granted', value: progress.granted },
    { label: 'Entry denied', value: progress.denied },
  ];

  return (
    <>
      <Link to="/verify" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" aria-hidden="true" />My activities</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{activity.name}</h1>
        <ActivityStatusBadge status={activity.status} />
      </div>
      {(activity.description || activity.purpose) && <p className="mt-1 text-slate-500">{activity.description || activity.purpose}</p>}
      {place && <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /><span><span className="sr-only">Location: </span>{place}{activity.locationCheck?.enabled && <span className="block text-xs text-slate-500">Your device’s location is checked when you run each verification. It’s reported, and doesn’t block verification or entry.</span>}</span></p>}

      {inactive ? (
        <p role="alert" className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">This activity isn’t active, so new verifications can’t be started. Earlier results stay in your history.</p>
      ) : (
        <div className="mt-5">
          {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
          {unavailable && <p role="status" className="mb-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{unavailable}</p>}
          <Button size="lg" className="w-full sm:w-auto" icon={<Play className="h-5 w-5" />} disabled={readOnly || !!unavailable} onClick={start}>Start Verification</Button>
          {readOnly && <p className="mt-2 text-sm text-amber-800">Role preview is read-only. Exit the preview to verify.</p>}
        </div>
      )}
      {usesFace && policy.effective.identitySource.kind === 'local' && service.faceMode(organization.id) === 'simulated' && (
        <p className="mt-4 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <ScanFace className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span><span className="font-semibold">Simulated facial verification.</span> No facial verification provider is configured, so this demonstration organization uses a labelled simulation. Results are marked Simulated and aren’t real biometric verification.</span>
        </p>
      )}
      {usesFace && policy.effective.identitySource.kind === 'local' && service.faceMode(organization.id) === 'unavailable' && (
        <p className="mt-4 flex gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
          <ScanFace className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span><span className="font-semibold">Biometric verification unavailable.</span> Identity can’t be verified right now. You can find participants and capture a selfie, but every verification records Unable to Verify.</span>
        </p>
      )}

      <section aria-label="Verification progress" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((x) => (
          <Card key={x.label} className="p-4">
            <p className="text-xs text-slate-500">{x.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{x.value}</p>
          </Card>
        ))}
      </section>

      {version && (
        <Card className="mt-6 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Verification requirements</h2>
          <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Verification requirements">
            <div><dt className="text-slate-500">Owning Organization</dt><dd className="text-slate-900">{organization.name}</dd></div>
            <div><dt className="text-slate-500">Programme</dt><dd className="text-slate-900">{policy.programme ? policy.programme.name : 'None — independent activity'}</dd></div>
            <div><dt className="text-slate-500">Identity Source</dt><dd className="text-slate-900">{policy.effective.identitySource.kind === 'local' ? 'FixID Local Records' : `${policy.integration?.name ?? 'External identity service'} (external)`}</dd></div>
            <div><dt className="text-slate-500">Verification Method</dt><dd className="text-slate-900">{METHOD_LABEL[policy.effective.method]}{policy.effective.method === 'face' ? ` · Liveness ${LIVENESS_LABEL[policy.effective.liveness].toLowerCase()}` : ''}</dd></div>
            <div><dt className="text-slate-500">Eligibility Requirement</dt><dd className="text-slate-900">{ELIGIBILITY_LABEL[policy.effective.eligibility.approach]}</dd></div>
            <div><dt className="text-slate-500">Assigned Verifiers</dt><dd className="text-slate-900">{verifiers.join(', ') || 'None'}</dd></div>
          </dl>
          {policy.programme && <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3 w-3" aria-hidden="true" />Requirements set by the programme are enforced and can’t be changed while verifying.</p>}
          <p className="mt-3 text-xs font-medium text-slate-500">Checks</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-600">
            {describeRequirements(version, (id) => credentialTypeById.get(id)?.name ?? '').map((l) => <li key={l}>{l}</li>)}
          </ul>
        </Card>
      )}

      {mine.length > 0 && (
        <section className="mt-6" aria-labelledby="mine">
          <h2 id="mine" className="text-sm font-semibold text-slate-900">Your recent verifications here</h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {mine.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{a.subject?.label ?? 'Not identified'}</span>
                  <span className="block text-xs text-slate-500">{formatDateTime(a.completedAt ?? a.startedAt)}</span>
                </span>
                <AttemptBadge attempt={a} />
                {a.accessDecision && <AccessBadge attempt={a} />}
                {a.entry && <EntryBadge attempt={a} />}
                <Link to={`/verify/attempts/${a.id}`} className="font-medium text-brand-600 hover:text-brand-700">View<span className="sr-only"> {a.id}</span></Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
