import { useAuthorization } from '@/auth/authorization';
import { useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { INDUSTRY_LABEL } from '@/domain/labels';
import {
  normalizeProfile, profileValues, timezoneOptions, validateOrganizationProfile, type OrganizationProfileValues, type ProfileErrors,
} from '@/domain/organization';
import type { Industry, Organization } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { useActions } from '@/store/AppStore';

type Values = OrganizationProfileValues;

const NOT_PROVIDED = <span className="text-slate-400">Not provided</span>;

/**
 * Settings → Organization: the Organization Profile. Read-only by default; an administrator who manages
 * settings can Edit, then Save or Cancel. Country, Organization ID, status and registration date are
 * read-only. Administrators are managed in Administrators & Roles; branding is a separate capability.
 */
export function OrganizationForm({ organization }: { organization: Organization }) {
  const canManage = useAuthorization().can('settings.manage');
  const [editing, setEditing] = useState(false);
  return editing && canManage
    ? <EditProfile organization={organization} onDone={() => setEditing(false)} />
    : <ViewProfile organization={organization} canEdit={canManage} onEdit={() => setEditing(true)} />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-3 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900 sm:col-span-2 sm:mt-0">{children}</dd>
    </div>
  );
}

function ViewProfile({ organization: o, canEdit, onEdit }: { organization: Organization; canEdit: boolean; onEdit: () => void }) {
  const active = (o.status ?? 'active') === 'active';
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Organization profile</h2>
          <p className="mt-0.5 text-sm text-slate-500">Your organization’s information in FixID.</p>
        </div>
        {canEdit && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>Edit</Button>}
      </div>
      <CardBody>
        <dl className="divide-y divide-slate-100" aria-label="Organization profile">
          <Row label="Organization Name">{o.name}</Row>
          <Row label="Short Name">{o.shortName}</Row>
          <Row label="Industry">{INDUSTRY_LABEL[o.industry]}</Row>
          <Row label="Default Person Label">{o.memberLabel}</Row>
          <Row label="Organization Email">{o.contactEmail}</Row>
          <Row label="Organization Phone Number">{o.phone || NOT_PROVIDED}</Row>
          <Row label="Organization Address">{o.address ? <span className="whitespace-pre-line">{o.address}</span> : NOT_PROVIDED}</Row>
          <Row label="Country">{o.country}{o.region ? <span className="text-slate-500"> · {o.region}</span> : null}</Row>
          <Row label="Time Zone">{o.timezone}</Row>
          <Row label="Organization ID"><span className="font-mono text-xs">{o.id}</span></Row>
          <Row label="Organization Status"><Badge tone={active ? 'success' : 'neutral'} dot>{active ? 'Active' : 'Inactive'}</Badge></Row>
          <Row label="Date Registered">{formatDate(o.createdAt)}</Row>
        </dl>
      </CardBody>
    </Card>
  );
}

function EditProfile({ organization, onDone }: { organization: Organization; onDone: () => void }) {
  const { updateOrganizationProfile } = useActions();
  const toast = useToast();
  const [values, setValues] = useState<Values>(() => profileValues(organization));
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const zones = timezoneOptions(organization.timezone);

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFailure(null);
    const clean = normalizeProfile(values);
    const errs = validateOrganizationProfile(clean, zones);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 300));
    const r = updateOrganizationProfile(organization.id, clean);
    setSaving(false);
    // A failed save changes nothing and shows no success.
    if (!r.ok) {
      if ('errors' in r && r.errors) setErrors(r.errors);
      setFailure(r.error);
      return;
    }
    toast({ tone: 'success', title: 'Organization profile saved', description: 'The changes have been recorded in the audit log.' });
    onDone();
  };

  return (
    <Card>
      <CardHeader title="Edit organization profile" description="Country, Organization ID, status and registration date can’t be changed here." />
      <form onSubmit={submit} noValidate aria-label="Edit organization profile">
        {failure && <p role="alert" className="mx-5 mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-800 ring-1 ring-inset ring-red-200">{failure} Nothing was saved.</p>}
        <CardBody className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Organization Name" required error={errors.name}>
            {(p) => <Input {...p} autoFocus value={values.name} maxLength={100} onChange={(e) => set('name', e.target.value)} />}
          </Field>
          <Field label="Short Name" required error={errors.shortName} hint="2–5 letters or numbers. Used in the organization switcher.">
            {(p) => <Input {...p} value={values.shortName} maxLength={5} onChange={(e) => set('shortName', e.target.value.toUpperCase())} />}
          </Field>
          <Field label="Industry" required>
            {(p) => (
              <Select {...p} value={values.industry} onChange={(e) => set('industry', e.target.value as Industry)}>
                {Object.entries(INDUSTRY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Default Person Label" required error={errors.memberLabel} hint="How people are referred to by default, e.g. Member, Employee.">
            {(p) => <Input {...p} value={values.memberLabel} onChange={(e) => set('memberLabel', e.target.value)} />}
          </Field>
          <Field label="Organization Email" required error={errors.contactEmail}>
            {(p) => <Input {...p} type="email" value={values.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />}
          </Field>
          <Field label="Organization Phone Number" error={errors.phone} hint="Optional">
            {(p) => <Input {...p} type="tel" placeholder="e.g. +234 801 234 5678" value={values.phone} onChange={(e) => set('phone', e.target.value)} />}
          </Field>
          <div className="md:col-span-2">
            <Field label="Organization Address" error={errors.address} hint="Optional">
              {(p) => <Textarea {...p} rows={3} maxLength={220} placeholder="Street, city, state or region" value={values.address} onChange={(e) => set('address', e.target.value)} />}
            </Field>
          </div>
          <Field label="Time Zone" required error={errors.timezone}>
            {(p) => <Select {...p} value={values.timezone} onChange={(e) => set('timezone', e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</Select>}
          </Field>
          <div>
            <p className="text-sm font-medium text-slate-700">Country</p>
            <p className="mt-2 text-sm text-slate-900">{organization.country}</p>
            <p className="mt-1 text-xs text-slate-500">Set at registration.</p>
          </div>
        </CardBody>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <Button variant="secondary" disabled={saving} onClick={onDone}>Cancel</Button>
          <Button type="submit" loading={saving}>Save</Button>
        </div>
      </form>
    </Card>
  );
}
