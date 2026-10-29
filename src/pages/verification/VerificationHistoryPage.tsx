import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FlaskConical, Repeat, X } from 'lucide-react';
import { DecisionBadge, EligibilityStatusBadge, LivenessBadge, MatchBadge, SimulatedBadge, StageBadge, lookupLabel, sourceName } from '@/components/verification/transactionParts';
import { useAuthorization } from '@/auth/authorization';
import { DEMO_AUTH_ENABLED } from '@/auth/authCore';
import { stageOf } from '@/domain/transactions';
import { attemptSubject, exceptionFor, exceptionsVisibleTo } from '@/store/exceptionOps';
import type { ActivityDecision } from '@/domain/activitySettings';
import { Badge, Button, Card, DataTable, EmptyState, FilterSelect, Input, PageHeader, Pagination, SearchInput, StatCard, usePageSlice, type Column } from '@/components/ui';
import { AccessAndEntry, AccessBadge, EligibilityBadge, EntryBadge, IdentityResultBadge, LocationBadge } from '@/components/verification/attemptParts';
import { rangeStart, type TimeRange } from '@/domain/metrics';
import type { VerificationAttempt, VerificationOutcome } from '@/domain/types';
import { checkById, providersFor } from '@/domain/verification';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDateTime } from '@/lib/dates';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { EXCEPTION_REASON_LABEL, EXCEPTION_STATUS_LABEL, RESOLUTION_LABEL, type ExceptionStatus, type VerificationException } from '@/domain/exceptions';
import { ORIGINAL_RESULT_LABEL, REVIEW_FILTER_LABEL, legacyResult, originalResultOf, reviewOutcomeOf, type OriginalResult } from '@/domain/history';
import { ExceptionStatusBadge } from '../exceptions/ExceptionsPage';
import { AttemptBadge } from '@/components/verification/attemptParts';
import { TransactionDetailPage } from '../TransactionDetailPage';
import { activityPath } from './paths';
import { scheduleSummary } from '@/domain/activityLifecycle';

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
  /** The organization that performed it (shared activities can be performed by participating organizations). */
  performedBy?: string;
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
    decision: <span className="inline-flex items-center gap-1">{a.status === 'completed' ? <DecisionBadge decision={current} /> : a.status === 'in-progress' || a.status === 'expired' ? <StageBadge attempt={a} /> : <DecisionBadge />}{a.reviewDisposition && <span className="text-xs text-slate-500">Reviewed</span>}{a.reusedFrom && <Repeat className="h-3.5 w-3.5 text-sky-600" aria-label="Reused identity result" />}{a.simulated && <FlaskConical className="h-3.5 w-3.5 text-amber-600" aria-label="Used simulated services" />}</span>,
    decisionKey: a.status === 'completed' ? current : undefined, status: <StageBadge attempt={a} />,
    performedBy: a.organizationId, matchKey: a.match?.status, eligibilityKey: a.eligibilityStatus, stageKey: stageOf(a), simulated: a.simulated,
    outcome: <span className="inline-flex items-center gap-1"><AttemptBadge attempt={a} />{a.simulated && <FlaskConical className="h-3.5 w-3.5 text-amber-600" aria-label="Used simulated providers" />}</span>,
    outcomeKey: a.status === 'completed' ? a.outcome : undefined,
    access: <AccessBadge attempt={a} />, location: <LocationBadge attempt={a} />, entry: <EntryBadge attempt={a} />, entered: a.entry?.status === 'entered',
    search: [a.id, a.activityName, a.subject?.label, a.verifierName, a.lookup?.reference, a.serviceName, ...a.reasons].join(' ').toLowerCase(),
  };
}

export function AttemptsTable({ rows, hideActivity, orgName, hideColumns = [] }: { rows: VerificationAttempt[]; hideActivity?: boolean; orgName?: (id: string) => string; hideColumns?: string[] }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)).map((a) => fromAttempt(a, orgName?.(a.organizationId) ?? '')), [rows, orgName]);
  const hide = [...(hideActivity ? ['activity'] : []), ...(orgName ? [] : ['organization']), ...hideColumns];
  return <HistoryTable rows={sorted} hide={hide} empty={<EmptyState title="No verifications yet" />} />;
}

function HistoryTable({ rows, hide = [], empty }: { rows: HistoryRow[]; hide?: string[]; empty: ReactNode }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const columns: Column<HistoryRow>[] = [
    { key: 'time', header: 'Date & time', cell: (r) => <span className="tabular-nums text-slate-600">{formatDateTime(r.at)}</span> },
    { key: 'reference', header: 'Reference', cell: (r) => <span className="font-mono text-xs text-slate-600">{r.id}</span> },
    { key: 'activity', header: 'Activity', cell: (r) => (r.activityHref ? <Link to={r.activityHref} onClick={stop} className="text-slate-900 hover:text-brand-700">{r.activityName}</Link> : <span className="text-slate-900">{r.activityName}</span>) },
    { key: 'organization', header: 'Organization', cell: (r) => <span className="text-slate-600">{r.organization}</span> },
    { key: 'subject', header: 'Person', cell: (r) => (r.memberId ? <Link to={`/users/${r.memberId}`} onClick={stop} className="text-slate-900 hover:text-brand-700">{r.subject}</Link> : <span className="text-slate-500">{r.subject}</span>) },
    { key: 'verifier', header: 'Verifier', cell: (r) => r.verifier },
    { key: 'source', header: 'Identity source', cell: (r) => <span className="text-slate-600">{r.source}</span> },
    { key: 'identity', header: 'Identity', cell: (r) => r.identity },
    { key: 'eligibility', header: 'Eligibility', cell: (r) => r.eligibility },
    { key: 'decision', header: 'Outcome', cell: (r) => r.decision },
    { key: 'status', header: 'Status', cell: (r) => r.status },
    { key: 'entry', header: 'Entry', cell: (r) => r.entry },
    { key: 'details', header: <span className="sr-only">Details</span>, cell: (r) => <Link to={`/verification-history/${r.id}`} onClick={stop} className="text-sm font-medium text-brand-600 hover:text-brand-700">View<span className="sr-only"> details for {r.id}</span></Link> },
  ];
  return <DataTable columns={columns.filter((c) => !hide.includes(c.key))} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/verification-history/${r.id}`} empty={empty} />;
}

/** One attempt in the global history: the original result, and the linked review (never a second record). */
interface GlobalRow {
  id: string;
  at: string;
  activityId: string;
  activityName: string;
  /** Activity configuration that can be opened (engine activities only). */
  activityHref?: string;
  memberId?: string;
  participant: string;
  identifier: string;
  verifier: string;
  organizationId: string;
  result: OriginalResult;
  explanation?: string;
  review: ReturnType<typeof reviewOutcomeOf>;
  exception?: VerificationException;
  search: string;
}

const RESULT_TONE: Record<OriginalResult, 'success' | 'danger' | 'warning' | 'brand'> = { successful: 'success', unsuccessful: 'danger', incomplete: 'warning', review: 'brand' };
export const OriginalResultBadge = ({ result }: { result: OriginalResult }) => <Badge tone={RESULT_TONE[result]} dot>{ORIGINAL_RESULT_LABEL[result]}</Badge>;
// Older links (dashboard, scenarios) used decision and status filters; they map onto the original result.
const LEGACY_PARAM: Record<string, OriginalResult> = { allow: 'successful', deny: 'unsuccessful', 'unable-to-decide': 'incomplete', 'unable-to-complete': 'incomplete', 'pending-review': 'review' };

/**
 * Verification History: every completed attempt the organization may see (its own, and those participating
 * organizations performed for its shared activities), one row per attempt. A record of what happened, never a
 * place to verify, review or approve.
 */
export function VerificationHistoryPage() {
  const { can } = useAuthorization();
  const { state } = useStore();
  const { organization, transactions, activities, memberById } = useOrgData();
  const [q, setQ] = useQueryState('q');
  const [range, setRange] = useQueryState('range', '30d');
  const [from, setFrom] = useQueryState('from');
  const [to, setTo] = useQueryState('to');
  const [legacyDecision, setLegacyDecision] = useQueryState('decision', '');
  const [legacyStatus, setLegacyStatus] = useQueryState('status', '');
  const [result, setResult] = useQueryState('result', LEGACY_PARAM[legacyDecision] ?? LEGACY_PARAM[legacyStatus] ?? 'all');
  const [review, setReview] = useQueryState('review', 'all');
  const [exc, setExc] = useQueryState('exception', 'all');
  const [activity, setActivity] = useQueryState('activity', 'all');
  const [verifier, setVerifier] = useQueryState('verifier', 'all');
  const [person, setPerson] = useQueryState('person', '');
  const [page, setPage] = usePageParam();
  const [, setParams] = useSearchParams();
  const now = useMemo(() => new Date(), []);
  const canSeeExceptions = can('exceptions.view') || can('exceptions.review') || can('exceptions.approve');
  const visibleExceptions = useMemo(() => new Set(canSeeExceptions ? exceptionsVisibleTo(state, organization.id).map((e) => e.id) : []), [state, organization.id, canSeeExceptions]);

  const all = useMemo<GlobalRow[]>(() => {
    const orgAttempts = state.data.verificationAttempts.filter((a) => (a.organizationId === organization.id || a.activityOwnerId === organization.id) && a.status !== 'in-progress');
    const rows: GlobalRow[] = orgAttempts.map((a) => {
      const who = attemptSubject(state, a);
      const e = a.exceptionId ? exceptionFor(state, a.exceptionId) : undefined;
      return {
        id: a.id, at: a.completedAt ?? a.startedAt, activityId: a.activityId, activityName: a.activityName, activityHref: activityPath(a.activityId),
        memberId: a.subject?.memberId, participant: who.name, identifier: who.identifier, verifier: a.verifierName, organizationId: a.organizationId,
        result: originalResultOf(a)!, explanation: a.decisionExplanation ?? a.reasons[0], review: reviewOutcomeOf(e), exception: e,
        search: [a.id, a.activityName, who.name, who.identifier, a.lookup?.reference, a.exceptionId, a.verifierName].join(' ').toLowerCase(),
      };
    });
    const legacyName = new Map(activities.map((x) => [x.id, x.name]));
    for (const t of transactions) {
      const m = t.memberId ? memberById.get(t.memberId) : undefined;
      const id = m?.identifier?.value;
      const identifier = !id ? '—' : id.length <= 4 ? '••••' : `••••${id.slice(-4)}`;
      rows.push({
        id: t.id, at: t.occurredAt, activityId: t.activityId, activityName: legacyName.get(t.activityId) ?? '—', memberId: m?.id, participant: m?.displayName ?? 'Unknown',
        identifier, verifier: t.verifier, organizationId: organization.id, result: legacyResult(t.decision), explanation: t.reason, review: reviewOutcomeOf(),
        search: [t.id, legacyName.get(t.activityId), m?.displayName, identifier, t.verifier].join(' ').toLowerCase(),
      });
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [state, organization.id, transactions, activities, memberById]);

  const filtered = useMemo(() => {
    const start = range === 'custom' ? (from || undefined) : rangeStart(range as TimeRange, now)?.toISOString();
    const end = range === 'custom' && to ? `${to}T23:59:59.999Z` : undefined;
    const query = q.trim().toLowerCase();
    return all.filter((r) =>
      (!start || r.at >= start) && (!end || r.at <= end)
      && (result === 'all' || r.result === result)
      && (review === 'all' || r.review.key === review)
      && (exc === 'all' || (exc === 'none' ? !r.exception : exc === 'any' ? !!r.exception : r.exception?.status === exc))
      && (activity === 'all' || r.activityId === activity)
      && (verifier === 'all' || r.verifier === verifier)
      && (!person || r.memberId === person)
      && (!query || r.search.includes(query)));
  }, [all, range, from, to, result, review, exc, activity, verifier, person, q, now]);

  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const personName = person ? memberById.get(person)?.displayName : null;
  const activityOptions = [...new Map(all.map((r) => [r.activityId, r.activityName])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  const verifiers = [...new Set(all.map((r) => r.verifier))].sort();
  const performers = new Set(all.map((r) => r.organizationId));
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? '';
  const filtersOn = [result, review, exc, activity, verifier].some((v) => v !== 'all') || !!q.trim() || !!person;
  const clear = () => setParams((prev) => { const n = new URLSearchParams(prev); ['q', 'result', 'review', 'exception', 'activity', 'verifier', 'person', 'decision', 'status', 'page', 'from', 'to'].forEach((k) => n.delete(k)); n.set('range', 'all'); return n; }, { replace: true });
  const count = (k: OriginalResult) => filtered.filter((r) => r.result === k).length;
  const period = range === 'custom' ? `${from || 'the first record'} to ${to || 'today'}` : ({ today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' } as Record<string, string>)[range] ?? range;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const columns: Column<GlobalRow>[] = [
    { key: 'participant', header: 'Participant', className: '!whitespace-normal min-w-[9rem]', cell: (r) => (r.memberId && can('users.view') ? <Link to={`/users/${r.memberId}`} onClick={stop} className="font-medium text-slate-900 hover:text-brand-700">{r.participant}</Link> : <span className="font-medium text-slate-900">{r.participant}</span>) },
    { key: 'identifier', header: 'Identifier', cell: (r) => <span className="font-mono text-xs text-slate-600">{r.identifier}</span> },
    { key: 'activity', header: 'Verification activity', className: '!whitespace-normal min-w-[9rem]', cell: (r) => <span>{r.activityHref && can('verification.activities.view') ? <Link to={r.activityHref} onClick={stop} className="text-slate-900 hover:text-brand-700">{r.activityName}</Link> : r.activityName}{performers.size > 1 && r.organizationId !== organization.id && <span className="block text-xs text-slate-500">{orgName(r.organizationId)}</span>}</span> },
    { key: 'result', header: 'Original result', cell: (r) => <OriginalResultBadge result={r.result} /> },
    { key: 'review', header: 'Final review outcome', className: '!whitespace-normal min-w-[9rem]', cell: (r) => (r.exception && (r.review.key !== 'none') ? <span className="text-sm text-slate-900">{r.review.label}{r.review.detail && <span className="block text-xs text-slate-500">{r.review.detail}</span>}</span> : <span className="text-slate-400">—</span>) },
    { key: 'verifier', header: 'Verifier', cell: (r) => r.verifier },
    { key: 'time', header: 'Date & time', cell: (r) => <span className="tabular-nums text-slate-600">{formatDateTime(r.at)}<span className="block font-mono text-[11px] text-slate-400">{r.id}</span></span> },
    { key: 'exception', header: 'Exception', cell: (r) => (!r.exception ? <span className="text-slate-400">—</span> : visibleExceptions.has(r.exception.id)
      ? <span><Link to={`/exceptions/${r.exception.id}`} onClick={stop} className="font-mono text-xs font-medium text-brand-700 hover:underline">{r.exception.id}</Link><span className="block"><ExceptionStatusBadge status={r.exception.status} /></span></span>
      : <span className="text-xs text-slate-600">Exception raised</span>) },
    { key: 'details', header: <span className="sr-only">Action</span>, cell: (r) => <Link to={`/verification-history/${r.id}`} onClick={stop} className="text-sm font-medium text-brand-600 hover:text-brand-700">View<span className="sr-only"> details for {r.id}</span></Link> },
  ];

  return (
    <>
      <PageHeader
        title="Verification History"
        description="A record of every verification attempt: who was verified, where, by whom, the original result and any human review that followed."
        actions={DEMO_AUTH_ENABLED ? <Link to="/developer/status-api" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-300 hover:bg-amber-50"><FlaskConical className="h-4 w-4" aria-hidden="true" />Status API (simulated)</Link> : undefined}
      />
      <section aria-label="Summary" className="mb-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total attempts" value={filtered.length} hint={count('review') ? `${count('review')} referred for review` : undefined} />
        <StatCard label="Successful" value={count('successful')} tone="emerald" />
        <StatCard label="Unsuccessful" value={count('unsuccessful')} tone="violet" />
        <StatCard label="Incomplete" value={count('incomplete')} tone="amber" />
      </section>
      <p className="mb-4 text-xs text-slate-500" role="status">{period}{filtersOn ? ' · totals reflect the current search and filters' : ''}. Original results only: a review decision is never counted as another attempt.</p>
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Search participant, activity, reference or identifier" className="sm:w-80" label="Search verification history" />
          <FilterSelect label="Date range" value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'all', label: 'All time' }, { value: 'custom', label: 'Custom range' }]} />
          {range === 'custom' && <>
            <label className="text-sm text-slate-600">From<Input type="date" value={from} onChange={(x) => setFrom(x.target.value)} className="mt-1" aria-label="From date" /></label>
            <label className="text-sm text-slate-600">To<Input type="date" value={to} onChange={(x) => setTo(x.target.value)} className="mt-1" aria-label="To date" /></label>
          </>}
          <FilterSelect label="Activity" value={activity} onChange={setActivity} options={[{ value: 'all', label: 'All activities' }, ...activityOptions]} />
          <FilterSelect label="Original result" value={result} onChange={(v) => { setResult(v); if (legacyDecision) setLegacyDecision(''); if (legacyStatus) setLegacyStatus(''); }} options={[{ value: 'all', label: 'Any original result' }, ...(Object.keys(ORIGINAL_RESULT_LABEL) as OriginalResult[]).map((k) => ({ value: k, label: ORIGINAL_RESULT_LABEL[k] }))]} />
          <FilterSelect label="Final review outcome" value={review} onChange={setReview} options={[{ value: 'all', label: 'Any review outcome' }, ...Object.entries(REVIEW_FILTER_LABEL).map(([value, label]) => ({ value, label }))]} />
          <FilterSelect label="Verifier" value={verifier} onChange={setVerifier} options={[{ value: 'all', label: 'All verifiers' }, ...verifiers.map((v) => ({ value: v, label: v }))]} />
          <FilterSelect label="Exception" value={exc} onChange={setExc} options={[{ value: 'all', label: 'With or without exception' }, { value: 'none', label: 'No exception' }, { value: 'any', label: 'Any exception' }, ...(Object.keys(EXCEPTION_STATUS_LABEL) as ExceptionStatus[]).map((k) => ({ value: k, label: `Exception: ${EXCEPTION_STATUS_LABEL[k]}` }))]} />
          {personName && (
            <Badge tone="brand" className="py-1">
              Participant: {personName}
              <button type="button" onClick={() => setPerson('')} aria-label="Remove participant filter"><X className="h-3 w-3" /></button>
            </Badge>
          )}
        </div>
          <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} rowHref={(r) => `/verification-history/${r.id}`}
            empty={all.length === 0
              ? <EmptyState title="No verification attempts recorded" description="Attempts appear here when verifiers in this organization, or in organizations taking part in its shared activities, complete them. Only records within your organization’s scope are shown." />
              : <EmptyState title="No records match" description="Try a different search, widen the date range or clear the filters." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />} />
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
  // Its own transaction, or one a participating organization performed for its shared activity. Any other
  // organization's transaction is never shown; the refused attempt is audited.
  const attempt = state.data.verificationAttempts.find((a) => a.id === recordId && (a.organizationId === organization.id || a.activityOwnerId === organization.id));
  const elsewhere = !attempt && state.data.verificationAttempts.some((a) => a.id === recordId);
  useEffect(() => { if (elsewhere && recordId) recordAccessDenied(organization.id, 'verification-transaction', recordId); }, [elsewhere, recordId, organization.id, recordAccessDenied]);
  return attempt ? <AttemptDetail attempt={attempt} /> : <TransactionDetailPage />;
}

function AttemptDetail({ attempt }: { attempt: VerificationAttempt }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const providers = providersFor(organization);
  const performer = attempt.organizationId !== organization.id ? state.data.organizations.find((o) => o.id === attempt.organizationId)?.name : undefined;
  const owner = attempt.activityOwnerId && attempt.activityOwnerId !== organization.id ? state.data.organizations.find((o) => o.id === attempt.activityOwnerId)?.name : undefined;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Verification History', to: '/verification-history' }, { label: attempt.id }]}
        title={<span className="font-mono">{attempt.id}</span>}
        description={`${attempt.activityName} · ${formatDateTime(attempt.completedAt ?? attempt.startedAt)}`}
        meta={originalResultOf(attempt) ? <OriginalResultBadge result={originalResultOf(attempt)!} /> : <AttemptBadge attempt={attempt} />}
      />
      {attempt.simulated && (
        <p className="mb-4 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-300">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Some checks used simulated providers. This result isn’t real identity or credential assurance.
        </p>
      )}
      <div className="space-y-6">
        <AttemptSummary attempt={attempt} />
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
        <TransactionDetails attempt={attempt} performedBy={performer} sharedBy={owner} />
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
function TransactionDetails({ attempt: a, performedBy, sharedBy }: { attempt: VerificationAttempt; performedBy?: string; sharedBy?: string }) {
  const row = (label: string, value: ReactNode) => <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-900">{value}</dd></div>;
  return (
    <Card className="px-5 py-5">
      <h2 className="text-sm font-semibold text-slate-900">Verification transaction</h2>
      <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Verification transaction">
        {row('Transaction Reference', <span className="font-mono text-xs">{a.id}</span>)}
        {row('Status', <StageBadge attempt={a} />)}
        {row('Identity Source', sourceName(a))}
        {sharedBy && row('Shared activity from', sharedBy)}
        {performedBy && row('Performed by', performedBy)}
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

/**
 * The three things Verification History answers about one attempt: what happened, any human review that followed
 * (linked, never merged), and the activity it belongs to. No portraits or biometric data: evidence is inspected
 * only in the exception review workspace, by people permitted to.
 */
function AttemptSummary({ attempt: a }: { attempt: VerificationAttempt }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const who = attemptSubject(state, a);
  const result = originalResultOf(a);
  const e = a.exceptionId ? exceptionFor(state, a.exceptionId) : undefined;
  const canOpenException = !!e && (can('exceptions.view') || can('exceptions.review') || can('exceptions.approve')) && exceptionsVisibleTo(state, organization.id).some((x) => x.id === e.id);
  const review = reviewOutcomeOf(e);
  const config = state.data.activityConfigs.find((c) => c.id === a.activityId);
  const schedule = config ? scheduleSummary(config.schedule) : null;
  const method = a.identitySource === 'external'
    ? ['Record lookup', a.liveness?.required ? 'liveness' : null, a.match && a.match.status !== 'not-required' && a.match.status !== 'record-confirmed' ? 'face match' : null].filter(Boolean).join(', ')
    : a.checks.map((c) => checkById(c.type).name).join(', ');
  const row = (label: string, value: ReactNode) => <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-900">{value}</dd></div>;
  const lastEvent = (actions: string[]) => e?.history.filter((h) => actions.includes(h.action)).slice(-1)[0];
  const proposed = lastEvent(['proposal-submitted']);
  const decided = lastEvent(['proposal-approved', 'proposal-rejected', 'proposal-returned']);
  return (
    <>
      <Card className="px-5 py-5">
        <h2 className="text-sm font-semibold text-slate-900">Attempt information</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Attempt information">
          {row('Attempt reference', <span className="font-mono text-xs">{a.id}</span>)}
          {row('Participant', <>{a.subject?.memberId && can('users.view') ? <Link to={`/users/${a.subject.memberId}`} className="text-brand-700 hover:underline">{who.name}</Link> : who.name} <span className="font-mono text-xs text-slate-500">{who.identifier}</span></>)}
          {row('Date and time', formatDateTime(a.completedAt ?? a.startedAt))}
          {row('Verifier', a.verifierName)}
          {row('Identity source', <>{sourceName(a)}{a.simulated && <span className="ml-1"><SimulatedBadge /></span>}</>)}
          {method && row('Verification method', method)}
          {row('Original result', result ? <OriginalResultBadge result={result} /> : 'In progress')}
          {row('Explanation', a.decisionExplanation ?? a.reasons[0] ?? '—')}
          {a.retryOf && row('Earlier attempt', <Link to={`/verification-history/${a.retryOf}`} className="font-mono text-xs text-brand-700 hover:underline">{a.retryOf}</Link>)}
          {a.reverificationOf && row('Follow-up attempt for exception', (can('exceptions.view') || can('exceptions.review')) && exceptionsVisibleTo(state, organization.id).some((x) => x.id === a.reverificationOf) ? <Link to={`/exceptions/${a.reverificationOf}`} className="font-mono text-xs text-brand-700 hover:underline">{a.reverificationOf}</Link> : <span className="font-mono text-xs">{a.reverificationOf}</span>)}
        </dl>
      </Card>
      <Card className="px-5 py-5">
        <h2 className="text-sm font-semibold text-slate-900">Review information</h2>
        {!e ? <p className="mt-2 text-sm text-slate-600">No exception was raised for this attempt. Its original result is final.</p> : (
          <>
            <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Review information">
              {row('Exception', canOpenException ? <Link to={`/exceptions/${e.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">{e.id}</Link> : <span className="font-mono text-xs">{e.id}</span>)}
              {row('Reason', EXCEPTION_REASON_LABEL[e.reason])}
              {row('Exception status', <ExceptionStatusBadge status={e.status} />)}
              {row('Human-review decision', e.resolution ? <>{review.label}<span className="block text-xs text-slate-500">{e.resolution.by}, {formatDateTime(e.resolution.at)}</span></> : e.proposal ? <>Proposed: {RESOLUTION_LABEL[e.proposal.outcome]}<span className="block text-xs text-slate-500">{e.proposal.by}, {formatDateTime(e.proposal.at)}</span></> : 'Not yet decided')}
              {(e.approval || proposed) && row('Approval', e.approval ? <>Approved by {e.approval.by}<span className="block text-xs text-slate-500">{formatDateTime(e.approval.at)}</span></>
                : e.status === 'pending-approval' ? 'Awaiting a different approver'
                : decided ? <>{decided.action === 'proposal-rejected' ? 'Rejected' : 'Returned for review'} by {decided.actorName}<span className="block text-xs text-slate-500">{formatDateTime(decided.at)}</span></> : '—')}
              {a.reviewDisposition && row('Final verification state', <><DecisionBadge decision={a.reviewDisposition.decision} /><span className="block text-xs text-slate-500">After review. Eligibility still follows the activity’s rules.</span></>)}
              {(e.previousResolutions?.length ?? 0) > 0 && row('Earlier decisions', e.previousResolutions!.map((r) => `${RESOLUTION_LABEL[r.outcome]} (${r.by}, ${formatDateTime(r.at)})`).join('; '))}
            </dl>
            <p className="mt-3 text-xs text-slate-500">The original result above is kept unchanged. {canOpenException ? 'Evidence, including any portrait comparison, is reviewed in the exception workspace.' : 'You don’t have access to the exception’s details.'}</p>
          </>
        )}
      </Card>
      <Card className="px-5 py-5">
        <h2 className="text-sm font-semibold text-slate-900">Activity context</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Activity context">
          {row('Verification activity', can('verification.activities.view') ? <Link to={activityPath(a.activityId)} className="font-medium text-brand-700 hover:underline">{a.activityName}</Link> : a.activityName)}
          {schedule && row('Schedule', schedule)}
          {row('Other attempts in this activity', <Link to={`/verification-history?activity=${encodeURIComponent(a.activityId)}&range=all`} className="text-brand-700 hover:underline">View history for this activity</Link>)}
        </dl>
      </Card>
    </>
  );
}
