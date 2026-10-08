import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface Crumb { label: string; to?: string }

export function PageHeader({ title, description, actions, breadcrumbs, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: Crumb[]; meta?: ReactNode }) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-sm text-slate-500">
          {breadcrumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
              {c.to ? <Link to={c.to} className="hover:text-slate-800">{c.label}</Link> : <span className="text-slate-700">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
