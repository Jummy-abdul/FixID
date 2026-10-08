import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Fingerprint, ImagePlus, Trash2, UserPlus } from 'lucide-react';
import { Badge, Button, Field, Input } from '@/components/ui';
import { SimulatedBadge } from '@/components/domain/StatusBadges';
import { describePattern, previewIdentifier, validateManualValue } from '@/domain/identifierPattern';
import type { CanonicalIdentity, IdentifierConfig } from '@/domain/types';
import { readPhoto } from '@/lib/image';
import { maskEmail, maskPhone, newId } from '@/lib/identifiers';
import { useServices } from '@/services/ServicesProvider';
import { IdSwitchUnavailableError, type ResolutionResult } from '@/services/types';
import { useActions, useStore, type OrgData } from '@/store/AppStore';
import { isIdentifierTaken } from '@/store/operations';
import { identityKey, type Draft, type PersonForm } from './draft';
import { Callout, FormSection, StepShell } from './parts';

type Errors = Partial<Record<keyof PersonForm, string>>;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

export function validatePerson(p: PersonForm, config: IdentifierConfig, taken: (v: string) => boolean): Errors {
  const e: Errors = {};
  if (!p.givenName.trim()) e.givenName = 'Enter their first name.';
  else if (!NAME.test(p.givenName.trim())) e.givenName = 'Use letters only.';
  if (!p.familyName.trim()) e.familyName = 'Enter their last name.';
  else if (!NAME.test(p.familyName.trim())) e.familyName = 'Use letters only.';
  if (p.email.trim() && !EMAIL.test(p.email.trim())) e.email = 'Enter a valid email address.';
  const digits = p.phone.replace(/\D/g, '');
  if (p.phone.trim() && (!/^[+\d][\d\s()-]*$/.test(p.phone.trim()) || digits.length < 7 || digits.length > 15)) e.phone = 'Enter a valid phone number.';
  if (!p.email.trim() && !p.phone.trim()) e.email = 'Add an email address or phone number.';
  if (config.mode === 'manual') {
    const v = p.identifierValue.trim();
    const invalid = v ? validateManualValue(v) : `Enter their ${config.name}.`;
    if (invalid) e.identifierValue = invalid;
    else if (taken(v)) e.identifierValue = `${v} is already assigned to another user.`;
  }
  return e;
}

/** What the identity check means for creating this user. */
function decision(r: ResolutionResult | null, existingMemberName: string | null, confirmNew: boolean) {
  if (!r) return { canCreate: false as const };
  if (existingMemberName) return { canCreate: false as const };
  if (r.kind === 'conflict') return { canCreate: false as const };
  if (r.kind === 'possible' && !confirmNew) return { canCreate: false as const };
  return { canCreate: true as const, reuse: r.kind === 'match' };
}

function IdentityCard({ identity }: { identity: CanonicalIdentity }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Fingerprint className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">{identity.givenName} {identity.familyName}</p>
        <p className="font-mono text-xs text-slate-500">{identity.idSwitchId}</p>
        <p className="text-slate-600">{[maskEmail(identity.email), maskPhone(identity.phone)].filter(Boolean).join(' · ')}</p>
      </div>
    </div>
  );
}

export function StepDetails({ org, draft, config, update, footerStart }: {
  org: OrgData; draft: Draft; config: IdentifierConfig; update: (patch: Partial<Draft>) => void; footerStart: React.ReactNode;
}) {
  const { idSwitch } = useServices();
  const { getState } = useStore();
  const { createUser } = useActions();
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<'checking' | 'creating' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const p = draft.person;
  const current = draft.resolvedFor === identityKey(p) ? draft.resolution : null;
  const existingMember = current?.kind === 'match' ? org.members.find((m) => m.idSwitchId === current.identity.idSwitchId) ?? null : null;
  const d = decision(current, existingMember?.displayName ?? null, draft.confirmNewIdentity);

  const set = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => {
    update({ person: { ...p, [k]: v } });
    setFailure(null);
    if (errors[k] || (k === 'phone' && errors.email)) setErrors((e) => ({ ...e, [k]: undefined, ...(k === 'phone' ? { email: undefined } : {}) }));
  };

  const create = async (resolution: ResolutionResult) => {
    setBusy('creating');
    try {
      let identity: { idSwitchId: string; resolution: 'linked-existing' | 'created-new' };
      if (resolution.kind === 'match') {
        identity = { idSwitchId: resolution.identity.idSwitchId, resolution: 'linked-existing' };
      } else {
        let created = draft.createdIdentity;
        if (!created) {
          created = await idSwitch.createIdentity({ givenName: p.givenName, familyName: p.familyName, email: p.email, phone: p.phone });
          update({ createdIdentity: created });
        }
        identity = { idSwitchId: created.idSwitchId, resolution: 'created-new' };
      }
      await new Promise((r) => setTimeout(r, 250));
      const r = createUser({
        requestId: draft.requestId, organizationId: org.organization.id, at: new Date().toISOString(), identifierConfigId: config.id,
        identifierValue: p.identifierValue, person: { givenName: p.givenName, familyName: p.familyName, photoDataUrl: p.photoDataUrl },
        identity, memberId: newId('mem'),
      });
      if (!r.ok) {
        if (r.errors.identifier) setErrors((e) => ({ ...e, identifierValue: r.errors.identifier }));
        setFailure(Object.values(r.errors)[0] ?? 'The user could not be created.');
        return;
      }
      update({ memberId: r.memberId, phase: 'created' });
    } catch (err) {
      setFailure(err instanceof IdSwitchUnavailableError
        ? "ID Switch is unavailable, so the identity couldn't be created. Nothing was saved."
        : (err as Error).message || 'Something went wrong. Nothing was saved.');
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (inFlight.current) return;
    const errs = validatePerson(p, config, (v) => isIdentifierTaken(getState(), config.id, v));
    setErrors(errs);
    if (Object.keys(errs).length) return;
    inFlight.current = true;
    setFailure(null);
    try {
      // Reuse a resolution for unchanged details (e.g. after confirming a new identity).
      if (current) {
        if (d.canCreate) await create(current);
        return;
      }
      setBusy('checking');
      const resolution = await idSwitch.resolveIdentity({ givenName: p.givenName, familyName: p.familyName, email: p.email, phone: p.phone });
      setBusy(null);
      update({ resolution, resolvedFor: identityKey(p), confirmNewIdentity: false, createdIdentity: null });
      const member = resolution.kind === 'match' ? org.members.find((m) => m.idSwitchId === resolution.identity.idSwitchId) : undefined;
      // Clear cases continue straight away; anything that needs a decision stops here.
      if (resolution.kind === 'none' || (resolution.kind === 'match' && !member)) await create(resolution);
    } catch (err) {
      setBusy(null);
      if (err instanceof IdSwitchUnavailableError) setFailure("We couldn't reach ID Switch to check for an existing identity. Nothing has been saved. Try again shortly.");
      else throw err;
    } finally {
      inFlight.current = false;
    }
  };

  const generatedExample = config.mode === 'generated' ? previewIdentifier(config.segments, config.nextSequence, org.organization.timezone) : null;

  return (
    <StepShell
      title="User information"
      description={<>Identified by <span className="font-medium text-slate-700">{config.name}</span>.{' '}
        <button type="button" className="font-medium text-brand-600 hover:text-brand-700" onClick={() => update({ phase: 'identifier' })}>Change</button></>}
      footer={
        <>
          <div className="flex items-center gap-2">
            {footerStart}
            <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => update({ phase: 'identifier' })} disabled={!!busy}>Back</Button>
          </div>
          <Button onClick={submit} loading={!!busy} disabled={!!current && !d.canCreate} icon={busy ? undefined : <UserPlus className="h-4 w-4" />}>
            {busy === 'checking' ? 'Checking ID Switch…' : busy === 'creating' ? 'Creating user…' : 'Create user'}
          </Button>
        </>
      }
    >
      {failure && <div className="mb-6"><Callout tone="danger" title="The user wasn't created">{failure}</Callout></div>}

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
        <p className="text-xs text-slate-500">Add at least an email or phone number. It's used to find an existing identity and later to deliver their digital ID.</p>
      </FormSection>

      <FormSection title={config.name} description={config.mode === 'manual' ? 'Entered for each person. Must be unique.' : 'Generated automatically.'}>
        {config.mode === 'manual' ? (
          <Field label={config.name} required error={errors.identifierValue}>
            {(f) => <Input {...f} autoComplete="off" className="font-mono" value={p.identifierValue} onChange={(e) => set('identifierValue', e.target.value)} />}
          </Field>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label={`${config.name} will be generated`}>
            <p className="text-sm text-slate-700">Assigned when you create the user, following <span className="font-mono">{describePattern(config.segments)}</span>.</p>
            <p className="mt-1 text-sm text-slate-500">Next likely value: <span className="font-mono font-medium text-slate-900">{generatedExample}</span> <Badge tone="neutral">Preview</Badge></p>
          </div>
        )}
      </FormSection>

      <FormSection title="Photo" description="Optional. Shown on their digital ID.">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 text-slate-400">
            {p.photoDataUrl ? <img src={p.photoDataUrl} alt="Selected photo" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6" aria-hidden="true" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload photo"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setPhotoError(null);
                try { set('photoDataUrl', await readPhoto(file)); } catch (err) { setPhotoError((err as Error).message); }
              }} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>{p.photoDataUrl ? 'Replace photo' : 'Upload photo'}</Button>
            {p.photoDataUrl && <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => set('photoDataUrl', undefined)}>Remove</Button>}
          </div>
        </div>
        {photoError && <p role="alert" className="text-sm text-red-600">{photoError}</p>}
      </FormSection>

      {current && current.kind !== 'none' && (
        <section aria-label="Identity check" className="mt-6 space-y-3 border-t border-slate-100 pt-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">Identity check <SimulatedBadge /></p>
          {existingMember && (
            <Callout tone="warning" title={`${existingMember.displayName} is already a user in your organization`}
              action={<Link to={`/users/${existingMember.id}`} className="text-sm font-medium text-amber-900 underline">View user</Link>}>
              They can't be added twice. To give them another digital ID, open their profile and choose Issue credential.
            </Callout>
          )}
          {current.kind === 'match' && !existingMember && (
            <>
              <Callout tone="success" title="Existing identity found">
                Matched on {current.matchedOn.join(' and ')}. FixID will link this identity instead of creating a new one.
              </Callout>
              <IdentityCard identity={current.identity} />
            </>
          )}
          {current.kind === 'conflict' && (
            <Callout tone="danger" title="These details belong to someone else">
              The {current.field === 'email-and-phone' ? 'email address and phone number match two different people' : `${current.field === 'email' ? 'email address' : 'phone number'} is already on record for a person with a different name`} in ID Switch.
              To avoid merging two people, change the details before continuing.
            </Callout>
          )}
          {current.kind === 'possible' && (
            <>
              <Callout tone="warning" title="Possible matches found">
                Someone with the same name exists, but a name alone isn't enough to confirm it's the same person. If it is, enter the email or phone number they have on record.
              </Callout>
              <div className="grid gap-3 sm:grid-cols-2">{current.candidates.map((c) => <IdentityCard key={c.idSwitchId} identity={c} />)}</div>
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                  checked={draft.confirmNewIdentity} onChange={(e) => update({ confirmNewIdentity: e.target.checked })} />
                <span>I've confirmed this is a different person. <span className="text-slate-500">Create a new identity in ID Switch.</span></span>
              </label>
            </>
          )}
        </section>
      )}
    </StepShell>
  );
}
