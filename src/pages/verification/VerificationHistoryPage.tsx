import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, FlaskConical, X } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState, FilterSelect, PageHeader, Pagination, SearchInput, usePageSlice, type Column } from '@/components/ui';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { ResultBadge } from '@/components/domain/StatusBadges';
import { AccessAndEntry, AccessBadge, EligibilityBadge, EntryBadge, IdentityResultBadge, LocationBadge } from '@/components/verification/attemptParts';
import { rangeStart, type TimeRange } from '@/domain/metrics';
import type { Transaction, VerificationAttempt, VerificationOutcome } from '@/domain/types';
import { OUTCOME_LABEL, checkById, providersFor } from '@/domain/verification';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDateTime } from '@/lib/dates';
import { useOrgData, useSession, useStore } from '@/store/AppStore';
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
  identity: ReactNode;
  eligibility: ReactNode;
  outcome: ReactNode;
  outcomeKey?: VerificationOutcome;
  access: ReactNode;
  location: ReactNode;
  entry: ReactNode;
  entered: boolean;
  search: string;
}

function fromAttempt(a: VerificationAttempt): HistoryRow {
  return {
    id: a.id, at: a.completedAt ?? a.startedAt, activityId: a.activityId, activityName: a.activityName, activityHref: activityPath(a.activityId),
    memberId: a.subject?.memberId, subject: a.subject?.label ?? 'Not identified', verifier: a.verifierName,
    identity: <IdentityResultBadge attempt={a} />, eligibility: <EligibilityBadge attempt={a} />,
    outcome: <span className="inline-flex items-center gap-1"><AttemptBadge attempt={a} />{a.simulated && <FlaskConical className="h-3.5 w-3.5 text-amber-600" aria-label="Used simulated providers" />}</span>,
    outcomeKey: a.status === 'completed' ? a.outcome : undefined,
    access: <AccessBadge attempt={a} />, location: <LocationBadge attempt={a} />, entry: <EntryBadge attempt={a} />, entered: a.entry?.status === 'entered',
    search: [a.id, a.activityName, a.subject?.label, a.verifierName, ...a.reasons].join(' ').toLowerCase(),
  };
}

// Earlier records kept a verification result and an allow/deny decision; shown in today's vocabulary.
const LEGACY_OUTCOME = { allow: 'verified', deny: 'not-verified', indeterminate: 'unable-to-verify' } as const;
const LEGACY_ACCESS = { allow: 'permitted', deny: 'not-permitted', indeterminate: 'review-required' } as const;

export function AttemptsTable({ rows, hideActivity }: { rows: VerificationAttempt[]; hideActivity?: boolean }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)).map(fromAttempt), [rows]);
  return <HistoryTable rows={sorted} hide={hideActivity ? ['activity'] : []} empty={<EmptyState title="No verifications yet" description="Verifications appear here once a verifier performs this activity." />} />;
}

function HistoryTable({ rows, hide = [], empty }: { rows: HistoryRow[]; hide?: string[]; empty: ReactNode }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const columns: Column<HistoryRow>[] = [
    { key: 'time', header: 'Date & time', cell: (r) => <span className="tabular-nums text-slate-600">{formatDateTime(r.at)}</span> },
    { key: 'activity', header: 'Activity', cell: (r) => (r.activityHref ? <Link to={r.activityHref} onClick={stop} className="text-slate-900 hover:text-brand-700">{r.activityName}</Link> : <span className="text-slate-900">{r.activityName}</span>) },
    { key: 'subject', header: 'Subject', cell: (r) => (r.memberId ? <Link to={`/users/${r.memberId}`} onClick={stop} className="text-slate-900 hover:text-brand-700">{r.subject}</Link> : <span className="text-slate-500">{r.subject}</span>) },
    { key: 'verifier', header: 'Verifier', cell: (r) => r.verifier },
    { key: 'identity', header: 'Identity', cell: (r) => r.identity },
    { key: 'eligibility', header: 'Eligibility', cell: (r) => r.eligibility },
    { key: 'outcome', header: 'Outcome', cell: (r) => r.outcome },
    { key: 'access', header: 'Access', cell: (r) => r.access },
    { key: 'location', header: 'Location', cell: (r) => r.location },
    { key: 'entry', header: 'Entry', cell: (r) => r.entry },
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
  const [person, setPerson] = useQueryState('person', '');
  const [page, setPage] = usePageParam();
  const now = useMemo(() => new Date(), []);

  const attempts = useMemo(() => state.data.verificationAttempts.filter((a) => a.organizationId === organization.id && a.status !== 'in-progress'), [state.data.verificationAttempts, organization.id]);
  const configs = state.data.activityConfigs.filter((a) => a.organizationId === organization.id);
  const all = useMemo(() => {
    const legacyName = new Map(activities.map((a) => [a.id, a.name]));
    const legacy = (t: Transaction): HistoryRow => {
      const m = t.memberId ? memberById.get(t.memberId) : undefined;
      return {
        id: t.id, at: t.occurredAt, activityId: t.activityId, activityName: legacyName.get(t.activityId) ?? '—', memberId: m?.id, subject: m?.displayName ?? 'Unknown', verifier: t.verifier,
        identity: <ResultBadge result={t.result} />, eligibility: <span className="text-slate-400">—</span>,
        outcome: <AttemptBadge attempt={{ status: 'completed', outcome: LEGACY_OUTCOME[t.decision] }} />, outcomeKey: LEGACY_OUTCOME[t.decision],
        access: <AccessBadge attempt={{ accessDecision: LEGACY_ACCESS[t.decision] }} />, location: <span className="text-slate-400">—</span>, entry: <span className="text-slate-400">—</span>, entered: false,
        search: [t.id, t.reason, m?.displayName, t.credentialId && credentialById.get(t.credentialId)?.identifier, legacyName.get(t.activityId)].join(' ').toLowerCase(),
      };
    };
    return [...attempts.map(fromAttempt), ...transactions.map(legacy)].sort((a, b) => b.at.localeCompare(a.at));
  }, [attempts, transactions, activities, memberById, credentialById]);

  const filtered = useMemo(() => {
    const start = rangeStart(range as TimeRange, now)?.toISOString();
    const query = q.trim().toLowerCase();
    return all.filter((r) =>
      (!start || r.at >= start) &&
      (outcome === 'all' || r.outcomeKey === outcome) &&
      (activity === 'all' || r.activityId === activity) &&
      (entry === 'all' || (entry === 'entered') === r.entered) &&
      (!person || r.memberId === person) &&
      (!query || r.search.includes(query)));
  }, [all, range, outcome, activity, entry, person, q, now]);

  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);
  const personName = person ? memberById.get(person)?.displayName : null;
  const activityOptions = [...configs.map((a) => ({ value: a.id, label: a.name })), ...activities.map((a) => ({ value: a.id, label: a.name }))];

  return (
    <>
      <PageHeader
        title="Verification History"
        description="Every verification: what was checked, the outcome, the access decision, and whether entry was recorded."
        actions={<PlannedButton icon={<Download className="h-4 w-4" />} info={PLANNED.export}>Export CSV</PlannedButton>}
      />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search reference, person, verifier or reason" className="sm:w-72" />
          <FilterSelect label="Time range" value={range} onChange={setRange}
            options={[{ value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'all', label: 'All time' }]} />
          <FilterSelect label="Activity" value={activity} onChange={setActivity} options={[{ value: 'all', label: 'All activities' }, ...activityOptions]} />
          <FilterSelect label="Outcome" value={outcome} onChange={setOutcome}
            options={[{ value: 'all', label: 'All outcomes' }, ...(Object.keys(OUTCOME_LABEL) as VerificationOutcome[]).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))]} />
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
  const attempt = state.data.verificationAttempts.find((a) => a.id === recordId && a.organizationId === organization.id);
  return attempt ? <AttemptDetail attempt={attempt} /> : <TransactionDetailPage />;
}

function AttemptDetail({ attempt }: { attempt: VerificationAttempt }) {
  const { organization } = useSession();
  const providers = providersFor(organization);
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
        <AccessAndEntry attempt={attempt} />
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
