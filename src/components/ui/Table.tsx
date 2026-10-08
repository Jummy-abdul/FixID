import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, rowHref, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; rowHref?: (r: T) => string; empty?: ReactNode }) {
  const navigate = useNavigate();
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/80">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500', c.className)}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((r) => {
            const href = rowHref?.(r);
            return (
              <tr key={rowKey(r)}
                onClick={href ? () => navigate(href) : undefined}
                className={cn(href && 'cursor-pointer hover:bg-slate-50')}>
                {columns.map((c) => <td key={c.key} className={cn('whitespace-nowrap px-4 py-3 text-slate-700', c.className)}>{c.cell(r)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function usePageSlice<T>(rows: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  return { pageRows: rows.slice((current - 1) * pageSize, current * pageSize), pageCount, current };
}

export function Pagination({ page, pageCount, total, pageSize, onPage }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
      <span>Showing <span className="font-medium text-slate-700">{from}–{to}</span> of <span className="font-medium text-slate-700">{total}</span></span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
        <span className="px-2">Page {page} of {pageCount}</span>
        <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page" className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
