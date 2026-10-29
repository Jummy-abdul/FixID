import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, CheckCircle2, ClipboardList, FlaskConical, ListChecks, ShieldAlert, XCircle } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, FilterSelect, StatCard } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { DecisionBadge, sourceName } from '@/components/verification/transactionParts';
import { EXCEPTION_REASON_LABEL, isUnresolved } from '@/domain/exceptions';
import { formatDateTime } from '@/lib/dates';
import { currentDecision, exceptionFor, exceptionsVisibleTo } from '@/store/exceptionOps';
import { integrationsOf } from '@/store/integrationOps';
import { participation, sharedWith } from '@/store/sharingOps';
import { organizationTransactions, sharedResults, summarize } from '@/store/reporting';
import { useSession, useStore } from '@/store/AppStore';
import { useVerificationService } from '@/verification/useVerificationService';
import { ExceptionStatusBadge } from '../exceptions/ExceptionsPage';

const PERIODS = { '7d': 7, '30d': 30, all: 0 } as const;

/**
 * Verification operations for the current workspace, from its stored transactions and exceptions: what
 * happened, what needs review, and whether activities and identity services are working. Read-only; each
 * section appears only with the permission to see it. Shared activities it owns, and those it takes part in, are listed too.
 */
export function VerificationOperations() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const service = useVerificationService();
  const [period, setPeriod] = useState<keyof typeof PERIODS>('30d');
  const from = useMemo(() => (PERIODS[period] ? new Date(Date.now() - PERIODS[period] * 86_400_000).toISOString() : undefined), [period]);
  const showResults = can('verification.results.view');
  const showExceptions = can('exceptions.view') || can('exceptions.review');
  if (!showResults && !showExceptions && !can('verification.activities.view')) return null;

  const tx = organizationTransactions(state, organization.id, { from });
  const s = summarize(state, tx);
  const activities = state.data.activityConfigs.filter((a) => a.organizationId === organization.id);
  const recent = [...tx].sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)).slice(0, 5);
  const exceptions = showExceptions ? exceptionsVisibleTo(state, organization.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  const integrations = integrationsOf(state, organization.id);
  const faceMode = service.faceMode(organization.id);
  const canSeeActivities = can('verification.activities.view');
  const owned = canSeeActivities ? activities.filter((a) => a.sharing && a.status !== 'draft') : [];
  const joined = canSeeActivities ? sharedWith(state, organization.id) : [];
  const invited = joined.filter((a) => participation(a, organization.id) === 'invited');
  const ownerName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? 'Another organization';

  return (
    <section aria-label="Verification operations" className="mt-8 space-y-6">
      {/* Waiting invitations come first: nothing can be verified for them until someone accepts. */}
      {invited.length > 0 && (
        <Link to="/verification-activities?view=invited" className="flex items-center gap-3 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200 hover:bg-sky-100">
          <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{invited.length === 1 ? `${ownerName(invited[0].organizationId)} invited you to ${invited[0].name}.` : `${invited.length} activity invitations are waiting.`}</span>
          <span className="font-semibold">Review</span>
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Verification</h2>
        </div>
        <FilterSelect label="Period" value={period} onChange={(v) => setPeriod(v as keyof typeof PERIODS)} options={[{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'all', label: 'All time' }]} />
      </div>
      {showResults && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Active activities" value={activities.filter((a) => a.status === 'active').length} icon={<ListChecks className="h-4 w-4" />} to="/verification-activities" />
          <StatCard label="Total attempts" value={s.attempts} icon={<ClipboardList className="h-4 w-4" />} to="/verification-history" hint={s.incomplete ? `${s.incomplete} incomplete` : undefined} />
          <StatCard label="Verified" value={s.allowed} tone="emerald" icon={<CheckCircle2 className="h-4 w-4" />} to="/verification-history?result=successful" />
          <StatCard label="Not verified" value={s.denied} icon={<XCircle className="h-4 w-4" />} to="/verification-history?result=unsuccessful" />
          <StatCard label="Pending review" value={s.pendingReview} tone="violet" icon={<ShieldAlert className="h-4 w-4" />} to={showExceptions ? '/exceptions?status=unresolved' : undefined} />
          <StatCard label="Unable to verify" value={s.unableToComplete} tone="amber" to="/verification-history?result=incomplete" />
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        {showResults && (
          <Card>
            <CardHeader title="Recent verification transactions" action={<Link to="/verification-history" className="text-sm font-medium text-brand-600 hover:text-brand-700">View history</Link>} />
            {recent.length === 0 ? <EmptyState title="No verifications in this period" /> : (
              <ul className="divide-y divide-slate-100" aria-label="Recent verification transactions">
                {recent.map((a) => (
                  <li key={a.id}>
                    <Link to={`/verification-history/${a.id}`} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm hover:bg-slate-50">
                      <span className="min-w-0 flex-1"><span className="block font-medium text-slate-900">{a.activityName}</span><span className="block text-xs text-slate-500">{a.id} · {sourceName(a)} · {formatDateTime(a.completedAt ?? a.startedAt)}</span></span>
                      {a.simulated && <FlaskConical className="h-3.5 w-3.5 text-amber-600" aria-label="Simulated" />}
                      {a.status === 'completed' ? <DecisionBadge decision={currentDecision(a, a.exceptionId ? exceptionFor(state, a.exceptionId) : undefined)} /> : <Badge>{a.status}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {showExceptions && (
          <Card>
            <CardHeader title="Recent exceptions" description={`${exceptions.filter(isUnresolved).length} unresolved`} action={<Link to="/exceptions" className="text-sm font-medium text-brand-600 hover:text-brand-700">View exceptions</Link>} />
            {exceptions.length === 0 ? <EmptyState title="No exceptions" description="Verifications needing review appear here." /> : (
              <ul className="divide-y divide-slate-100" aria-label="Recent exceptions">
                {exceptions.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    <Link to={`/exceptions/${e.id}`} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm hover:bg-slate-50">
                      <span className="min-w-0 flex-1"><span className="block font-medium text-slate-900">{EXCEPTION_REASON_LABEL[e.reason]}</span><span className="block text-xs text-slate-500">{e.id} · {e.activityName}{e.organizationId !== organization.id ? ` · ${state.data.organizations.find((o) => o.id === e.organizationId)?.name}` : ''}</span></span>
                      <ExceptionStatusBadge status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {showResults && (
          <Card>
            <CardHeader title="Identity service status" />
            <ul className="divide-y divide-slate-100 text-sm" aria-label="Identity service status">
              <li className="flex items-center gap-2 px-5 py-2.5"><span className="flex-1 text-slate-900">FixID facial verification (local)</span>
                <Badge tone={faceMode === 'configured' ? 'success' : faceMode === 'simulated' ? 'warning' : 'neutral'}>{faceMode === 'configured' ? 'Available' : faceMode === 'simulated' ? 'Simulated' : 'Not configured'}</Badge></li>
              {integrations.map((i) => (
                <li key={i.id} className="flex items-center gap-2 px-5 py-2.5"><span className="flex-1 text-slate-900">{i.name}{i.connection.target === 'simulated' ? ' (simulated)' : ''}</span>
                  <Badge tone={i.status === 'active' ? 'success' : i.status === 'error' ? 'danger' : 'neutral'}>{i.status === 'active' ? 'Active' : i.status === 'error' ? 'Error' : i.status === 'inactive' ? 'Inactive' : i.status === 'testing' ? 'Testing' : 'Draft'}</Badge></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {(owned.length > 0 || joined.length > 0) && (
        <Card>
          <CardHeader title="Shared activities" />
          <ul className="divide-y divide-slate-100" aria-label="Shared activities">
            {owned.map((a) => {
              const o = sharedResults(state, a);
              return (
                <li key={a.id}>
                  <Link to={`/verification-activities/${a.id}?tab=organizations`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                    <Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1 font-medium text-slate-900">{a.name} <span className="font-normal text-slate-500">· yours</span></span>
                    <span className="text-slate-600">{o.participating} organizations taking part · {o.summary.attempts} verifications · {o.exceptions.unresolved} open exceptions</span>
                  </Link>
                </li>
              );
            })}
            {joined.map((a) => {
              const st = participation(a, organization.id);
              return (
                <li key={a.id}>
                  <Link to={`/verification-activities/${a.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                    <Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1 font-medium text-slate-900">{a.name} <span className="font-normal text-slate-500">· from {ownerName(a.organizationId)}</span></span>
                    <Badge tone={st === 'invited' ? 'info' : st === 'active' ? 'success' : 'warning'}>{st === 'invited' ? 'Invited' : st === 'active' ? 'Accepted' : 'Suspended'}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}
