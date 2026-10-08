import { initials } from '@/lib/identifiers';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CardDesign, Organization } from '@/domain/types';

export interface CardContent {
  name: string;
  identifier: string;
  credentialTypeName: string;
  relationship?: string;
  unit?: string;
  expiresAt?: string | null;
  issuedAt?: string;
}

/** Deterministic QR-like pattern. Visual only; not a scannable code. */
function PseudoQr({ value, className }: { value: string; className?: string }) {
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
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} className={cn('rounded bg-white', className)} role="img" aria-label="Credential QR code (illustrative)">
      <rect x={-1} y={-1} width={n + 2} height={n + 2} fill="#fff" />
      {cells.map(([x, y]) => <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill="#0f172a" />)}
      {eye(0, 0)}{eye(n - 7, 0)}{eye(0, n - 7)}
    </svg>
  );
}

export function DigitalIdCard({ design, organization, content, className }: { design: CardDesign; organization: Organization; content: CardContent; className?: string }) {
  const show = (f: CardDesign['fields'][number]) => design.fields.includes(f);
  const vertical = design.layout === 'vertical';
  const rows: { label: string; value: string }[] = [];
  if (show('identifier')) rows.push({ label: 'ID number', value: content.identifier });
  if (show('relationship') && content.relationship) rows.push({ label: 'Role', value: content.relationship });
  if (show('unit') && content.unit) rows.push({ label: 'Unit', value: content.unit });
  if (show('issued') && content.issuedAt) rows.push({ label: 'Issued', value: formatDate(content.issuedAt) });
  if (show('expiry')) rows.push({ label: 'Expires', value: content.expiresAt ? formatDate(content.expiresAt) : 'No expiry' });

  return (
    <div
      className={cn('relative overflow-hidden rounded-2xl p-5 shadow-lg ring-1 ring-black/5', vertical ? 'aspect-[5/8] w-64' : 'aspect-[86/54] w-[360px]', className)}
      style={{ background: `linear-gradient(135deg, ${design.primaryColor} 0%, ${design.primaryColor} 55%, ${design.accentColor}33 140%)`, color: design.textColor }}
    >
      <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full opacity-20" style={{ background: design.accentColor }} />
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold" style={{ background: design.accentColor, color: design.primaryColor }}>
              {organization.shortName.slice(0, 3)}
            </span>
            <div className="leading-tight">
              <p className="text-[11px] font-semibold">{organization.name}</p>
              <p className="text-[10px] opacity-75">{content.credentialTypeName}</p>
            </div>
          </div>
        </div>

        <div className={cn('mt-4 flex flex-1 gap-4', vertical ? 'flex-col items-center text-center' : 'items-start')}>
          {design.showPhoto && (
            <div className={cn('flex shrink-0 items-center justify-center rounded-xl bg-white/15 font-semibold ring-2', vertical ? 'h-20 w-20 text-2xl' : 'h-16 w-16 text-lg')} style={{ ['--tw-ring-color' as string]: design.accentColor }}>
              {initials(content.name)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {show('name') && <p className={cn('truncate font-semibold', vertical ? 'text-base' : 'text-[15px]')}>{content.name}</p>}
            <dl className={cn('mt-1.5 space-y-0.5 text-[10.5px]', vertical && 'inline-block text-left')}>
              {rows.map((r) => (
                <div key={r.label} className="flex gap-2">
                  <dt className="w-14 shrink-0 opacity-70">{r.label}</dt>
                  <dd className="truncate font-medium">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {design.showQr && <PseudoQr value={content.identifier} className={cn('shrink-0 p-1', vertical ? 'h-20 w-20' : 'h-16 w-16 self-end')} />}
        </div>
        <div className="mt-2 h-1 w-full rounded-full" style={{ background: design.accentColor }} />
      </div>
    </div>
  );
}
