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
 * Portraits of the three university demonstration scenarios (fictional, AI-generated), in public/demo/faces/jamb/
 * (see its README): the JAMB registration portrait, the NIN record's portrait and the face the simulated "Capture Face" reveals.
 * Served as static files; anything missing falls back to a neutral placeholder.
 */
type FaceKind = 'jamb' | 'nin' | 'live' | 'reference';
export const FACE_SETS: Record<string, string> = { 'U-A': 's1', 'U-B': 's2', 'U-C': 's3', 'N-A': 'nysc_a', 'N-B': 'nysc_b', 'N-C': 'nysc_c' };
/** Paths under public/demo/faces/. Each candidate has its own files; none are shared across candidates. */
const FACE_FILES: Record<string, Partial<Record<FaceKind, string>>> = {
  s1: { jamb: 'jamb/s1_jamb.jpg', nin: 'jamb/s1_nin.jpg', live: 'jamb/s1_live.jpg' },
  s2: { jamb: 'jamb/s2_jamb.jpg', nin: 'jamb/s2_nin.jpg', live: 'jamb/s2_live.jpg' },
  // Scenario 3 has only the registered portrait; the person presenting is the same student.
  s3: { jamb: 'jamb/s3_jamb.jpg', live: 'jamb/s3_jamb.jpg' },
  // NYSC candidates (public/demo/faces/nysc/): JAMB profile photograph, NIN identity photograph, simulated live capture.
  // `reference` is the face captured and stored at the candidate's university admission clearance on FixID.
  // A: the same person as the NYSC live capture. B: a different person. C has no clearance, so no reference.
  nysc_a: { jamb: 'nysc/nysc_a_jamb.jpg', nin: 'nysc/nysc_a_nin.jpg', live: 'nysc/nysc_a_live.jpg', reference: 'nysc/nysc_a_jamb.jpg' },
  nysc_b: { jamb: 'nysc/nysc_b_jamb.jpg', nin: 'nysc/nysc_b_nin.jpg', live: 'nysc/nysc_b_live.jpg', reference: 'nysc/nysc_b_jamb.jpg' },
  nysc_c: { jamb: 'nysc/nysc_c_jamb.jpg', nin: 'nysc/nysc_c_nin.jpg', live: 'nysc/nysc_c_live.jpg' },
};
export const facePath = (set: string, kind: FaceKind): string | undefined => {
  const file = FACE_FILES[set]?.[kind];
  return file ? `/demo/faces/${file}` : undefined;
};
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

/** The predefined face the simulated capture reveals for the student (for a test candidate, as documented). */
export function demoFace(r: Pick<StudentRecord, 'reg' | 'gender'>): string | undefined {
  const set = faceSet(r.reg);
  if (set) return facePath(set, 'live');
  const s = scenarioByReg(r.reg);
  if (s) return byName('candidates', `${s.id}-demo`) ?? (s.demoFace === 'same-person' ? byName('candidates', `${s.id}-registration`) : undefined);
  return registrationPortrait(r);
}

/**
 * What the student's JAMB image is. For the examination-impersonation scenario the face JAMB holds is the one
 * recorded at examination verification (the impersonator's), so it must not be called the registration portrait.
 */
export function jambPortraitLabel(r: Pick<StudentRecord, 'reg'>): string {
  const s = scenarioByReg(r.reg);
  if (s?.university === 'exam-mismatch') return 'JAMB examination verification record';
  return s?.workspace === 'nysc' ? 'JAMB profile photograph' : 'JAMB registration portrait';
}

/**
 * The FixID reference image: the face captured and stored at the candidate's university admission clearance on
 * FixID. Only a completed clearance has one; nothing is substituted when it is missing.
 */
export function clearanceReferenceImage(r: Pick<StudentRecord, 'reg' | 'clearance'>): string | undefined {
  if (r.clearance !== 'cleared') return undefined;
  const set = faceSet(r.reg);
  return set ? facePath(set, 'reference') ?? facePath(set, 'live') : undefined;
}

/**
 * The Scenario 4 registrant (valid JAMB registration, no admission record). Reuses an existing demo image that no
 * other screen displays; the simulated capture shows the same person.
 */
const REGISTRANT_FACES: Record<string, string> = { '20250190104KE': '/demo/faces/nysc/nysc_c_nin.jpg' };
export const registrantPortrait = (reg: string): string | undefined => REGISTRANT_FACES[reg.trim().toUpperCase()];
