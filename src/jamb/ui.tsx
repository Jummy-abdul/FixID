import { useState, type ReactNode } from 'react';
import { Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, LogOut, MinusCircle, XCircle } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';
import type { StudentRecord } from './data';
import jambLogo from './assets/jamb-logo.png';
import { JAMB_PERSONAS, type ConsoleRole } from './personas';
import type { Officer } from './store';

/* ---------------- access and layout ---------------- */

/** Only the matching demo account opens a console; everyone else goes to their own home. */
export function RequireConsole({ role, children }: { role: ConsoleRole; children: ReactNode }) {
  const { account } = useAuth();
  const location = useLocation();
  if (!account) return <Navigate to="/signin" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (account.consoleRole !== role) return <Navigate to={homeFor(account)} replace />;
  return <>{children}</>;
}

/** The signed-in officer, for the store's permission checks. */
export function useOfficer(): Officer {
  const { account } = useAuth();
  const p = JAMB_PERSONAS.find((x) => x.accountId === account?.id);
  return { name: p ? `${p.firstName} ${p.lastName}` : 'Officer', role: p?.consoleRole ?? 'jamb-officer', institution: p?.institution };
}

export interface NavItem { label: string; to: string; end?: boolean }

/**
 * A JAMB Identity Verification & Clearance console: JAMB is the platform identity; a university officer's
 * console adds the institution as context. One discreet "Demo environment" label in the footer discloses that
 * records are illustrative and verification responses simulated. Chrome is hidden when printing.
 */
export function ConsoleShell({ context, nav, roleLabel, children }: { context?: { title: string; subtitle: string }; nav: NavItem[]; roleLabel: string; children: ReactNode }) {
  const { account, signOut } = useAuth();
  const navigate = useNavigate();
  const name = [account?.firstName, account?.lastName].filter(Boolean).join(' ');
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="bg-emerald-950 text-white print:hidden">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <JambLogo />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-base font-semibold">JAMB Identity Verification &amp; Clearance</p>
              <p className="truncate text-xs text-emerald-100/80">Joint Admissions and Matriculation Board</p>
            </div>
          </div>
          {context && (
            <div className="min-w-0 border-l border-white/20 pl-5 leading-tight" aria-label="Institution">
              <p className="truncate text-sm font-semibold">{context.title}</p>
              <p className="truncate text-xs text-emerald-100/80">{context.subtitle}</p>
            </div>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-right leading-tight md:block">
              <span className="block font-medium">{name}</span>
              <span className="block text-xs text-white/70">{roleLabel}</span>
            </span>
            <Button size="sm" variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={() => { signOut(); navigate('/signin', { replace: true }); }}>Sign out</Button>
          </div>
        </div>
        <nav aria-label="Console" className="mx-auto w-full max-w-7xl overflow-x-auto px-4 sm:px-6 lg:px-8">
          <ul className="flex gap-1">
            {nav.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={({ isActive }) => cn('block whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-slate-50 text-slate-900' : 'text-white/80 hover:bg-white/10 hover:text-white')}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">{children}</main>
      <footer className="mx-auto w-full max-w-7xl px-4 pb-6 sm:px-6 lg:px-8 print:hidden">
        <DemoEnvironment />
      </footer>
    </div>
  );
}

/** The single, discreet disclosure: illustrative records and simulated verification responses. */
export function DemoEnvironment() {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
      <span className="rounded-full bg-slate-200/70 px-2 py-0.5 font-medium text-slate-500">Demo environment</span>
      <span>Illustrative records; identity verification responses are simulated.</span>
    </p>
  );
}

/** The JAMB logo, on a white disc so it reads on the dark header. Replace src/jamb/assets/jamb-logo.png to update it. */
export function JambLogo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-white p-0.5 shadow-sm', size === 'lg' ? 'h-16 w-16' : 'h-12 w-12')}>
      <img src={jambLogo} alt="Joint Admissions and Matriculation Board logo" className="h-full w-full object-contain" />
    </span>
  );
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

/* ---------------- illustrative portraits ---------------- */

/**
 * A drawn, clearly illustrative portrait (never a photograph or derived from anyone). The same student keeps
 * the same features across stages; the stage changes the background.
 */
export function Portrait({ seed, gender, stage, label, className }: { seed: string; gender: StudentRecord['gender']; stage: 'registration' | 'exam' | 'clearance'; label: string; className?: string }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const skin = ['#8a5a3c', '#a66a43', '#6e4630', '#b47a52', '#7c5034'][h % 5];
  const hair = ['#1f1b18', '#2f2a26', '#140f0c'][(h >> 3) % 3];
  const bg = { registration: '#e0e7ff', exam: '#dcfce7', clearance: '#fef3c7' }[stage];
  const shirt = { registration: '#4f46e5', exam: '#15803d', clearance: '#b45309' }[stage];
  return (
    <svg viewBox="0 0 120 140" role="img" aria-label={`${label} (illustrative drawing)`} className={cn('h-36 w-full rounded-lg bg-white', className)}>
      <rect width="120" height="140" fill={bg} rx="6" />
      <ellipse cx="60" cy="130" rx="44" ry="28" fill={shirt} />
      {gender === 'Female' && <ellipse cx="60" cy="58" rx="33" ry="38" fill={hair} />}
      <ellipse cx="60" cy="62" rx="25" ry="30" fill={skin} />
      <path d={gender === 'Female' ? 'M33 58 Q60 14 87 58 Q84 34 60 30 Q36 34 33 58Z' : 'M36 50 Q60 24 84 50 Q80 36 60 33 Q40 36 36 50Z'} fill={hair} />
      <circle cx="50" cy="62" r="2.6" fill="#111827" /><circle cx="70" cy="62" r="2.6" fill="#111827" />
      <path d="M52 78 Q60 83 68 78" stroke="#3f1d0b" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** A deterministic, clearly simulated "capture" used when no camera is available. */
export function simulatedCaptureDataUrl(seed: string, gender: StudentRecord['gender']) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const skin = ['#8a5a3c', '#a66a43', '#6e4630', '#b47a52', '#7c5034'][h % 5];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140"><rect width="120" height="140" fill="#fef3c7"/><ellipse cx="60" cy="130" rx="44" ry="28" fill="#b45309"/>${gender === 'Female' ? '<ellipse cx="60" cy="58" rx="33" ry="38" fill="#1f1b18"/>' : ''}<ellipse cx="60" cy="62" rx="25" ry="30" fill="${skin}"/><circle cx="50" cy="62" r="2.6" fill="#111827"/><circle cx="70" cy="62" r="2.6" fill="#111827"/><path d="M52 78 Q60 83 68 78" stroke="#3f1d0b" stroke-width="2" fill="none"/></svg>`;
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
