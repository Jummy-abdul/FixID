import type { ReactNode } from 'react';
import { Fingerprint } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Layered digital ID cards on a soft brand gradient. Decorative. */
function AuthIllustration() {
  return (
    <svg viewBox="0 0 520 420" className="h-auto w-full max-w-[520px]" aria-hidden="true">
      <defs>
        <linearGradient id="au-card1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#e0e7ff" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="au-card2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e3a8a" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
        <linearGradient id="au-card3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f43f5e" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
        <radialGradient id="au-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="260" cy="210" r="200" fill="url(#au-glow)" />
      <circle cx="430" cy="70" r="6" fill="#ffffff" opacity="0.5" />
      <circle cx="80" cy="340" r="4" fill="#ffffff" opacity="0.45" />
      <path d="M60 110c40-30 90-40 140-24" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="1.5" fill="none" strokeDasharray="4 6" />

      {/* Back card: portrait badge */}
      <g transform="rotate(-12 150 220)">
        <rect x="70" y="110" width="150" height="230" rx="18" fill="url(#au-card3)" />
        <circle cx="145" cy="190" r="34" fill="#ffffff" opacity="0.28" />
        <circle cx="145" cy="180" r="13" fill="#ffffff" opacity="0.8" />
        <path d="M120 212c6-18 44-18 50 0" fill="#ffffff" opacity="0.8" />
        <rect x="95" y="245" width="100" height="10" rx="5" fill="#ffffff" opacity="0.9" />
        <rect x="110" y="265" width="70" height="7" rx="3.5" fill="#ffffff" opacity="0.55" />
      </g>

      {/* Middle card: classic landscape */}
      <g transform="rotate(6 320 200)">
        <rect x="190" y="120" width="260" height="164" rx="18" fill="url(#au-card2)" />
        <rect x="190" y="120" width="260" height="40" rx="18" fill="#ffffff" opacity="0.08" />
        <rect x="208" y="134" width="20" height="14" rx="3" fill="#fbbf24" />
        <rect x="236" y="137" width="90" height="8" rx="4" fill="#ffffff" opacity="0.85" />
        <rect x="208" y="176" width="62" height="78" rx="8" fill="#ffffff" opacity="0.2" stroke="#fbbf24" strokeWidth="2" />
        <circle cx="239" cy="205" r="11" fill="#ffffff" opacity="0.8" />
        <path d="M222 236c5-14 29-14 34 0" fill="#ffffff" opacity="0.8" />
        <rect x="286" y="180" width="110" height="10" rx="5" fill="#ffffff" opacity="0.95" />
        <rect x="286" y="200" width="80" height="7" rx="3.5" fill="#ffffff" opacity="0.55" />
        <rect x="286" y="216" width="96" height="7" rx="3.5" fill="#ffffff" opacity="0.55" />
        <circle cx="420" cy="252" r="12" fill="#fde68a" opacity="0.85" />
      </g>

      {/* Front card: verified */}
      <g transform="rotate(-3 300 300)">
        <rect x="150" y="240" width="250" height="140" rx="18" fill="url(#au-card1)" />
        <rect x="170" y="262" width="44" height="44" rx="12" fill="#2563eb" />
        <path d="M182 284l7 7 14-15" stroke="#ffffff" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="228" y="268" width="120" height="10" rx="5" fill="#1e293b" opacity="0.85" />
        <rect x="228" y="288" width="84" height="7" rx="3.5" fill="#64748b" opacity="0.5" />
        <rect x="170" y="326" width="210" height="8" rx="4" fill="#cbd5e1" />
        <rect x="170" y="344" width="150" height="8" rx="4" fill="#e2e8f0" />
      </g>
    </svg>
  );
}

/**
 * Split-screen frame shared by sign-up, verification, password, sign-in, recovery and onboarding.
 * On small screens the illustration panel is hidden so the form comes first.
 */
export function AuthLayout({ children, footer, wide = false }: { children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen bg-white">
      <div className="flex w-full flex-col px-5 py-6 sm:px-10 lg:w-1/2 lg:px-16 xl:px-24">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><Fingerprint className="h-5 w-5" aria-hidden="true" /></span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold text-slate-900">FixID</p>
            <p className="text-[11px] text-slate-500">by Seamfix</p>
          </div>
        </div>
        <main className="flex flex-1 items-center py-10">
          <div className={cn('w-full', wide ? 'max-w-lg' : 'max-w-md')}>{children}</div>
        </main>
        {footer && <div className="text-sm text-slate-500">{footer}</div>}
      </div>
      <aside className="relative hidden overflow-hidden lg:flex lg:w-1/2 lg:flex-col lg:items-center lg:justify-center"
        style={{ background: 'linear-gradient(145deg, #1d4ed8 0%, #2563eb 40%, #4f46e5 100%)' }}>
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10" aria-hidden="true" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-indigo-400/20" aria-hidden="true" />
        <div className="relative w-full max-w-xl px-12">
          <AuthIllustration />
          <div className="mt-10 text-white">
            <p className="text-3xl font-semibold tracking-tight">Identity, made simple.</p>
            <p className="mt-3 max-w-md text-lg text-blue-100">Create, issue, and manage digital credentials with confidence.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function AuthHeading({ title, description, eyebrow }: { title: string; description?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-8">
      {eyebrow && <div className="mb-4">{eyebrow}</div>}
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {description && <p className="mt-2 text-slate-500">{description}</p>}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{children}</p>;
}
