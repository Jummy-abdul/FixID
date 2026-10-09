import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FlaskConical, Play, ScanFace, ShieldOff } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, SearchInput, useToast } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { TYPE_INFO, activeAssignments } from '@/domain/verification';
import { actorPermissions } from '@/store/adminOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { canPreviewRoles } from '@/store/state';
import { useVerificationService } from '@/verification/useVerificationService';
import { formatDateTime } from '@/lib/dates';
import { AttemptBadge } from './VerifierLayout';

export function VerifierHome() {
  const { organization } = useSession();
  const { state } = useStore();
  const { record, previewRole } = useAuthorization();
  const service = useVerificationService();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canExecute = actorPermissions(state, organization.id).has('verification.execute');
  const activities = useMemo(() => service.listAuthorizedActivities(organization.id), [service, organization.id, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = activities.filter(({ activity }) => !q.trim() || `${activity.name} ${activity.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  const recent = state.data.verificationAttempts.filter((a) => a.organizationId === organization.id && a.verifierId === record?.id).slice(0, 8);
  const demoOn = !!organization.integrations.verificationDemo?.enabled;

  const start = (activityId: string) => {
    setError(null);
    const r = service.startAttempt(organization.id, activityId);
    if (!r.ok) return setError(r.error);
    navigate(`/verify/attempts/${r.attempt.id}`);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Verification</h1>
      <p className="mt-1 text-slate-500">Select a verification activity to begin.</p>

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
        {!canExecute ? <NoExecute onSetUp={() => toast({ tone: 'success', title: 'Demo verifier access set up', description: 'You can now perform the activities you were assigned.' })} />
          : activities.length === 0 ? (
            <Card><EmptyState icon={<ScanFace className="h-5 w-5" />} title="No activities assigned to you"
              description="When an administrator assigns you to an active verification activity, it will appear here." /></Card>
          ) : (
            <div className="space-y-4">
              {activities.length > 4 && <SearchInput value={q} onChange={setQ} placeholder="Search activities" label="Search activities" />}
              <ul className="grid gap-4 md:grid-cols-2" aria-label="Your verification activities">
                {shown.map(({ activity, version }) => {
                  const required = version.checks.filter((c) => c.requirement === 'required').length;
                  return (
                    <li key={activity.id}>
                      <Card className="flex h-full flex-col p-5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{TYPE_INFO[version.type].name}</p>
                        <h2 className="mt-1 text-lg font-semibold text-slate-900">{activity.name}</h2>
                        <p className="mt-1 flex-1 text-sm text-slate-500">{activity.description || activity.purpose}</p>
                        <p className="mt-3 text-sm text-slate-600">{version.checks.length} checks · {required} required</p>
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
          <h2 id="recent" className="text-sm font-semibold text-slate-900">Your recent verifications</h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{a.activityName}</span>
                  <span className="block text-xs text-slate-500">{a.id} · {formatDateTime(a.startedAt)}{a.subject ? ` · ${a.subject.label}` : ''}</span>
                </span>
                <AttemptBadge attempt={a} />
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
 * explicitly give themselves the Verifier role and assignments, through the normal audited operations.
 */
function NoExecute({ onSetUp }: { onSetUp: () => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { record } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const active = state.data.activityConfigs.filter((a) => a.organizationId === organization.id && a.status === 'active');
  const canSetUp = canPreviewRoles(state) && !!record;

  const setUp = () => {
    setConfirming(false);
    if (!record) return;
    const roles = actions.setAdminRoles(organization.id, record.id, [...record.roleIds, 'verifier']);
    if (!roles.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: roles.error });
    for (const a of active) {
      const s = state.data;
      const version = s.activityVersions.find((v) => v.id === (a.draftVersionId ?? a.activeVersionId))!;
      const current = activeAssignments(s, organization.id, a.id).map((x) => x.administratorId);
      actions.saveActivity(organization.id, a.id, {
        name: a.name, description: a.description, purpose: a.purpose, type: version.type, checks: version.checks, outcome: version.outcome,
        verifierIds: [...new Set([...current, record.id])],
      });
    }
    onSetUp();
  };

  return (
    <Card>
      <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Your role doesn’t include performing verifications"
        description="Verifications are performed by administrators with the Verifier role who are assigned to an activity. Ask an Organization Admin for access."
        action={canSetUp ? <Button icon={<FlaskConical className="h-4 w-4" />} onClick={() => setConfirming(true)}>Set up demo verifier access</Button> : undefined} />
      {canSetUp && (
        <ConfirmDialog open={confirming} title="Set up demo verifier access?" confirmLabel="Set up access" onCancel={() => setConfirming(false)} onConfirm={setUp}
          description={`This adds the Verifier role to your account in ${organization.name} and assigns you to its ${active.length} active ${active.length === 1 ? 'activity' : 'activities'}. Both changes are recorded in the Audit Log and can be undone in Settings → Administrators & Roles and on each activity.`} />
      )}
    </Card>
  );
}
