import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck } from 'lucide-react';
import { Button, Field, Input, Select } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { DEFAULT_COUNTRY, countryByCode } from '@/data/countries';
import { AuthHeading, AuthLayout, FormError } from './AuthLayout';
import { CountryCombobox } from './fields';

const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

function StepLabel({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-3 text-xs font-medium text-slate-500" aria-label={`Step ${step} of 2`}>
      <span className="flex gap-1.5" aria-hidden="true">
        {[1, 2].map((n) => <span key={n} className={`h-1.5 w-8 rounded-full ${n <= step ? 'bg-brand-600' : 'bg-slate-200'}`} />)}
      </span>
      Step {step} of 2
    </div>
  );
}

export function OnboardingPersonalPage() {
  const { account, savePersonal } = useAuth();
  const navigate = useNavigate();
  const [first, setFirst] = useState(account?.firstName ?? '');
  const [last, setLast] = useState(account?.lastName ?? '');
  const [errors, setErrors] = useState<{ first?: string; last?: string }>({});
  if (!account) return <Navigate to="/signin" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!first.trim()) next.first = 'Enter your first name.';
    else if (!NAME.test(first.trim())) next.first = 'Use letters only.';
    if (!last.trim()) next.last = 'Enter your last name.';
    else if (!NAME.test(last.trim())) next.last = 'Use letters only.';
    setErrors(next);
    if (Object.keys(next).length) return;
    savePersonal(first, last);
    navigate('/onboarding/organization');
  };

  return (
    <AuthLayout>
      <AuthHeading eyebrow={<StepLabel step={1} />} title="What should we call you?" description="A few details to personalize your FixID experience." />
      <form onSubmit={submit} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={errors.first}>
            {(p) => <Input {...p} autoComplete="given-name" autoFocus className="h-11" value={first} onChange={(e) => setFirst(e.target.value)} />}
          </Field>
          <Field label="Last name" required error={errors.last}>
            {(p) => <Input {...p} autoComplete="family-name" className="h-11" value={last} onChange={(e) => setLast(e.target.value)} />}
          </Field>
        </div>
        <Field label="Email address">
          {(p) => (
            <div className="relative">
              <Input {...p} readOnly value={account.email} className="h-11 bg-slate-50 pr-28 text-slate-600" />
              <span className="absolute inset-y-0 right-3 flex items-center gap-1 text-xs font-medium text-emerald-700">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Verified
              </span>
            </div>
          )}
        </Field>
        <Button type="submit" className="h-11 w-full">Continue</Button>
      </form>
    </AuthLayout>
  );
}

export function OnboardingOrganizationPage() {
  const { account, createOrganization } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [region, setRegion] = useState('');
  const [errors, setErrors] = useState<{ name?: string; country?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  if (!account) return <Navigate to="/signin" replace />;
  if (account.onboarding === 'personal') return <Navigate to="/onboarding/personal" replace />;
  const regions = countryByCode(country)?.regions;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    const n = name.trim();
    if (!n) next.name = 'Enter your organization name.';
    else if (n.length < 2) next.name = 'Use at least 2 characters.';
    else if (n.length > 80) next.name = 'Keep the name under 80 characters.';
    if (!countryByCode(country)) next.country = 'Choose a country.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 400));
    try {
      createOrganization({ name: n, countryCode: country, region });
      navigate('/', { replace: true });
    } catch (err) {
      setErrors({ form: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <AuthHeading eyebrow={<StepLabel step={2} />} title="Tell us about your organization" description="Let's set up your workspace." />
      <form onSubmit={submit} noValidate className="space-y-5">
        {errors.form && <FormError>{errors.form}</FormError>}
        <Field label="Organization name" required error={errors.name}>
          {(p) => <Input {...p} autoComplete="organization" autoFocus className="h-11" placeholder="e.g. Crestfield Academy" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <CountryCombobox value={country} onChange={(c) => { setCountry(c); setRegion(''); setErrors((x) => ({ ...x, country: undefined })); }} error={errors.country} required />
        <Field label="State / Region">
          {(p) => regions ? (
            <Select {...p} className="h-11" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Select (optional)</option>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          ) : <Input {...p} className="h-11" placeholder="Optional" value={region} onChange={(e) => setRegion(e.target.value)} />}
        </Field>
        <Button type="submit" className="h-11 w-full" loading={busy}>Create organization</Button>
      </form>
      <Link to="/onboarding/personal" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
      </Link>
    </AuthLayout>
  );
}
