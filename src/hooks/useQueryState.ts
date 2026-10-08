import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Filter state stored in the URL, so filtered views are linkable (e.g. from the dashboard). */
export function useQueryState(key: string, fallback = ''): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const setValue = useCallback(
    (v: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!v || v === fallback) next.delete(key);
        else next.set(key, v);
        next.delete('page');
        return next;
      }, { replace: true });
    },
    [key, fallback, setParams],
  );
  return [value, setValue];
}

export function usePageParam(): [number, (p: number) => void] {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const setPage = useCallback((p: number) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) next.delete('page'); else next.set('page', String(p));
      return next;
    }, { replace: true });
  }, [setParams]);
  return [page, setPage];
}
