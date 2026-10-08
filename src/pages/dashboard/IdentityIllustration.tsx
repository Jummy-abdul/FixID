import { useId } from 'react';
import { cn } from '@/lib/cn';

/** Pattern for the illustrative QR block (1 = filled). */
const QR = [
  '1110101', '1010011', '1110110', '0001010', '1101111', '0110001', '1011101',
];

/**
 * Digital identity illustration: an issued ID card with a verification badge.
 * Decorative only; hidden from assistive technology.
 */
export function IdentityIllustration({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, '');
  const cardFill = `card-${uid}`;
  const shadow = `shadow-${uid}`;
  const glow = `glow-${uid}`;

  return (
    <svg viewBox="0 0 460 340" className={cn('h-auto w-full', className)} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={cardFill} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d2d8b" />
          <stop offset="1" stopColor="#2147ee" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#dae6ff" />
          <stop offset="1" stopColor="#eef4ff" stopOpacity="0" />
        </radialGradient>
        <filter id={shadow} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#1d2d8b" floodOpacity="0.22" />
        </filter>
      </defs>

      {/* Backdrop */}
      <circle cx="235" cy="170" r="160" fill={`url(#${glow})`} />
      <circle cx="235" cy="170" r="128" fill="none" stroke="#bdd3ff" strokeWidth="1.5" strokeDasharray="3 7" />

      {/* Template card behind */}
      <g transform="rotate(8 260 160)" opacity="0.9">
        <rect x="150" y="70" width="236" height="148" rx="18" fill="#ffffff" stroke="#dae6ff" strokeWidth="1.5" />
        <rect x="170" y="92" width="64" height="8" rx="4" fill="#dae6ff" />
        <rect x="170" y="110" width="110" height="6" rx="3" fill="#eef4ff" />
        <rect x="170" y="124" width="90" height="6" rx="3" fill="#eef4ff" />
      </g>

      {/* Issued digital ID */}
      <g className="motion-safe:animate-float" style={{ transformOrigin: '220px 180px' }}>
        <g transform="rotate(-5 220 180)" filter={`url(#${shadow})`}>
          <rect x="92" y="98" width="262" height="164" rx="20" fill={`url(#${cardFill})`} />
          <circle cx="330" cy="112" r="60" fill="#5c8dfd" opacity="0.18" />
          {/* Organization mark + title */}
          <rect x="114" y="120" width="26" height="26" rx="7" fill="#f5b301" />
          <rect x="148" y="123" width="88" height="8" rx="4" fill="#ffffff" opacity="0.95" />
          <rect x="148" y="137" width="54" height="6" rx="3" fill="#ffffff" opacity="0.55" />
          {/* Portrait */}
          <rect x="114" y="164" width="62" height="70" rx="12" fill="#ffffff" opacity="0.14" stroke="#f5b301" strokeWidth="2" />
          <circle cx="145" cy="189" r="12" fill="#ffffff" opacity="0.85" />
          <path d="M124 228c3-14 12-21 21-21s18 7 21 21" fill="#ffffff" opacity="0.85" />
          {/* Details */}
          <rect x="190" y="168" width="96" height="9" rx="4.5" fill="#ffffff" />
          <rect x="190" y="187" width="70" height="6" rx="3" fill="#ffffff" opacity="0.6" />
          <rect x="190" y="200" width="82" height="6" rx="3" fill="#ffffff" opacity="0.6" />
          <rect x="190" y="213" width="58" height="6" rx="3" fill="#ffffff" opacity="0.6" />
          {/* QR */}
          <rect x="290" y="186" width="48" height="48" rx="6" fill="#ffffff" />
          {QR.flatMap((row, y) => [...row].map((c, x) => (c === '1'
            ? <rect key={`${x}-${y}`} x={295 + x * 5.4} y={191 + y * 5.4} width="4.6" height="4.6" rx="0.8" fill="#1d2d8b" />
            : null)))}
          <rect x="114" y="246" width="224" height="4" rx="2" fill="#f5b301" />
        </g>
      </g>

      {/* Verified badge */}
      <g className="motion-safe:animate-float-delayed" style={{ transformOrigin: '352px 96px' }}>
        <circle cx="352" cy="96" r="30" fill="#ffffff" />
        <circle cx="352" cy="96" r="24" fill="#059669" />
        <path d="M341 96.5l7.5 7.5 14-15" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Identity chip */}
      <g className="motion-safe:animate-float-delayed" style={{ transformOrigin: '92px 270px' }}>
        <rect x="52" y="240" width="80" height="60" rx="16" fill="#ffffff" stroke="#dae6ff" strokeWidth="1.5" />
        <g fill="none" stroke="#3766f9" strokeWidth="2.4" strokeLinecap="round">
          <path d="M80 262a12 12 0 0 1 24 0v6" />
          <path d="M86 266v-3a6 6 0 0 1 12 0v9" />
          <path d="M92 263v14" />
          <path d="M76 270v-6" />
          <path d="M104 274v2" />
        </g>
      </g>

      {/* Sparkles */}
      <g fill="#90b6ff">
        <circle cx="70" cy="110" r="4" />
        <circle cx="398" cy="210" r="5" />
        <circle cx="300" cy="300" r="3" />
      </g>
      <path d="M408 132v14M401 139h14" stroke="#5c8dfd" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M58 168v10M53 173h10" stroke="#bdd3ff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
