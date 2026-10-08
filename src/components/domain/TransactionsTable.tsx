import { Link } from 'react-router-dom';
import { CornerDownRight } from 'lucide-react';
import { DataTable, EmptyState, type Column } from '@/components/ui';
import { DecisionBadge, ResultBadge } from './StatusBadges';
import { METHOD_LABEL } from '@/domain/labels';
import type { Transaction } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

type Col = 'time' | 'id' | 'activity' | 'person' | 'credential' | 'method' | 'result' | 'decision' | 'reason';

export function TransactionsTable({ rows, hide = [], emptyTitle = 'No transactions', emptyDescription }: { rows: Transaction[]; hide?: Col[]; emptyTitle?: string; emptyDescription?: string }) {
  const { activityById, memberById, credentialById } = useOrgData();
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const all: (Column<Transaction> & { key: Col })[] = [
    { key: 'time', header: 'Time', cell: (t) => <span className="tabular-nums text-slate-600">{formatDateTime(t.occurredAt)}</span> },
    { key: 'id', header: 'Transaction', cell: (t) => <span className="font-mono text-xs text-slate-500">{t.id}</span> },
    {
      key: 'activity', header: 'Activity', cell: (t) => {
        const a = activityById.get(t.activityId);
        return a ? <Link to={`/activities/${a.id}`} onClick={stop} className="text-slate-900 hover:text-brand-700">{a.name}</Link> : '—';
      },
    },
    {
      key: 'person', header: 'Person', cell: (t) => {
        const m = t.memberId ? memberById.get(t.memberId) : null;
        return m ? <Link to={`/people/${m.id}`} onClick={stop} className="text-slate-900 hover:text-brand-700">{m.displayName}</Link> : <span className="text-slate-400">Unknown</span>;
      },
    },
    {
      key: 'credential', header: 'Credential', cell: (t) => {
        const c = t.credentialId ? credentialById.get(t.credentialId) : null;
        return c ? <Link to={`/credentials/${c.id}`} onClick={stop} className="font-mono text-xs text-slate-600 hover:text-brand-700">{c.identifier}</Link> : <span className="text-slate-400">—</span>;
      },
    },
    {
      key: 'method', header: 'Method', cell: (t) => (
        <span className="flex items-center gap-1">
          {METHOD_LABEL[t.method]}
          {t.fallbackUsed && <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-600" title="Fallback method used"><CornerDownRight className="h-3 w-3" />fallback</span>}
        </span>
      ),
    },
    { key: 'result', header: 'Verification', cell: (t) => <ResultBadge result={t.result} /> },
    { key: 'decision', header: 'Decision', cell: (t) => <DecisionBadge decision={t.decision} /> },
    { key: 'reason', header: 'Reason', cell: (t) => <span className="text-slate-600">{t.reason}</span>, className: 'max-w-xs truncate' },
  ];
  return (
    <DataTable
      columns={all.filter((c) => !hide.includes(c.key))}
      rows={rows}
      rowKey={(t) => t.id}
      rowHref={(t) => `/transactions/${t.id}`}
      empty={<EmptyState title={emptyTitle} description={emptyDescription} />}
    />
  );
}
