import '@testing-library/jest-dom/vitest';
import { latency } from '@/services/latency';

latency.min = 0;
latency.max = 0;

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
}

window.scrollTo = () => {};
