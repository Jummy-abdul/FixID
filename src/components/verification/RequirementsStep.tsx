import { Lock } from 'lucide-react';
import { Field, Select } from '@/components/ui';
import { CAPABILITY_LABEL, type CustomIntegration } from '@/domain/integrations';
import {
  ASSURANCE_NOT_DEFINED, EXCEPTION_LABEL, LIVENESS_LABEL, METHOD_LABEL, reverificationLabel,
  type ExceptionHandling, type LivenessRequirement, type ReverificationPolicy, type VerificationMethod, type VerificationProgramme, type VerificationSettings,
} from '@/domain/programmes';
import { cn } from '@/lib/cn';
import { sourceLabel } from './RequirementsSummary';

const REVERIFICATION_OPTIONS: ReverificationPolicy[] = [
  { mode: 'every-time' }, { mode: 'reuse-within', days: 1 }, { mode: 'reuse-within', days: 7 }, { mode: 'reuse-within', days: 30 }, { mode: 'activity-defined' },
];
const key = (r: ReverificationPolicy) => (r.mode === 'reuse-within' ? `reuse-${r.days}` : r.mode);
const windowOf = (r: ReverificationPolicy) => (r.mode === 'reuse-within' ? r.days : 0);
const box = (on: boolean) => cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', on ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300');

function Inherited({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500"><Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{children}</p>;
}

/**
 * Identity source and verification requirements for an activity. For a programme-linked activity the
 * programme's mandatory requirements are shown as inherited and locked; only stricter choices are offered.
 */
export function RequirementsStep({ value, onChange, programme, integrations, programmeIntegration, ownerName, readOnly }: {
  value: VerificationSettings;
  onChange: (v: VerificationSettings) => void;
  programme?: VerificationProgramme;
  /** The organization's own integrations (independent activities). */
  integrations: CustomIntegration[];
  /** The programme owner's integration, as metadata only. */
  programmeIntegration?: CustomIntegration;
  ownerName?: string;
  readOnly?: boolean;
}) {
  const req = programme?.requirements;
  const set = <K extends keyof VerificationSettings>(k: K, v: VerificationSettings[K]) => onChange({ ...value, [k]: v });
  const from = programme ? `Set by the programme ${programme.name}` : '';
  const setMethod = (m: VerificationMethod) => onChange({ ...value, method: m, liveness: m === 'record' ? 'not-applicable' : value.liveness === 'not-applicable' ? 'required' : value.liveness });
  const usable = integrations.filter((i) => i.status === 'active');

  return (
    <div className="space-y-6">
      <section aria-labelledby="src-heading" className="space-y-2">
        <h3 id="src-heading" className="text-sm font-semibold text-slate-900">Identity Source</h3>
        {req ? (
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-inset ring-slate-200">
            <p className="font-medium text-slate-900">{sourceLabel(req.identitySource, programmeIntegration, ownerName)}</p>
            {programmeIntegration && <p className="text-xs text-slate-500">{programmeIntegration.capabilities.map((c) => CAPABILITY_LABEL[c]).join(' · ')}. Configuration and credentials stay with {ownerName}.</p>}
            <Inherited>{from}. It can’t be replaced.</Inherited>
          </div>
        ) : (
          <fieldset disabled={readOnly} className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Identity Source</legend>
            <label className={box(value.identitySource.kind === 'local')}>
              <input type="radio" name="act-src" className="mt-0.5 h-4 w-4" checked={value.identitySource.kind === 'local'}
                onChange={() => onChange({ ...value, identitySource: { kind: 'local' }, eligibility: value.eligibility.approach === 'external-source' || value.eligibility.approach === 'reference-list' ? { approach: 'local-population' } : value.eligibility })} />
              <span><span className="block text-sm font-semibold text-slate-900">FixID Local Records</span><span className="block text-sm text-slate-500">People registered and enrolled in your organization.</span></span>
            </label>
            <label className={cn(box(value.identitySource.kind === 'external'), !usable.length && 'cursor-not-allowed opacity-60')}>
              <input type="radio" name="act-src" className="mt-0.5 h-4 w-4" disabled={!usable.length} checked={value.identitySource.kind === 'external'}
                onChange={() => onChange({ ...value, identitySource: { kind: 'external', integrationId: usable[0].id }, eligibility: value.eligibility.approach === 'local-population' ? { approach: 'external-source' } : value.eligibility })} />
              <span><span className="block text-sm font-semibold text-slate-900">External Identity Service</span>
                <span className="block text-sm text-slate-500">{usable.length ? 'People don’t need FixID records; nothing is enrolled from the service.' : 'No active custom identity service. Set one up in Settings → Integrations.'}</span></span>
            </label>
          </fieldset>
        )}
        {!req && value.identitySource.kind === 'external' && (
          <Field label="Identity service">{(p) => (
            <Select {...p} disabled={readOnly} value={value.identitySource.kind === 'external' ? value.identitySource.integrationId : ''} onChange={(e) => set('identitySource', { kind: 'external', integrationId: e.target.value })}>
              {integrations.map((i) => <option key={i.id} value={i.id} disabled={i.status !== 'active'}>{i.name} — {i.capabilities.map((c) => CAPABILITY_LABEL[c]).join(', ')}{i.status !== 'active' ? ` (${i.status}, can’t be selected)` : ''}</option>)}
            </Select>
          )}</Field>
        )}
      </section>

      <section aria-labelledby="req-heading" className="space-y-4 border-t border-slate-100 pt-5">
        <h3 id="req-heading" className="text-sm font-semibold text-slate-900">Verification Requirements</h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Field label="Verification method">{(p) => (
              <Select {...p} disabled={readOnly || req?.method === 'face'} value={value.method} onChange={(e) => setMethod(e.target.value as VerificationMethod)}>
                {(Object.keys(METHOD_LABEL) as VerificationMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </Select>
            )}</Field>
            {req?.method === 'face' && <Inherited>{from}.</Inherited>}
          </div>
          <div>
            <Field label="Liveness">{(p) => (
              <Select {...p} disabled={readOnly || value.method === 'record' || req?.liveness === 'required'} value={value.liveness} onChange={(e) => set('liveness', e.target.value as LivenessRequirement)}>
                {(value.method === 'record' ? ['not-applicable'] : ['required', 'optional']).map((l) => <option key={l} value={l}>{LIVENESS_LABEL[l as LivenessRequirement]}</option>)}
              </Select>
            )}</Field>
            {req?.liveness === 'required' && value.method === 'face' && <Inherited>Liveness is required by the programme {programme!.name} and can’t be disabled.</Inherited>}
            {value.method === 'face' && <p className="mt-1 text-xs text-slate-500">Simulated liveness results are never presented as presentation-attack detection.</p>}
          </div>
          <div>
            <Field label="Reverification">{(p) => (
              <Select {...p} disabled={readOnly} value={key(value.reverification)}
                onChange={(e) => set('reverification', REVERIFICATION_OPTIONS.find((r) => key(r) === e.target.value)!)}>
                {REVERIFICATION_OPTIONS.filter((r) => !req || windowOf(r) <= windowOf(req.reverification)).map((r) => <option key={key(r)} value={key(r)}>{reverificationLabel(r)}</option>)}
              </Select>
            )}</Field>
            {req && <Inherited>The programme allows at most: {reverificationLabel(req.reverification).toLowerCase()}. Stricter is fine.</Inherited>}
            <p className="mt-1 text-xs text-slate-500">A previous result is only reused for the same identity source, purpose and requirements, never just because a reference repeats.</p>
          </div>
          <div>
            <Field label="Exception handling">{(p) => (
              <Select {...p} disabled={readOnly || !!req} value={value.exceptions} onChange={(e) => set('exceptions', e.target.value as ExceptionHandling)}>
                {(Object.keys(EXCEPTION_LABEL) as ExceptionHandling[]).map((x) => <option key={x} value={x}>{EXCEPTION_LABEL[x]}</option>)}
              </Select>
            )}</Field>
            {req && <Inherited>{from}{req.escalateToProgramme ? '; exceptions are escalated to a programme reviewer' : ''}.</Inherited>}
          </div>
        </div>
      </section>

      <section aria-labelledby="decision-heading" className="space-y-3 border-t border-slate-100 pt-5">
        <h3 id="decision-heading" className="text-sm font-semibold text-slate-900">Decision rules</h3>
        <p className="text-sm text-slate-600">Identity matching, eligibility and the activity decision are separate results. FixID allows only when identity matches <span className="font-semibold">and</span> eligibility is confirmed (or not required). A match never means someone is eligible.</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="When the identity match is inconclusive">{(p) => (
            <Select {...p} disabled={readOnly} value={value.decisionRules.onInconclusiveMatch} onChange={(e) => set('decisionRules', { ...value.decisionRules, onInconclusiveMatch: e.target.value as 'pending-review' | 'unable-to-decide' })}>
              <option value="pending-review">Send for review</option>
              <option value="unable-to-decide">Unable to decide</option>
            </Select>
          )}</Field>
          <Field label="When the identity service is unavailable">{(p) => (
            <Select {...p} disabled={readOnly} value={value.decisionRules.onServiceUnavailable} onChange={(e) => set('decisionRules', { ...value.decisionRules, onServiceUnavailable: e.target.value as 'pending-review' | 'unable-to-decide' })}>
              <option value="unable-to-decide">Unable to decide (no decision is made)</option>
              <option value="pending-review">Send for review</option>
            </Select>
          )}</Field>
        </div>
        <p className="flex gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />Assurance: {ASSURANCE_NOT_DEFINED}</p>
      </section>
    </div>
  );
}
