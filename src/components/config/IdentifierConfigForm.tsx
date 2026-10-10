import { Field, Input } from '@/components/ui';
import { suggestedSegments, type PatternErrors } from '@/domain/identifierPattern';
import type { IdentifierConfig, IdentifierSegment } from '@/domain/types';
import { cn } from '@/lib/cn';
import { PatternBuilder } from './PatternBuilder';

export interface IdentifierFormValue {
  name: string;
  mode: 'manual' | 'generated';
  segments: IdentifierSegment[];
}

export function initialIdentifierForm(existing?: IdentifierConfig, suggestedName = ''): IdentifierFormValue {
  if (existing) return { name: existing.name, mode: existing.mode, segments: existing.segments };
  return { name: suggestedName, mode: 'generated', segments: suggestedSegments(suggestedName || 'ID') };
}

function ModeOption({ checked, onSelect, title, description }: { checked: boolean; onSelect: () => void; title: string; description: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect}
      className={cn('flex w-full items-start gap-3 rounded-xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        checked ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', checked ? 'border-brand-600 bg-brand-600' : 'border-slate-300')}>
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-sm text-slate-500">{description}</span>
      </span>
    </button>
  );
}

/** The identifier configuration body. Shared by the identifier drawer and the nested view in the credential drawer. */
export function IdentifierConfigForm({ value, onChange, errors, timeZone, existing }: {
  value: IdentifierFormValue;
  onChange: (v: IdentifierFormValue) => void;
  errors: { name?: string; segments?: PatternErrors };
  timeZone: string;
  existing?: IdentifierConfig;
}) {
  return (
    <div className="space-y-8">
      <section>
        <Field label="Identifier name" required error={errors.name} hint="For example Employee ID, Membership Number or Staff ID.">
          {(p) => <Input {...p} data-autofocus value={value.name} maxLength={40} onChange={(e) => onChange({ ...value, name: e.target.value })} />}
        </Field>
      </section>

      <section>
        <p id="assignment-label" className="mb-3 text-sm font-semibold text-slate-900">How should this identifier be assigned?</p>
        <div role="radiogroup" aria-labelledby="assignment-label" className="grid gap-3 sm:grid-cols-2">
          <ModeOption checked={value.mode === 'manual'} onSelect={() => onChange({ ...value, mode: 'manual' })}
            title="Enter manually" description={<>You type it when adding each person, e.g. <span className="font-mono">MAT/2026/1025</span>.</>} />
          <ModeOption checked={value.mode === 'generated'} onSelect={() => onChange({ ...value, mode: 'generated', segments: value.segments.length ? value.segments : suggestedSegments(value.name || 'ID') })}
            title="Generate automatically" description="FixID builds it from a pattern you define." />
        </div>
      </section>

      {value.mode === 'generated' && (
        <section>
          <p className="mb-3 text-sm font-semibold text-slate-900">Pattern</p>
          <PatternBuilder segments={value.segments} onChange={(segments) => onChange({ ...value, segments })} errors={errors.segments}
            timeZone={timeZone} nextSequence={existing?.nextSequence ?? 1} />
          {existing && existing.mode === 'generated' && (
            <p className="mt-3 text-xs text-slate-500">Changes apply to future users only. Identifiers already assigned stay the same.</p>
          )}
        </section>
      )}
      {value.mode === 'manual' && (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
          When adding a person you'll be asked for their {value.name.trim() || 'identifier'}. FixID checks that each value is unique.
        </p>
      )}
    </div>
  );
}
