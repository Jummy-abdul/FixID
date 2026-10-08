import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface DrawerProps {
  open: boolean;
  /** Called for Escape, the close button and the backdrop. The owner decides whether to confirm unsaved changes. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Shows a back arrow, for nested views inside the same drawer surface. */
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg' | 'xl';
}

/** Side drawer: consistent header, scrollable body and sticky footer. One surface at a time; nested views swap its content. */
export function Drawer({ open, onClose, title, description, onBack, children, footer, width = 'lg' }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); } };
    document.addEventListener('keydown', onKey);
    const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button');
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const widths = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-3xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] motion-safe:animate-[fadeIn_150ms_ease-out]" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={cn('relative flex h-full w-full flex-col bg-white shadow-2xl ring-1 ring-slate-200 motion-safe:animate-[slideIn_200ms_ease-out]', widths[width])}>
        <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5 sm:px-8">
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Back" className="-ml-2 mt-0.5 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-6 py-4 sm:px-8">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
