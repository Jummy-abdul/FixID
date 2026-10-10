import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, FlaskConical, MapPin, Play, ScanFace, ShieldOff } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, SearchInput, useToast } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { AccessBadge, EntryBadge } from '@/components/verification/attemptParts';
import { describeRequirements } from '@/domain/verification';
import { scheduleText } from '../verification/ActivityDetailsPage';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { canPreviewRoles } from '@/store/state';
import { useVerificationService } from '@/verification/useVerificationService';
import { formatDateTime } from '@/lib/dates';
import { AttemptBadge } from '@/components/verification/attemptParts';

export function VerifierHome() {
  const { organization } = useSession();
  const { state } = useStore();
  const { record, previewRole, can } = useAuthorization();
  const service = useVerificationService();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  // What the (possibly previewed) role allows; starting a verification is still checked by the service.
  const canExecute = can('verification.execute');
  const activities = useMemo(() => service.listAuthorizedActivities(organization.id), [service, organization.id, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = activities.filter(({ activity }) => !q.trim() || `${activity.name} ${activity.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  const recent = state.data.verificationAttempts.filter((a) => a.organizationId === organization.id && a.verifierId === record?.id).slice(0, 8);
  const demoOn = !!organization.integrations.verificationDemo?.enabled;
  const { credentialTypeById } = useOrgData();

  const start = (activityId: string) => {
    setError(null);
    const r = service.startAttempt(organization.id, activityId);
    if (!r.ok) return setError(r.error);
    navigate(`/verify/attempts/${r.attempt.id}`);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Verification Activities</h1>
      <p className="mt-1 text-slate-500">Choose the activity, then verify each person in front of you. They don’t need to scan or present anything unless the activity asks for a credential.</p>

      {previewRole && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">Role preview is read-only, so verifications can’t be performed. Exit the preview to verify.</p>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
      {canExecute && !demoOn && (
        <p className="mt-4 flex gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Credential presentation, facial matching, liveness and holder binding have no connected service in this prototype, so those checks return Unable to Verify.
          An administrator can turn on labelled demonstration providers in Settings → Integrations.
        </p>
      )}

      <div className="mt-6">
        {!canExecute ? <NoExecute onSetUp={() => toast({ tone: 'success', title: 'Verifier role added', description: 'Activities appear here once you’re assigned to them.' })} />
          : activities.length === 0 ? (
            <Card><EmptyState icon={<ScanFace className="h-5 w-5" />} title="No activities assigned to you yet"
              description="You can verify people only for activities you’re assigned to. Assigning verifiers to activities is coming soon; until then there’s nothing to verify here." /></Card>
          ) : (
            <div className="space-y-4">
              {activities.length > 4 && <SearchInput value={q} onChange={setQ} placeholder="Search activities" label="Search activities" />}
              <ul className="grid gap-4 md:grid-cols-2" aria-label="Your verification activities">
                {shown.map(({ activity, version }) => {
                  const when = scheduleText(activity.schedule);
                  return (
                    <li key={activity.id}>
                      <Card className="flex h-full flex-col p-5">
                        <h2 className="text-lg font-semibold text-slate-900">{activity.name}</h2>
                        <p className="mt-1 text-sm text-slate-500">{activity.purpose || activity.description}</p>
                        {(activity.location || when) && (
                          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                            {activity.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{activity.location}</span>}
                            {when && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{when}</span>}
                          </p>
                        )}
                        <ul className="mt-3 flex-1 list-disc space-y-0.5 pl-5 text-sm text-slate-600" aria-label="What will be checked">
                          {describeRequirements(version, (id) => credentialTypeById.get(id)?.name ?? '').map((l) => <li key={l}>{l}</li>)}
                        </ul>
                        <Button className="mt-4 self-start" icon={<Play className="h-4 w-4" />} disabled={!!previewRole} onClick={() => start(activity.id)}
                          aria-label={`Start verification: ${activity.name}`}>Start Verification</Button>
                      </Card>
                    </li>
                  );
                })}
              </ul>
              {shown.length === 0 && <p className="text-sm text-slate-500">No activities match your search.</p>}
            </div>
          )}
      </div>

      {recent.length > 0 && (
        <section className="mt-10" aria-labelledby="recent">
          <h2 id="recent" className="flex items-center justify-between text-sm font-semibold text-slate-900">Your recent verifications<Link to="/verify/history" className="font-medium text-brand-600 hover:text-brand-700">View all</Link></h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{a.activityName}</span>
                  <span className="block text-xs text-slate-500">{a.id} · {formatDateTime(a.startedAt)}{a.subject ? ` · ${a.subject.label}` : ''}</span>
                </span>
                <AttemptBadge attempt={a} />
                {a.accessDecision && <AccessBadge attempt={a} />}
                {a.entry && <EntryBadge attempt={a} />}
                <Link to={`/verify/attempts/${a.id}`} className="font-medium text-brand-600 hover:text-brand-700">{a.status === 'in-progress' ? 'Resume' : 'View'}<span className="sr-only"> {a.id}</span></Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * The signed-in administrator can't perform verifications. In demo builds an Organization Admin can
 * explicitly give themselves the Verifier role, through the normal audited operation. The role alone
 * doesn't open any activity: verifiers perform only the activities they're assigned to.
 */
function NoExecute({ onSetUp }: { onSetUp: () => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { record } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const canSetUp = canPreviewRoles(state) && !!record && !state.session.previewRoleId;

  const setUp = () => {
    setConfirming(false);
    if (!record) return;
    const roles = actions.setAdminRoles(organization.id, record.id, [...record.roleIds, 'verifier']);
    if (!roles.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: roles.error });
    onSetUp();
  };

  return (
    <Card>
      <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Your role doesn’t include performing verifications"
        description="Verifications are performed by people with the Verifier role. Ask an Organization Admin for access."
        action={canSetUp ? <Button icon={<FlaskConical className="h-4 w-4" />} onClick={() => setConfirming(true)}>Set up demo verifier access</Button> : undefined} />
      {canSetUp && (
        <ConfirmDialog open={confirming} title="Set up demo verifier access?" confirmLabel="Set up access" onCancel={() => setConfirming(false)} onConfirm={setUp}
          description={`This adds the Verifier role to your account in ${organization.name}. You’ll be able to verify people for activities once you’re assigned to them. The change is recorded in the Audit Log and can be undone in Settings → Administrators & Roles.`} />
      )}
    </Card>
  );
}

/** My Verification History: the verifications this administrator performed, and nobody else's. */
export function VerifierHistoryPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { record } = useAuthorization();
  const mine = state.data.verificationAttempts
    .filter((a) => a.organizationId === organization.id && !!record && a.verifierId === record.id && a.status !== 'in-progress')
    .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt));
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Verification History</h1>
      <p className="mt-1 text-slate-500">Verifications you performed. Other verifiers’ records aren’t shown.</p>
      <div className="mt-6">
        {mine.length === 0 ? (
          <Card><EmptyState icon={<ScanFace className="h-5 w-5" />} title="No verifications yet" description="Verifications you perform appear here." /></Card>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" aria-label="Your verifications">
            {mine.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{a.activityName}</span>
                  <span className="block text-xs text-slate-500">{formatDateTime(a.completedAt ?? a.startedAt)}{a.subject ? ` · ${a.subject.label}` : ''} · {a.id}</span>
                </span>
                <AttemptBadge attempt={a} />
                {a.accessDecision && <AccessBadge attempt={a} />}
                {a.entry && <EntryBadge attempt={a} />}
                <Link to={`/verify/attempts/${a.id}`} className="font-medium text-brand-600 hover:text-brand-700">View<span className="sr-only"> {a.id}</span></Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** The dashboard for a role whose only job is verifying: their assignments and their recent work. */
export function VerifierDashboard() {
  const { organization, admin } = useSession();
  const { state } = useStore();
  const { record } = useAuthorization();
  const service = useVerificationService();
  const assigned = useMemo(() => service.listAuthorizedActivities(organization.id), [service, organization.id, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = state.data.verificationAttempts.filter((a) => a.organizationId === organization.id && !!record && a.verifierId === record.id);
  const today = new Date().toISOString().slice(0, 10);
  const todays = mine.filter((a) => (a.completedAt ?? a.startedAt).slice(0, 10) === today);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Dashboard</h1>
      <p className="mt-1 text-slate-500">Welcome, {admin.name.split(' ')[0]}. Your verification work for {organization.name}.</p>
      <section aria-label="Your verification summary" className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5"><p className="text-sm text-slate-500">Assigned activities</p><p className="mt-1 text-2xl font-semibold text-slate-900">{assigned.length}</p></Card>
        <Card className="p-5"><p className="text-sm text-slate-500">Verifications today</p><p className="mt-1 text-2xl font-semibold text-slate-900">{todays.filter((a) => a.status === 'completed').length}</p></Card>
        <Card className="p-5"><p className="text-sm text-slate-500">Entries recorded today</p><p className="mt-1 text-2xl font-semibold text-slate-900">{todays.filter((a) => a.entry).length}</p></Card>
      </section>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/verify" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"><Play className="h-4 w-4" aria-hidden="true" />My Verification Activities</Link>
        <Link to="/verify/history" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">My Verification History</Link>
      </div>
      {assigned.length === 0 && (
        <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          You aren’t assigned to any verification activities yet. Assigning verifiers to activities is coming soon.
        </p>
      )}
    </>
  );
}
