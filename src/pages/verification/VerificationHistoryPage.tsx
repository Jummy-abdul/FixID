import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, FlaskConical, Repeat, X } from 'lucide-react';
import { DecisionBadge, EligibilityStatusBadge, LivenessBadge, MatchBadge, SimulatedBadge, StageBadge, lookupLabel, sourceName } from '@/components/verification/transactionParts';
import { useAuthorization } from '@/auth/authorization';
import { DEMO_AUTH_ENABLED } from '@/auth/authCore';
import { DECISION_LABEL, ELIGIBILITY_STATUS_LABEL, MATCH_LABEL, STAGE_LABEL, stageOf } from '@/domain/transactions';
import { currentDecision, exceptionFor } from '@/store/exceptionOps';
import type { ActivityDecision } from '@/domain/programmes';
import { Badge, Card, DataTable, EmptyState, FilterSelect, PageHeader, Pagination, SearchInput, usePageSlice, type Column } from '@/components/ui';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { ResultBadge } from '@/components/domain/StatusBadges';
import { AccessAndEntry, AccessBadge, EligibilityBadge, EntryBadge, IdentityResultBadge, LocationBadge } from '@/components/verification/attemptParts';
import { rangeStart, type TimeRange } from '@/domain/metrics';
import type { Transaction, VerificationAttempt, VerificationOutcome } from '@/domain/types';
import { OUTCOME_LABEL, checkById, providersFor } from '@/domain/verification';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDateTime } from '@/lib/dates';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { RESOLUTION_LABEL } from '@/domain/exceptions';
import { AttemptBadge } from '@/components/verification/attemptParts';
import { TransactionDetailPage } from '../TransactionDetailPage';
import { activityPath } from './paths';

const PAGE_SIZE = 20;

/**
 * One row of Verification History. Engine attempts and earlier sample verification records are read
 * through this adapter; neither is copied or converted in storage.
 */
interface HistoryRow {
  id: string;
  at: string;
  activityId: string;
  activityName: string;
  activityHref?: string;
  memberId?: string;
  subject: string;
  verifier: string;
  organization: string;
  source: string;
  sourceKey: 'local' | 'external';
  identity: ReactNode;
  eligibility: ReactNode;
  decision: ReactNode;
  decisionKey?: ActivityDecision;
  programmeId?: string;
  matchKey?: string;
  eligibilityKey?: string;
  stageKey: string;
  simulated: boolean;
  status: ReactNode;
  outcome: ReactNode;
  outcomeKey?: VerificationOutcome;
  access: ReactNode;
  location: ReactNode;
  entry: ReactNode;
  entered: boolean;
  search: string;
}

function fromAttempt(a: VerificationAttempt, organization = '', current: ActivityDecision | undefined = a.reviewDisposition?.decision ?? a.decision): HistoryRow {
  return {
    id: a.id, at: a.completedAt ?? a.startedAt, activityId: a.activityId, activityName: a.activityName, activityHref: activityPath(a.activityId),
    memberId: a.subject?.memberId, subject: a.subject?.label ?? 'Not identified', verifier: a.verifierName, organization,
    source: sourceName(a), sourceKey: a.identitySource === 'external' ? 'external' : 'local',
    // Transactions record identity match and eligibility separately; earlier records show their identity and eligibility results.
    identity: a.match ? <MatchBadge status={a.match.status} /> : <IdentityResultBadge attempt={a} />,
    eligibility: a.eligibilityStatus ? <EligibilityStatusBadge status={a.eligibilityStatus} /> : <EligibilityBadge attempt={a} />,
    // The current disposition (after any review); the original decision stays on the transaction.
    decision: <span className="inline-flex items-center gap-1"><DecisionBadge decision={a.status === 'completed' ? current : undefined} />{a.reviewDisposition && <span className="text-xs text-slate-500">Reviewed</span>}{a.reusedFrom && <Repeat className="h-3.5 w-3.5 text-sky-600" aria-label="Reused identity result" />}{a.simulated && <FlaskConical className="h-3.5 w-3.5 text-amber-600" aria-label="Used simulated services" />}</span>,
    decisionKey: a.status === 'completed' ? current : undefined, status: <StageBadge attempt={a} />,
    programmeId: a.programmeId, matchKey: a.match?.status, eligibilityKey: a.eligibilityStatus, stageKey: stageOf(a), simulated: a.simulated,
    outcome: <span className="inline-flex items-center gap-1"><AttemptBadge attempt={a} />{a.simulated && <FlaskConical className="h-3.5 w-3.5 text-amber-600" aria-label="Used simulated providers" />}</span>,
    outcomeKey: a.status === 'completed' ? a.outcome : undefined,
    access: <AccessBadge attempt={a} />, location: <LocationBadge attempt={a} />, entry: <EntryBadge attempt={a} />, entered: a.entry?.status === 'entered',
    search: [a.id, a.activityName, a.subject?.label, a.verifierName, a.lookup?.reference, a.serviceName, ...a.reasons].join(' ').toLowerCase(),
  };
}

// Earlier records kept a verification result and an allow/deny decision; shown in today's vocabulary.
const LEGACY_OUTCOME = { allow: 'verified', deny: 'not-verified', indeterminate: 'unable-to-verify' } as const;
const LEGACY_ACCESS = { allow: 'permitted', deny: 'not-permitted', indeterminate: 'review-required' } as const;
const LEGACY_DECISION = { allow: 'allow', deny: 'deny', indeterminate: 'unable-to-decide' } as const;

export function AttemptsTable({ rows, hideActivity }: { rows: VerificationAttempt[]; hideActivity?: boolean }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)).map((a) => fromAttempt(a)), [rows]);
  return <HistoryTable rows={sorted} hide={hideActivity ? ['activity', 'organization'] : ['organization']} empty={<EmptyState title="No verifications yet" description="Verifications appear here once a verifier performs this activity." />} />;
}

function HistoryTable({ rows, hide = [], empty }: { rows: HistoryRow[]; hide?: string[]; empty: ReactNode }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const columns: Column<HistoryRow>[] = [
    { key: 'time', header: 'Date & time', cell: (r) => <span className="tabular-nums text-slate-600">{formatDateTime(r.at)}</span> },
    { key: 'reference', header: 'Reference', cell: (r) => <span className="font-mono text-xs text-slate-600">{r.id}</span> },
    { key: 'activity', header: 'Activity', cell: (r) => (r.activityHref ? <Link to={r.activityHref} onClick={stop} className="text-slate-900 hover:text-brand-700">{r.activityName}</Link> : <span className="text-slate-900">{r.activityName}</span>) },
    { key: 'organization', header: 'Organization', cell: (r) => <span className="text-slate-600">{r.organization}</span> },
    { key: 'subject', header: 'Subject', cell: (r) => (r.memberId ? <Link to={`/users/${r.memberId}`} onClick={stop} className="text-slate-900 hover:text-brand-700">{r.subject}</Link> : <span className="text-slate-500">{r.subject}</span>) },
    { key: 'verifier', header: 'Verifier', cell: (r) => r.verifier },
    { key: 'source', header: 'Identity source', cell: (r) => <span className="text-slate-600">{r.source}</span> },
    { key: 'identity', header: 'Identity', cell: (r) => r.identity },
    { key: 'eligibility', header: 'Eligibility', cell: (r) => r.eligibility },
    { key: 'decision', header: 'Decision', cell: (r) => r.decision },
    { key: 'status', header: 'Status', cell: (r) => r.status },
    { key: 'entry', header: 'Entry', cell: (r) => r.entry },
    { key: 'details', header: <span className="sr-only">Details</span>, cell: (r) => <Link to={`/verification-history/${r.id}`} onClick={stop} className="text-sm font-medium text-brand-600 hover:text-brand-700">View<span className="sr-only"> details for {r.id}</span></Link> },
  ];
  return <DataTable columns={columns.filter((c) => !hide.includes(c.key))} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/verification-history/${r.id}`} empty={empty} />;
}

export function VerificationHistoryPage() {
  const { state } = useStore();
  const { organization, transactions, activities, memberById, credentialById } = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [range, setRange] = useQueryState('range', '30d');
  const [outcome, setOutcome] = useQueryState('outcome', 'all');
  const [activity, setActivity] = useQueryState('activity', 'all');
  const [entry, setEntry] = useQueryState('entry', 'all');
  const [decision, setDecision] = useQueryState('decision', 'all');
  const [source, setSource] = useQueryState('source', 'all');
  const [programme, setProgramme] = useQueryState('programme', 'all');
  const [match, setMatch] = useQueryState('match', 'all');
  const [elig, setElig] = useQueryState('eligibility', 'all');
  const [stage, setStage] = useQueryState('status', 'all');
  const [sim, setSim] = useQueryState('simulated', 'all');
  const [person, setPerson] = useQueryState('person', '');
  const [page, setPage] = usePageParam();
  const now = useMemo(() => new Date(), []);

  const attempts = useMemo(() => state.data.verificationAttempts.filter((a) => a.organizationId === organization.id && a.status !== 'in-progress'), [state.data.verificationAttempts, organization.id]);
  const configs = state.data.activityConfigs.filter((a) => a.organizationId === organization.id);
  // Programmes this organization's transactions ran under (by name only).
  const programmes = (state.data.verificationProgrammes ?? []).filter((p) => attempts.some((a) => a.programmeId === p.id));
  const all = useMemo(() => {
    const legacyName = new Map(activities.map((a) => [a.id, a.name]));
    const legacy = (t: Transaction): HistoryRow => {
      const m = t.memberId ? memberById.get(t.memberId) : undefined;
      return {
        id: t.id, at: t.occurredAt, activityId: t.activityId, activityName: legacyName.get(t.activityId) ?? '—', memberId: m?.id, subject: m?.displayName ?? 'Unknown', verifier: t.verifier,
        organization: organization.name, source: 'FixID Local Records', sourceKey: 'local', stageKey: 'completed', simulated: false, decision: <DecisionBadge decision={LEGACY_DECISION[t.decision]} />, decisionKey: LEGACY_DECISION[t.decision],
        status: <StageBadge attempt={{ status: 'completed', outcome: LEGACY_OUTCOME[t.decision] }} />,
        identity: <ResultBadge result={t.result} />, eligibility: <span className="text-slate-400">—</span>,
        outcome: <AttemptBadge attempt={{ status: 'completed', outcome: LEGACY_OUTCOME[t.decision] }} />, outcomeKey: LEGACY_OUTCOME[t.decision],
        access: <AccessBadge attempt={{ accessDecision: LEGACY_ACCESS[t.decision] }} />, location: <span className="text-slate-400">—</span>, entry: <span className="text-slate-400">—</span>, entered: false,
        search: [t.id, t.reason, m?.displayName, t.credentialId && credentialById.get(t.credentialId)?.identifier, legacyName.get(t.activityId)].join(' ').toLowerCase(),
      };
    };
    return [...attempts.map((a) => fromAttempt(a, organization.name, a.status === 'completed' ? currentDecision(a, a.exceptionId ? exceptionFor(state, a.exceptionId) : undefined) : undefined)), ...transactions.map(legacy)].sort((a, b) => b.at.localeCompare(a.at));
  }, [attempts, transactions, activities, memberById, credentialById, organization.name, state]);

  const filtered = useMemo(() => {
    const start = rangeStart(range as TimeRange, now)?.toISOString();
    const query = q.trim().toLowerCase();
    return all.filter((r) =>
      (!start || r.at >= start) &&
      (outcome === 'all' || r.outcomeKey === outcome) &&
      (decision === 'all' || r.decisionKey === decision) &&
      (source === 'all' || r.sourceKey === source) &&
      (programme === 'all' || (programme === 'none' ? !r.programmeId : r.programmeId === programme)) &&
      (match === 'all' || r.matchKey === match) &&
      (elig === 'all' || r.eligibilityKey === elig) &&
      (stage === 'all' || r.stageKey === stage) &&
      (sim === 'all' || (sim === 'yes') === r.simulated) &&
      (activity === 'all' || r.activityId === activity) &&
      (entry === 'all' || (entry === 'entered') === r.entered) &&
      (!person || r.memberId === person) &&
      (!query || r.search.includes(query)));
  }, [all, range, outcome, decision, source, programme, match, elig, stage, sim, activity, entry, person, q, now]);

  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const personName = person ? memberById.get(person)?.displayName : null;
  const activityOptions = [...configs.map((a) => ({ value: a.id, label: a.name })), ...activities.map((a) => ({ value: a.id, label: a.name }))];

  return (
    <>
      <PageHeader
        title="Verification History"
        description="Every verification: what was checked, the outcome, the access decision, and whether entry was recorded."
        actions={(
          <div className="flex flex-wrap gap-2">
            {DEMO_AUTH_ENABLED && <Link to="/developer/status-api" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-300 hover:bg-amber-50"><FlaskConical className="h-4 w-4" aria-hidden="true" />Status API (simulated)</Link>}
            <PlannedButton icon={<Download className="h-4 w-4" />} info={PLANNED.export}>Export CSV</PlannedButton>
          </div>
        )}
      />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search reference, person, verifier or reason" className="sm:w-72" />
          <FilterSelect label="Time range" value={range} onChange={setRange}
            options={[{ value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'all', label: 'All time' }]} />
          <FilterSelect label="Activity" value={activity} onChange={setActivity} options={[{ value: 'all', label: 'All activities' }, ...activityOptions]} />
          <FilterSelect label="Outcome" value={outcome} onChange={setOutcome}
            options={[{ value: 'all', label: 'All outcomes' }, ...(Object.keys(OUTCOME_LABEL) as VerificationOutcome[]).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))]} />
          <FilterSelect label="Decision" value={decision} onChange={setDecision}
            options={[{ value: 'all', label: 'All decisions' }, ...(Object.keys(DECISION_LABEL) as ActivityDecision[]).map((d) => ({ value: d, label: DECISION_LABEL[d] }))]} />
          <FilterSelect label="Identity source" value={source} onChange={setSource}
            options={[{ value: 'all', label: 'All identity sources' }, { value: 'local', label: 'FixID Local Records' }, { value: 'external', label: 'External identity services' }]} />
          {programmes.length > 0 && <FilterSelect label="Programme" value={programme} onChange={setProgramme} options={[{ value: 'all', label: 'All programmes' }, { value: 'none', label: 'No programme' }, ...programmes.map((p) => ({ value: p.id, label: p.name }))]} />}
          <FilterSelect label="Identity match" value={match} onChange={setMatch} options={[{ value: 'all', label: 'Any identity match' }, ...(Object.keys(MATCH_LABEL) as (keyof typeof MATCH_LABEL)[]).map((k) => ({ value: k, label: MATCH_LABEL[k] }))]} />
          <FilterSelect label="Eligibility" value={elig} onChange={setElig} options={[{ value: 'all', label: 'Any eligibility' }, ...(Object.keys(ELIGIBILITY_STATUS_LABEL) as (keyof typeof ELIGIBILITY_STATUS_LABEL)[]).map((k) => ({ value: k, label: ELIGIBILITY_STATUS_LABEL[k] }))]} />
          <FilterSelect label="Transaction status" value={stage} onChange={setStage} options={[{ value: 'all', label: 'Any status' }, ...(['completed', 'pending-review', 'failed', 'unable-to-complete', 'cancelled'] as const).map((k) => ({ value: k, label: STAGE_LABEL[k] }))]} />
          <FilterSelect label="Simulation" value={sim} onChange={setSim} options={[{ value: 'all', label: 'Simulated or not' }, { value: 'yes', label: 'Simulated' }, { value: 'no', label: 'Not simulated' }]} />
          <FilterSelect label="Entry" value={entry} onChange={setEntry}
            options={[{ value: 'all', label: 'Any entry status' }, { value: 'entered', label: 'Entered' }, { value: 'not-entered', label: 'Not entered' }]} />
          {personName && (
            <Badge tone="brand" className="py-1">
              Person: {personName}
              <button type="button" onClick={() => setPerson('')} aria-label="Remove person filter"><X className="h-3 w-3" /></button>
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-6 border-b border-slate-100 bg-slate-50/50 px-4 py-2.5 text-sm text-slate-600">
          <span><span className="font-semibold tabular-nums text-slate-900">{filtered.length.toLocaleString()}</span> verifications</span>
          <span><span className="font-semibold tabular-nums text-slate-900">{filtered.filter((r) => r.outcomeKey === 'verified').length.toLocaleString()}</span> verified</span>
          <span><span className="font-semibold tabular-nums text-slate-900">{filtered.filter((r) => r.entered).length.toLocaleString()}</span> {filtered.filter((r) => r.entered).length === 1 ? 'entry' : 'entries'} recorded</span>
        </div>
        <HistoryTable rows={pageRows} empty={<EmptyState title="No verifications match" description="Try widening the time range or clearing filters." />} />
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
    </>
  );
}

/** Detail for a history row: engine attempts get the full record; earlier records keep their own view. */
export function VerificationRecordPage() {
  const { recordId } = useParams();
  const { state } = useStore();
  const { organization } = useSession();
  const { recordAccessDenied } = useActions();
  const attempt = state.data.verificationAttempts.find((a) => a.id === recordId && a.organizationId === organization.id);
  // Another organization's transaction is never shown; the refused attempt is audited.
  const elsewhere = !attempt && state.data.verificationAttempts.some((a) => a.id === recordId);
  useEffect(() => { if (elsewhere && recordId) recordAccessDenied(organization.id, 'verification-transaction', recordId); }, [elsewhere, recordId, organization.id, recordAccessDenied]);
  return attempt ? <AttemptDetail attempt={attempt} /> : <TransactionDetailPage />;
}

function AttemptDetail({ attempt }: { attempt: VerificationAttempt }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const providers = providersFor(organization);
  const programme = attempt.programmeId ? state.data.verificationProgrammes.find((p) => p.id === attempt.programmeId) : undefined;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Verification History', to: '/verification-history' }, { label: attempt.id }]}
        title={<span className="font-mono">{attempt.id}</span>}
        description={`${attempt.activityName} · ${formatDateTime(attempt.completedAt ?? attempt.startedAt)}`}
        meta={<AttemptBadge attempt={attempt} />}
      />
      {attempt.simulated && (
        <p className="mb-4 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-300">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Some checks used simulated providers. This result isn’t real identity or credential assurance.
        </p>
      )}
      <div className="space-y-6">
        <Card className="px-5 py-5">
          <h2 className="text-sm font-semibold text-slate-900">Verification outcome</h2>
          <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-500">Overall outcome</dt><dd className="mt-0.5"><AttemptBadge attempt={attempt} /></dd></div>
            <div><dt className="text-slate-500">Identity and credential</dt><dd className="mt-0.5"><IdentityResultBadge attempt={attempt} /></dd></div>
            <div><dt className="text-slate-500">Eligibility</dt><dd className="mt-0.5"><EligibilityBadge attempt={attempt} /></dd></div>
          </dl>
          {attempt.reasons.length > 0 && <ul className="mt-4 list-disc space-y-0.5 pl-5 text-sm text-slate-600" aria-label="Reasons">{attempt.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          {attempt.review && <p className="mt-4 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">Pending review since {formatDateTime(attempt.review.referredAt)} ({attempt.review.referredBy}): {attempt.review.reason}</p>}
        </Card>
        <TransactionDetails attempt={attempt} programmeName={programme?.name} />
        {attempt.diagnostics?.length && can('audit.view') ? (
          <Card className="px-5 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Diagnostics (protected)</h2>
            <p className="mt-0.5 text-xs text-slate-500">Technical details for administrators. They never include credentials, raw payloads or biometric data.</p>
            <ul className="mt-3 space-y-1 text-sm text-slate-700" aria-label="Diagnostics">
              {attempt.diagnostics.map((d) => <li key={`${d.at}${d.step}`}><span className="text-slate-500">{formatDateTime(d.at)} · {d.step}:</span> {d.message}</li>)}
            </ul>
          </Card>
        ) : null}
        {attempt.identitySource !== 'external' && <AccessAndEntry attempt={attempt} />}
        <Card className="px-5 py-5">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Activity</dt><dd><Link to={activityPath(attempt.activityId)} className="font-medium text-brand-700 hover:underline">{attempt.activityName}</Link></dd></div>
            <div><dt className="text-slate-500">Configuration version</dt><dd className="text-slate-900">Version {attempt.versionNumber}</dd></div>
            <div><dt className="text-slate-500">Subject</dt><dd className="text-slate-900">{attempt.subject?.memberId ? <Link to={`/users/${attempt.subject.memberId}`} className="text-brand-700 hover:underline">{attempt.subject.label}</Link> : attempt.subject?.label ?? 'Not identified'}</dd></div>
            <div><dt className="text-slate-500">Verifier</dt><dd className="text-slate-900">{attempt.verifierName}</dd></div>
            <div><dt className="text-slate-500">Application</dt><dd className="text-slate-900">{attempt.client.name}</dd></div>
            <div><dt className="text-slate-500">Started</dt><dd className="text-slate-900">{formatDateTime(attempt.startedAt)}</dd></div>
          </dl>
        </Card>
        <Card>
          <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">Checks</h2>
          <ul className="divide-y divide-slate-100" aria-label="Checks">
            {attempt.checks.map((c) => (
              <li key={c.checkId} className="px-5 py-3 text-sm">
                <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  {checkById(c.type).name}<Badge tone={c.status === 'passed' ? 'success' : c.status === 'failed' ? 'danger' : c.status === 'skipped' ? 'neutral' : 'warning'}>{c.status}</Badge>
                  {c.simulated && <Badge tone="warning"><FlaskConical className="h-3 w-3" aria-hidden="true" />Simulated</Badge>}
                </span>
                <span className="block text-slate-600">{c.explanation}</span>
                <span className="block text-xs text-slate-500">Provider: {providers.find((p) => p.id === c.providerId)?.name ?? '—'}{c.evidenceRef ? ` · Evidence reference: ${c.evidenceRef}` : ''}</span>
              </li>
            ))}
            {attempt.checks.length === 0 && <li className="px-5 py-3 text-sm text-slate-500">No checks were run.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}

/**
 * The transaction record, read-only: identity source, the permitted reference, each step's result, the
 * decision and why. Never raw biometric data. Ready for the review and audit tools of a later phase.
 */
function TransactionDetails({ attempt: a, programmeName }: { attempt: VerificationAttempt; programmeName?: string }) {
  const row = (label: string, value: ReactNode) => <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-900">{value}</dd></div>;
  return (
    <Card className="px-5 py-5">
      <h2 className="text-sm font-semibold text-slate-900">Verification transaction</h2>
      <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Verification transaction">
        {row('Transaction Reference', <span className="font-mono text-xs">{a.id}</span>)}
        {row('Status', <StageBadge attempt={a} />)}
        {row('Identity Source', sourceName(a))}
        {programmeName && row('Programme', programmeName)}
        {a.lookup && row('External Reference ID', <><span className="font-mono">{a.lookup.reference.toUpperCase()}</span><span className="block text-xs text-slate-500">Lookup: {lookupLabel(a)}{a.lookup.count > 1 ? ` (${a.lookup.count} lookups)` : ''}</span></>)}
        {a.lookup?.status === 'FOUND' && a.lookup.attributes && Object.keys(a.lookup.attributes).length > 0 && row('Permitted attributes returned', Object.entries(a.lookup.attributes).map(([k, v]) => `${k}: ${v}`).join(' · '))}
        {a.liveness && row('Liveness', <><LivenessBadge status={a.liveness.status} />{a.liveness.simulated && <span className="ml-1"><SimulatedBadge /></span>}</>)}
        {a.match && row('Identity Match', <>
          <MatchBadge status={a.match.status} />{a.match.simulated && a.match.status !== 'not-evaluated' && <span className="ml-1"><SimulatedBadge /></span>}
          {a.match.service && <span className="block text-xs text-slate-500">Matching service: {a.match.service}</span>}
          {a.match.providerTransactionId && <span className="block text-xs text-slate-500">Provider transaction: <span className="font-mono">{a.match.providerTransactionId}</span></span>}
          {a.match.score !== undefined && a.match.scoreScale && <span className="block text-xs text-slate-500">Score {a.match.score} (scale {a.match.scoreScale}{a.match.threshold !== undefined ? `, service threshold ${a.match.threshold}` : ''}), as reported by this service. Not comparable with other services.</span>}
        </>)}
        {a.eligibilityStatus && row('Eligibility', <><EligibilityStatusBadge status={a.eligibilityStatus} />{a.eligibilityExplanation && <span className="block text-xs text-slate-500">{a.eligibilityExplanation}</span>}</>)}
        {row('Activity Decision', <><DecisionBadge decision={a.decision} />{a.decisionExplanation && <span className="block text-xs text-slate-500">{a.decisionExplanation}</span>}</>)}
        {a.failureReason && row('Failure or exception reason', a.failureReason)}
        {a.exceptionId && row('Exception', <Link to={`/exceptions/${a.exceptionId}`} className="font-mono text-brand-700 hover:underline">{a.exceptionId}</Link>)}
        {a.reviewDisposition && row('Current disposition (after review)', <><DecisionBadge decision={a.reviewDisposition.decision} /><span className="block text-xs text-slate-500">{RESOLUTION_LABEL[a.reviewDisposition.outcome]} · {a.reviewDisposition.by} · {formatDateTime(a.reviewDisposition.at)}. The original decision above is unchanged.</span></>)}
        {a.reverificationOf && row('Reverification for exception', <Link to={`/exceptions/${a.reverificationOf}`} className="font-mono text-brand-700 hover:underline">{a.reverificationOf}</Link>)}
        {a.reusedFrom && row('Reused result from', <Link to={`/verification-history/${a.reusedFrom}`} className="font-mono text-brand-700 hover:underline">{a.reusedFrom}</Link>)}
        {a.retryOf && row('Retry of', <Link to={`/verification-history/${a.retryOf}`} className="font-mono text-brand-700 hover:underline">{a.retryOf}</Link>)}
        {row('Simulation', a.simulated ? <SimulatedBadge label="Simulated result" /> : 'No simulated services were used')}
        {row('Created', formatDateTime(a.startedAt))}
        {a.completedAt && row('Completed', formatDateTime(a.completedAt))}
      </dl>
      <p className="mt-3 text-xs text-slate-500">No raw biometric images or templates are kept in the transaction. Captures were used once and discarded.</p>
    </Card>
  );
}
