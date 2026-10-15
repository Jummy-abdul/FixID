import type { Credential } from '@/domain/types';

/**
 * Credential printing. Cards are printed at the ISO/IEC 7810 ID-1 ("ATM card") size. The existing card
 * renderer draws every template on a 340 × 214 px base (portrait: 214 × 340), which is printed scaled so its
 * long edge is exactly 85.60 mm. Its aspect ratio (1.5888) is very slightly wider than ID-1's (1.5858), so the
 * short edge comes out at 53.88 mm instead of 53.98 mm: the 0.1 mm difference is left as margin on the page
 * rather than stretching the design.
 */
export const ID1_MM = { long: 85.6, short: 53.98 } as const;
export const CARD_BASE_PX = { long: 340, short: 214 } as const;
/** CSS pixels per millimetre (CSS defines 96 px per inch). */
export const PX_PER_MM = 96 / 25.4;
/** Scale that makes the renderer's long edge exactly 85.60 mm when printed. */
export const PRINT_SCALE = (ID1_MM.long * PX_PER_MM) / CARD_BASE_PX.long;
/** Printed short edge of the rendered design, in millimetres (53.88). */
export const RENDERED_SHORT_MM = (CARD_BASE_PX.short * ID1_MM.long) / CARD_BASE_PX.long;

/** Why a credential can't be printed, or null when it can: only active, current credentials are printed. */
export function printProblem(c: Pick<Credential, 'status' | 'expiresAt' | 'effectiveFrom'>, now = new Date()): string | null {
  if (c.status === 'suspended') return 'Credential suspended';
  if (c.status === 'revoked') return 'Credential revoked';
  if (c.status === 'pending') return 'Credential not yet active';
  if (c.status === 'expired' || (c.expiresAt && new Date(c.expiresAt) <= now)) return 'Credential expired';
  if (new Date(c.effectiveFrom) > now) return 'Credential not yet active';
  return null;
}

export const isPrintable = (c: Pick<Credential, 'status' | 'expiresAt' | 'effectiveFrom'>, now = new Date()) => printProblem(c, now) === null;

/** A safe file name for a downloaded PDF. */
export function pdfFileName(parts: string[]): string {
  const base = parts.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${base || 'credentials'}.pdf`;
}
