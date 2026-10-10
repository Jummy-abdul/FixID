import { useAuthorization } from '@/auth/authorization';
import { useState, type FormEvent } from 'react';
import { Button, Card, CardBody, CardHeader, Field, Input, Select, useToast } from '@/components/ui';
import { INDUSTRY_LABEL } from '@/domain/labels';
import type { Industry, Organization } from '@/domain/types';
import type { OrganizationProfileUpdate } from '@/store/state';
import { useActions } from '@/store/AppStore';

type Values = OrganizationProfileUpdate;
type Errors = Partial<Record<keyof Values, string>>;

const COUNTRIES = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'United Kingdom'];
const TIMEZONES = ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Europe/London'];

export function validateOrganization(v: Values): Errors {
  const e: Errors = {};
  if (v.name.trim().length < 3) e.name = 'Enter an organization name of at least 3 characters.';
  else if (v.name.trim().length > 80) e.name = 'Organization name must be 80 characters or fewer.';
  if (!/^[A-Z0-9]{2,5}$/.test(v.shortName)) e.shortName = 'Use 2–5 uppercase letters or numbers, e.g. NBU.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.contactEmail.trim())) e.contactEmail = 'Enter a valid email address.';
  if (v.memberLabel.trim().length < 2) e.memberLabel = 'Enter a label, e.g. Member, Student or Employee.';
  return e;
}

function pick(o: Organization): Values {
  return { name: o.name, shortName: o.shortName, industry: o.industry, country: o.country, timezone: o.timezone, contactEmail: o.contactEmail, memberLabel: o.memberLabel };
}

export function OrganizationForm({ organization }: { organization: Organization }) {
  const canManage = useAuthorization().can('settings.manage');
  const { updateOrganizationProfile } = useActions();
  const toast = useToast();
  const initial = pick(organization);
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const dirty = (Object.keys(initial) as (keyof Values)[]).some((k) => initial[k] !== values[k]);

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const trimmed: Values = { ...values, name: values.name.trim(), contactEmail: values.contactEmail.trim(), memberLabel: values.memberLabel.trim() };
    const errs = validateOrganization(trimmed);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast({ tone: 'error', title: 'Check the highlighted fields', description: 'Your changes have not been saved.' });
      return;
    }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 350));
    const r = updateOrganizationProfile(organization.id, trimmed);
    setSaving(false);
    if (!r.ok) {
      toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
      return;
    }
    setValues(trimmed);
    toast({ tone: 'success', title: 'Organization profile saved', description: 'The change has been recorded in the audit log.' });
  };

  return (
    <Card>
      <CardHeader title="Organization profile" description="Shown to administrators, on credentials and in Seamfix Wallet." />
      <form onSubmit={submit} noValidate>
        {!canManage && <p className="mx-5 mt-4 rounded-lg bg-slate-50 px-4 py-2.5 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">You can view these settings. Only administrators who manage settings can change them.</p>}
        <fieldset disabled={!canManage} className="min-w-0">
        <CardBody className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Organization name" required error={errors.name}>
            {(p) => <Input {...p} value={values.name} onChange={(e) => set('name', e.target.value)} />}
          </Field>
          <Field label="Short name" required error={errors.shortName} hint="Used on cards and in the organization switcher.">
            {(p) => <Input {...p} value={values.shortName} maxLength={5} onChange={(e) => set('shortName', e.target.value.toUpperCase())} />}
          </Field>
          <Field label="Industry" required>
            {(p) => (
              <Select {...p} value={values.industry} onChange={(e) => set('industry', e.target.value as Industry)}>
                {Object.entries(INDUSTRY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Default person label" required error={errors.memberLabel} hint="How people are referred to by default, e.g. Member, Employee.">
            {(p) => <Input {...p} value={values.memberLabel} onChange={(e) => set('memberLabel', e.target.value)} />}
          </Field>
          <Field label="Contact email" required error={errors.contactEmail}>
            {(p) => <Input {...p} type="email" value={values.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />}
          </Field>
          <Field label="Country" required>
            {(p) => <Select {...p} value={values.country} onChange={(e) => set('country', e.target.value)}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select>}
          </Field>
          <Field label="Time zone" required>
            {(p) => <Select {...p} value={values.timezone} onChange={(e) => set('timezone', e.target.value)}>{TIMEZONES.map((c) => <option key={c}>{c}</option>)}</Select>}
          </Field>
        </CardBody>
        </fieldset>
        {canManage && <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          {dirty && <span className="mr-auto text-sm text-amber-700">You have unsaved changes</span>}
          <Button variant="secondary" disabled={!dirty || saving} onClick={() => { setValues(initial); setErrors({}); }}>Discard</Button>
          <Button type="submit" disabled={!dirty} loading={saving}>Save changes</Button>
        </div>}
      </form>
    </Card>
  );
}
