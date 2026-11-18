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

/** The original JAMB registration portrait, when one is supplied. */
export function registrationPortrait(r: Pick<StudentRecord, 'reg' | 'gender'>): string | undefined {
  const s = scenarioByReg(r.reg);
  if (s) return byName('candidates', `${s.id}-registration`);
  const list = pool(r.gender === 'Female' ? 'female' : 'male');
  return list.length ? list[hash(r.reg) % list.length] : undefined;
}

/** The predefined face "Use Demo Face" loads for the student (for a test candidate, as documented). */
export function demoFace(r: Pick<StudentRecord, 'reg' | 'gender'>): string | undefined {
  const s = scenarioByReg(r.reg);
  if (s) return byName('candidates', `${s.id}-demo`) ?? (s.demoFace === 'same-person' ? byName('candidates', `${s.id}-registration`) : undefined);
  return registrationPortrait(r);
}
