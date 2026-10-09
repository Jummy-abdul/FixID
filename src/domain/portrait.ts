import type { Member } from './types';

/** The display portrait, shown only after successful portrait enrollment. Never an admin upload. */
export function portraitOf(m: Member): { url: string; isSample: boolean } | null {
  const e = m.faceEnrollment;
  return e.status === 'enrolled' && e.portraitUrl ? { url: e.portraitUrl, isSample: !!e.portraitIsSample } : null;
}
