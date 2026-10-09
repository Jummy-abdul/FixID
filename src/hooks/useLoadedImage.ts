import { useEffect, useState } from 'react';

/** Returns the URL once the image has loaded, so missing images fall back cleanly everywhere they're used. */
export function useLoadedImage(url: string | undefined): string | undefined {
  const [loaded, setLoaded] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setLoaded(url); };
    img.src = url;
    return () => { cancelled = true; };
  }, [url]);
  return url && loaded === url ? url : undefined;
}
