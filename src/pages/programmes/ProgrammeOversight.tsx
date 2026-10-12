import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Layers3, ShieldAlert, XCircle } from 'lucide-react';
import { Badge, Card, CardHeader, DataTable, PageHeader, StatCard } from '@/components/ui';
import { ActivityStatusBadge } from '@/components/verification/parts';
import { DecisionBadge, StageBadge } from '@/components/verification/transactionParts';
import { EXCEPTION_REASON_LABEL } from '@/domain/exceptions';
import type { VerificationProgramme } from '@/domain/programmes';
import { DECISION_LABEL } from '@/domain/transactions';
import { formatDateTime } from '@/lib/dates';
import { currentDecision, exceptionFor } from '@/store/exceptionOps';
import { participation, programmeFor } from '@/store/programmeOps';
import {
  CONFIGURATION_STATUS_LABEL, activityConfigurationStatus, oversight, programmeExceptions, programmeTransactions, summarize, type ConfigurationStatus,
} from '@/store/reporting';
import { useSession, useStore } from '@/store/AppStore';
import { ExceptionStatusBadge } from '../exceptions/ExceptionsPage';
import { ParticipationBadge } from './ProgrammesPage';

const CONFIG_TONE = { 'meets-requirements': 'success', 'action-required': 'warning', 'not-evaluated': 'neutral' } as const;
export const ConfigurationBadge = ({ status }: { status: ConfigurationStatus }) => <Badge tone={CONFIG_TONE[status]}>{CONFIGURATION_STATUS_LABEL[status]}</Badge>;

/**
 * Programme oversight for the owning organization: participation, programme-linked activity and
 * verification counts per participating organization, from stored transactions. Programme scope only:
 * participants' other activities, people, integrations and unrelated history are never included.
 */
export function ProgrammeOverview({ programme }: { programme: VerificationProgramme }) {
  const { state } = useStore();
  const o = oversight(state, programme);
  const s = o.summary;
  return (
    <section aria-label="Programme overview" className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Participating Organizations" value={o.participating} />
        <StatCard label="Active Activities" value={o.activeActivities} />
        <StatCard label="Total Verification Attempts" value={s.attempts} />
        <StatCard label="Completed Verifications" value={s.completed} tone="emerald" />
        <StatCard label="Pending Reviews" value={s.pendingReview} tone="violet" />
        <StatCard label="Unable to Complete" value={s.unableToComplete} tone="amber" />
        <StatCard label="Programme Exceptions" value={`${o.exceptions.unresolved} open`} hint={`${o.exceptions.total} in total`} />
      </div>
      <Card className="px-5 py-4">
        <h3 className="text-sm font-semibold text-slate-900">Verification outcomes by status</h3>
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600" aria-label="Verification outcomes by status">
          {(['allow', 'deny', 'pending-review', 'unable-to-decide'] as const).map((d) => <li key={d}>{DECISION_LABEL[d]}: <span className="font-semibold tabular-nums text-slate-900">{s.byDecision[d]}</span></li>)}
          <li>Cancelled: <span className="font-semibold tabular-nums text-slate-900">{s.cancelled}</span></li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">Counts come from stored transactions of programme-linked activities only. Outcomes reflect any recorded review determination.</p>
      </Card>
      <Card>
        <CardHeader title="Participating organizations" description="Programme-level summaries only. Select an organization for its programme activities and exceptions." />
        <DataTable
          rows={o.rows}
          rowKey={(r) => r.organizationId}
          rowHref={(r) => `/programmes/${programme.id}/organizations/${r.organizationId}`}
          columns={[
            { key: 'org', header: 'Organization', cell: (r) => <Link to={`/programmes/${programme.id}/organizations/${r.organizationId}`} className="font-medium text-slate-900 hover:text-brand-700">{r.name}</Link> },
            { key: 'part', header: 'Participation Status', cell: (r) => (r.participation === 'owner' ? <Badge tone="brand">Owner</Badge> : <ParticipationBadge status={r.participation as 'active'} />) },
            { key: 'acts', header: 'Active Activities', cell: (r) => r.activeActivities },
            { key: 'attempts', header: 'Verification Attempts', cell: (r) => r.summary.attempts },
            { key: 'completed', header: 'Completed', cell: (r) => r.summary.completed },
            { key: 'pending', header: 'Pending Review', cell: (r) => r.summary.pendingReview },
            { key: 'last', header: 'Last Activity', cell: (r) => (r.lastActivity ? formatDateTime(r.lastActivity) : '—') },
            { key: 'config', header: 'Programme Configuration Status', cell: (r) => <ConfigurationBadge status={r.configuration} /> },
          ]}
        />
      </Card>
      <p className="text-xs text-slate-500">Programme Configuration Status checks activity configuration against this programme’s requirements. It isn’t a legal or regulatory compliance assessment.</p>
    </section>
  );
}

/** One participating organization, within the programme's oversight scope. */
export function ProgrammeOrganizationPage() {
  const { programmeId = '', orgId = '' } = useParams();
  const { organization } = useSession();
  const { state } = useStore();
  const p = programmeFor(state, organization.id, programmeId);
  const role = p ? participation(p, orgId) : null;
  // Only the owner sees participant drill-downs, and only for organizations in the programme.
  if (!p || participation(p, organization.id) !== 'owner' || !role || (role === 'owner' && p.scope !== 'own')) {
    return (
      <Card className="px-6 py-10 text-center">
        <Layers3 className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Not available</h1>
        <p className="mt-1 text-slate-500">This organization isn’t within the programme oversight available to {organization.name}.</p>
        <Link to="/programmes" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to Verification Programmes</Link>
      </Card>
    );
  }
  const orgName = state.data.organizations.find((o) => o.id === orgId)?.name ?? orgId;
  const activities = state.data.activityConfigs.filter((a) => a.organizationId === orgId && a.programmeId === p.id);
  const tx = programmeTransactions(state, p, {}, orgId).sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt));
  const s = summarize(state, tx);
  const exceptions = programmeExceptions(state, p, orgId);
  return (
    <>
      <PageHeader title={orgName} breadcrumbs={[{ label: 'Verification Programmes', to: '/programmes' }, { label: p.name, to: `/programmes/${p.id}` }, { label: orgName }]}
        description={`Programme oversight for ${p.name}. Only this programme’s activities and transactions are shown.`} meta={role !== 'owner' ? <ParticipationBadge status={role} /> : undefined} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Verification Attempts" value={s.attempts} icon={<ClipboardList className="h-4 w-4" />} />
        <StatCard label="Allowed" value={s.allowed} tone="emerald" icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Denied" value={s.denied} icon={<XCircle className="h-4 w-4" />} />
        <StatCard label="Pending Review" value={s.pendingReview} tone="violet" icon={<ShieldAlert className="h-4 w-4" />} />
        <StatCard label="Unable to Complete" value={s.unableToComplete} tone="amber" />
      </div>
      <Card className="mt-6">
        <CardHeader title="Programme-linked activities" description="Programme Configuration Status: whether each activity is set up to meet the programme’s mandatory requirements." />
        <DataTable
          rows={activities}
          rowKey={(a) => a.id}
          empty={<p className="px-5 py-6 text-sm text-slate-500">No programme-linked activities yet.</p>}
          columns={[
            { key: 'name', header: 'Activity', cell: (a) => <span className="font-medium text-slate-900">{a.name}</span> },
            { key: 'status', header: 'Status', cell: (a) => <ActivityStatusBadge status={a.status} /> },
            {
              key: 'config', header: 'Programme Configuration Status', cell: (a) => {
                const c = activityConfigurationStatus(state, a, p);
                return (
                  <div>
                    <ConfigurationBadge status={c.status} />
                    {c.checks.length > 0 && <ul className="mt-1 space-y-0.5 text-xs" aria-label={`Configuration checks for ${a.name}`}>{c.checks.map((x) => <li key={x.label} className={x.ok ? 'text-slate-500' : 'text-amber-800'}>{x.ok ? '✓' : '✕'} {x.label}{x.detail ? ` — ${x.detail}` : ''}</li>)}</ul>}
                  </div>
                );
              },
            },
          ]}
        />
      </Card>
      <Card className="mt-6">
        <CardHeader title="Pending programme exceptions" description="Exceptions routed to the programme’s reviewers." />
        <DataTable
          rows={exceptions}
          rowKey={(e) => e.id}
          rowHref={(e) => `/exceptions/${e.id}`}
          empty={<p className="px-5 py-6 text-sm text-slate-500">No programme exceptions.</p>}
          columns={[
            { key: 'id', header: 'Exception', cell: (e) => <span className="font-mono text-xs">{e.id}</span> },
            { key: 'activity', header: 'Activity', cell: (e) => e.activityName },
            { key: 'reason', header: 'Reason', cell: (e) => EXCEPTION_REASON_LABEL[e.reason] },
            { key: 'status', header: 'Status', cell: (e) => <ExceptionStatusBadge status={e.status} /> },
          ]}
        />
      </Card>
      <Card className="mt-6">
        <CardHeader title="Transaction summaries" description="Programme-linked transactions without personal details: no names, references or identity attributes." />
        <DataTable
          rows={tx}
          rowKey={(a) => a.id}
          empty={<p className="px-5 py-6 text-sm text-slate-500">No verifications yet.</p>}
          columns={[
            { key: 'at', header: 'Date & time', cell: (a) => <span className="tabular-nums text-slate-600">{formatDateTime(a.completedAt ?? a.startedAt)}</span> },
            { key: 'ref', header: 'Transaction', cell: (a) => <span className="font-mono text-xs">{a.id}</span> },
            { key: 'activity', header: 'Activity', cell: (a) => a.activityName },
            { key: 'decision', header: 'Current Decision', cell: (a) => <DecisionBadge decision={a.status === 'completed' ? currentDecision(a, a.exceptionId ? exceptionFor(state, a.exceptionId) : undefined) : undefined} /> },
            { key: 'status', header: 'Status', cell: (a) => <StageBadge attempt={a} /> },
          ]}
        />
      </Card>
    </>
  );
}
