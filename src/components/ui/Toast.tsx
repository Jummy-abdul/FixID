import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: ToastTone; title: string; description?: string }

const ToastContext = createContext<((t: Omit<ToastItem, 'id'>) => void) | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = nextId++;
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    error: <XCircle className="h-5 w-5 text-red-500" />,
    info: <Info className="h-5 w-5 text-brand-500" />,
  };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role="status" className={cn('pointer-events-auto flex items-start gap-3 rounded-lg bg-white p-4 shadow-lg ring-1 ring-slate-200')}>
            {icons[t.tone]}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{t.title}</p>
              {t.description && <p className="mt-0.5 text-sm text-slate-500">{t.description}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss notification">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside ToastProvider');
  return push;
}
