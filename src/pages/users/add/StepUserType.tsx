import { useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { Badge, Button, Field, Input } from '@/components/ui';
import type { OrgData } from '@/store/AppStore';
import { cn } from '@/lib/cn';
import { credentialDefaults, userTypeSuggestions } from './suggestions';
import type { CredentialForm, Draft } from './draft';
import { RadioCard, StepShell } from './parts';

type Selection = { id: string } | { name: string } | null;

export function defaultCredentialForm(org: OrgData, userTypeName: string): CredentialForm {
  const d = credentialDefaults(org.organization, userTypeName);
  return {
    name: d.name,
    identifierLabel: d.identifierLabel,
    identifierMode: d.identifierMode,
    prefix: d.prefix,
    digits: 6,
    effectiveDate: 'on-issue',
    expiry: 'duration',
    months: 12,
    fixedDate: '',
    renewalAllowed: true,
    renewalWindowDays: 30,
    cardDesignId: org.organization.defaultCardDesignId,
  };
}

export function StepUserType({ org, draft, onContinue, footerStart }: { org: OrgData; draft: Draft; onContinue: (patch: Partial<Draft>) => void; footerStart: React.ReactNode }) {
  const [selection, setSelection] = useState<Selection>(draft.userType);
  const isCustomName = selection && 'name' in selection && !userTypeSuggestions(org.organization, org.userTypes.map((u) => u.name)).includes(selection.name);
  const [custom, setCustom] = useState(isCustomName && selection && 'name' in selection ? selection.name : '');
  const [customOpen, setCustomOpen] = useState(!!isCustomName);
  const [error, setError] = useState<string | null>(null);

  const suggestions = userTypeSuggestions(org.organization, org.userTypes.map((u) => u.name));
  const isSelected = (s: Selection) => JSON.stringify(s) === JSON.stringify(selection);

  const proceed = () => {
    let chosen = selection;
    if (customOpen) {
      const name = custom.trim();
      if (name.length < 2) return setError('Enter a name for this type of user, e.g. Volunteer.');
      if (name.length > 40) return setError('Keep the name under 40 characters.');
      const existing = org.userTypes.find((u) => u.name.toLowerCase() === name.toLowerCase());
      chosen = existing ? { id: existing.id } : { name };
    }
    if (!chosen) return setError('Choose who you are adding.');

    const existing = 'id' in chosen ? org.userTypes.find((u) => u.id === (chosen as { id: string }).id) : undefined;
    const credential = existing?.credentialTypeId ? org.credentialTypeById.get(existing.credentialTypeId) : undefined;
    if (existing && credential && credential.status === 'active') {
      // A saved configuration exists: reuse it and skip setup.
      onContinue({ userType: chosen, credentialTypeId: credential.id, reusedCredential: true, credentialChoice: { existingId: credential.id }, step: 'details' });
      return;
    }
    const name = existing?.name ?? (chosen as { name: string }).name;
    const hasActiveTypes = org.credentialTypes.some((t) => t.status === 'active');
    onContinue({
      userType: chosen,
      credentialTypeId: null,
      reusedCredential: false,
      credentialChoice: hasActiveTypes ? draft.credentialChoice ?? 'new' : 'new',
      credentialForm: draft.credentialForm && draft.userType && JSON.stringify(draft.userType) === JSON.stringify(chosen) ? draft.credentialForm : defaultCredentialForm(org, name),
      step: 'credential',
    });
  };

  return (
    <StepShell
      title="Who are you adding?"
      description="Choose the kind of person. FixID uses this to decide which digital ID to issue."
      footer={<>{footerStart}<Button onClick={proceed}>Continue <ArrowRight className="h-4 w-4" /></Button></>}
    >
      <div className="space-y-6">
        {org.userTypes.length > 0 && (
          <div>
            <p className="mb-3 text-sm font-medium text-slate-700">Your user types</p>
            <div role="radiogroup" aria-label="Your user types" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {org.userTypes.map((u) => {
                const cred = u.credentialTypeId ? org.credentialTypeById.get(u.credentialTypeId) : undefined;
                return (
                  <RadioCard key={u.id} checked={!customOpen && isSelected({ id: u.id })}
                    onSelect={() => { setSelection({ id: u.id }); setCustomOpen(false); setError(null); }}
                    title={u.name}
                    description={cred ? `Issues ${cred.name}` : 'No credential set up yet'}
                    badge={cred ? <Badge tone="success">Ready</Badge> : undefined} />
                );
              })}
            </div>
          </div>
        )}

        <div>
          <p className="mb-3 text-sm font-medium text-slate-700">{org.userTypes.length > 0 ? 'Or add a new type' : 'For example'}</p>
          <div role="radiogroup" aria-label="Suggested user types" className="flex flex-wrap gap-2">
            {suggestions.map((name) => {
              const checked = !customOpen && isSelected({ name });
              return (
                <button key={name} type="button" role="radio" aria-checked={checked}
                  onClick={() => { setSelection({ name }); setCustomOpen(false); setError(null); }}
                  className={cn('rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400')}>
                  {name}
                </button>
              );
            })}
            <button type="button" role="radio" aria-checked={customOpen}
              onClick={() => { setCustomOpen(true); setSelection(null); setError(null); }}
              className={cn('inline-flex items-center gap-1.5 rounded-full border border-dashed px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                customOpen ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:border-slate-400')}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Something else
            </button>
          </div>
          {customOpen && (
            <div className="mt-4 max-w-sm">
              <Field label="Name this user type" required error={error ?? undefined} hint="For example Volunteer, Alumnus or Contractor.">
                {(p) => <Input {...p} autoFocus value={custom} onChange={(e) => { setCustom(e.target.value); setError(null); }} />}
              </Field>
            </div>
          )}
        </div>
        {error && !customOpen && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </StepShell>
  );
}
