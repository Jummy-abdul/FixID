import { ID1_MM, RENDERED_SHORT_MM } from './printing';

export interface PdfPage { element: HTMLElement; orientation: 'landscape' | 'portrait' }

/** Pixels per CSS pixel when capturing a card: about 600 dpi at ID-1 size, so text and codes stay sharp. */
const PIXEL_RATIO = 6.3;

/**
 * Saves the prepared card pages as a PDF with one ID-1 sized page per card side. Each page is captured from
 * the same rendered cards used for browser printing; the libraries load only when a PDF is requested.
 */
export async function saveCardsPdf(pages: PdfPage[], fileName: string, title: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  if (!pages.length) throw new Error('There are no cards to save.');
  const [{ jsPDF }, { toPng, getFontEmbedCSS }] = await Promise.all([import('jspdf'), import('html-to-image')]);
  const cardOf = (el: HTMLElement) => (el.querySelector('[role="img"]') as HTMLElement | null) ?? el;
  // Web fonts are embedded once for the whole file. If they can't be loaded, the system font is used rather
  // than failing the export.
  let fonts: { fontEmbedCSS: string } | { skipFonts: true };
  try { fonts = { fontEmbedCSS: await getFontEmbedCSS(cardOf(pages[0].element)) }; } catch { fonts = { skipFonts: true }; }
  const capture = async (el: HTMLElement) => {
    try {
      return await toPng(el, { pixelRatio: PIXEL_RATIO, ...fonts });
    } catch {
      return toPng(el, { pixelRatio: PIXEL_RATIO, skipFonts: true });
    }
  };
  const size = (o: PdfPage['orientation']): [number, number] => (o === 'landscape' ? [ID1_MM.long, ID1_MM.short] : [ID1_MM.short, ID1_MM.long]);
  const first = pages[0].orientation;
  const doc = new jsPDF({ unit: 'mm', format: size(first), orientation: first === 'landscape' ? 'l' : 'p', compress: true });
  doc.setProperties({ title, creator: 'FixID' });
  for (let i = 0; i < pages.length; i++) {
    const { element, orientation } = pages[i];
    const [w, h] = size(orientation);
    if (i > 0) doc.addPage([w, h], orientation === 'landscape' ? 'l' : 'p');
    const png = await capture(cardOf(element));
    // The design keeps its own aspect ratio: full long edge, centred on the short edge.
    if (orientation === 'landscape') doc.addImage(png, 'PNG', 0, (h - RENDERED_SHORT_MM) / 2, w, RENDERED_SHORT_MM);
    else doc.addImage(png, 'PNG', (w - RENDERED_SHORT_MM) / 2, 0, RENDERED_SHORT_MM, h);
    onProgress?.(i + 1, pages.length);
  }
  doc.save(fileName);
}
