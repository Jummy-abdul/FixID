import { useEffect, useState } from 'react';
import { Button, Drawer, useToast } from '@/components/ui';
import type { IdentifierConfig } from '@/domain/types';
import { newId } from '@/lib/identifiers';
import { useActions, useStore, useOrgData } from '@/store/AppStore';
import { validateIdentifierConfig, type IdentifierConfigErrors } from '@/store/operations';
import { DiscardBar } from './DiscardBar';
import { IdentifierConfigForm, initialIdentifierForm, type IdentifierFormValue } from './IdentifierConfigForm';
import { useGuardedClose } from './useGuardedClose';

/** Saves an identifier configuration; returns the saved id, or validation errors without saving. */
export function useSaveIdentifier() {
  const { saveIdentifierConfig } = useActions();
  const { getState } = useStore();
  return (organizationId: string, form: IdentifierFormValue, existingId?: string):
    { ok: true; configId: string } | { ok: false; errors: IdentifierConfigErrors } => {
    const input = { organizationId, at: new Date().toISOString(), id: existingId ?? newId('idc'), ...form };
    const errors = validateIdentifierConfig(getState(), input);
    if (errors.name || errors.segments) return { ok: false, errors };
    const r = saveIdentifierConfig(input);
    return r.ok ? { ok: true, configId: r.configId } : { ok: false, errors: { name: r.errors.name } };
  };
}

/**
 * Reusable "Configure identifier" drawer. Used from Add user and from Templates → Identifiers.
 * Returns the saved configuration to the caller via onSaved.
 */
export function IdentifierDrawer({ open, onClose, onSaved, suggestedName, existing }: {
  open: boolean;
  onClose: () => void;
  onSaved: (configId: string) => void;
  suggestedName?: string;
  existing?: IdentifierConfig;
}) {
  const { organization } = useOrgData();
  const toast = useToast();
  const save = useSaveIdentifier();
  const [form, setForm] = useState<IdentifierFormValue>(() => initialIdentifierForm(existing, suggestedName));
  const [initial, setInitial] = useState(form);
  const [errors, setErrors] = useState<IdentifierConfigErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const f = initialIdentifierForm(existing, suggestedName);
    setForm(f);
    setInitial(f);
    setErrors({});
  }, [open, existing, suggestedName]);

  const guard = useGuardedClose(JSON.stringify(form) !== JSON.stringify(initial), onClose);

  const submit = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 200));
    const r = save(organization.id, form, existing?.id);
    setSaving(false);
    if (!r.ok) return setErrors(r.errors);
    toast({ tone: 'success', title: `${form.name.trim()} saved`, description: existing ? 'Future users will use the updated rules.' : 'You can reuse it for every user you add.' });
    onSaved(r.configId);
  };

  return (
    <Drawer open={open} onClose={guard.requestClose} width="xl"
      title={existing ? `Edit ${existing.name}` : 'Configure identifier'}
      description="Define how this identifier will be assigned to users."
      footer={guard.confirming ? <DiscardBar onKeep={guard.keepEditing} onDiscard={guard.discard} /> : (
        <>
          <Button variant="secondary" onClick={guard.requestClose}>Cancel</Button>
          <Button onClick={submit} loading={saving}>Save identifier</Button>
        </>
      )}>
      <IdentifierConfigForm value={form} onChange={(v) => { setForm(v); setErrors({}); }} errors={errors} timeZone={organization.timezone} existing={existing} />
    </Drawer>
  );
}
