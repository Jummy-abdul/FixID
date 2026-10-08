import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grip } from 'lucide-react';
import { APPLICATIONS, CURRENT_APPLICATION_ID, type SeamfixApplication } from '@/config/applications';
import { handleMenuKeys, usePopover } from '@/hooks/usePopover';
import { cn } from '@/lib/cn';

const COLUMNS = 3;

export function AppLauncher() {
  const { open, toggle, close, containerRef, triggerRef } = usePopover();
  const [notice, setNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    else setNotice(null);
  }, [open]);

  const select = (app: SeamfixApplication) => {
    if (app.id === CURRENT_APPLICATION_ID) {
      close();
      if (app.route) navigate(app.route);
      return;
    }
    if (app.url) {
      close();
      window.location.assign(app.url);
      return;
    }
    setNotice(`${app.name} navigation is not configured yet.`);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-label="Applications"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls="app-launcher-menu"
          className={cn('peer flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
            open && 'bg-slate-100 text-slate-800')}
        >
          <Grip className="h-5 w-5" />
        </button>
        {!open && (
          <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white opacity-0 peer-hover:opacity-100 peer-focus-visible:opacity-100">
            Applications
          </span>
        )}
      </div>
      {open && (
        <div id="app-launcher-menu" ref={menuRef} role="menu" aria-label="Seamfix applications" onKeyDown={(e) => handleMenuKeys(e, COLUMNS)}
          className="absolute right-0 z-40 mt-2 w-80 rounded-2xl bg-white p-3 shadow-xl ring-1 ring-slate-200">
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Seamfix applications</p>
          <div className="grid grid-cols-3 gap-1">
            {APPLICATIONS.map((app) => {
              const current = app.id === CURRENT_APPLICATION_ID;
              const configured = current || !!app.url;
              return (
                <button key={app.id} type="button" role="menuitem" onClick={() => select(app)}
                  aria-current={current ? 'true' : undefined}
                  aria-description={configured ? app.description : `${app.description}. Not configured`}
                  className={cn('flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    current && 'bg-brand-50/70 ring-1 ring-inset ring-brand-200 hover:bg-brand-50')}>
                  <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', app.tone, !configured && 'opacity-60')}>
                    <app.icon className="h-5 w-5" />
                  </span>
                  <span className={cn('text-sm font-medium', configured ? 'text-slate-900' : 'text-slate-500')}>{app.name}</span>
                  <span className={cn('text-[10px] font-medium uppercase tracking-wide', current ? 'text-brand-700' : 'text-slate-400')}>
                    {current ? 'Current' : configured ? 'Open' : 'Not configured'}
                  </span>
                </button>
              );
            })}
          </div>
          <p aria-live="polite" className={cn('mt-2 rounded-lg px-2.5 py-2 text-xs', notice ? 'bg-amber-50 text-amber-800' : 'sr-only')}>
            {notice ?? ''}
          </p>
        </div>
      )}
    </div>
  );
}
