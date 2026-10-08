import { useState } from 'react';
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import type { DailyDecisions } from '@/domain/metrics';

/** Reserved status colours: always paired with an icon and label in the legend. */
const SERIES = [
  { key: 'allow', label: 'Allowed', color: '#059669', Icon: CheckCircle2 },
  { key: 'deny', label: 'Denied', color: '#dc2626', Icon: XCircle },
  { key: 'indeterminate', label: 'Indeterminate', color: '#d97706', Icon: CircleHelp },
] as const;

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function DecisionChart({ data }: { data: DailyDecisions[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 200, padL = 32, padB = 22, padT = 8;
  const max = Math.max(4, ...data.map((d) => d.total));
  const niceMax = Math.ceil(max / 4) * 4 || 4;
  const plotH = H - padB - padT;
  const slot = (W - padL) / data.length;
  const barW = Math.min(28, slot * 0.62);
  const y = (v: number) => (v / niceMax) * plotH;
  const ticks = [0, niceMax / 4, niceMax / 2, (3 * niceMax) / 4, niceMax];
  const hovered = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4" aria-hidden="true">
        {SERIES.map(({ key, label, color, Icon }) => (
          <span key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
            <Icon className="h-3.5 w-3.5 text-slate-400" />
            {label}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Verification decisions per day for the last 14 days" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W} y1={padT + plotH - y(t)} y2={padT + plotH - y(t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={padL - 6} y={padT + plotH - y(t) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">{t}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = padL + slot * i + slot / 2;
            let acc = 0;
            const segs = SERIES.map((s) => {
              const v = d[s.key];
              const h = y(v);
              const seg = { ...s, v, h, top: padT + plotH - acc - h };
              acc += h;
              return seg;
            }).filter((s) => s.v > 0);
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={padL + slot * i} y={padT} width={slot} height={plotH} fill={hover === i ? '#f1f5f9' : 'transparent'} />
                {segs.map((s, si) => {
                  const isTop = si === segs.length - 1;
                  const gap = si > 0 ? 2 : 0;
                  const h = Math.max(0, s.h - gap);
                  const r = isTop ? Math.min(4, h / 2, barW / 2) : 0;
                  const x0 = cx - barW / 2, y0 = s.top, x1 = cx + barW / 2, y1 = s.top + h;
                  const path = r > 0
                    ? `M${x0},${y1} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x1 - r} Q${x1},${y0} ${x1},${y0 + r} V${y1} Z`
                    : `M${x0},${y1} V${y0} H${x1} V${y1} Z`;
                  return <path key={s.key} d={path} fill={s.color} />;
                })}
                {(i % 2 === (data.length - 1) % 2) && (
                  <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill="#94a3b8">{dayFmt.format(d.date)}</text>
                )}
              </g>
            );
          })}
        </svg>
        {hovered && hover !== null && (
          <div className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-lg bg-white p-2.5 text-xs shadow-lg ring-1 ring-slate-200"
            style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}>
            <p className="mb-1 font-semibold text-slate-900">{weekdayFmt.format(hovered.date)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center justify-between text-slate-600">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                <span className="font-medium tabular-nums text-slate-900">{hovered[s.key]}</span>
              </p>
            ))}
            <p className="mt-1 flex justify-between border-t border-slate-100 pt-1 text-slate-600"><span>Total</span><span className="font-medium tabular-nums text-slate-900">{hovered.total}</span></p>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Verification decisions per day</caption>
        <thead><tr><th>Date</th><th>Allowed</th><th>Denied</th><th>Indeterminate</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.date.toISOString()}><td>{dayFmt.format(d.date)}</td><td>{d.allow}</td><td>{d.deny}</td><td>{d.indeterminate}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
