import { useState, type CSSProperties, type ReactNode } from 'react';
import { RotateCw, UserRound } from 'lucide-react';
import { templateById } from '@/domain/templates';
import type { Organization, TemplateId } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';

export interface CredentialCardContent {
  credentialName: string;
  holderName: string;
  identifierLabel: string;
  identifierValue: string;
  expiresAt?: string | null;
  issuedAt?: string;
  photoUrl?: string;
  /** Organization logo shown instead of the initials, when the credential has one. */
  logoUrl?: string;
  /** Marks illustrative data (e.g. while configuring) so it can't be mistaken for a real credential. */
  sample?: boolean;
}

export type CardSide = 'front' | 'back';

const SIZE = { landscape: { w: 340, h: 214 }, portrait: { w: 214, h: 340 } };

/** Deterministic QR-like pattern. Visual only; not a scannable code. */
function PseudoQr({ value, size }: { value: string; size: number }) {
  const n = 21;
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const cells: [number, number][] = [];
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (finder(x, y)) continue;
      h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
      if (h % 2 === 0) cells.push([x, y]);
    }
  }
  const eye = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} fill="#0f172a" />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="#0f172a" />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} width={size} height={size} className="rounded-sm bg-white" role="img" aria-label="Verification code">
      <rect x={-1} y={-1} width={n + 2} height={n + 2} fill="#fff" />
      {cells.map(([x, y]) => <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill="#0f172a" />)}
      {eye(0, 0)}{eye(n - 7, 0)}{eye(0, n - 7)}
    </svg>
  );
}

/** Fine wave lines used as a security background. */
function Guilloche({ color, opacity = 0.18 }: { color: string; opacity?: number }) {
  const lines = Array.from({ length: 14 }, (_, i) => i);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 340 214" preserveAspectRatio="none" aria-hidden="true">
      {lines.map((i) => (
        <path key={i} d={`M0 ${20 + i * 14} C 60 ${5 + i * 14}, 120 ${40 + i * 14}, 170 ${20 + i * 14} S 280 ${i * 14}, 340 ${22 + i * 14}`}
          fill="none" stroke={color} strokeWidth="0.6" opacity={opacity} />
      ))}
    </svg>
  );
}

function Hologram({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('block rounded-full opacity-80', className)}
      style={{ background: 'conic-gradient(from 90deg, #fde68a, #a7f3d0, #bfdbfe, #f5d0fe, #fde68a)' }} />
  );
}

function Portrait({ url, name, className, style }: { url?: string; name: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn('flex items-center justify-center overflow-hidden bg-slate-200 text-slate-400', className)} style={style}>
      {url ? <img src={url} alt={`Portrait of ${name}`} className="h-full w-full object-cover" /> : <UserRound className="h-1/2 w-1/2" aria-hidden="true" />}
    </div>
  );
}

/**
 * The organization mark in its fixed placeholder: the initials, or an uploaded logo fitted inside the
 * same box (aspect ratio kept, never stretched), so the template's layout doesn't move.
 */
function Logo({ org, bg, fg, className, url }: { org: Organization; bg: string; fg: string; className?: string; url?: string }) {
  if (url) {
    return (
      <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-px', className)}>
        <img src={url} alt={`${org.name} logo`} className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-md font-bold tracking-tight', className)} style={{ background: bg, color: fg }}>
      {org.shortName.slice(0, 3).toUpperCase()}
    </span>
  );
}

/** Diagonal watermark: visible on light and dark designs without covering card content. */
function SampleMark() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <span className="-rotate-[18deg] select-none text-[44px] font-black uppercase tracking-[0.25em]" style={{ color: 'rgba(120,120,120,0.16)' }}>Sample</span>
    </span>
  );
}

const expiryText = (c: CredentialCardContent) => (c.expiresAt ? formatDate(c.expiresAt) : 'No expiry');

/* ------------------------------------------------------------------ */
/* Classic Landscape: formal, navy and gold                            */
/* ------------------------------------------------------------------ */

function ClassicLandscape({ side, org, c }: { side: CardSide; org: Organization; c: CredentialCardContent }) {
  const navy = '#0b2a5b';
  const gold = '#c9a227';
  if (side === 'back') {
    return (
      <div className="relative flex h-full flex-col bg-[#f8f6ef] text-slate-800">
        <Guilloche color={navy} opacity={0.08} />
        <div className="h-7 w-full" style={{ background: navy }} />
        <div className="relative flex flex-1 gap-4 p-4">
          <div className="flex min-w-0 flex-1 flex-col justify-between text-[8px] leading-snug text-slate-600">
            <p>This card is the property of {org.name} and must be presented on request. It is not transferable.</p>
            <p>If found, please return it to {org.name}.</p>
            <div>
              <div className="h-px w-28 bg-slate-400" />
              <p className="mt-0.5 text-[7px] uppercase tracking-wide text-slate-500">Authorized signature</p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <PseudoQr value={c.identifierValue || c.holderName} size={78} />
            <span className="font-mono text-[7px] text-slate-500">{c.identifierValue}</span>
          </div>
        </div>
        <p className="truncate px-4 pb-1.5 font-mono text-[5.5px] uppercase tracking-[0.2em] text-slate-400">{`${org.name} · ${c.credentialName} · `.repeat(4)}</p>
      </div>
    );
  }
  return (
    <div className="relative flex h-full flex-col bg-[#fbfaf6] text-slate-900">
      <Guilloche color={navy} opacity={0.1} />
      <div className="relative flex items-center gap-2 px-4 py-2.5" style={{ background: navy, color: '#fff' }}>
        <Logo org={org} url={c.logoUrl} bg={gold} fg={navy} className="h-7 w-7 text-[10px]" />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[11px] font-semibold">{org.name}</p>
          <p className="truncate text-[8.5px] uppercase tracking-[0.18em]" style={{ color: gold }}>{c.credentialName}</p>
        </div>
      </div>
      <div className="relative flex flex-1 gap-3.5 px-4 pt-3">
        <Portrait url={c.photoUrl} name={c.holderName} className="h-[92px] w-[74px] rounded-md ring-2" style={{ ['--tw-ring-color' as string]: gold }} />
        <div className="min-w-0 flex-1">
          <p className="text-[7.5px] uppercase tracking-wide text-slate-500">Name</p>
          <p className="truncate text-[14px] font-semibold leading-tight">{c.holderName}</p>
          <p className="mt-2 text-[7.5px] uppercase tracking-wide text-slate-500">{c.identifierLabel}</p>
          <p className="truncate font-mono text-[11px] font-semibold" style={{ color: navy }}>{c.identifierValue}</p>
          <p className="mt-2 text-[7.5px] uppercase tracking-wide text-slate-500">Expires</p>
          <p className="text-[10px] font-medium">{expiryText(c)}</p>
        </div>
        <Hologram className="absolute bottom-3 right-4 h-8 w-8" />
      </div>
      <div className="relative h-1.5 w-full" style={{ background: gold }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modern Landscape: minimal, strong typography                         */
/* ------------------------------------------------------------------ */

function ModernLandscape({ side, org, c }: { side: CardSide; org: Organization; c: CredentialCardContent }) {
  const ink = '#111827';
  const accent = '#4f46e5';
  if (side === 'back') {
    return (
      <div className="relative flex h-full flex-col text-white" style={{ background: ink }}>
        <div className="mt-5 h-8 w-full bg-black/70" aria-hidden="true" />
        <div className="flex flex-1 flex-col justify-between p-4">
          <div>
            <p className="text-[10px] font-semibold">Found this card?</p>
            <p className="mt-1 max-w-[230px] text-[8.5px] leading-snug text-white/70">
              Please return it to {org.name}. This card identifies the holder named on the front and remains the property of the issuer.
            </p>
          </div>
          <div className="flex items-end justify-between">
            <p className="text-[8px] text-white/60">{org.name}</p>
            <span className="h-1 w-14 rounded-full" style={{ background: accent }} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex h-full bg-white text-slate-900">
      <div className="w-2.5 shrink-0" style={{ background: `linear-gradient(180deg, ${accent}, #a855f7)` }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo org={org} url={c.logoUrl} bg={ink} fg="#fff" className="h-6 w-6 rounded-full text-[8px]" />
            <p className="truncate text-[10px] font-semibold text-slate-700">{org.name}</p>
          </div>
          <span className="rounded-full px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white" style={{ background: accent }}>{c.credentialName}</span>
        </div>
        <div className="mt-3 flex flex-1 items-center gap-4">
          <Portrait url={c.photoUrl} name={c.holderName} className="h-[86px] w-[86px] rounded-full ring-4 ring-slate-100" />
          <div className="min-w-0 flex-1">
            <p className="text-[19px] font-bold leading-[1.05] tracking-tight">{c.holderName}</p>
            <p className="mt-2.5 text-[8px] font-medium uppercase tracking-[0.16em] text-slate-400">{c.identifierLabel}</p>
            <p className="truncate font-mono text-[12px] font-semibold">{c.identifierValue}</p>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 text-[8px] text-slate-500">
          <span>Expires {expiryText(c)}</span>
          <span className="font-semibold" style={{ color: accent }}>{org.shortName}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Classic Portrait: vertical badge                                    */
/* ------------------------------------------------------------------ */

function ClassicPortrait({ side, org, c }: { side: CardSide; org: Organization; c: CredentialCardContent }) {
  const green = '#0f5e4b';
  const gold = '#d4a72c';
  if (side === 'back') {
    return (
      <div className="relative flex h-full flex-col items-center bg-[#f7f8f5] px-4 py-5 text-center text-slate-700">
        <Guilloche color={green} opacity={0.08} />
        <Logo org={org} url={c.logoUrl} bg={green} fg="#fff" className="relative h-7 w-7 text-[9px]" />
        <div className="relative mt-4"><PseudoQr value={c.identifierValue || c.holderName} size={104} /></div>
        <p className="relative mt-2 font-mono text-[8px] text-slate-500">{c.identifierValue}</p>
        <p className="relative mt-auto text-[7.5px] leading-snug text-slate-500">
          Scan to verify. This badge remains the property of {org.name} and must be returned on request.
        </p>
        <div className="relative mt-3 h-1 w-16 rounded-full" style={{ background: gold }} />
      </div>
    );
  }
  return (
    <div className="relative flex h-full flex-col bg-white text-slate-900">
      <Guilloche color={green} opacity={0.07} />
      <div className="relative flex flex-col items-center px-3 pb-6 pt-3 text-center text-white" style={{ background: green }}>
        <Logo org={org} url={c.logoUrl} bg={gold} fg={green} className="h-7 w-7 text-[9px]" />
        <p className="mt-1.5 line-clamp-2 text-[10px] font-semibold leading-tight">{org.name}</p>
      </div>
      <div className="relative -mt-4 flex justify-center">
        <Portrait url={c.photoUrl} name={c.holderName} className="h-[104px] w-[88px] rounded-lg border-[3px] shadow-sm" style={{ borderColor: gold }} />
      </div>
      <div className="relative flex flex-1 flex-col items-center px-3 pt-2 text-center">
        <p className="line-clamp-2 text-[14px] font-semibold leading-tight">{c.holderName}</p>
        <p className="mt-1 text-[8px] uppercase tracking-[0.16em]" style={{ color: green }}>{c.credentialName}</p>
        <div className="mt-2 w-full rounded-md bg-slate-50 px-2 py-1.5 ring-1 ring-inset ring-slate-200">
          <p className="text-[7px] uppercase tracking-wide text-slate-500">{c.identifierLabel}</p>
          <p className="truncate font-mono text-[10.5px] font-semibold">{c.identifierValue}</p>
        </div>
        <p className="mt-1.5 text-[8px] text-slate-500">Expires {expiryText(c)}</p>
      </div>
      <div className="relative h-2 w-full" style={{ background: `linear-gradient(90deg, ${green}, ${gold})` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modern Portrait: bold colour                                         */
/* ------------------------------------------------------------------ */

function ModernPortrait({ side, org, c }: { side: CardSide; org: Organization; c: CredentialCardContent }) {
  const bg = 'linear-gradient(160deg, #f43f5e 0%, #a21caf 55%, #4c1d95 100%)';
  if (side === 'back') {
    return (
      <div className="relative flex h-full flex-col p-5 text-white" style={{ background: bg }}>
        <div className="absolute -left-10 bottom-10 h-36 w-36 rounded-full bg-white/10" aria-hidden="true" />
        <p className="relative text-[13px] font-bold leading-tight">How to use this card</p>
        <ol className="relative mt-3 list-decimal space-y-1.5 pl-4 text-[8.5px] leading-snug text-white/85">
          <li>Show this card when asked to confirm who you are.</li>
          <li>Keep it with you while on {org.shortName} premises.</li>
          <li>Report a lost card to {org.name} straight away.</li>
        </ol>
        <p className="relative mt-auto text-[8px] text-white/70">If found, please return to {org.name}.</p>
      </div>
    );
  }
  return (
    <div className="relative flex h-full flex-col items-center p-4 text-center text-white" style={{ background: bg }}>
      <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
      <div className="relative flex w-full items-center justify-between">
        <Logo org={org} url={c.logoUrl} bg="#fff" fg="#a21caf" className="h-6 w-6 rounded-full text-[8px]" />
        <span className="text-[8px] font-semibold uppercase tracking-[0.18em] text-white/85">{c.credentialName}</span>
      </div>
      <Portrait url={c.photoUrl} name={c.holderName} className="relative mt-4 h-[96px] w-[96px] rounded-full bg-white/25 text-white/80 ring-4 ring-white/40" />
      <p className="relative mt-3 line-clamp-2 text-[18px] font-extrabold leading-[1.05] tracking-tight">{c.holderName}</p>
      <p className="relative mt-auto text-[7.5px] uppercase tracking-[0.16em] text-white/70">{c.identifierLabel}</p>
      <p className="relative truncate font-mono text-[11px] font-semibold">{c.identifierValue}</p>
      <div className="relative mt-2 flex w-full items-center justify-between border-t border-white/25 pt-1.5 text-[7.5px] text-white/80">
        <span className="truncate">{org.name}</span>
        <span>Exp. {expiryText(c)}</span>
      </div>
    </div>
  );
}

const RENDERERS: Record<TemplateId, (p: { side: CardSide; org: Organization; c: CredentialCardContent }) => ReactNode> = {
  'classic-landscape': ClassicLandscape,
  'modern-landscape': ModernLandscape,
  'classic-portrait': ClassicPortrait,
  'modern-portrait': ModernPortrait,
};

/**
 * One renderer for every digital ID: template previews, configuration previews and issued credentials.
 * `scale` resizes the whole card proportionally.
 */
export function CredentialCard({ templateId, side = 'front', organization, content, scale = 1, className }: {
  templateId: TemplateId; side?: CardSide; organization: Organization; content: CredentialCardContent; scale?: number; className?: string;
}) {
  const t = templateById(templateId);
  const { w, h } = SIZE[t.orientation];
  const Render = RENDERERS[t.id];
  return (
    <div className={cn('shrink-0', className)} style={{ width: w * scale, height: h * scale }}
      role="img" aria-label={`${content.credentialName} for ${content.holderName}, ${t.name}, ${side}`}>
      <div className="relative overflow-hidden rounded-[14px] shadow-lg ring-1 ring-black/10"
        style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {content.sample && <SampleMark />}
        <Render side={side} org={organization} c={content} />
      </div>
    </div>
  );
}

/** Front/back toggle around a CredentialCard. */
export function FlippableCredentialCard(props: Omit<Parameters<typeof CredentialCard>[0], 'side'> & { label?: string }) {
  const [side, setSide] = useState<CardSide>('front');
  return (
    <div className="flex flex-col items-center gap-3">
      <CredentialCard {...props} side={side} />
      <SideToggle side={side} onChange={setSide} label={props.label} />
    </div>
  );
}

export function SideToggle({ side, onChange, label = 'Card side', flipLabel = 'Flip card' }: { side: CardSide; onChange: (s: CardSide) => void; label?: string; flipLabel?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
        {(['front', 'back'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={side === s} onClick={() => onChange(s)}
            className={cn('rounded-md px-3 py-1 capitalize transition-colors', side === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
            {s}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => onChange(side === 'front' ? 'back' : 'front')} aria-label={flipLabel}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        <RotateCw className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
