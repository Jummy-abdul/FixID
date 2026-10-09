import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Fingerprint, UserPlus } from 'lucide-react';
import { Badge, Button, Field, Input, Select } from '@/components/ui';
import { COUNTRIES, countryByCode, toE164 } from '@/data/countries';
import { describePattern, previewIdentifier, validateManualValue } from '@/domain/identifierPattern';
import type { CanonicalIdentity, IdentifierConfig } from '@/domain/types';
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
  if (!p.email.trim()) e.email = 'Enter their email address.';
  else if (!EMAIL.test(p.email.trim())) e.email = 'Enter a valid email address.';
  if (p.phone.trim() && (!/^[+\d][\d\s()-]*$/.test(p.phone.trim()) || !internationalPhone(p))) e.phone = 'Enter a valid phone number.';
  if (config.mode === 'manual') {
    const v = p.identifierValue.trim();
    const invalid = v ? validateManualValue(v) : `Enter their ${config.name}.`;
    if (invalid) e.identifierValue = invalid;
    else if (taken(v)) e.identifierValue = `${v} is already assigned to another user.`;
  }
  return e;
}

/** The phone number in international format (E.164), or '' when none was entered. */
export function internationalPhone(p: PersonForm): string | null {
  if (!p.phone.trim()) return '';
  return toE164(countryByCode(p.phoneCountry)?.dial ?? '+234', p.phone);
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
          created = await idSwitch.createIdentity({
            givenName: p.givenName, familyName: p.familyName, email: p.email, phone: internationalPhone(p) ?? '',
            gender: p.gender || undefined, country: countryByCode(p.country)?.name, region: p.region.trim() || undefined,
          });
          update({ createdIdentity: created });
        }
        identity = { idSwitchId: created.idSwitchId, resolution: 'created-new' };
      }
      await new Promise((r) => setTimeout(r, 250));
      const r = createUser({
        requestId: draft.requestId, organizationId: org.organization.id, at: new Date().toISOString(), identifierConfigId: config.id,
        identifierValue: p.identifierValue, person: { givenName: p.givenName, familyName: p.familyName },
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
        ? "We couldn't add this user right now. Nothing was saved. Please try again shortly."
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
      const resolution = await idSwitch.resolveIdentity({ givenName: p.givenName, familyName: p.familyName, email: p.email, phone: internationalPhone(p) ?? '' });
      setBusy(null);
      update({ resolution, resolvedFor: identityKey(p), confirmNewIdentity: false, createdIdentity: null });
      const member = resolution.kind === 'match' ? org.members.find((m) => m.idSwitchId === resolution.identity.idSwitchId) : undefined;
      // Clear cases continue straight away; anything that needs a decision stops here.
      if (resolution.kind === 'none' || (resolution.kind === 'match' && !member)) await create(resolution);
    } catch (err) {
      setBusy(null);
      if (err instanceof IdSwitchUnavailableError) setFailure("We couldn't check for existing records right now. Nothing has been saved. Please try again shortly.");
      else throw err;
    } finally {
      inFlight.current = false;
    }
  };

  const regions = countryByCode(p.country)?.regions;
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
            {busy === 'checking' ? 'Checking…' : busy === 'creating' ? 'Creating user…' : 'Create user'}
          </Button>
        </>
      }
    >
      {failure && <div className="mb-6"><Callout tone="danger" title="The user wasn't created">{failure}</Callout></div>}

      <FormSection title="Personal Information">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
          <Field label="First Name" required error={errors.givenName}>
            {(f) => <Input {...f} autoComplete="off" value={p.givenName} onChange={(e) => set('givenName', e.target.value)} />}
          </Field>
          <Field label="Last Name" required error={errors.familyName}>
            {(f) => <Input {...f} autoComplete="off" value={p.familyName} onChange={(e) => set('familyName', e.target.value)} />}
          </Field>
          <Field label="Email Address" required error={errors.email}>
            {(f) => <Input {...f} type="email" autoComplete="off" value={p.email} onChange={(e) => set('email', e.target.value)} />}
          </Field>
          <Field label="Phone Number" error={errors.phone}>
            {(f) => (
              <div className="flex gap-2">
                <div className="w-32 shrink-0">
                  <Select aria-label="Country calling code" value={p.phoneCountry} onChange={(e) => set('phoneCountry', e.target.value)}>
                    {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.code} {c.dial}</option>)}
                  </Select>
                </div>
                <div className="min-w-0 flex-1">
                  <Input {...f} type="tel" autoComplete="off" placeholder="803 555 0101" value={p.phone} onChange={(e) => set('phone', e.target.value)} />
                </div>
              </div>
            )}
          </Field>
          <Field label="Country">
            {(f) => (
              <Select {...f} value={p.country} onChange={(e) => update({ person: { ...p, country: e.target.value, region: '' } })}>
                <option value="">Select country</option>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Region/State">
            {(f) => regions
              ? (
                <Select {...f} value={p.region} onChange={(e) => set('region', e.target.value)}>
                  <option value="">Select region/state</option>
                  {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              )
              : <Input {...f} autoComplete="off" value={p.region} onChange={(e) => set('region', e.target.value)} />}
          </Field>
          <Field label="Gender">
            {(f) => (
              <Select {...f} value={p.gender} onChange={(e) => set('gender', e.target.value as PersonForm['gender'])}>
                <option value="">Select gender</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
              </Select>
            )}
          </Field>
        </div>
      </FormSection>

      <FormSection title={config.name} description={config.mode === 'manual' ? 'Entered for each user. Must be unique.' : 'Generated automatically.'}>
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

      {current && current.kind !== 'none' && (
        <section aria-label="Identity check" className="mt-6 space-y-3 border-t border-slate-100 pt-6">
          <p className="text-sm font-semibold text-slate-900">Existing records</p>
          {existingMember && (
            <Callout tone="warning" title={`${existingMember.displayName} is already a user in your organization`}
              action={<Link to={`/users/${existingMember.id}`} className="text-sm font-medium text-amber-900 underline">View user</Link>}>
              They can't be added twice. To give them another digital ID, open their profile and choose Issue credential.
            </Callout>
          )}
          {current.kind === 'match' && !existingMember && (
            <>
              <Callout tone="success" title="Existing record found">
                Matched on {current.matchedOn.join(' and ')}. FixID will use this person's existing record instead of creating a new one.
              </Callout>
              <IdentityCard identity={current.identity} />
            </>
          )}
          {current.kind === 'conflict' && (
            <Callout tone="danger" title="These details belong to someone else">
              The {current.field === 'email-and-phone' ? 'email address and phone number match two different people' : `${current.field === 'email' ? 'email address' : 'phone number'} is already on record for a person with a different name`}.
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
                <span>I've confirmed this is a different person.</span>
              </label>
            </>
          )}
        </section>
      )}
    </StepShell>
  );
}
