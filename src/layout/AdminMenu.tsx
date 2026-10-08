import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { handleMenuKeys, usePopover } from '@/hooks/usePopover';
import { useSession } from '@/store/AppStore';

export function AdminMenu() {
  const { admin } = useSession();
  const { open, toggle, close, containerRef, triggerRef } = usePopover();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button ref={triggerRef} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls="profile-menu"
        aria-label={`Account menu for ${admin.name}`}
        className="flex items-center rounded-full p-0.5 hover:ring-2 hover:ring-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <Avatar name={admin.name} initials={admin.initials} size="sm" />
      </button>
      {open && (
        <div id="profile-menu" ref={menuRef} role="menu" aria-label="Account" onKeyDown={(e) => handleMenuKeys(e)}
          className="absolute right-0 z-40 mt-2 w-64 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <Avatar name={admin.name} initials={admin.initials} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{admin.name}</p>
              <p className="truncate text-xs text-slate-500">{admin.email}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-slate-100" />
          <Link to="/profile" role="menuitem" onClick={() => close()}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
            <UserRound className="h-4 w-4 text-slate-400" />
            My Profile
          </Link>
        </div>
      )}
    </div>
  );
}
