import { ArrowDown, ArrowUp, CalendarDays, Hash, Minus, Plus, Shuffle, Trash2, Type } from 'lucide-react';
import { Input, Select } from '@/components/ui';
import {
  DATE_FORMATS, SEGMENT_LABEL, SEPARATORS, defaultSegment, effectiveNextSequence, renderPattern, seededRandom, type PatternErrors,
} from '@/domain/identifierPattern';
import type { IdentifierSegment } from '@/domain/types';
import { cn } from '@/lib/cn';

const KIND_STYLE: Record<IdentifierSegment['kind'], { icon: typeof Type; chip: string }> = {
  static: { icon: Type, chip: 'bg-brand-50 text-brand-800 ring-brand-200' },
  separator: { icon: Minus, chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  sequence: { icon: Hash, chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  'random-numeric': { icon: Shuffle, chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  'random-alphanumeric': { icon: Shuffle, chip: 'bg-violet-50 text-violet-800 ring-violet-200' },
  date: { icon: CalendarDays, chip: 'bg-sky-50 text-sky-800 ring-sky-200' },
};

const ADD_ORDER: IdentifierSegment['kind'][] = ['static', 'separator', 'date', 'sequence', 'random-numeric', 'random-alphanumeric'];

function SegmentFields({ segment, onChange, timeZone }: { segment: IdentifierSegment; onChange: (s: IdentifierSegment) => void; timeZone: string }) {
  const label = (text: string, control: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">{text}{control}</label>
  );
  switch (segment.kind) {
    case 'static':
      return label('Text', <Input value={segment.value} maxLength={12} placeholder="e.g. ID" className="h-9 w-40 font-mono uppercase"
        onChange={(e) => onChange({ ...segment, value: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />);
    case 'separator':
      return (
        <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          <span id={`${segment.id}-sep`}>Character</span>
          <div role="radiogroup" aria-labelledby={`${segment.id}-sep`} className="flex gap-1">
            {SEPARATORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={segment.value === c} aria-label={`Separator ${c}`}
                onClick={() => onChange({ ...segment, value: c })}
                className={cn('h-9 w-9 rounded-lg border font-mono text-sm', segment.value === c ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400')}>
                {c}
              </button>
            ))}
          </div>
        </div>
      );
    case 'sequence':
      return (
        <div className="flex flex-wrap items-end gap-3">
          {label('Start at', <Input type="number" min={0} value={Number.isNaN(segment.start) ? '' : segment.start} className="h-9 w-28"
            onChange={(e) => onChange({ ...segment, start: e.target.value === '' ? Number.NaN : Number(e.target.value) })} />)}
          {label('Digits', (
            <Select value={segment.digits} className="h-9 w-24" onChange={(e) => onChange({ ...segment, digits: Number(e.target.value) })}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          ))}
          <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={segment.zeroPad}
              onChange={(e) => onChange({ ...segment, zeroPad: e.target.checked })} />
            Pad with zeros
          </label>
        </div>
      );
    case 'random-numeric':
      return label('Length', <Input type="number" min={3} max={16} value={Number.isNaN(segment.length) ? '' : segment.length} className="h-9 w-24"
        onChange={(e) => onChange({ ...segment, length: e.target.value === '' ? Number.NaN : Number(e.target.value) })} />);
    case 'random-alphanumeric':
      return (
        <div className="flex flex-wrap items-end gap-3">
          {label('Length', <Input type="number" min={3} max={16} value={Number.isNaN(segment.length) ? '' : segment.length} className="h-9 w-24"
            onChange={(e) => onChange({ ...segment, length: e.target.value === '' ? Number.NaN : Number(e.target.value) })} />)}
          {label('Characters', (
            <Select value={segment.charset} className="h-9 w-56" onChange={(e) => onChange({ ...segment, charset: e.target.value as 'upper' | 'mixed' })}>
              <option value="upper">Capital letters and numbers</option>
              <option value="mixed">Mixed-case letters and numbers</option>
            </Select>
          ))}
        </div>
      );
    case 'date':
      return (
        <div className="flex flex-wrap items-end gap-3">
          {label('Format', (
            <Select value={segment.format} className="h-9 w-36" onChange={(e) => onChange({ ...segment, format: e.target.value as typeof segment.format })}>
              {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          ))}
          <p className="pb-2 text-xs text-slate-500">Date the user is added ({timeZone})</p>
        </div>
      );
  }
}

export function PatternBuilder({ segments, onChange, errors, timeZone, nextSequence }: {
  segments: IdentifierSegment[];
  onChange: (segments: IdentifierSegment[]) => void;
  errors?: PatternErrors;
  timeZone: string;
  /** Next value of an existing configuration's sequence, so the preview shows what comes next. */
  nextSequence: number;
}) {
  const update = (i: number, s: IdentifierSegment) => onChange(segments.map((x, j) => (j === i ? s : x)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...segments];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item);
    onChange(next);
  };
  const random = seededRandom(segments.map((s) => s.id).join('|'));
  const sequence = effectiveNextSequence(segments, nextSequence);
  const now = new Date();

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-slate-900 p-5 text-white">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Identifier preview</p>
        <p className="mt-2 min-h-[2.25rem] break-all font-mono text-2xl font-semibold tracking-wide" aria-live="polite" data-testid="identifier-preview">
          {segments.length === 0
            ? <span className="text-base font-normal text-slate-500">Add segments to build the identifier</span>
            : segments.map((s) => (
              <span key={s.id} className={cn('rounded px-0.5', errors?.[s.id] && 'bg-red-500/30')}>
                {renderPattern([s], { sequence, date: now, timeZone, random })}
              </span>
            ))}
        </p>
        <p className="mt-2 text-xs text-slate-400">Example only. Nothing is reserved until a user is created.</p>
      </div>

      {errors?.pattern && <p role="alert" className="text-sm text-red-600">{errors.pattern}</p>}

      <ol className="space-y-2" aria-label="Pattern segments">
        {segments.map((s, i) => {
          const style = KIND_STYLE[s.kind];
          return (
            <li key={s.id} className={cn('rounded-xl border bg-white p-3', errors?.[s.id] ? 'border-red-300' : 'border-slate-200')}>
              <div className="flex flex-wrap items-start gap-3">
                <span className={cn('mt-5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold ring-1 ring-inset', style.chip)}>
                  <style.icon className="h-3.5 w-3.5" aria-hidden="true" /> {i + 1}. {SEGMENT_LABEL[s.kind]}
                </span>
                <div className="min-w-0 flex-1"><SegmentFields segment={s} timeZone={timeZone} onChange={(n) => update(i, n)} /></div>
                <div className="mt-5 flex shrink-0 items-center gap-0.5">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${SEGMENT_LABEL[s.kind]} up`}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" disabled={i === segments.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${SEGMENT_LABEL[s.kind]} down`}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => onChange(segments.filter((_, j) => j !== i))} aria-label={`Remove ${SEGMENT_LABEL[s.kind]}`}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              {errors?.[s.id] && <p role="alert" className="mt-2 text-sm text-red-600">{errors[s.id]}</p>}
            </li>
          );
        })}
      </ol>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Add segment</p>
        <div className="flex flex-wrap gap-2">
          {ADD_ORDER.map((kind) => {
            const Icon = KIND_STYLE[kind].icon;
            return (
              <button key={kind} type="button" onClick={() => onChange([...segments, defaultSegment(kind)])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /><Icon className="h-3.5 w-3.5" aria-hidden="true" />{SEGMENT_LABEL[kind]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
