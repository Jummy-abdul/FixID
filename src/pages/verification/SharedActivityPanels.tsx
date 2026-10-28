import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Check, ChevronRight, ScanFace, X } from 'lucide-react';
import { Badge, Button, ButtonLink, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, FilterSelect, StatCard, useToast } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { ActivityStatusBadge, VerifierPicker } from '@/components/verification/parts';
import { ActivitySettingsSummary } from '@/components/verification/RequirementsSummary';
import { PARTICIPATION_LABEL, type ParticipationStatus } from '@/domain/activitySettings';
import type { ActivityConfig, VerificationAttempt } from '@/domain/types';
import { DECISION_LABEL, STAGE_LABEL, stageOf } from '@/domain/transactions';
import { useQueryState } from '@/hooks/useQueryState';
import { currentDecision, exceptionFor } from '@/store/exceptionOps';
import type { AppState } from '@/store/state';
import { activeAssignments } from '@/domain/verification';
import { summarize } from '@/store/reporting';
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

type Outcome = 'allow' | 'deny' | 'pending-review' | 'unable-to-decide' | 'incomplete';
/** A transaction's current outcome (after any review), counted the same way as the summary figures. */
function outcomeOf(state: AppState, a: VerificationAttempt): Outcome | undefined {
  const d = a.status === 'completed' ? currentDecision(a, a.exceptionId ? exceptionFor(state, a.exceptionId) : undefined) : undefined;
  if (stageOf(a) === 'incomplete') return 'incomplete';
  if (d === 'unable-to-decide' || stageOf(a) === 'unable-to-complete') return 'unable-to-decide';
  return d;
}

/** The owner manages participation: who's invited, who accepted, and suspending or removing an organization. */
export function ParticipatingOrganizationsTab({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const { setParticipantStatus } = useActions();
  const toast = useToast();
  const [pending, setPending] = useState<{ orgId: string; name: string; status: 'active' | 'suspended' | 'removed' } | null>(null);
  const canEdit = can('verification.activities.edit');
  const rows = (activity.sharing?.participants ?? []).filter((p) => p.status !== 'removed').map((p) => ({
    ...p, name: state.data.organizations.find((o) => o.id === p.organizationId)?.name ?? p.organizationId,
    verifiers: state.data.verifierAssignments.filter((v) => v.activityId === activity.id && v.organizationId === p.organizationId && v.status === 'active').length,
  }));
  const apply = () => {
    if (!pending) return;
    const res = setParticipantStatus(organization.id, activity.id, pending.orgId, pending.status);
    setPending(null);
    if (!res.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: res.error });
    toast({ tone: 'success', title: { active: 'Resumed', suspended: 'Suspended', removed: 'Removed' }[pending.status], description: pending.name });
  };
  return (
    <Card>
      <CardHeader title="Participating organizations" action={canEdit ? <ButtonLink to={`${activityPath(activity.id)}/edit`} variant="secondary" size="sm">Invite organizations</ButtonLink> : undefined} />
      <DataTable
        rows={rows}
        rowKey={(x) => x.organizationId}
        empty={<EmptyState title="No organizations invited" />}
        columns={[
          { key: 'org', header: 'Organization', cell: (x) => <span className="font-medium text-slate-900">{x.name}</span> },
          { key: 'status', header: 'Status', cell: (x) => <ParticipationBadge status={x.status} /> },
          { key: 'staff', header: 'Verifiers', cell: (x) => <span className="tabular-nums">{x.verifiers}</span> },
          {
            key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (x) => (canEdit && x.status !== 'declined' ? (
              <span className="inline-flex gap-2">
                {x.status === 'active' && <Button size="sm" variant="ghost" onClick={() => setPending({ orgId: x.organizationId, name: x.name, status: 'suspended' })}>Suspend<span className="sr-only"> {x.name}</span></Button>}
                {x.status === 'suspended' && <Button size="sm" variant="ghost" onClick={() => setPending({ orgId: x.organizationId, name: x.name, status: 'active' })}>Resume<span className="sr-only"> {x.name}</span></Button>}
                <Button size="sm" variant="ghost" onClick={() => setPending({ orgId: x.organizationId, name: x.name, status: 'removed' })}>Remove<span className="sr-only"> {x.name}</span></Button>
              </span>
            ) : null),
          },
        ]}
      />
      {pending && (
        <ConfirmDialog open tone={pending.status === 'active' ? 'primary' : 'danger'} onCancel={() => setPending(null)} onConfirm={apply}
          title={{ active: `Resume ${pending.name}?`, suspended: `Suspend ${pending.name}?`, removed: `Remove ${pending.name}?` }[pending.status]}
          confirmLabel={{ active: 'Resume', suspended: 'Suspend', removed: 'Remove' }[pending.status]}
          description={pending.status === 'active' ? 'Its verifiers can verify again.' : 'Its verifiers can’t start new verifications. Earlier records are kept.'} />
      )}
    </Card>
  );
}

const OUTCOME_OPTIONS = [{ value: 'all', label: 'All outcomes' }, ...(['allow', 'deny', 'pending-review', 'unable-to-decide'] as const).map((d) => ({ value: d, label: DECISION_LABEL[d] })), { value: 'incomplete', label: STAGE_LABEL.incomplete }];

/**
 * The Verifications tab: an activity's verification records, filterable by organization and outcome. The owner
 * sees every organization's records for this activity; a participating organization only its own.
 */
export function ActivityTransactionsTab({ activity, onlyOrganizationId }: { activity: ActivityConfig; onlyOrganizationId?: string }) {
  const { state } = useStore();
  const [org, setOrg] = useQueryState('org', 'all');
  const [outcome, setOutcome] = useQueryState('outcome', 'all');
  const all = state.data.verificationAttempts.filter((a) => a.activityId === activity.id && a.status !== 'in-progress' && (!onlyOrganizationId || a.organizationId === onlyOrganizationId));
  const orgs = [...new Set(all.map((a) => a.organizationId))];
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const rows = all.filter((a) => (org === 'all' || a.organizationId === org) && (outcome === 'all' || outcomeOf(state, a) === outcome));
  return (
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
        {!onlyOrganizationId && orgs.length > 1 && <FilterSelect label="Organization" value={org} onChange={setOrg} options={[{ value: 'all', label: 'All organizations' }, ...orgs.map((id) => ({ value: id, label: orgName(id) }))]} />}
        <FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={OUTCOME_OPTIONS} />
      </div>
      {/* Only what's needed here; the full record opens from each row. */}
      <AttemptsTable rows={rows} hideActivity orgName={onlyOrganizationId ? undefined : orgName}
        hideColumns={['source', 'identity', 'eligibility', 'status', ...((activity.entryPolicy && activity.entryPolicy !== 'off') || all.some((x) => x.entry) ? [] : ['entry'])]} />
    </Card>
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
  const mineSummary = summarize(state, state.data.verificationAttempts.filter((a) => a.activityId === activity.id && a.organizationId === organization.id && a.status !== 'in-progress'));
  const canAssign = can('verification.verifiers.assign');

  const respond = (accept: boolean) => {
    const r = respondToInvitation(organization.id, activity.id, accept);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: accept ? 'Invitation accepted' : 'Invitation declined', description: accept ? 'Now assign verifiers.' : activity.name });
  };
  const saveStaff = () => {
    const r = assignSharedVerifiers(organization.id, activity.id, staff ?? assigned);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    setStaff(null);
    toast({ tone: 'success', title: 'Verifiers updated', description: activity.name });
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
            <h2 className="text-base font-semibold text-slate-900">{owner} invited you to this activity</h2>
            <p className="text-sm text-slate-500">{owner} sees only this activity’s results.</p>
          </div>
          {can('verification.activities.edit') ? (
            <div className="flex gap-2">
              <Button icon={<Check className="h-4 w-4" />} onClick={() => respond(true)}>Accept</Button>
              <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => respond(false)}>Decline</Button>
            </div>
          ) : <p className="text-sm text-slate-500">An administrator can accept it.</p>}
        </Card>
      )}
      {status === 'suspended' && <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">Suspended by {owner}.</p>}

      <div className="space-y-6">
        <Card className="px-6 py-5">
          <h2 className="text-sm font-semibold text-slate-900">Requirements</h2>
          <p className="mt-1 text-xs text-slate-500">Set by {owner}.</p>
          <div className="mt-3"><ActivitySettingsSummary settings={policy.effective} integration={policy.integration} ownerName={owner} /></div>
        </Card>

        {status === 'active' && (
          <Card className="px-6 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Verifiers</h2>
            <div className="mt-3"><VerifierPicker value={staff ?? assigned} onChange={setStaff} readOnly={!canAssign} /></div>
            {canAssign && staff && <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setStaff(null)}>Cancel</Button><Button onClick={saveStaff}>Save verifiers</Button></div>}
          </Card>
        )}

        {can('verification.results.view') && status !== 'invited' && (
          <section aria-label="Your results" className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Your results</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Total attempts" value={mineSummary.attempts} hint={mineSummary.incomplete ? `${mineSummary.incomplete} incomplete` : undefined} />
              <StatCard label="Verified" value={mineSummary.allowed} tone="emerald" />
              <StatCard label="Not verified" value={mineSummary.denied} />
              <StatCard label="Pending review" value={mineSummary.pendingReview} tone="violet" />
            </div>
            <ActivityTransactionsTab activity={activity} onlyOrganizationId={organization.id} />
          </section>
        )}
      </div>
    </>
  );
}
