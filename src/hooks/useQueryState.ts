import { useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

/**
 * Updates made from one render (e.g. a "Clear filters" handler calling several setters) must build on each
 * other: React Router hands every functional update the parameters of the last render, so without this only
 * the last setter would take effect. The pending parameters are kept per location until the next render.
 */
let pending: { locationKey: string; params: URLSearchParams } | null = null;
function useParamUpdater() {
  const [, setParams] = useSearchParams();
  const { key: locationKey } = useLocation();
  return useCallback((change: (next: URLSearchParams) => void) => {
    setParams((prev) => {
      const base = pending && pending.locationKey === locationKey ? pending.params : prev;
      const next = new URLSearchParams(base);
      change(next);
      pending = { locationKey, params: next };
      return next;
    }, { replace: true });
  }, [setParams, locationKey]);
}

/** Filter state stored in the URL, so filtered views are linkable (e.g. from the dashboard). */
export function useQueryState(key: string, fallback = ''): [string, (v: string) => void] {
  const [params] = useSearchParams();
  const update = useParamUpdater();
  const value = params.get(key) ?? fallback;
  const setValue = useCallback((v: string) => update((next) => {
    if (!v || v === fallback) next.delete(key);
    else next.set(key, v);
    next.delete('page');
  }), [key, fallback, update]);
  return [value, setValue];
}

export function usePageParam(): [number, (p: number) => void] {
  const [params] = useSearchParams();
  const update = useParamUpdater();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const setPage = useCallback((p: number) => update((next) => {
    if (p <= 1) next.delete('page'); else next.set('page', String(p));
  }), [update]);
  return [page, setPage];
}
