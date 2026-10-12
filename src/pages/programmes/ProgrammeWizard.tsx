import { useState } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import { Button, Drawer, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { ProgrammeRequirementsSummary } from '@/components/verification/RequirementsSummary';
import { CAPABILITY_LABEL } from '@/domain/integrations';
import {
  ASSURANCE_NOT_DEFINED, ELIGIBILITY_DESCRIPTION, ELIGIBILITY_LABEL, EXCEPTION_LABEL, LIVENESS_LABEL, METHOD_LABEL, defaultProgrammeRequirements,
  type EligibilityApproach, type ExceptionHandling, type LivenessRequirement, type ProgrammeRequirements, type VerificationMethod, type VerificationProgramme,
} from '@/domain/programmes';
import { cn } from '@/lib/cn';
import { integrationsOf } from '@/store/integrationOps';
import { subRelationships } from '@/store/orgOps';
import { programmeProblems } from '@/store/programmeOps';
import { useActions, useSession, useStore } from '@/store/AppStore';

const STEPS = ['Programme Details', 'Participating Organizations', 'Verification Requirements', 'Review'] as const;
const box = (on: boolean) => cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', on ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300');

/**
 * Create or edit a Verification Programme in four steps. The owner is always the current organization;
 * only its own sub-organizations can be selected, and none are added automatically.
 */
export function ProgrammeWizard({ programme, onClose, onSaved }: { programme: VerificationProgramme | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { saveProgramme, programmeTransition } = useActions();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(programme?.name ?? '');
  const [description, setDescription] = useState(programme?.description ?? '');
  const [purpose, setPurpose] = useState(programme?.purpose ?? '');
  const [scope, setScope] = useState<'own' | 'sub-organizations'>(programme?.scope ?? 'own');
  const [selected, setSelected] = useState<string[]>(programme?.participants.filter((p) => p.status !== 'removed').map((p) => p.organizationId) ?? []);
  const [req, setReq] = useState<ProgrammeRequirements>(programme?.requirements ?? defaultProgrammeRequirements());
  const [error, setError] = useState<string | null>(null);
  const subs = subRelationships(state, organization.id).filter((r) => r.status === 'active').map((r) => state.data.organizations.find((o) => o.id === r.childOrganizationId)!).filter(Boolean);
  const integrations = integrationsOf(state, organization.id);
  const set = <K extends keyof ProgrammeRequirements>(k: K, v: ProgrammeRequirements[K]) => { setReq((x) => ({ ...x, [k]: v })); setError(null); };
  const input = { name, description, purpose, scope, participantIds: scope === 'sub-organizations' ? selected : [], requirements: req };
  const problems = programmeProblems(state, { ...input, organizationId: organization.id, id: programme?.id });
  const integration = req.identitySource.kind === 'external' ? integrations.find((i) => i.id === (req.identitySource as { integrationId: string }).integrationId) : undefined;

  const next = () => {
    if (step === 0 && !name.trim()) return setError('Enter a programme name.');
    if (step === 1 && scope === 'sub-organizations' && !selected.length) return setError('Select at least one participating sub-organization.');
    setError(null);
    setStep((s) => s + 1);
  };
  const save = (activate: boolean) => {
    const r = saveProgramme(organization.id, input, programme?.id);
    if (!r.ok) return setError(r.error);
    if (activate && (!programme || programme.status === 'draft')) {
      const a = programmeTransition(organization.id, r.programmeId, 'activate');
      if (!a.ok) { setError(`Saved as Draft, not activated: ${a.error}`); return; }
    }
    toast({ tone: 'success', title: activate ? 'Programme active' : programme ? 'Programme saved' : 'Programme saved as Draft', description: name.trim() });
    onSaved(r.programmeId);
  };
  const setMethod = (m: VerificationMethod) => { set('method', m); set('liveness', m === 'record' ? 'not-applicable' : req.liveness === 'not-applicable' ? 'required' : req.liveness); };
  const toggleAllowed = (a: EligibilityApproach) => set('allowedEligibility', req.allowedEligibility.includes(a) ? req.allowedEligibility.filter((x) => x !== a) : [...req.allowedEligibility, a]);

  return (
    <Drawer open onClose={onClose} width="xl" title={programme ? `Edit ${programme.name}` : 'Create verification programme'} description={`Step ${step + 1} of 4 · ${STEPS[step]}`}
      onBack={step > 0 ? () => setStep((s) => s - 1) : undefined}
      footer={(
        <>
          {step > 0 && <Button variant="ghost" className="mr-auto" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep((s) => s - 1)}>Back</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {step < 3 ? <Button onClick={next}>Continue</Button> : (
            <>
              <Button variant="secondary" onClick={() => save(false)}>{programme && programme.status !== 'draft' ? 'Save changes' : 'Save as Draft'}</Button>
              {(!programme || programme.status === 'draft') && <Button disabled={problems.length > 0} onClick={() => save(true)}>Save & Activate</Button>}
            </>
          )}
        </>
      )}>
      <ol className="mb-6 flex flex-wrap gap-2 text-xs font-medium" aria-label="Steps">
        {STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={cn('rounded-full px-2.5 py-1', i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>{i + 1}. {s}</li>)}
      </ol>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}

      {step === 0 && (
        <div className="space-y-5">
          <Field label="Programme Name" required>{(p) => <Input {...p} autoFocus maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />}</Field>
          <Field label="Description" hint="Optional">{(p) => <Textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
          <Field label="Programme Purpose" hint="Why people are verified under this programme, in a sentence.">{(p) => <Input {...p} maxLength={200} value={purpose} onChange={(e) => setPurpose(e.target.value)} />}</Field>
          <dl className="grid gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-inset ring-slate-200 sm:grid-cols-2">
            <div><dt className="text-slate-500">Owning Organization</dt><dd className="font-medium text-slate-900">{organization.name}</dd></div>
            <div><dt className="text-slate-500">Programme Status</dt><dd className="text-slate-900">{programme ? programme.status[0].toUpperCase() + programme.status.slice(1) : 'Draft'}</dd></div>
          </dl>
        </div>
      )}

      {step === 1 && (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium text-slate-700">Who the programme applies to</legend>
          <label className={box(scope === 'own')}>
            <input type="radio" name="prg-scope" className="mt-0.5 h-4 w-4" checked={scope === 'own'} onChange={() => { setScope('own'); setError(null); }} />
            <span><span className="block text-sm font-semibold text-slate-900">Own Organization Only</span><span className="block text-sm text-slate-500">The programme applies only to {organization.name}.</span></span>
          </label>
          <label className={cn(box(scope === 'sub-organizations'), !subs.length && 'cursor-not-allowed opacity-60')}>
            <input type="radio" name="prg-scope" className="mt-0.5 h-4 w-4" disabled={!subs.length} checked={scope === 'sub-organizations'} onChange={() => { setScope('sub-organizations'); setError(null); }} />
            <span><span className="block text-sm font-semibold text-slate-900">Selected Sub-organizations</span><span className="block text-sm text-slate-500">{subs.length ? 'Choose which of your sub-organizations take part. None are added automatically.' : `${organization.name} has no sub-organizations.`}</span></span>
          </label>
          {scope === 'sub-organizations' && (
            <ul className="space-y-2 pl-7" aria-label="Sub-organizations">
              {subs.map((o) => {
                const existing = programme?.participants.find((p) => p.organizationId === o.id && p.status !== 'removed');
                return (
                  <li key={o.id}>
                    <label className="flex items-center gap-2 text-sm text-slate-800">
                      <input type="checkbox" className="h-4 w-4 rounded" checked={selected.includes(o.id)}
                        onChange={(e) => { setSelected((x) => (e.target.checked ? [...x, o.id] : x.filter((y) => y !== o.id))); setError(null); }} />
                      {o.name}
                      <span className="text-xs text-slate-500">{existing ? existing.status : selected.includes(o.id) ? (programme?.status === 'active' ? 'will be active' : 'will be invited') : ''}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-slate-500">Taking part gives the programme’s requirements and identity service to that organization’s programme activities. It doesn’t give {organization.name} access to their records.</p>
        </fieldset>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Identity Source</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={box(req.identitySource.kind === 'local')}>
                <input type="radio" name="prg-src" className="mt-0.5 h-4 w-4" checked={req.identitySource.kind === 'local'} onChange={() => { set('identitySource', { kind: 'local' }); set('allowedEligibility', req.allowedEligibility.filter((a) => a === 'local-population' || a === 'none').length ? req.allowedEligibility.filter((a) => a === 'local-population' || a === 'none') : ['local-population']); }} />
                <span><span className="block text-sm font-semibold text-slate-900">FixID Local Records</span><span className="block text-sm text-slate-500">People registered and enrolled in each participating organization.</span></span>
              </label>
              <label className={cn(box(req.identitySource.kind === 'external'), !integrations.length && 'cursor-not-allowed opacity-60')}>
                <input type="radio" name="prg-src" className="mt-0.5 h-4 w-4" disabled={!integrations.length} checked={req.identitySource.kind === 'external'}
                  onChange={() => set('identitySource', { kind: 'external', integrationId: (integrations.find((i) => i.status === 'active') ?? integrations[0]).id })} />
                <span><span className="block text-sm font-semibold text-slate-900">External Identity Service</span><span className="block text-sm text-slate-500">{integrations.length ? 'One of your custom identity services. People don’t need FixID records.' : 'No custom identity service is configured.'}</span></span>
              </label>
            </div>
            {req.identitySource.kind === 'external' && (
              <Field label="Identity service">{(p) => (
                <Select {...p} value={req.identitySource.kind === 'external' ? req.identitySource.integrationId : ''} onChange={(e) => set('identitySource', { kind: 'external', integrationId: e.target.value })}>
                  {integrations.map((i) => <option key={i.id} value={i.id} disabled={i.status !== 'active'}>{i.name} — {i.capabilities.map((c) => CAPABILITY_LABEL[c]).join(', ')}{i.status !== 'active' ? ` (${i.status}, can’t be used)` : ''}</option>)}
                </Select>
              )}</Field>
            )}
          </fieldset>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Verification method">{(p) => (
              <Select {...p} value={req.method} onChange={(e) => setMethod(e.target.value as VerificationMethod)}>
                {(Object.keys(METHOD_LABEL) as VerificationMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </Select>
            )}</Field>
            <Field label="Liveness" hint={req.method === 'record' ? 'Only applies to face verification.' : 'Participating organizations can’t disable a required liveness check.'}>{(p) => (
              <Select {...p} value={req.liveness} disabled={req.method === 'record'} onChange={(e) => set('liveness', e.target.value as LivenessRequirement)}>
                {(req.method === 'record' ? ['not-applicable'] : ['required', 'optional']).map((l) => <option key={l} value={l}>{LIVENESS_LABEL[l as LivenessRequirement]}</option>)}
              </Select>
            )}</Field>
            <Field label="Reverification">{(p) => (
              <Select {...p} value={req.reverification.mode === 'reuse-within' ? `reuse-${req.reverification.days}` : req.reverification.mode}
                onChange={(e) => set('reverification', e.target.value.startsWith('reuse-') ? { mode: 'reuse-within', days: Number(e.target.value.slice(6)) } : { mode: e.target.value as 'every-time' | 'activity-defined' })}>
                <option value="every-time">Verify every time</option>
                <option value="reuse-1">Accept a previous valid verification within 1 day</option>
                <option value="reuse-7">Accept a previous valid verification within 7 days</option>
                <option value="reuse-30">Accept a previous valid verification within 30 days</option>
                <option value="activity-defined">Fresh verification when the activity requires it</option>
              </Select>
            )}</Field>
            <Field label="Exception handling" hint="For failed, disputed or inconclusive verification. Never a final access decision on its own.">{(p) => (
              <Select {...p} value={req.exceptions} onChange={(e) => set('exceptions', e.target.value as ExceptionHandling)}>
                {(Object.keys(EXCEPTION_LABEL) as ExceptionHandling[]).map((x) => <option key={x} value={x}>{EXCEPTION_LABEL[x]}</option>)}
              </Select>
            )}</Field>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded" checked={req.escalateToProgramme} onChange={(e) => set('escalateToProgramme', e.target.checked)} />
            <span>Escalate exceptions to an authorized programme reviewer in {organization.name}<span className="block text-xs text-slate-500">The review workflow arrives in a later phase; the rule is recorded now.</span></span>
          </label>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Eligibility</legend>
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" className="h-4 w-4 rounded" checked={req.eligibilityRequired} onChange={(e) => set('eligibilityRequired', e.target.checked)} />Eligibility must be determined (identity alone is never enough)
            </label>
            <p className="mb-2 text-xs text-slate-500">Approaches activities may use:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(ELIGIBILITY_LABEL) as EligibilityApproach[]).map((a) => {
                const needsExternal = a === 'external-source' || a === 'reference-list';
                const off = (needsExternal && req.identitySource.kind !== 'external') || (a === 'none' && req.eligibilityRequired);
                return (
                  <label key={a} className={cn(box(req.allowedEligibility.includes(a)), off && 'cursor-not-allowed opacity-60')}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded" disabled={off} checked={req.allowedEligibility.includes(a) && !off} onChange={() => toggleAllowed(a)} />
                    <span><span className="block text-sm font-semibold text-slate-900">{ELIGIBILITY_LABEL[a]}</span><span className="block text-xs text-slate-500">{ELIGIBILITY_DESCRIPTION[a]}</span></span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="flex gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />Assurance: {ASSURANCE_NOT_DEFINED} These settings are mandatory controls; FixID doesn’t claim a certified assurance level for them.</p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5 text-sm">
          <dl className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2" aria-label="Programme summary">
            <div><dt className="text-slate-500">Programme Name</dt><dd className="font-medium text-slate-900">{name}</dd></div>
            <div><dt className="text-slate-500">Owning Organization</dt><dd className="text-slate-900">{organization.name}</dd></div>
            <div><dt className="text-slate-500">Purpose</dt><dd className="text-slate-900">{purpose || '—'}</dd></div>
            <div><dt className="text-slate-500">Participating Organizations</dt><dd className="text-slate-900">{scope === 'own' ? `${organization.name} only` : selected.map((id) => state.data.organizations.find((o) => o.id === id)?.name).join(', ')}</dd></div>
          </dl>
          <ProgrammeRequirementsSummary requirements={req} integration={integration} />
          <p className="text-slate-500">Restrictions: participating organizations can make these requirements stricter but can’t weaken them, replace the identity service or see its configuration.</p>
          {problems.length > 0 && (
            <div role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900 ring-1 ring-inset ring-amber-200">
              <p className="font-semibold">To activate, resolve:</p>
              <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
