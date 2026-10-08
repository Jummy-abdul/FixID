import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';

const TABS = [
  { to: '/templates', label: 'Card designs', end: true },
  { to: '/templates/credential-types', label: 'Credential types', end: false },
];

/** Route-backed tabs grouping the two template capabilities under the Templates navigation item. */
export function TemplatesTabs() {
  return (
    <nav aria-label="Templates sections" className="mb-6 flex gap-1 border-b border-slate-200">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end}
          className={({ isActive }) => cn('-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
