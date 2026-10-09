import { NavLink, useLocation } from 'react-router-dom';
import { Fingerprint } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAVIGATION } from './navigation';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-300">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Fingerprint className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold text-white">FixID</p>
          <p className="text-[11px] text-slate-400">by Seamfix</p>
        </div>
      </div>
      <nav aria-label="Primary" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAVIGATION.map((group) => (
          <div key={group.label ?? 'top'}>
            {group.label && <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive: exact }) => {
                      const isActive = exact || !!item.alsoActiveOn?.some((p) => pathname === p || pathname.startsWith(`${p}/`));
                      return cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100');
                    }}
                  >
                    <item.icon className="h-[18px] w-[18px]" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
