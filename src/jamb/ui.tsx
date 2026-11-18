import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, LogOut, Menu, MinusCircle, ShieldOff, UserRound, X, XCircle } from 'lucide-react';
import { Avatar, Badge, Button } from '@/components/ui';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { handleMenuKeys, usePopover } from '@/hooks/usePopover';
import { SidebarNav } from '@/layout/Sidebar';
import type { NavGroup } from '@/layout/navigation';
import { cn } from '@/lib/cn';
import type { StudentRecord } from './data';
import jambLogo from './assets/jamb-logo.png';
import { type ConsoleRole } from './personas';
import { registrationPortrait } from './portraits';
import { accessDisabled, officerFor, useJambState, type Officer } from './store';

/* ---------------- access and layout ---------------- */

/** Only the matching demo account opens a workspace; everyone else goes to their own home. JAMB can disable access. */
export function RequireConsole({ role, children }: { role: ConsoleRole; children: ReactNode }) {
  const { account } = useAuth();
  const location = useLocation();
  const state = useJambState();
  if (!account) return <Navigate to="/signin" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (account.consoleRole !== role) return <Navigate to={homeFor(account)} replace />;
  if (accessDisabled(account.email, state)) return <AccessDisabled />;
  return <>{children}</>;
}

function AccessDisabled() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-card ring-1 ring-slate-200">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600"><ShieldOff className="h-6 w-6" aria-hidden="true" /></span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Your access has been disabled</h1>
        <p className="mt-1 text-sm text-slate-500">JAMB has disabled your account on the identity verification platform. Contact your JAMB administrator to restore access.</p>
        <Button className="mt-6" variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={() => { signOut(); navigate('/signin', { replace: true }); }}>Sign out</Button>
      </div>
    </div>
  );
}

/** The signed-in officer, for the store's permission checks. */
export function useOfficer(): Officer {
  const { account } = useAuth();
  return officerFor(account?.email);
}

/**
 * A workspace of the JAMB Identity Verification Platform, built on FixID's layout: the same sidebar (with
 * JAMB branding and the role's navigation), a header naming the organisation and role, and the account menu.
 * Chrome is hidden when printing.
 */
export function ConsoleLayout({ nav, organisation, mark, children }: { nav: NavGroup[]; organisation: { name: string; role: string }; mark?: ReactNode; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo?.(0, 0); }, [pathname]);
  const brand = (
    <div className="flex h-16 items-center gap-2.5 px-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white p-0.5"><img src={jambLogo} alt="Joint Admissions and Matriculation Board logo" className="h-full w-full object-contain" /></span>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[15px] font-semibold text-white">JAMB Identity</p>
        <p className="truncate text-[11px] text-slate-400">Verification Platform</p>
      </div>
    </div>
  );
  const footer = <p className="px-5 pb-4 text-[11px] text-slate-500"><span className="rounded-full bg-white/5 px-2 py-0.5">Demo environment</span></p>;
  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block print:hidden"><SidebarNav groups={nav} brand={brand} footer={footer} /></aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="relative h-full w-64">
            <SidebarNav groups={nav} brand={brand} footer={footer} onNavigate={() => setMobileOpen(false)} />
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="absolute right-2 top-4 rounded-md p-1.5 text-slate-400 hover:bg-white/10"><X className="h-5 w-5" /></button>
          </aside>
        </div>
      )}
      <div className="lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 print:hidden">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"><Menu className="h-5 w-5" /></button>
          <div className="flex min-w-0 items-center gap-2.5" role="region" aria-label="Workspace">
            {mark}
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-slate-900">{organisation.name}</p>
              <p className="truncate text-xs text-slate-500">{organisation.role}</p>
            </div>
          </div>
          <div className="ml-auto"><AccountMenu /></div>
        </header>
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">{children}</main>
      </div>
    </div>
  );
}

/** The signed-in officer's menu (same pattern as FixID's account menu). */
function AccountMenu() {
  const { account, signOut } = useAuth();
  const officer = useOfficer();
  const navigate = useNavigate();
  const { open, toggle, close, containerRef, triggerRef } = usePopover();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [open]);
  return (
    <div ref={containerRef} className="relative">
      <button ref={triggerRef} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${officer.name}`}
        className="flex items-center gap-2 rounded-full p-0.5 hover:ring-2 hover:ring-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <span className="hidden text-right leading-tight sm:block"><span className="block text-sm font-medium text-slate-900">{officer.name}</span><span className="block text-xs text-slate-500">{officer.title}</span></span>
        <Avatar name={officer.name} size="sm" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Account" onKeyDown={(e) => handleMenuKeys(e)} className="absolute right-0 z-40 mt-2 w-64 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <Avatar name={officer.name} />
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{officer.name}</p><p className="truncate text-xs text-slate-500">{account?.email}</p></div>
          </div>
          <div className="my-1 h-px bg-slate-100" />
          <p className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-500"><UserRound className="h-3.5 w-3.5" aria-hidden="true" />{officer.title} · {officer.organisation}</p>
          <button type="button" role="menuitem" onClick={() => { close(); signOut(); navigate('/signin', { replace: true }); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
            <LogOut className="h-4 w-4 text-slate-400" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** The JAMB logo on a white disc. Replace src/jamb/assets/jamb-logo.png to update it. */
export function JambLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-white p-0.5 ring-1 ring-slate-200', size === 'lg' ? 'h-16 w-16' : size === 'sm' ? 'h-8 w-8' : 'h-12 w-12')}>
      <img src={jambLogo} alt="Joint Admissions and Matriculation Board logo" className="h-full w-full object-contain" />
    </span>
  );
}

/** An organisation's mark: a lettermark until the organisation's own logo is supplied. */
export function OrgMark({ letters, tone = 'slate' }: { letters: string; tone?: 'slate' | 'green' | 'blue' }) {
  const t = { slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', blue: 'bg-sky-100 text-sky-800' }[tone];
  return <span aria-hidden="true" className={cn('flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-1.5 text-[11px] font-bold tracking-tight', t)}>{letters}</span>;
}

/* ---------------- statuses ---------------- */

export function VerificationBadge({ status }: { status: StudentRecord['verification'] }) {
  if (status === 'verified') return <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Verified</Badge>;
  if (status === 'failed') return <Badge tone="danger"><XCircle className="h-3 w-3" aria-hidden="true" />Failed</Badge>;
  if (status === 'exception') return <Badge tone="warning"><AlertTriangle className="h-3 w-3" aria-hidden="true" />Exception</Badge>;
  return <Badge tone="neutral"><CircleDashed className="h-3 w-3" aria-hidden="true" />Not verified yet</Badge>;
}
export function ClearanceBadge({ status }: { status: StudentRecord['clearance'] }) {
  return status === 'cleared' ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Cleared</Badge> : <Badge tone="neutral"><Clock className="h-3 w-3" aria-hidden="true" />Pending</Badge>;
}
export function MatriculationBadge({ status }: { status: StudentRecord['matriculation'] }) {
  return status === 'matriculated' ? <Badge tone="brand"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Matriculated</Badge> : <Badge tone="neutral"><MinusCircle className="h-3 w-3" aria-hidden="true" />Not yet</Badge>;
}

export const VERIFICATION_FILTER = [
  { value: 'all', label: 'Any verification status' }, { value: 'verified', label: 'Verified' }, { value: 'not-started', label: 'Not verified yet' },
  { value: 'failed', label: 'Failed' }, { value: 'exception', label: 'Exception' },
];
export const CLEARANCE_FILTER = [{ value: 'all', label: 'Any clearance status' }, { value: 'cleared', label: 'Cleared' }, { value: 'pending', label: 'Pending' }];
export const MATRIC_FILTER = [{ value: 'all', label: 'Any matriculation status' }, { value: 'matriculated', label: 'Matriculated' }, { value: 'not-matriculated', label: 'Not yet matriculated' }];

/* ---------------- portraits ---------------- */

/** A student's original JAMB registration portrait (a photograph when supplied, otherwise "portrait on file"). */
export function Portrait({ record, label = 'JAMB registration portrait', className }: { record: Pick<StudentRecord, 'reg' | 'gender' | 'firstName' | 'lastName'>; label?: string; className?: string }) {
  const url = registrationPortrait(record);
  if (url) return <img src={url} alt={`${label}: ${record.firstName} ${record.lastName}`} className={cn('rounded-lg object-cover ring-1 ring-slate-200', className ?? 'h-40 w-full')} />;
  return <PortraitPlaceholder label={`${label}: ${record.firstName} ${record.lastName}`} className={className} />;
}
export function PortraitPlaceholder({ label, className }: { label: string; className?: string }) {
  return (
    <div role="img" aria-label={label} className={cn('flex flex-col items-center justify-center gap-1 overflow-hidden rounded-lg bg-slate-100 text-slate-400 ring-1 ring-slate-200', className ?? 'h-40 w-full')}>
      <UserRound className="h-1/3 max-h-12 w-1/3 max-w-12" aria-hidden="true" />
      {!/\bh-(1\d|2\d)\b/.test(className ?? '') && <span className="text-[11px] font-medium">Portrait on file</span>}
    </div>
  );
}
/** An image for a capture when no demo photograph has been supplied. */
export function placeholderFaceUrl(name: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#e2e8f0"/><circle cx="150" cy="150" r="70" fill="#94a3b8"/><ellipse cx="150" cy="370" rx="120" ry="110" fill="#94a3b8"/><text x="150" y="40" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#475569">${name.replace(/[<&>]/g, '')}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/* ---------------- charts ---------------- */

/** Categorical slots (validated palette: slots 1–2) and neutral remainder; status colors for outcomes. */
export const SERIES = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', rest: '#d6d3d1' } as const;
export const STATUS = { good: '#0ca30c', critical: '#d03b3b', serious: '#ec835a', neutral: '#a8a29e' } as const;
const fmt = (n: number) => n.toLocaleString('en-NG');
const pct = (v: number, t: number) => (t ? Math.round((v / t) * 1000) / 10 : 0);

/** A single headline proportion: a labelled meter. */
export function ProgressMeter({ label, value, total, color = SERIES.s1, hint }: { label: string; value: number; total: number; color?: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-900"><span className="text-lg font-semibold">{pct(value, total)}%</span> <span className="text-slate-500">{fmt(value)} of {fmt(total)}</span></span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-valuetext={`${pct(value, total)}% (${fmt(value)} of ${fmt(total)})`}>
        <div className="h-full rounded-full" style={{ width: `${pct(value, total)}%`, background: color }} />
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
      {items.map((i) => <li key={i.label} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} aria-hidden="true" />{i.label}</li>)}
    </ul>
  );
}

export interface StackRow { key: string; label: string; segments: { label: string; value: number; color: string }[]; onSelect?: () => void }

/**
 * 100% horizontal stacked bars, one per row (e.g. institutions): proportions comparable across rows. Each row
 * shows its details on hover or focus; the full figures are in the accompanying table.
 */
export function StackedBars({ rows, ariaLabel }: { rows: StackRow[]; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {rows.map((r) => {
        const total = r.segments.reduce((s, x) => s + x.value, 0);
        const active = hover === r.key;
        const detail = r.segments.map((x) => `${x.label}: ${fmt(x.value)} (${pct(x.value, total)}%)`).join(' · ');
        return (
          <li key={r.key} className="relative grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_1fr]">
            <span className="truncate text-sm text-slate-700" title={r.label}>{r.label}</span>
            <button type="button" onClick={r.onSelect} onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(r.key)} onBlur={() => setHover(null)}
              aria-label={`${r.label}. ${detail}`} className="flex h-5 w-full gap-[2px] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              {r.segments.map((x, i) => x.value > 0 && (
                <span key={x.label} className={cn('h-full', i === r.segments.length - 1 && 'rounded-r', i === 0 && 'rounded-l')} style={{ width: `${(x.value / total) * 100}%`, background: x.color, opacity: hover && !active ? 0.55 : 1 }} />
              ))}
            </button>
            {active && (
              <span role="tooltip" className="pointer-events-none absolute right-0 top-6 z-10 w-72 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
                <span className="block font-semibold">{r.label}</span>
                {r.segments.map((x) => <span key={x.label} className="flex justify-between gap-3"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: x.color }} />{x.label}</span><span className="tabular-nums">{fmt(x.value)} · {pct(x.value, total)}%</span></span>)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Grouped columns: a few measures across a few categories (e.g. admission sessions). One y-axis. */
export function GroupedColumns({ groups, series, ariaLabel }: { groups: { label: string; values: number[] }[]; series: { label: string; color: string }[]; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const W = 520; const H = 220; const left = 46; const bottom = 26; const plotH = H - bottom - 10;
  const gw = (W - left - 10) / groups.length; const bw = Math.min(28, (gw - 24) / series.length);
  const ticks = [0, top / 2, top];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => {
          const y = 10 + plotH - (t / top) * plotH;
          return <g key={t}><line x1={left} x2={W - 10} y1={y} y2={y} stroke="#e7e5e4" /><text x={left - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#78716c">{t >= 1000 ? `${t / 1000}k` : t}</text></g>;
        })}
        {groups.map((g, gi) => {
          const x0 = left + gi * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2;
          return (
            <g key={g.label} onMouseEnter={() => setHover(gi)} onMouseLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(gi)} onBlur={() => setHover(null)}
              aria-label={`${g.label}: ${series.map((s, i) => `${s.label} ${fmt(g.values[i])}`).join(', ')}`} className="outline-none">
              <rect x={left + gi * gw} y={0} width={gw} height={H - bottom} fill={hover === gi ? '#f5f5f4' : 'transparent'} />
              {g.values.map((v, i) => {
                const h = (v / top) * plotH;
                const x = x0 + i * (bw + 2);
                const y = 10 + plotH - h;
                return <path key={i} d={`M${x},${y + h} V${y + Math.min(4, h)} Q${x},${y} ${x + Math.min(4, bw / 2)},${y} H${x + bw - Math.min(4, bw / 2)} Q${x + bw},${y} ${x + bw},${y + Math.min(4, h)} V${y + h} Z`} fill={series[i].color} />;
              })}
              <text x={left + gi * gw + gw / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="#44403c">{g.label}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div role="tooltip" className="pointer-events-none absolute top-0 z-10 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg" style={{ left: `${Math.min(70, ((left + hover * gw) / W) * 100)}%` }}>
          <span className="block font-semibold">{groups[hover].label}</span>
          {series.map((s, i) => <span key={s.label} className="flex justify-between gap-4"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span><span className="tabular-nums">{fmt(groups[hover].values[i])}</span></span>)}
        </div>
      )}
    </div>
  );
}

/** One whole split into states (e.g. verification outcomes): a single bar plus a labelled list with icons. */
export function Distribution({ parts, ariaLabel }: { parts: { label: string; value: number; color: string; icon: ReactNode }[]; ariaLabel: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="flex h-4 w-full gap-[2px]" role="img" aria-label={`${ariaLabel}: ${parts.map((p) => `${p.label} ${fmt(p.value)}`).join(', ')}`}>
        {parts.map((p, i) => p.value > 0 && <span key={p.label} title={`${p.label}: ${fmt(p.value)}`} className={cn('h-full', i === 0 && 'rounded-l', i === parts.length - 1 && 'rounded-r')} style={{ width: `${Math.max(0.6, (p.value / total) * 100)}%`, background: p.color }} />)}
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-slate-700"><span style={{ color: p.color }}>{p.icon}</span>{p.label}</span>
            <span className="tabular-nums text-slate-900">{fmt(p.value)} <span className="text-slate-500">({pct(p.value, total)}%)</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { fmt, pct };
