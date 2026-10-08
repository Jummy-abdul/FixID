import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Badge } from '@/components/ui';
import { useSession } from '@/store/AppStore';

export function AdminMenu() {
  const { admin, organization } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu"
        className="flex items-center gap-2 rounded-full p-0.5 hover:ring-2 hover:ring-slate-200">
        <Avatar name={admin.name} size="sm" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-72 rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center gap-3">
            <Avatar name={admin.name} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{admin.name}</p>
              <p className="truncate text-xs text-slate-500">{admin.email}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone="brand">{admin.role}</Badge>
            <Badge>{organization.shortName}</Badge>
          </div>
          <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
            Simulated session. Sign-up and login are out of scope for this prototype.
          </p>
          <Link to="/settings" role="menuitem" onClick={() => setOpen(false)} className="mt-3 block rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Organization settings
          </Link>
        </div>
      )}
    </div>
  );
}
