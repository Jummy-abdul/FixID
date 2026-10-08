import { useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, ExternalLink } from 'lucide-react';
import { Badge, Button, Field, Input, Select, useToast } from '@/components/ui';
import { validityLabel } from '@/domain/labels';
import type { ValidityRule } from '@/domain/types';
import { formatIdentifier, newId } from '@/lib/identifiers';
import { cn } from '@/lib/cn';
import { useActions, type OrgData } from '@/store/AppStore';
import type { NewCredentialConfig } from '@/store/operations';
import type { CredentialForm, Draft } from './draft';
import { Callout, FormSection, RadioCard, StepShell } from './parts';

const DURATIONS = [
  { months: 6, label: '6 months' }, { months: 12, label: '1 year' }, { months: 24, label: '2 years' },
  { months: 36, label: '3 years' }, { months: 48, label: '4 years' },
];

export function toValidity(f: CredentialForm): ValidityRule {
  if (f.expiry === 'no-expiry') return { kind: 'no-expiry' };
  if (f.expiry === 'fixed-date') return { kind: 'fixed-date', date: f.fixedDate ? new Date(`${f.fixedDate}T23:59:59`).toISOString() : '' };
  return { kind: 'duration', months: f.months };
}

export function toConfig(f: CredentialForm): NewCredentialConfig {
  return {
    name: f.name,
    identifierLabel: f.identifierLabel,
    identifierMode: f.identifierMode,
    prefix: f.prefix.trim().toUpperCase(),
    digits: f.digits,
    effectiveDate: f.effectiveDate,
    validity: toValidity(f),
    renewal: { allowed: f.renewalAllowed && f.expiry !== 'no-expiry', windowDays: f.renewalWindowDays },
    cardDesignId: f.cardDesignId,
  };
}

export function StepCredential({ org, draft, userTypeName, update, footerStart }: {
  org: OrgData; draft: Draft; userTypeName: string; update: (patch: Partial<Draft>) => void; footerStart: React.ReactNode;
}) {
  const { saveCredentialSetup } = useActions();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const form = draft.credentialForm!;
  const choice = draft.credentialChoice;
  const activeTypes = org.credentialTypes.filter((t) => t.status === 'active');
  const isFirstEver = activeTypes.length === 0;
  // Staff, Personnel and names already ending in s read naturally without an added s.
  const plural = /(s|staff|personnel)$/i.test(userTypeName) ? userTypeName : `${userTypeName}s`;

  const set = <K extends keyof CredentialForm>(k: K, v: CredentialForm[K]) => {
    update({ credentialForm: { ...form, [k]: v } });
    if (errors[k as string]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  const save = async () => {
    if (!choice) return setErrors({ choice: 'Choose a credential or create a new one.' });
    setSaving(true);
    await new Promise((r) => setTimeout(r, 250));
    const result = saveCredentialSetup({
      organizationId: org.organization.id,
      at: new Date().toISOString(),
      userType: draft.userType!,
      credential: choice === 'new' ? { config: toConfig(form) } : choice,
      ids: { userTypeId: newId('ut'), credentialTypeId: newId('ct') },
    });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      if (result.errors.renewal) setAdvanced(true);
      return;
    }
    const type = choice === 'new' ? form.name.trim() : org.credentialTypeById.get(choice.existingId)?.name;
    if (choice === 'new') toast({ tone: 'success', title: `${type} saved`, description: `It will be reused the next time you add ${plural.toLowerCase()}.` });
    update({ userType: { id: result.userTypeId }, credentialTypeId: result.credentialTypeId, step: 'details' });
  };

  const firstId = form.identifierMode === 'generated' ? formatIdentifier(form.prefix.trim().toUpperCase(), form.digits, 1) : null;

  return (
    <StepShell
      title={`What will you issue to ${plural.toLowerCase()}?`}
      description={isFirstEver
        ? `This is a one-time setup. Next time you add ${/^[aeiou]/i.test(userTypeName) ? 'an' : 'a'} ${userTypeName.toLowerCase()}, FixID reuses it.`
        : 'Reuse a credential you already issue, or set up a new one.'}
      footer={
        <>
          <div className="flex items-center gap-2">
            {footerStart}
            <Button variant="ghost" onClick={() => update({ step: 'type' })} icon={<ArrowLeft className="h-4 w-4" />}>Back</Button>
          </div>
          <Button onClick={save} loading={saving}>{choice === 'new' ? 'Save and continue' : 'Continue'} {!saving && <ArrowRight className="h-4 w-4" />}</Button>
        </>
      }
    >
      {!isFirstEver && (
        <div className="mb-6">
          <div role="radiogroup" aria-label="Credential" className="grid gap-3 sm:grid-cols-2">
            {activeTypes.map((t) => (
              <RadioCard key={t.id} checked={typeof choice === 'object' && choice?.existingId === t.id}
                onSelect={() => { update({ credentialChoice: { existingId: t.id } }); setErrors({}); }}
                title={t.name} badge={<Badge tone="neutral">Saved</Badge>}
                description={`${t.identifier.label} · ${validityLabel(t.validity)}`} />
            ))}
            <RadioCard checked={choice === 'new'} onSelect={() => { update({ credentialChoice: 'new' }); setErrors({}); }}
              title="Create a new credential" description="Set up a different credential for this user type." />
          </div>
          {errors.choice && <p role="alert" className="mt-2 text-sm text-red-600">{errors.choice}</p>}
        </div>
      )}

      {errors.userType && <div className="mb-4"><Callout tone="danger">{errors.userType}</Callout></div>}
      {errors.credential && <div className="mb-4"><Callout tone="danger">{errors.credential}</Callout></div>}

      {choice === 'new' && (
        <div className={cn(!isFirstEver && 'rounded-xl border border-slate-200 p-5')}>
          <FormSection title="Credential" description="What this digital ID is called.">
            <Field label="Credential name" required error={errors.name} hint="For example Student ID, Staff ID or Membership ID.">
              {(p) => <Input {...p} value={form.name} onChange={(e) => set('name', e.target.value)} />}
            </Field>
          </FormSection>

          <FormSection title="Identifier" description="The unique number printed on each digital ID.">
            <Field label="Identifier name" required error={errors.identifierLabel} hint="For example Matric number or Employee number.">
              {(p) => <Input {...p} value={form.identifierLabel} onChange={(e) => set('identifierLabel', e.target.value)} />}
            </Field>
            <div role="radiogroup" aria-label="How identifiers are assigned" className="grid gap-3 sm:grid-cols-2">
              <RadioCard checked={form.identifierMode === 'manual'} onSelect={() => set('identifierMode', 'manual')}
                title="Enter for each person" description="Use numbers you already have, such as matric numbers." />
              <RadioCard checked={form.identifierMode === 'generated'} onSelect={() => set('identifierMode', 'generated')}
                title="Generate automatically" description="FixID assigns the next number in sequence." />
            </div>
            {form.identifierMode === 'generated' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Prefix" error={errors.prefix} hint="Optional. Capital letters, numbers, - or /.">
                  {(p) => <Input {...p} value={form.prefix} maxLength={12} onChange={(e) => set('prefix', e.target.value.toUpperCase())} />}
                </Field>
                <Field label="Number length" error={errors.digits}>
                  {(p) => (
                    <Select {...p} value={form.digits} onChange={(e) => set('digits', Number(e.target.value))}>
                      {[4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} digits</option>)}
                    </Select>
                  )}
                </Field>
                <p className="text-sm text-slate-500 sm:col-span-2">First identifier: <span className="font-mono font-medium text-slate-900">{firstId}</span></p>
              </div>
            )}
            <p className="text-xs text-slate-500">Identifiers are always unique within this credential.</p>
          </FormSection>

          <FormSection title="Validity" description="When the digital ID starts and stops being valid.">
            <Field label="Expires" error={errors.validity}>
              {(p) => (
                <Select {...p} value={form.expiry === 'duration' ? String(form.months) : form.expiry}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'fixed-date' || v === 'no-expiry') update({ credentialForm: { ...form, expiry: v } });
                    else update({ credentialForm: { ...form, expiry: 'duration', months: Number(v) } });
                    setErrors((er) => ({ ...er, validity: '' }));
                  }}>
                  {DURATIONS.map((d) => <option key={d.months} value={d.months}>{d.label} after it becomes effective</option>)}
                  <option value="fixed-date">On a specific date</option>
                  <option value="no-expiry">Never</option>
                </Select>
              )}
            </Field>
            {form.expiry === 'fixed-date' && (
              <Field label="Expiry date" required error={errors.validity}>
                {(p) => <Input {...p} type="date" value={form.fixedDate} onChange={(e) => set('fixedDate', e.target.value)} />}
              </Field>
            )}
            <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              More options <ChevronDown className={cn('h-4 w-4 transition-transform', advanced && 'rotate-180')} aria-hidden="true" />
            </button>
            {advanced && (
              <div className="space-y-4 rounded-xl bg-slate-50 p-4">
                <div role="radiogroup" aria-label="Effective from" className="grid gap-3 sm:grid-cols-2">
                  <RadioCard checked={form.effectiveDate === 'on-issue'} onSelect={() => set('effectiveDate', 'on-issue')}
                    title="Effective when issued" description="Recommended." />
                  <RadioCard checked={form.effectiveDate === 'custom-date'} onSelect={() => set('effectiveDate', 'custom-date')}
                    title="Choose a date when issuing" description="For example, the start of term." />
                </div>
                <label className={cn('flex items-center gap-2 text-sm text-slate-700', form.expiry === 'no-expiry' && 'opacity-50')}>
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" disabled={form.expiry === 'no-expiry'}
                    checked={form.renewalAllowed && form.expiry !== 'no-expiry'} onChange={(e) => set('renewalAllowed', e.target.checked)} />
                  Allow renewal before it expires
                </label>
                {form.renewalAllowed && form.expiry !== 'no-expiry' && (
                  <div className="max-w-xs">
                    <Field label="Renewal opens (days before expiry)" error={errors.renewal}>
                      {(p) => <Input {...p} type="number" min={1} max={180} value={form.renewalWindowDays} onChange={(e) => set('renewalWindowDays', Number(e.target.value))} />}
                    </Field>
                  </div>
                )}
              </div>
            )}
          </FormSection>

          <FormSection title="Template" description="How the digital ID looks. Every organization starts with a default design.">
            <div role="radiogroup" aria-label="Template" className="grid gap-3 sm:grid-cols-2">
              {org.cardDesigns.map((d) => (
                <RadioCard key={d.id} checked={form.cardDesignId === d.id} onSelect={() => set('cardDesignId', d.id)}
                  title={<span className="flex items-center gap-2"><span className="h-4 w-6 rounded" style={{ background: `linear-gradient(135deg, ${d.primaryColor}, ${d.accentColor})` }} />{d.name}</span>}
                  badge={d.isDefault ? <Badge tone="brand">Default</Badge> : undefined}
                  description={d.layout === 'vertical' ? 'Portrait' : 'Landscape'} />
              ))}
            </div>
            {errors.cardDesignId && <p role="alert" className="text-sm text-red-600">{errors.cardDesignId}</p>}
            <a href="/templates" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              Manage templates <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <p className="text-xs text-slate-500">Opens in a new tab. Your progress here is kept.</p>
          </FormSection>
        </div>
      )}
    </StepShell>
  );
}
