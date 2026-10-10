import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus } from 'lucide-react';
import { Badge, Button, Drawer, Field, Input, Select, useToast } from '@/components/ui';
import { CredentialCard, SideToggle, type CardSide } from '@/components/credentials/CredentialCard';
import { previewIdentifier } from '@/domain/identifierPattern';
import { DEFAULT_TEMPLATE_ID, STARTER_TEMPLATES, sampleExpiry, templateById } from '@/domain/templates';
import type { CredentialType, TemplateId, ValidityRule } from '@/domain/types';
import { newId } from '@/lib/identifiers';
import { cn } from '@/lib/cn';
import { useActions, useOrgData } from '@/store/AppStore';
import { CredentialLogoField } from './CredentialLogoField';
import { DiscardBar } from './DiscardBar';
import { useSaveIdentifier } from './IdentifierDrawer';
import { IdentifierConfigForm, initialIdentifierForm, type IdentifierFormValue } from './IdentifierConfigForm';
import { useGuardedClose } from './useGuardedClose';

interface CredentialForm {
  templateId: TemplateId;
  name: string;
  identifierConfigId: string;
  effectiveDate: 'on-issue' | 'custom-date';
  expiry: 'no-expiry' | 'duration' | 'date';
  durationValue: number;
  durationUnit: 'months' | 'years';
  dateMode: 'fixed' | 'at-issuance';
  fixedDate: string;
  renewable: boolean;
  logoAssetId: string;
}

function toValidity(f: CredentialForm): ValidityRule {
  if (f.expiry === 'no-expiry') return { kind: 'no-expiry' };
  if (f.expiry === 'duration') return { kind: 'duration', months: f.durationUnit === 'years' ? f.durationValue * 12 : f.durationValue };
  if (f.dateMode === 'at-issuance') return { kind: 'set-at-issuance' };
  return { kind: 'fixed-date', date: f.fixedDate ? new Date(`${f.fixedDate}T23:59:59`).toISOString() : '' };
}

function fromType(t: CredentialType): CredentialForm {
  const v = t.validity;
  const years = v.kind === 'duration' && v.months % 12 === 0;
  return {
    templateId: t.templateId,
    name: t.name,
    identifierConfigId: t.identifierConfigId ?? '',
    effectiveDate: t.effectiveDate === 'custom-date' ? 'custom-date' : 'on-issue',
    expiry: v.kind === 'no-expiry' ? 'no-expiry' : v.kind === 'duration' ? 'duration' : 'date',
    durationValue: v.kind === 'duration' ? (years ? v.months / 12 : v.months) : 1,
    durationUnit: v.kind === 'duration' && !years ? 'months' : 'years',
    dateMode: v.kind === 'set-at-issuance' ? 'at-issuance' : 'fixed',
    fixedDate: v.kind === 'fixed-date' ? v.date.slice(0, 10) : '',
    renewable: t.renewal.allowed,
    logoAssetId: t.logoAssetId ?? '',
  };
}

function suggestName(identifierName: string) {
  const n = identifierName.toLowerCase();
  if (n.includes('matric') || n.includes('student')) return 'Student ID';
  if (n.includes('staff')) return 'Staff ID';
  if (n.includes('employee')) return 'Employee ID';
  if (n.includes('member')) return 'Membership Card';
  return '';
}

function Choice({ checked, onSelect, title, children }: { checked: boolean; onSelect: () => void; title: ReactNode; children?: ReactNode }) {
  return (
    <div className={cn('rounded-xl border p-3 transition-colors', checked ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
      <button type="button" role="radio" aria-checked={checked} onClick={onSelect} className="flex w-full items-center gap-3 text-left text-sm font-medium text-slate-900">
        <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', checked ? 'border-brand-600 bg-brand-600' : 'border-slate-300')}>
          {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
        {title}
      </button>
      {checked && children && <div className="mt-3 pl-7">{children}</div>}
    </div>
  );
}

function Steps({ step }: { step: 1 | 2 }) {
  return (
    <ol className="mb-6 flex items-center gap-3 text-sm" aria-label="Steps">
      {(['Choose template', 'Configure credential'] as const).map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
              done ? 'bg-brand-600 text-white' : active ? 'bg-white text-brand-700 ring-2 ring-brand-600' : 'bg-slate-100 text-slate-500')}>
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : n}
            </span>
            <span className={cn('font-medium', active ? 'text-slate-900' : 'text-slate-500')}>{label}</span>
            {n === 1 && <span className="mx-1 h-px w-8 bg-slate-200" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The one credential configuration drawer, for creating and editing: Choose template → Configure credential.
 * A new identifier can be created in a nested view on the same drawer surface. Saving never issues anything.
 */
export function CredentialDrawer({ open, onClose, onSaved, defaultIdentifierConfigId, existing }: {
  open: boolean;
  onClose: () => void;
  onSaved: (credentialTypeId: string) => void;
  defaultIdentifierConfigId?: string;
  /** Edit this configuration instead of creating a new one. */
  existing?: CredentialType;
}) {
  const org = useOrgData();
  const { organization, identifierConfigs, identifierConfigById, credentials, logoAssetById } = org;
  const { saveCredentialConfig } = useActions();
  const saveIdentifier = useSaveIdentifier();
  const toast = useToast();

  const blank = (): CredentialForm => {
    if (existing) return fromType(existing);
    const idc = defaultIdentifierConfigId ?? (identifierConfigs.length === 1 ? identifierConfigs[0].id : '');
    return {
      templateId: DEFAULT_TEMPLATE_ID, name: suggestName(identifierConfigById.get(idc)?.name ?? ''), identifierConfigId: idc,
      effectiveDate: 'on-issue', expiry: 'duration', durationValue: 1, durationUnit: 'years', dateMode: 'fixed', fixedDate: '', renewable: true, logoAssetId: '',
    };
  };
  const [form, setForm] = useState<CredentialForm>(blank);
  const [initial, setInitial] = useState(form);
  const [step, setStep] = useState<1 | 2>(existing ? 2 : 1);
  const [side, setSide] = useState<CardSide>('front');
  // Each template card previews its own side independently.
  const [templateSides, setTemplateSides] = useState<Partial<Record<TemplateId, CardSide>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Nested identifier view (same drawer surface; no stacked drawers). The credential draft is kept meanwhile.
  const [nested, setNested] = useState<IdentifierFormValue | null>(null);
  const [nestedErrors, setNestedErrors] = useState<Parameters<typeof IdentifierConfigForm>[0]['errors']>({});

  useEffect(() => {
    if (!open) return;
    const f = blank();
    setForm(f);
    setInitial(f);
    setStep(existing ? 2 : 1);
    setSide('front');
    setTemplateSides({});
    setErrors({});
    setNested(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  const guard = useGuardedClose(nested !== null || JSON.stringify(form) !== JSON.stringify(initial), onClose);
  const set = <K extends keyof CredentialForm>(k: K, v: CredentialForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '', ...(['expiry', 'durationValue', 'durationUnit', 'dateMode', 'fixedDate'].includes(k) ? { validity: '' } : {}) }));
  };

  const submit = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 200));
    const r = saveCredentialConfig({
      organizationId: organization.id, at: new Date().toISOString(), id: existing?.id ?? newId('ct'), editing: !!existing,
      name: form.name, identifierConfigId: form.identifierConfigId, templateId: form.templateId,
      effectiveDate: form.effectiveDate, validity: toValidity(form), renewable: form.renewable, logoAssetId: form.logoAssetId || undefined,
    });
    setSaving(false);
    if (!r.ok) {
      setErrors(r.errors);
      if (r.errors.templateId) setStep(1);
      return;
    }
    onSaved(r.credentialTypeId);
  };

  const saveNested = () => {
    if (!nested) return;
    const r = saveIdentifier(organization.id, nested);
    if (!r.ok) return setNestedErrors(r.errors);
    toast({ tone: 'success', title: `${nested.name.trim()} saved` });
    setForm((f) => ({ ...f, identifierConfigId: r.configId, name: f.name || suggestName(nested.name) }));
    setErrors((e) => ({ ...e, identifierConfigId: '' }));
    setNested(null);
  };

  if (nested) {
    return (
      <Drawer open={open} onClose={guard.requestClose} width="xl" onBack={() => setNested(null)}
        title="Configure identifier" description="Define how this identifier will be assigned to users."
        footer={guard.confirming ? <DiscardBar onKeep={guard.keepEditing} onDiscard={guard.discard} /> : (
          <>
            <Button variant="secondary" onClick={() => setNested(null)}>Back to credential</Button>
            <Button onClick={saveNested}>Save identifier</Button>
          </>
        )}>
        <IdentifierConfigForm value={nested} onChange={(v) => { setNested(v); setNestedErrors({}); }} errors={nestedErrors} timeZone={organization.timezone} />
      </Drawer>
    );
  }

  const idConfig = identifierConfigById.get(form.identifierConfigId);
  const sampleId = idConfig
    ? idConfig.mode === 'generated' ? previewIdentifier(idConfig.segments, idConfig.nextSequence, organization.timezone) : 'ABC-12345'
    : 'ID-00001';
  const sample = (name: string) => ({
    credentialName: name || 'Digital ID', holderName: 'Sample Holder', identifierLabel: idConfig?.name ?? 'Identifier',
    identifierValue: sampleId, expiresAt: sampleExpiry(toValidity(form)), sample: true, logoUrl: logoAssetById.get(form.logoAssetId)?.dataUrl,
  });
  const issuedCount = existing ? credentials.filter((c) => c.credentialTypeId === existing.id).length : 0;

  const footer = guard.confirming ? <DiscardBar onKeep={guard.keepEditing} onDiscard={guard.discard} /> : step === 1 ? (
    <>
      <Button variant="secondary" onClick={guard.requestClose}>Cancel</Button>
      <Button onClick={() => setStep(2)}>Next: Configure credential <ArrowRight className="h-4 w-4" /></Button>
    </>
  ) : (
    <>
      <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(1)} className="mr-auto">{existing ? 'Change template' : 'Back'}</Button>
      <Button variant="secondary" onClick={guard.requestClose}>Cancel</Button>
      <Button onClick={submit} loading={saving}>{existing ? 'Save changes' : 'Save credential'}</Button>
    </>
  );

  return (
    <Drawer open={open} onClose={guard.requestClose} width="2xl"
      title={existing ? `Edit ${existing.name}` : step === 1 ? 'Choose template' : 'Configure credential'}
      description={step === 1 ? 'Pick the design for this credential. You can preview both sides of each template.' : undefined}
      footer={footer}>
      {!existing && <Steps step={step} />}

      {step === 1 && (
        <section aria-label="Templates">
          <div role="radiogroup" aria-label="Template" className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {STARTER_TEMPLATES.map((t) => {
              const selected = form.templateId === t.id;
              const cardSide = templateSides[t.id] ?? 'front';
              return (
                // The Front/Back control sits beside the selectable area, not inside it, so it never selects the template.
                <div key={t.id} className={cn('relative flex flex-col rounded-2xl border transition-colors',
                  selected ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                <button type="button" role="radio" aria-checked={selected} onClick={() => set('templateId', t.id)}
                  className="flex flex-1 flex-col rounded-2xl p-4 pb-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <span className="flex h-[230px] items-center justify-center rounded-xl bg-slate-50">
                    <CredentialCard templateId={t.id} side={cardSide} organization={organization} content={sample(form.name)}
                      scale={t.orientation === 'landscape' ? 0.8 : 0.62} />
                  </span>
                  <span className="mt-3 flex items-center gap-2">
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300')}>
                      {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">{t.name}</span>
                    <Badge tone="neutral">{t.orientation === 'landscape' ? 'Landscape' : 'Portrait'}</Badge>
                    {t.id === DEFAULT_TEMPLATE_ID && <Badge tone="brand">Default</Badge>}
                  </span>
                  <span className="mt-1 pl-6 text-xs text-slate-500">{t.description}</span>
                </button>
                <div className="absolute bottom-3 right-4">
                  <SideToggle side={cardSide} onChange={(v) => setTemplateSides((x) => ({ ...x, [t.id]: v }))} label={`${t.name} preview side`} flipLabel={`Flip ${t.name}`} />
                </div>
                </div>
              );
            })}
          </div>
          {errors.templateId && <p role="alert" className="mt-3 text-sm text-red-600">{errors.templateId}</p>}
        </section>
      )}

      {step === 2 && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
          <div className="space-y-7">
            {existing && issuedCount > 0 && (
              <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
                Changes apply to credentials issued from now on. The {issuedCount} already issued keep their current details.
              </p>
            )}
            {errors.form && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{errors.form}</p>}
            <Field label="Credential name" required error={errors.name} hint="For example Staff ID, Membership Card or Visitor Pass.">
              {(p) => <Input {...p} data-autofocus value={form.name} onChange={(e) => set('name', e.target.value)} />}
            </Field>

            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p id="cred-identifier" className="text-sm font-medium text-slate-700">Identifier <span className="text-red-500">*</span></p>
                {identifierConfigs.length > 0 && (
                  <button type="button" onClick={() => setNested(initialIdentifierForm(undefined, ''))}
                    className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                    <Plus className="h-4 w-4" aria-hidden="true" /> New identifier
                  </button>
                )}
              </div>
              {identifierConfigs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                  <p>No identifiers yet. Create one, such as Employee ID or Membership Number.</p>
                  <Button size="sm" className="mt-3" icon={<Plus className="h-4 w-4" />} onClick={() => setNested(initialIdentifierForm(undefined, ''))}>Create identifier</Button>
                </div>
              ) : (
                <div role="radiogroup" aria-labelledby="cred-identifier" className="grid gap-2 sm:grid-cols-2">
                  {identifierConfigs.map((c) => (
                    <button key={c.id} type="button" role="radio" aria-checked={form.identifierConfigId === c.id}
                      onClick={() => { set('identifierConfigId', c.id); if (!form.name.trim()) set('name', suggestName(c.name)); }}
                      className={cn('rounded-xl border p-3 text-left', form.identifierConfigId === c.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                      <span className="block text-sm font-semibold text-slate-900">{c.name}</span>
                      <span className="block text-xs text-slate-500">{c.mode === 'manual' ? 'Manual' : 'Generated'}</span>
                    </button>
                  ))}
                </div>
              )}
              {errors.identifierConfigId && <p role="alert" className="mt-2 text-sm text-red-600">{errors.identifierConfigId}</p>}
              <p className="mt-2 text-xs text-slate-500">Each credential shows the identifier already assigned to the user.</p>
            </section>

            <CredentialLogoField value={form.logoAssetId} onChange={(id) => set('logoAssetId', id)} error={errors.logoAssetId} />

            <section>
              <p id="cred-effective" className="mb-2 text-sm font-medium text-slate-700">Effective date</p>
              <div role="radiogroup" aria-labelledby="cred-effective" className="space-y-2">
                <Choice checked={form.effectiveDate === 'on-issue'} onSelect={() => set('effectiveDate', 'on-issue')} title="Effective from issuance date" />
                <Choice checked={form.effectiveDate === 'custom-date'} onSelect={() => set('effectiveDate', 'custom-date')} title="Specify effective date during issuance" />
              </div>
            </section>

            <section>
              <p id="cred-expiry" className="mb-2 text-sm font-medium text-slate-700">Expiration</p>
              <div role="radiogroup" aria-labelledby="cred-expiry" className="space-y-2">
                <Choice checked={form.expiry === 'no-expiry'} onSelect={() => set('expiry', 'no-expiry')} title="Never expires" />
                <Choice checked={form.expiry === 'duration'} onSelect={() => set('expiry', 'duration')} title="Valid for a specified duration">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-24">
                      <Input type="number" min={1} max={form.durationUnit === 'years' ? 50 : 600} aria-label="Duration"
                        value={Number.isFinite(form.durationValue) ? form.durationValue : ''} onChange={(e) => set('durationValue', Math.floor(Number(e.target.value)))} />
                    </div>
                    <div className="w-32">
                      <Select aria-label="Duration unit" value={form.durationUnit} onChange={(e) => set('durationUnit', e.target.value as CredentialForm['durationUnit'])}>
                        <option value="months">Months</option>
                        <option value="years">Years</option>
                      </Select>
                    </div>
                    <span className="text-sm text-slate-500">from the effective date</span>
                  </div>
                </Choice>
                <Choice checked={form.expiry === 'date'} onSelect={() => set('expiry', 'date')} title="Specific expiration date">
                  <div className="space-y-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="radio" name="date-mode" checked={form.dateMode === 'fixed'} onChange={() => set('dateMode', 'fixed')} className="h-4 w-4 border-slate-300 text-brand-600" />
                      Set the date now
                    </label>
                    {form.dateMode === 'fixed' && (
                      <div className="max-w-[200px] pl-6">
                        <Input type="date" aria-label="Expiration date" value={form.fixedDate} onChange={(e) => set('fixedDate', e.target.value)} />
                      </div>
                    )}
                    <label className="flex items-center gap-2">
                      <input type="radio" name="date-mode" checked={form.dateMode === 'at-issuance'} onChange={() => set('dateMode', 'at-issuance')} className="h-4 w-4 border-slate-300 text-brand-600" />
                      Choose the date when issuing
                    </label>
                    {form.dateMode === 'at-issuance' && <p className="pl-6 text-xs text-slate-500">You'll be asked for the expiration date before each credential is issued.</p>}
                  </div>
                </Choice>
              </div>
              {errors.validity && <p role="alert" className="mt-2 text-sm text-red-600">{errors.validity}</p>}
            </section>

            <section>
              <p id="cred-renew" className="mb-2 text-sm font-medium text-slate-700">Can this credential be renewed?</p>
              <div role="radiogroup" aria-labelledby="cred-renew" className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm font-medium">
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={form.renewable === v} onClick={() => set('renewable', v)}
                    className={cn('rounded-md px-5 py-1.5', form.renewable === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
                    {v ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside aria-label="Preview" className="lg:sticky lg:top-0 lg:self-start">
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-slate-50 p-5">
              <p className="self-start text-sm font-medium text-slate-700">Preview <span className="font-normal text-slate-400">· {templateById(form.templateId).name}</span></p>
              <CredentialCard templateId={form.templateId} side={side} organization={organization} content={sample(form.name)}
                scale={templateById(form.templateId).orientation === 'landscape' ? 0.98 : 0.9} />
              <SideToggle side={side} onChange={setSide} label="Preview side" />
              <p className="text-center text-xs text-slate-400">Sample data. Real credentials show the holder's details.</p>
            </div>
          </aside>
        </div>
      )}
    </Drawer>
  );
}
