import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import type { CredentialType } from '@/domain/types';
import { readPhoto } from '@/lib/image';
import { useServices } from '@/services/ServicesProvider';
import { IdSwitchUnavailableError } from '@/services/types';
import { useStore, type OrgData } from '@/store/AppStore';
import { findDuplicateIdentifier } from '@/store/operations';
import { identityKey, type Draft, type PersonForm } from './draft';
import { Callout, FormSection, StepShell } from './parts';
import { defaultCredentialForm } from './StepUserType';

type Errors = Partial<Record<keyof PersonForm, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validatePerson(p: PersonForm, type: CredentialType, isDuplicateIdentifier: (v: string) => boolean): Errors {
  const e: Errors = {};
  const name = /^[\p{L}][\p{L}\p{M}' .-]*$/u;
  if (!p.givenName.trim()) e.givenName = 'Enter their first name.';
  else if (!name.test(p.givenName.trim())) e.givenName = 'Use letters only.';
  if (!p.familyName.trim()) e.familyName = 'Enter their last name.';
  else if (!name.test(p.familyName.trim())) e.familyName = 'Use letters only.';
  if (p.email.trim() && !EMAIL.test(p.email.trim())) e.email = 'Enter a valid email address.';
  const digits = p.phone.replace(/\D/g, '');
  if (p.phone.trim() && (!/^[+\d][\d\s()-]*$/.test(p.phone.trim()) || digits.length < 7 || digits.length > 15)) e.phone = 'Enter a valid phone number.';
  if (!p.email.trim() && !p.phone.trim()) e.email = 'Add an email address or phone number.';
  if (type.identifier.mode === 'manual') {
    const v = p.identifier.trim();
    if (!v) e.identifier = `Enter their ${type.identifier.label.toLowerCase()}.`;
    else if (!/^[A-Za-z0-9][A-Za-z0-9/._-]{1,39}$/.test(v)) e.identifier = 'Use 2–40 letters, numbers, /, ., - or _.';
    else if (isDuplicateIdentifier(v)) e.identifier = `${v} is already assigned to someone else.`;
  }
  if (type.effectiveDate === 'custom-date' && !p.effectiveDate) e.effectiveDate = 'Choose when the digital ID becomes effective.';
  return e;
}

export function StepDetails({ org, draft, type, userTypeName, update, footerStart }: {
  org: OrgData; draft: Draft; type: CredentialType; userTypeName: string; update: (patch: Partial<Draft>) => void; footerStart: React.ReactNode;
}) {
  const { idSwitch } = useServices();
  const { getState } = useStore();
  const [errors, setErrors] = useState<Errors>({});
  const [checking, setChecking] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const p = draft.person;

  const set = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => {
    update({ person: { ...p, [k]: v } });
    if (errors[k] || (k === 'phone' && errors.email)) setErrors((e) => ({ ...e, [k]: undefined, ...(k === 'phone' ? { email: undefined } : {}) }));
  };

  const onPhoto = async (file?: File) => {
    if (!file) return;
    setPhotoError(null);
    try {
      set('photoDataUrl', await readPhoto(file));
    } catch (err) {
      setPhotoError((err as Error).message);
    }
  };

  const proceed = async () => {
    const errs = validatePerson(p, type, (v) => !!findDuplicateIdentifier(getState(), type.id, v));
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const keyNow = identityKey(p);
    if (draft.resolution && draft.resolvedFor === keyNow) {
      update({ step: 'identity' });
      return;
    }
    setChecking(true);
    setLookupFailed(false);
    try {
      const resolution = await idSwitch.resolveIdentity({ givenName: p.givenName, familyName: p.familyName, email: p.email, phone: p.phone });
      const member = resolution.kind === 'match'
        ? org.members.find((m) => m.idSwitchId === resolution.identity.idSwitchId) ?? null
        : null;
      update({ resolution, resolvedFor: keyNow, existingMemberId: member?.id ?? null, confirmNewIdentity: false, createdIdentity: null, step: 'identity' });
    } catch (err) {
      if (err instanceof IdSwitchUnavailableError) setLookupFailed(true);
      else throw err;
    } finally {
      setChecking(false);
    }
  };

  return (
    <StepShell
      title={`Who is this ${userTypeName.toLowerCase()}?`}
      description={<>They'll receive a <span className="font-medium text-slate-700">{type.name}</span>.{' '}
        <button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={() => update({ step: 'credential', reusedCredential: false, credentialChoice: { existingId: type.id }, credentialForm: draft.credentialForm ?? defaultCredentialForm(org, userTypeName) })}>Change</button></>}
      footer={
        <>
          <div className="flex items-center gap-2">
            {footerStart}
            <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => update({ step: draft.reusedCredential ? 'type' : 'credential' })}>Back</Button>
          </div>
          <Button onClick={proceed} loading={checking}>{checking ? 'Checking ID Switch…' : 'Continue'} {!checking && <ArrowRight className="h-4 w-4" />}</Button>
        </>
      }
    >
      {lookupFailed && (
        <div className="mb-6">
          <Callout tone="danger" title="We couldn't reach ID Switch"
            action={<Button size="sm" variant="secondary" onClick={proceed}>Try again</Button>}>
            We need to check for an existing identity before issuing. Nothing has been saved.
          </Callout>
        </div>
      )}
      <FormSection title="Name and contact" description="Held in ID Switch, Seamfix's shared identity record. FixID keeps only what your organization needs.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={errors.givenName}>
            {(f) => <Input {...f} autoComplete="off" value={p.givenName} onChange={(e) => set('givenName', e.target.value)} />}
          </Field>
          <Field label="Last name" required error={errors.familyName}>
            {(f) => <Input {...f} autoComplete="off" value={p.familyName} onChange={(e) => set('familyName', e.target.value)} />}
          </Field>
          <Field label="Email address" error={errors.email}>
            {(f) => <Input {...f} type="email" autoComplete="off" value={p.email} onChange={(e) => set('email', e.target.value)} />}
          </Field>
          <Field label="Phone number" error={errors.phone}>
            {(f) => <Input {...f} type="tel" autoComplete="off" value={p.phone} onChange={(e) => set('phone', e.target.value)} />}
          </Field>
        </div>
        <p className="text-xs text-slate-500">Add at least an email or phone number. It's used to find an existing identity and to deliver their digital ID.</p>
      </FormSection>

      {(type.identifier.mode === 'manual' || type.effectiveDate === 'custom-date') && (
        <FormSection title={type.name} description="Details for this credential.">
          {type.identifier.mode === 'manual' && (
            <Field label={type.identifier.label} required error={errors.identifier} hint="Must be unique.">
              {(f) => <Input {...f} autoComplete="off" value={p.identifier} onChange={(e) => set('identifier', e.target.value)} />}
            </Field>
          )}
          {type.effectiveDate === 'custom-date' && (
            <Field label="Effective from" required error={errors.effectiveDate}>
              {(f) => <Input {...f} type="date" value={p.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} />}
            </Field>
          )}
        </FormSection>
      )}

      <FormSection title="Photo" description="Optional. Shown on the digital ID.">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 text-slate-400">
            {p.photoDataUrl ? <img src={p.photoDataUrl} alt="Selected photo" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6" aria-hidden="true" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload photo"
              onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>{p.photoDataUrl ? 'Replace photo' : 'Upload photo'}</Button>
            {p.photoDataUrl && <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => set('photoDataUrl', undefined)}>Remove</Button>}
          </div>
        </div>
        {photoError && <p role="alert" className="text-sm text-red-600">{photoError}</p>}
        <p className="text-xs text-slate-500">JPG, PNG or WebP, up to 5 MB.</p>
      </FormSection>
    </StepShell>
  );
}
