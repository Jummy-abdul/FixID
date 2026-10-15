import { saveCardsPdf } from '@/components/credentials/print/pdf';
import { ID1_MM, RENDERED_SHORT_MM } from '@/components/credentials/print/printing';

const calls: { ctor?: unknown; pages: unknown[][]; images: unknown[][]; saved?: string; props?: unknown } = { pages: [], images: [] };
vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor(opts: unknown) { calls.ctor = opts; }
    setProperties(p: unknown) { calls.props = p; }
    addPage(...a: unknown[]) { calls.pages.push(a); }
    addImage(...a: unknown[]) { calls.images.push(a); }
    save(name: string) { calls.saved = name; }
  },
}));
const toPng = vi.fn(async () => 'data:image/png;base64,AAA');
vi.mock('html-to-image', () => ({ toPng: (...a: unknown[]) => toPng(...(a as [])), getFontEmbedCSS: async () => '' }));

const page = (orientation: 'landscape' | 'portrait') => {
  const element = document.createElement('section');
  const card = document.createElement('div');
  card.setAttribute('role', 'img');
  element.appendChild(card);
  return { element, orientation, card };
};

describe('PDF export', () => {
  it('writes one ID-1 page per card side, keeping each design’s proportions', async () => {
    const pages = [page('landscape'), page('landscape'), page('portrait')];
    const progress: number[] = [];
    await saveCardsPdf(pages, 'cards.pdf', 'Cards', (n) => progress.push(n));
    expect(calls.ctor).toMatchObject({ unit: 'mm', format: [ID1_MM.long, ID1_MM.short], orientation: 'l' });
    expect(calls.pages).toEqual([[[ID1_MM.long, ID1_MM.short], 'l'], [[ID1_MM.short, ID1_MM.long], 'p']]);
    const gap = (ID1_MM.short - RENDERED_SHORT_MM) / 2;
    expect(calls.images.map((i) => i.slice(2).map((v) => Number((v as number).toFixed(3))))).toEqual([
      [0, Number(gap.toFixed(3)), 85.6, Number(RENDERED_SHORT_MM.toFixed(3))],
      [0, Number(gap.toFixed(3)), 85.6, Number(RENDERED_SHORT_MM.toFixed(3))],
      [Number(gap.toFixed(3)), 0, Number(RENDERED_SHORT_MM.toFixed(3)), 85.6],
    ]);
    // Each page is captured from the rendered card itself, at about 600 dpi.
    expect(toPng.mock.calls.map((c) => (c as unknown[])[0])).toEqual(pages.map((p) => p.card));
    expect((toPng.mock.calls[0] as unknown[])[1]).toMatchObject({ pixelRatio: 6.3 });
    expect(calls.saved).toBe('cards.pdf');
    expect(calls.props).toMatchObject({ title: 'Cards' });
    expect(progress).toEqual([1, 2, 3]);
  });

  it('refuses an empty batch', async () => {
    await expect(saveCardsPdf([], 'x.pdf', 'x')).rejects.toThrow('There are no cards to save.');
  });
});
