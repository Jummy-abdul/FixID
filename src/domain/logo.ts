/**
 * Credential logos: organization-owned images that replace the initials in a template's logo
 * position. Validated by their actual bytes (not the file name or the browser's declared type).
 */

export type LogoMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export const LOGO_TYPES: LogoMimeType[] = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_LOGO_BYTES = 512 * 1024;
const MIN_SIDE = 16;
const MAX_SIDE = 4096;

export type LogoCheck =
  | { ok: true; mimeType: LogoMimeType; width: number; height: number }
  | { ok: false; error: string };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

/** The image format and pixel size read from the file's own header, or null if it isn't a supported image. */
function sniff(b: Uint8Array): { mimeType: LogoMimeType; width: number; height: number } | null {
  // PNG: signature, then the IHDR chunk with width and height.
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    return { mimeType: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  // JPEG: SOI, then walk the segments to a start-of-frame marker.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xd9 || marker === 0xda) return null;
      const len = u16be(b, i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mimeType: 'image/jpeg', width: u16be(b, i + 7), height: u16be(b, i + 5) };
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF container with a VP8 / VP8L / VP8X chunk.
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') return { mimeType: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mimeType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { mimeType: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    }
  }
  return null;
}

/** Checks an uploaded logo: size, real image format (PNG, JPEG or WebP, matching the declared type) and dimensions. */
export function checkLogo(bytes: Uint8Array, declaredType?: string): LogoCheck {
  if (bytes.length === 0) return { ok: false, error: 'The file is empty.' };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, error: `The logo must be ${MAX_LOGO_BYTES / 1024} KB or smaller.` };
  if (declaredType && !LOGO_TYPES.includes(declaredType as LogoMimeType)) return { ok: false, error: 'Upload a PNG, JPEG or WebP image.' };
  const found = sniff(bytes);
  if (!found) return { ok: false, error: 'This file isn’t a valid PNG, JPEG or WebP image.' };
  if (declaredType && declaredType !== found.mimeType) return { ok: false, error: 'The file’s contents don’t match its type. Upload a PNG, JPEG or WebP image.' };
  if (found.width < MIN_SIDE || found.height < MIN_SIDE) return { ok: false, error: `The logo is too small. Use an image at least ${MIN_SIDE} × ${MIN_SIDE} pixels.` };
  if (found.width > MAX_SIDE || found.height > MAX_SIDE) return { ok: false, error: `The logo is too large. Use an image no bigger than ${MAX_SIDE} × ${MAX_SIDE} pixels.` };
  return { ok: true, ...found };
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: LogoMimeType): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mimeType};base64,${btoa(bin)}`;
}

/** Decodes a stored data URL back to bytes, or null if it isn't one. */
export function dataUrlToBytes(dataUrl: string): { mimeType: string; bytes: Uint8Array } | null {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mimeType: m[1], bytes };
  } catch {
    return null;
  }
}
