/**
 * Photographs and fingerprint images for identity records. The photo library holds the archived portraits that
 * identity records can reference; uploaded photographs are stored with the record (resized).
 */
export interface LibraryPhoto { id: string; url: string; person: string }

const LIB: [string, string, string][] = [
  ['jamb', 's1_jamb.jpg', 'p01'], ['jamb', 's1_nin.jpg', 'p01'], ['jamb', 's1_live.jpg', 'p01'],
  ['jamb', 's2_jamb.jpg', 'p02'], ['jamb', 's2_nin.jpg', 'p03'], ['jamb', 's2_live.jpg', 'p03'],
  ['jamb', 's3_jamb.jpg', 'p04'],
  ['nysc', 'nysc_a_jamb.jpg', 'p05'], ['nysc', 'nysc_a_nin.jpg', 'p05'], ['nysc', 'nysc_a_live.jpg', 'p05'],
  ['nysc', 'nysc_b_jamb.jpg', 'p06'], ['nysc', 'nysc_b_nin.jpg', 'p07'], ['nysc', 'nysc_b_live.jpg', 'p07'],
  ['nysc', 'nysc_c_jamb.jpg', 'p08'], ['nysc', 'nysc_c_nin.jpg', 'p08'], ['nysc', 'nysc_c_live.jpg', 'p08'],
];
export const PHOTO_LIBRARY: LibraryPhoto[] = LIB.map(([dir, file, person], i) => ({ id: `PH-${String(i + 1).padStart(4, '0')}`, url: `/demo/faces/${dir}/${file}`, person }));
export const photoUrl = (name: string) => PHOTO_LIBRARY.find((p) => p.url.endsWith(`/${name}`))!.url;

/** The face the person presenting shows at capture: a different photograph of the NIN record's holder, where one exists. */
const PRESENTING: Record<string, string> = Object.fromEntries([
  ['s1_nin.jpg', 's1_live.jpg'], ['s2_nin.jpg', 's2_live.jpg'], ['nysc_a_nin.jpg', 'nysc_a_live.jpg'], ['nysc_b_nin.jpg', 'nysc_b_live.jpg'], ['nysc_c_nin.jpg', 'nysc_c_live.jpg'],
].map(([a, b]) => [photoUrl(a), photoUrl(b)]));

/**
 * Which person a photograph shows (photographs of one person share an identity). A photograph uploaded to a
 * candidate's record is the enrolled candidate's own photograph.
 */
export const personOf = (url: string | undefined, owner = 'candidate'): string | undefined => (url ? PHOTO_LIBRARY.find((p) => p.url === url)?.person ?? `r-${owner}` : undefined);
export function presentingFace(ninPhoto: string | undefined, jambPhoto: string | undefined): string | undefined {
  const ref = ninPhoto ?? jambPhoto;
  return ref ? PRESENTING[ref] ?? ref : undefined;
}

/** A fingerprint image for an identity (the same person always gives the same ridge pattern). */
export function fingerprintImage(identity: string): string {
  let seed = 0; for (const c of identity) seed = (seed * 33 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const tilt = (rnd() - 0.5) * 24;
  const cx = 100 + (rnd() - 0.5) * 16, cy = 118 + (rnd() - 0.5) * 16;
  const paths: string[] = [];
  for (let i = 1; i <= 17; i++) {
    const rx = 5 + i * 4.6 + rnd() * 2, ry = 7 + i * 5.6 + rnd() * 2.5;
    const gap = 20 + rnd() * 60, start = rnd() * 360;
    paths.push(`<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" stroke-dasharray="${(rx * 4).toFixed(0)} ${gap.toFixed(0)}" stroke-dashoffset="${start.toFixed(0)}" />`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240"><rect width="200" height="240" fill="#f8fafc"/><clipPath id="f"><ellipse cx="100" cy="120" rx="78" ry="104"/></clipPath><g clip-path="url(#f)" fill="none" stroke="#334155" stroke-width="2.6" stroke-linecap="round" transform="rotate(${tilt.toFixed(1)} 100 120)">${paths.join('')}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Reads an uploaded photograph, resized so records stay small. */
export function readPhoto(file: File, max = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error('Choose an image file (JPEG or PNG).')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file couldn’t be read.'));
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onerror = () => resolve(src);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(src); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
