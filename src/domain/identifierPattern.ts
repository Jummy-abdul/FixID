import type { DateFormat, IdentifierConfig, IdentifierSegment } from './types';

export const DATE_FORMATS: DateFormat[] = ['YYYY', 'YY', 'MM', 'DD', 'YYYYMM', 'YYYYMMDD'];
export const SEPARATORS = ['-', '/', '_', '.'] as const;

export const SEGMENT_LABEL: Record<IdentifierSegment['kind'], string> = {
  static: 'Static text',
  separator: 'Separator',
  sequence: 'Sequential number',
  'random-numeric': 'Random numbers',
  'random-alphanumeric': 'Random letters and numbers',
  date: 'Date',
};

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, to avoid confusion with 1 and 0
const DIGITS = '0123456789';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';

/** Errors keyed by segment id, plus `pattern` for whole-pattern problems. */
export type PatternErrors = Record<string, string>;

export function validatePattern(segments: IdentifierSegment[]): PatternErrors {
  const errors: PatternErrors = {};
  if (segments.length === 0) {
    errors.pattern = 'Add at least one segment.';
    return errors;
  }
  if (!segments.some((s) => s.kind === 'sequence' || s.kind === 'random-numeric' || s.kind === 'random-alphanumeric')) {
    errors.pattern = 'Add a sequential or random segment so every identifier is different.';
  }
  if (segments.filter((s) => s.kind === 'sequence').length > 1) errors.pattern = 'Use only one sequential number.';
  for (const s of segments) {
    switch (s.kind) {
      case 'static':
        if (!s.value) errors[s.id] = 'Enter the text.';
        else if (!/^[A-Za-z0-9]{1,12}$/.test(s.value)) errors[s.id] = 'Use up to 12 letters or numbers.';
        break;
      case 'separator':
        if (!SEPARATORS.includes(s.value)) errors[s.id] = 'Choose a separator.';
        break;
      case 'sequence':
        if (!Number.isInteger(s.start) || s.start < 0 || s.start > 999_999_999) errors[s.id] = 'Start from a whole number of 0 or more.';
        else if (!Number.isInteger(s.digits) || s.digits < 1 || s.digits > 10) errors[s.id] = 'Use 1 to 10 digits.';
        else if (s.zeroPad && String(s.start).length > s.digits) errors[s.id] = `The starting number has more than ${s.digits} digits.`;
        break;
      case 'random-numeric':
      case 'random-alphanumeric':
        if (!Number.isInteger(s.length) || s.length < 3 || s.length > 16) errors[s.id] = 'Use a length between 3 and 16.';
        break;
      case 'date':
        if (!DATE_FORMATS.includes(s.format)) errors[s.id] = 'Choose a supported date format.';
        break;
    }
  }
  const length = segments.reduce((n, s) => n + segmentLength(s), 0);
  if (length > 40) errors.pattern = 'Identifiers can be at most 40 characters.';
  return errors;
}

function segmentLength(s: IdentifierSegment): number {
  switch (s.kind) {
    case 'static': return s.value.length;
    case 'separator': return 1;
    case 'sequence': return s.digits;
    case 'random-numeric':
    case 'random-alphanumeric': return s.length;
    case 'date': return s.format.length;
  }
}

/** Calendar parts of `date` in the organization's time zone. */
export function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { yyyy: get('year'), mm: get('month'), dd: get('day') };
}

function formatDate(format: DateFormat, date: Date, timeZone: string): string {
  const { yyyy, mm, dd } = dateParts(date, timeZone);
  switch (format) {
    case 'YYYY': return yyyy;
    case 'YY': return yyyy.slice(2);
    case 'MM': return mm;
    case 'DD': return dd;
    case 'YYYYMM': return `${yyyy}${mm}`;
    case 'YYYYMMDD': return `${yyyy}${mm}${dd}`;
  }
}

export interface RenderContext {
  sequence: number;
  date: Date;
  timeZone: string;
  /** Returns a number in [0, 1). */
  random: () => number;
}

export function renderPattern(segments: IdentifierSegment[], ctx: RenderContext): string {
  const pick = (chars: string) => chars[Math.floor(ctx.random() * chars.length)];
  return segments.map((s) => {
    switch (s.kind) {
      case 'static': return s.value;
      case 'separator': return s.value;
      case 'sequence': return s.zeroPad ? String(ctx.sequence).padStart(s.digits, '0') : String(ctx.sequence);
      case 'random-numeric': return Array.from({ length: s.length }, () => pick(DIGITS)).join('');
      case 'random-alphanumeric': return Array.from({ length: s.length }, () => pick(s.charset === 'upper' ? UPPER + DIGITS : UPPER + LOWER + DIGITS)).join('');
      case 'date': return formatDate(s.format, ctx.date, ctx.timeZone);
    }
  }).join('');
}

/** Deterministic pseudo-random source so previews don't flicker and never consume anything. */
export function seededRandom(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

/** The sequence value the next assignment will use, honoring a raised starting number. */
export function effectiveNextSequence(segments: IdentifierSegment[], nextSequence: number): number {
  const seq = segments.find((s) => s.kind === 'sequence');
  return seq && seq.kind === 'sequence' ? Math.max(nextSequence, seq.start) : nextSequence;
}

/** Example of the next identifier. Pure: does not advance the sequence or reserve anything. */
export function previewIdentifier(segments: IdentifierSegment[], nextSequence: number, timeZone: string, now = new Date()): string {
  return renderPattern(segments, {
    sequence: effectiveNextSequence(segments, nextSequence),
    date: now,
    timeZone,
    random: seededRandom(segments.map((s) => s.id).join('|')),
  });
}

/** Short human description, e.g. "STU / YYYY / 00001". */
export function describePattern(segments: IdentifierSegment[]): string {
  return segments.map((s) => {
    switch (s.kind) {
      case 'static': return s.value;
      case 'separator': return s.value;
      case 'sequence': return s.zeroPad ? '#'.repeat(s.digits) : '#…';
      case 'random-numeric': return '9'.repeat(s.length);
      case 'random-alphanumeric': return 'X'.repeat(s.length);
      case 'date': return s.format;
    }
  }).join('');
}

export interface GeneratedIdentifier { value: string; nextSequence: number }

/**
 * Generates the next unique identifier for a configuration.
 * Skips sequence values already taken and retries random segments on collision.
 */
export function generateIdentifier(
  config: Pick<IdentifierConfig, 'segments' | 'nextSequence'>,
  taken: (value: string) => boolean,
  timeZone: string,
  now: Date,
  random: () => number = Math.random,
): GeneratedIdentifier | null {
  const hasSequence = config.segments.some((s) => s.kind === 'sequence');
  let sequence = effectiveNextSequence(config.segments, config.nextSequence);
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = renderPattern(config.segments, { sequence, date: now, timeZone, random });
    if (!taken(value)) return { value, nextSequence: hasSequence ? sequence + 1 : config.nextSequence };
    if (hasSequence) sequence++;
  }
  return null;
}

export function newSegmentId() {
  return `seg_${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultSegment(kind: IdentifierSegment['kind']): IdentifierSegment {
  const id = newSegmentId();
  switch (kind) {
    case 'static': return { id, kind, value: 'ID' };
    case 'separator': return { id, kind, value: '-' };
    case 'sequence': return { id, kind, start: 1, digits: 5, zeroPad: true };
    case 'random-numeric': return { id, kind, length: 6 };
    case 'random-alphanumeric': return { id, kind, length: 6, charset: 'upper' };
    case 'date': return { id, kind, format: 'YYYY' };
  }
}

/** Starting pattern for a suggested identifier name. Always editable. */
export function suggestedSegments(name: string): IdentifierSegment[] {
  const code = name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ID';
  const lower = name.toLowerCase();
  const prefix = lower.includes('matric') ? 'STU' : lower.includes('staff') ? 'STF' : lower.includes('employee') ? 'EMP' : lower.includes('member') ? 'MEM' : code;
  return [
    { id: newSegmentId(), kind: 'static', value: prefix },
    { id: newSegmentId(), kind: 'separator', value: '/' },
    { id: newSegmentId(), kind: 'date', format: 'YYYY' },
    { id: newSegmentId(), kind: 'separator', value: '/' },
    { id: newSegmentId(), kind: 'sequence', start: 1, digits: 5, zeroPad: true },
  ];
}

/** Rules for manually entered identifier values. */
export function validateManualValue(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter a value.';
  if (!/^[A-Za-z0-9][A-Za-z0-9/._-]{0,39}$/.test(v)) return 'Use up to 40 letters, numbers, /, ., - or _.';
  return null;
}
