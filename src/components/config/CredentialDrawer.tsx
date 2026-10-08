import { useEffect, useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { Badge, Button, Drawer, Field, Input, Select, useToast } from '@/components/ui';
import { DigitalIdCard } from '@/components/domain/DigitalIdCard';
import { describePattern, previewIdentifier } from '@/domain/identifierPattern';
import type { ValidityRule } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { newId } from '@/lib/identifiers';
import { cn } from '@/lib/cn';
import { computeValidity } from '@/services/issuance';
import { useActions, useOrgData } from '@/store/AppStore';
import { DiscardBar } from './DiscardBar';
import { useSaveIdentifier } from './IdentifierDrawer';
import { IdentifierConfigForm, initialIdentifierForm, type IdentifierFormValue } from './IdentifierConfigForm';
import { useGuardedClose } from './useGuardedClose';

interface CredentialForm {
  name: string;
  identifierConfigId: string;
  cardDesignId: string;
  effectiveDate: 'on-issue' | 'custom-date';
  expiry: 'duration' | 'fixed-date' | 'no-expiry';
  months: number;
  fixedDate: string;
  renewalAllowed: boolean;
  renewalWindowDays: number;
}

const DURATIONS = [{ m: 6, l: '6 months' }, { m: 12, l: '1 year' }, { m: 24, l: '2 years' }, { m: 36, l: '3 years' }, { m: 48, l: '4 years' }];

function toValidity(f: CredentialForm): ValidityRule {
  if (f.expiry === 'no-expiry') return { kind: 'no-expiry' };
  if (f.expiry === 'fixed-date') return { kind: 'fixed-date', date: f.fixedDate ? new Date(`${f.fixedDate}T23:59:59`).toISOString() : '' };
  return { kind: 'duration', months: f.months };
}

function suggestName(identifierName: string) {
  const n = identifierName.toLowerCase();
  if (n.includes('matric') || n.includes('student')) return 'Student ID';
  if (n.includes('staff')) return 'Staff ID';
  if (n.includes('employee')) return 'Employee ID';
  if (n.includes('member')) return 'Membership Card';
  return '';
}

/**
 * Reusable "Configure credential" drawer. Opened through CredentialSetup from Credential Management and Templates.
 * A new identifier can be created in a nested view on the same drawer surface.
 */
export function CredentialDrawer({ open, onClose, onSaved, defaultIdentifierConfigId }: {
  open: boolean;
  onClose: () => void;
  onSaved: (credentialTypeId: string) => void;
  defaultIdentifierConfigId?: string;
}) {
  const org = useOrgData();
  const { organization, identifierConfigs, cardDesigns, identifierConfigById } = org;
  const { saveCredentialConfig } = useActions();
  const saveIdentifier = useSaveIdentifier();
  const toast = useToast();

  const blank = (): CredentialForm => {
    const idc = defaultIdentifierConfigId ?? identifierConfigs[0]?.id ?? '';
    return {
      name: suggestName(identifierConfigById.get(idc)?.name ?? ''), identifierConfigId: idc, cardDesignId: organization.defaultCardDesignId,
      effectiveDate: 'on-issue', expiry: 'duration', months: 12, fixedDate: '', renewalAllowed: true, renewalWindowDays: 30,
    };
  };
  const [form, setForm] = useState<CredentialForm>(blank);
  const [initial, setInitial] = useState(form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Nested identifier view (same drawer surface; no stacked drawers).
  const [nested, setNested] = useState<IdentifierFormValue | null>(null);
  const [nestedErrors, setNestedErrors] = useState<Parameters<typeof IdentifierConfigForm>[0]['errors']>({});

  useEffect(() => {
    if (!open) return;
    const f = blank();
    setForm(f);
    setInitial(f);
    setErrors({});
    setNested(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const guard = useGuardedClose(nested !== null || JSON.stringify(form) !== JSON.stringify(initial), onClose);
  const set = <K extends keyof CredentialForm>(k: K, v: CredentialForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '', ...(k === 'expiry' || k === 'months' || k === 'fixedDate' ? { validity: '' } : {}) }));
  };

  const submit = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 200));
    const r = saveCredentialConfig({
      organizationId: organization.id, at: new Date().toISOString(), id: newId('ct'), name: form.name, identifierConfigId: form.identifierConfigId,
      cardDesignId: form.cardDesignId, effectiveDate: form.effectiveDate, validity: toValidity(form),
      renewal: { allowed: form.renewalAllowed, windowDays: form.renewalWindowDays },
    });
    setSaving(false);
    if (!r.ok) return setErrors(r.errors);
    // Confirmation is shown by the caller (see CredentialSetup), after this drawer closes.
    onSaved(r.credentialTypeId);
  };

  const saveNested = () => {
    if (!nested) return;
    const r = saveIdentifier(organization.id, nested);
    if (!r.ok) return setNestedErrors(r.errors);
    toast({ tone: 'success', title: `${nested.name.trim()} saved` });
    setForm((f) => ({ ...f, identifierConfigId: r.configId, name: f.name || suggestName(nested.name) }));
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
  const design = cardDesigns.find((d) => d.id === form.cardDesignId) ?? cardDesigns[0];
  const validity = computeValidity({ effectiveDate: 'on-issue', validity: toValidity(form) }, new Date());
  const sample = idConfig
    ? idConfig.mode === 'generated' ? previewIdentifier(idConfig.segments, idConfig.nextSequence, organization.timezone) : `${idConfig.name}`
    : 'ID number';

  return (
    <Drawer open={open} onClose={guard.requestClose} width="xl"
      title="Configure credential" description="Define the digital ID you'll issue. You can reuse it for every user with the same identifier."
      footer={guard.confirming ? <DiscardBar onKeep={guard.keepEditing} onDiscard={guard.discard} /> : (
        <>
          <Button variant="secondary" onClick={guard.requestClose}>Cancel</Button>
          <Button onClick={submit} loading={saving}>Save credential</Button>
        </>
      )}>
      <div className="space-y-8">
        <Field label="Credential name" required error={errors.name} hint="For example Student ID, Staff ID or Membership Card.">
          {(p) => <Input {...p} data-autofocus value={form.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p id="cred-identifier" className="text-sm font-semibold text-slate-900">Identifier</p>
            <button type="button" onClick={() => setNested(initialIdentifierForm(undefined, ''))}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              <Plus className="h-4 w-4" aria-hidden="true" /> Create new identifier
            </button>
          </div>
          {identifierConfigs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">No identifiers yet. Create one to continue.</p>
          ) : (
            <div role="radiogroup" aria-labelledby="cred-identifier" className="grid gap-3 sm:grid-cols-2">
              {identifierConfigs.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={form.identifierConfigId === c.id} onClick={() => set('identifierConfigId', c.id)}
                  className={cn('rounded-xl border p-3 text-left', form.identifierConfigId === c.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                  <span className="block text-sm font-semibold text-slate-900">{c.name}</span>
                  <span className="block font-mono text-xs text-slate-500">{c.mode === 'manual' ? 'Entered manually' : describePattern(c.segments)}</span>
                </button>
              ))}
            </div>
          )}
          {errors.identifierConfigId && <p role="alert" className="mt-2 text-sm text-red-600">{errors.identifierConfigId}</p>}
          <p className="mt-2 text-xs text-slate-500">The credential shows the identifier already assigned to each user. It isn't regenerated.</p>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <p id="cred-template" className="text-sm font-semibold text-slate-900">Template</p>
            <div role="radiogroup" aria-labelledby="cred-template" className="space-y-2">
              {cardDesigns.map((d) => (
                <button key={d.id} type="button" role="radio" aria-checked={form.cardDesignId === d.id} onClick={() => set('cardDesignId', d.id)}
                  className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left', form.cardDesignId === d.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                  <span className="h-6 w-9 shrink-0 rounded" style={{ background: `linear-gradient(135deg, ${d.primaryColor}, ${d.accentColor})` }} />
                  <span className="flex-1 text-sm font-medium text-slate-900">{d.name}</span>
                  {d.isDefault && <Badge tone="brand">Default</Badge>}
                </button>
              ))}
            </div>
            {errors.cardDesignId && <p role="alert" className="text-sm text-red-600">{errors.cardDesignId}</p>}
            <a href="/templates" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              Manage templates <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
          <div className="flex items-start justify-center overflow-hidden rounded-2xl bg-slate-50 p-4">
            {design && (
              <div className="origin-top scale-[0.8]">
                <DigitalIdCard design={design} organization={organization} content={{
                  name: 'Sample Holder', identifier: sample, identifierLabel: idConfig?.name, credentialTypeName: form.name || 'Digital ID',
                  expiresAt: validity.expiresAt ? validity.expiresAt.toISOString() : null,
                }} />
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <p className="text-sm font-semibold text-slate-900">Validity</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Effective from" hint="The issuance time is always recorded separately.">
              {(p) => (
                <Select {...p} value={form.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value as CredentialForm['effectiveDate'])}>
                  <option value="on-issue">When issued (recommended)</option>
                  <option value="custom-date">A date chosen when issuing</option>
                </Select>
              )}
            </Field>
            <Field label="Expires" error={errors.validity}>
              {(p) => (
                <Select {...p} value={form.expiry === 'duration' ? String(form.months) : form.expiry} onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'fixed-date' || v === 'no-expiry') set('expiry', v);
                  else { setForm((f) => ({ ...f, expiry: 'duration', months: Number(v) })); setErrors((er) => ({ ...er, validity: '' })); }
                }}>
                  {DURATIONS.map((d) => <option key={d.m} value={d.m}>{d.l} after it becomes effective</option>)}
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
          </div>
          <p className="text-xs text-slate-500">
            {validity.expiresAt ? `A credential issued today would expire on ${formatDate(validity.expiresAt.toISOString())}.` : 'Credentials will not expire.'}
          </p>
          {form.expiry !== 'no-expiry' && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={form.renewalAllowed}
                  onChange={(e) => set('renewalAllowed', e.target.checked)} />
                Can be renewed
              </label>
              {form.renewalAllowed && (
                <label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-600">
                  opening
                  <Input type="number" min={1} max={180} aria-label="Renewal window in days" className="h-9 w-20" value={form.renewalWindowDays}
                    onChange={(e) => set('renewalWindowDays', Number(e.target.value))} />
                  days before expiry
                </label>
              )}
            </div>
          )}
          {errors.renewal && <p role="alert" className="text-sm text-red-600">{errors.renewal}</p>}
        </section>
      </div>
    </Drawer>
  );
}
