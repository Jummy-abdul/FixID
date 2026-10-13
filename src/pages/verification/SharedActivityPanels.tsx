import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Check, ChevronRight, ScanFace, X } from 'lucide-react';
import { Badge, Button, ButtonLink, Card, CardHeader, ConfirmDialog, DataTable, StatCard, useToast } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { ActivityStatusBadge, VerifierPicker } from '@/components/verification/parts';
import { ActivitySettingsSummary } from '@/components/verification/RequirementsSummary';
import { PARTICIPATION_LABEL, type ParticipationStatus } from '@/domain/activitySettings';
import type { ActivityConfig } from '@/domain/types';
import { activeAssignments } from '@/domain/verification';
import { formatDateTime } from '@/lib/dates';
import { sharedResults } from '@/store/reporting';
import { activityPolicy, participation } from '@/store/sharingOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { AttemptsTable } from './VerificationHistoryPage';
import { activityPath } from './paths';

const TONE: Record<ParticipationStatus | 'owner', 'success' | 'info' | 'warning' | 'neutral' | 'brand'> = {
  owner: 'brand', active: 'success', invited: 'info', suspended: 'warning', declined: 'neutral', removed: 'neutral',
};
export const ParticipationBadge = ({ status }: { status: ParticipationStatus | 'owner' }) => (
  <Badge tone={TONE[status]}>{status === 'owner' ? 'Owner' : PARTICIPATION_LABEL[status]}</Badge>
);

/**
 * The owner's view of a shared activity's participants: their status, whether they've assigned staff, and
 * this activity's results by organization. Nothing about their other activities, people or records.
 */
export function ParticipatingOrganizationsTab({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const { setParticipantStatus } = useActions();
  const toast = useToast();
  const [pending, setPending] = useState<{ orgId: string; name: string; status: 'active' | 'suspended' | 'removed' } | null>(null);
  const r = sharedResults(state, activity);
  const canEdit = can('verification.activities.edit');
  const apply = () => {
    if (!pending) return;
    const res = setParticipantStatus(organization.id, activity.id, pending.orgId, pending.status);
    setPending(null);
    if (!res.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: res.error });
    toast({ tone: 'success', title: { active: 'Participation resumed', suspended: 'Participation suspended', removed: 'Organization removed' }[pending.status], description: pending.name });
  };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Organizations taking part" value={r.participating} />
        <StatCard label="Verifications" value={r.summary.attempts} />
        <StatCard label="Verified" value={r.summary.allowed} tone="emerald" />
        <StatCard label="Open exceptions" value={r.exceptions.unresolved} hint={`${r.exceptions.total} in total`} tone="violet" to={`/exceptions?activity=${activity.id}`} />
      </div>
      <Card>
        <CardHeader title="Participating organizations"
          description="Each organization runs this activity from its own workspace with its own staff. You see only this activity’s results, never their other activities, people or records."
          action={canEdit ? <ButtonLink to={`${activityPath(activity.id)}/edit`} variant="secondary" size="sm">Invite organizations</ButtonLink> : undefined} />
        <DataTable
          rows={r.rows}
          rowKey={(x) => x.organizationId}
          columns={[
            { key: 'org', header: 'Organization', cell: (x) => <span className="font-medium text-slate-900">{x.name}</span> },
            { key: 'status', header: 'Status', cell: (x) => <ParticipationBadge status={x.participation as ParticipationStatus | 'owner'} /> },
            { key: 'staff', header: 'Staff assigned', cell: (x) => <span className="tabular-nums">{x.verifiers}</span> },
            { key: 'attempts', header: 'Verifications', cell: (x) => <span className="tabular-nums">{x.summary.attempts}</span> },
            { key: 'allowed', header: 'Verified', cell: (x) => <span className="tabular-nums">{x.summary.allowed}</span> },
            { key: 'review', header: 'Pending review', cell: (x) => <span className="tabular-nums">{x.summary.pendingReview}</span> },
            { key: 'last', header: 'Last verification', cell: (x) => <span className="whitespace-nowrap text-slate-500">{x.lastActivity ? formatDateTime(x.lastActivity) : '—'}</span> },
            {
              key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (x) => (canEdit && x.participation !== 'owner' && (x.participation === 'active' || x.participation === 'suspended' || x.participation === 'invited') ? (
                <span className="inline-flex gap-2">
                  {x.participation === 'active' && <Button size="sm" variant="ghost" onClick={() => setPending({ orgId: x.organizationId, name: x.name, status: 'suspended' })}>Suspend<span className="sr-only"> {x.name}</span></Button>}
                  {x.participation === 'suspended' && <Button size="sm" variant="ghost" onClick={() => setPending({ orgId: x.organizationId, name: x.name, status: 'active' })}>Resume<span className="sr-only"> {x.name}</span></Button>}
                  <Button size="sm" variant="ghost" onClick={() => setPending({ orgId: x.organizationId, name: x.name, status: 'removed' })}>Remove<span className="sr-only"> {x.name}</span></Button>
                </span>
              ) : null),
            },
          ]}
        />
      </Card>
      {pending && (
        <ConfirmDialog open tone={pending.status === 'active' ? 'primary' : 'danger'} onCancel={() => setPending(null)} onConfirm={apply}
          title={{ active: `Resume ${pending.name}?`, suspended: `Suspend ${pending.name}?`, removed: `Remove ${pending.name}?` }[pending.status]}
          confirmLabel={{ active: 'Resume', suspended: 'Suspend', removed: 'Remove' }[pending.status]}
          description={pending.status === 'active' ? 'Its assigned staff can verify for this activity again.'
            : `Its staff can’t start new verifications for this activity. Its earlier records are kept${pending.status === 'removed' ? '; you can invite it again by editing the activity' : ''}.`} />
      )}
    </div>
  );
}

/**
 * A participating organization's view of another organization's shared activity: accept the invitation,
 * see the requirements (set by the owner, read-only), choose which of its own staff verify, and see its own
 * verifications for this activity. It never sees the owner's other data.
 */
export function SharedActivityParticipantView({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can, record } = useAuthorization();
  const { respondToInvitation, assignSharedVerifiers } = useActions();
  const toast = useToast();
  const status = participation(activity, organization.id) as ParticipationStatus;
  const owner = state.data.organizations.find((o) => o.id === activity.organizationId)?.name ?? 'Another organization';
  const policy = activityPolicy(state, activity);
  const assigned = activeAssignments(state.data, organization.id, activity.id).map((v) => v.administratorId);
  const [staff, setStaff] = useState<string[] | null>(null);
  const mine = state.data.verificationAttempts.filter((a) => a.activityId === activity.id && a.organizationId === organization.id);
  const canAssign = can('verification.verifiers.assign');

  const respond = (accept: boolean) => {
    const r = respondToInvitation(organization.id, activity.id, accept);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: accept ? 'Invitation accepted' : 'Invitation declined', description: accept ? 'Assign your staff below to start verifying.' : activity.name });
  };
  const saveStaff = () => {
    const r = assignSharedVerifiers(organization.id, activity.id, staff ?? assigned);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    setStaff(null);
    toast({ tone: 'success', title: 'Staff updated', description: activity.name });
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="truncate text-slate-700">{activity.name}</span>
      </nav>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{activity.name}<ActivityStatusBadge status={activity.status} /></h1>
          <p className="mt-1 flex items-center gap-1.5 text-slate-600"><Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" />Shared activity from {owner} · <ParticipationBadge status={status} /></p>
          {activity.description && <p className="mt-2 max-w-2xl text-slate-500">{activity.description}</p>}
        </div>
        {status === 'active' && record && assigned.includes(record.id) && can('verification.execute') && (
          <ButtonLink to={`/verify/activities/${activity.id}`} icon={<ScanFace className="h-4 w-4" />}>Start verifying</ButtonLink>
        )}
      </header>

      {status === 'invited' && (
        <Card className="mb-6 flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{owner} invited {organization.name} to take part</h2>
            <p className="text-sm text-slate-500">You’ll run this activity with your own staff. {owner} sees this activity’s results, not your other activities, people or records.</p>
          </div>
          {can('verification.activities.edit') ? (
            <div className="flex gap-2">
              <Button icon={<Check className="h-4 w-4" />} onClick={() => respond(true)}>Accept</Button>
              <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => respond(false)}>Decline</Button>
            </div>
          ) : <p className="text-sm text-slate-500">An Organization Admin can accept it.</p>}
        </Card>
      )}
      {status === 'suspended' && <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">{owner} has suspended your organization’s participation. New verifications can’t start.</p>}

      <div className="space-y-6">
        <Card className="px-6 py-5">
          <h2 className="text-sm font-semibold text-slate-900">Requirements</h2>
          <p className="mt-1 text-xs text-slate-500">Set by {owner}. Your organization can’t change them.</p>
          <div className="mt-3"><ActivitySettingsSummary settings={policy.effective} integration={policy.integration} ownerName={owner} /></div>
        </Card>

        {status === 'active' && (
          <Card className="px-6 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Your staff for this activity</h2>
            <p className="mt-1 text-sm text-slate-500">Only {organization.name}’s staff can be chosen. They verify from {organization.name}’s workspace.</p>
            <div className="mt-3"><VerifierPicker value={staff ?? assigned} onChange={setStaff} readOnly={!canAssign} /></div>
            {canAssign && staff && <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setStaff(null)}>Cancel</Button><Button onClick={saveStaff}>Save staff</Button></div>}
          </Card>
        )}

        {can('verification.results.view') && (
          <Card>
            <p className="border-b border-slate-100 px-4 py-3 text-sm text-slate-500">{organization.name}’s verifications for this activity.</p>
            <AttemptsTable rows={mine} hideActivity />
          </Card>
        )}
      </div>
    </>
  );
}
