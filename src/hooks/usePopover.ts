import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Open/close state for a trigger + popover pair: closes on outside click and Escape,
 * returning focus to the trigger on Escape.
 */
export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<T>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => { if (!containerRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return { open, setOpen, toggle: () => setOpen((o) => !o), close, containerRef, triggerRef };
}

/** Arrow/Home/End navigation between `[role="menuitem"]` elements inside a menu. */
export function handleMenuKeys(e: React.KeyboardEvent<HTMLElement>, columns = 1) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  const move: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
  let next = -1;
  if (e.key in move) next = i < 0 ? 0 : Math.min(items.length - 1, Math.max(0, i + move[e.key]));
  if (e.key === 'Home') next = 0;
  if (e.key === 'End') next = items.length - 1;
  if (next >= 0) {
    e.preventDefault();
    items[next]?.focus();
  }
}
