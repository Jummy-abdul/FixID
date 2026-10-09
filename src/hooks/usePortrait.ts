import { portraitOf } from '@/domain/portrait';
import type { Member } from '@/domain/types';
import { useLoadedImage } from './useLoadedImage';

/** The member's enrolled portrait, only once the image is actually available. */
export function usePortrait(member: Member | undefined) {
  const p = member ? portraitOf(member) : null;
  const url = useLoadedImage(p?.url);
  return p && url ? { url, isSample: p.isSample } : null;
}
