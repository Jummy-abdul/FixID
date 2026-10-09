import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { handleMenuKeys } from '@/hooks/usePopover';
import { cn } from '@/lib/cn';

export interface OverflowMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  onSelect: () => void;
}

/**
 * Three-dot row menu. Rendered in a portal with fixed positioning so scrollable tables don't clip it.
 * Closes on outside click, Escape, scroll and resize.
 */
export function OverflowMenu({ label, items }: { label: string; items: OverflowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const below = r.bottom + 4;
    const top = below + menuHeight > window.innerHeight - 8 && r.top - menuHeight - 4 > 8 ? r.top - menuHeight - 4 : below;
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    const onMove = () => setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close]);

  return (
    <>
      <button ref={triggerRef} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" aria-label={label} onKeyDown={(e) => handleMenuKeys(e)}
          style={{ top: pos?.top ?? -9999, right: pos?.right ?? 0 }}
          className="fixed z-50 w-56 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
          {items.map((item) => (
            <button key={item.key} type="button" role="menuitem"
              onClick={(e) => { e.stopPropagation(); setOpen(false); item.onSelect(); }}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none',
                item.tone === 'danger' ? 'text-red-700' : 'text-slate-700')}>
              {item.icon && <span className={cn('h-4 w-4 shrink-0', item.tone === 'danger' ? 'text-red-500' : 'text-slate-400')} aria-hidden="true">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
