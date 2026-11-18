import type { StudentRecord } from './data';
import { scenarioByReg } from './scenarios';

/**
 * Photographic portraits, if supplied (see assets/portraits/README.md). Resolved at build time: adding a file
 * is enough. Registration portraits are JAMB's reference images; demo faces stand in for a live capture.
 */
const files = import.meta.glob('./assets/portraits/**/*.{jpg,jpeg,png,webp}', { eager: true, import: 'default' }) as Record<string, string>;
const byName = (dir: string, stem: string) => Object.entries(files).find(([p]) => p.startsWith(`./assets/portraits/${dir}/${stem}.`))?.[1];
const pool = (gender: 'female' | 'male') => Object.entries(files).filter(([p]) => p.startsWith(`./assets/portraits/pool/${gender}-`)).sort(([a], [b]) => a.localeCompare(b)).map(([, url]) => url);
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * The three university demonstration scenarios use face sets in public/demo/faces/ (see its README):
 * <set>-jamb.png (JAMB registration), <set>-nin.png (NIN identity record) and <set>-live.png (live capture for
 * "Use Demo Face"). Served as static files, so a missing image falls back to a neutral placeholder.
 */
export const FACE_SETS: Record<string, string> = { 'U-A': 'success-student', 'U-B': 'discrepancy-student', 'U-C': 'duplicate-clearance-student' };
export const facePath = (set: string, kind: 'jamb' | 'nin' | 'live') => `/demo/faces/${set}-${kind}.png`;
const faceSet = (reg: string) => { const s = scenarioByReg(reg); return s ? FACE_SETS[s.id] : undefined; };

/** The NIN identity record's portrait, for the demonstration scenarios. */
export function ninPortrait(r: Pick<StudentRecord, 'reg'>): string | undefined {
  const set = faceSet(r.reg);
  return set ? facePath(set, 'nin') : undefined;
}

/** Resolves to the image when it loads, otherwise to the fallback (e.g. a face not yet supplied). */
export function loadImage(url: string | undefined, fallback: string): Promise<string> {
  if (!url) return Promise.resolve(fallback);
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => resolve(fallback), 4000);
    img.onload = () => { window.clearTimeout(timer); resolve(url); };
    img.onerror = () => { window.clearTimeout(timer); resolve(fallback); };
    img.src = url;
  });
}

/** The original JAMB registration portrait, when one is supplied. */
export function registrationPortrait(r: Pick<StudentRecord, 'reg' | 'gender'>): string | undefined {
  const set = faceSet(r.reg);
  if (set) return facePath(set, 'jamb');
  const s = scenarioByReg(r.reg);
  if (s) return byName('candidates', `${s.id}-registration`);
  const list = pool(r.gender === 'Female' ? 'female' : 'male');
  return list.length ? list[hash(r.reg) % list.length] : undefined;
}

/** The predefined face "Use Demo Face" loads for the student (for a test candidate, as documented). */
export function demoFace(r: Pick<StudentRecord, 'reg' | 'gender'>): string | undefined {
  const set = faceSet(r.reg);
  if (set) return facePath(set, 'live');
  const s = scenarioByReg(r.reg);
  if (s) return byName('candidates', `${s.id}-demo`) ?? (s.demoFace === 'same-person' ? byName('candidates', `${s.id}-registration`) : undefined);
  return registrationPortrait(r);
}
