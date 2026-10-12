import { useState } from 'react';
import { ArrowLeft, FlaskConical, KeyRound, ShieldAlert } from 'lucide-react';
import { Button, Drawer, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import {
  AUTH_METHOD_LABEL, CAPABILITY_DESCRIPTION, CAPABILITY_LABEL, CONTRACT_VERSION, SIMULATED_BASE_URL, TIMEOUT_RANGE, connectionFromForm, emptyIntegrationForm,
  formFromIntegration, isSecuritySensitiveChange, validateConnection, validateContract, validateDetails,
  type CustomIntegration, type IntegrationAuthMethod, type IntegrationCapability, type IntegrationFormErrors, type IntegrationFormValues,
} from '@/domain/integrations';
import { cn } from '@/lib/cn';
import { useActions, useSession } from '@/store/AppStore';
import { ContractReference } from './IntegrationContract';

const STEPS = ['Integration Details', 'API Connection', 'API Contract', 'Review'] as const;

/**
 * Add or edit a custom identity service in four steps. Saving never activates it. No secret is ever
 * collected in the browser: in production they're entered into FixID's server-side secret manager.
 */
export function IntegrationWizard({ integration, onClose, onSaved }: { integration: CustomIntegration | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { organization } = useSession();
  const { saveIntegration } = useActions();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [v, setV] = useState<IntegrationFormValues>(() => (integration ? formFromIntegration(integration) : emptyIntegrationForm()));
  const [errors, setErrors] = useState<IntegrationFormErrors & { form?: string }>({});
  const set = <K extends keyof IntegrationFormValues>(k: K, value: IntegrationFormValues[K]) => { setV((x) => ({ ...x, [k]: value })); setErrors((e) => ({ ...e, [k]: undefined, form: undefined })); };
  const sensitive = !!integration && isSecuritySensitiveChange(integration, { capabilities: v.capabilities, connection: connectionFromForm(v) });

  const validators = [validateDetails, validateConnection, validateContract];
  const next = () => {
    const e = step < 3 ? validators[step](v) : {};
    setErrors(e);
    if (!Object.keys(e).length) setStep((s) => s + 1);
  };
  const save = () => {
    const r = saveIntegration(organization.id, v, integration?.id);
    if (!r.ok) return setErrors({ form: r.error });
    toast({ tone: 'success', title: integration ? 'Integration updated' : 'Integration saved as Draft', description: integration && sensitive ? 'Connection settings changed: test the connection before it can be active again.' : 'Test the connection, then activate it.' });
    onSaved(r.integrationId);
  };
  const toggleCap = (c: IntegrationCapability) => set('capabilities', v.capabilities.includes(c) ? v.capabilities.filter((x) => x !== c) : [...v.capabilities, c]);

  return (
    <Drawer open onClose={onClose} width="xl" title={integration ? `Edit ${integration.name}` : 'Add custom integration'}
      description={`Step ${step + 1} of 4 · ${STEPS[step]}`} onBack={step > 0 ? () => setStep((s) => s - 1) : undefined}
      footer={(
        <>
          {step > 0 && <Button variant="ghost" className="mr-auto" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep((s) => s - 1)}>Back</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {step < 3 ? <Button onClick={next}>Continue</Button> : <Button onClick={save}>{integration ? 'Save changes' : 'Save integration'}</Button>}
        </>
      )}>
      <ol className="mb-6 flex flex-wrap gap-2 text-xs font-medium" aria-label="Steps">
        {STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={cn('rounded-full px-2.5 py-1', i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>{i + 1}. {s}</li>)}
      </ol>
      {errors.form && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{errors.form}</p>}

      {step === 0 && (
        <div className="space-y-5">
          <Field label="Integration Name" required error={errors.name}>{(p) => <Input {...p} autoFocus maxLength={80} placeholder="My Identity Verification Service" value={v.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label="Description" error={errors.description} hint="Optional. What the integration is for.">{(p) => <Textarea {...p} rows={2} maxLength={300} value={v.description} onChange={(e) => set('description', e.target.value)} />}</Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Capabilities <span className="text-red-500">*</span></legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['lookup', 'matching'] as const).map((c) => (
                <label key={c} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', v.capabilities.includes(c) ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={v.capabilities.includes(c)} onChange={() => toggleCap(c)} />
                  <span><span className="block text-sm font-semibold text-slate-900">{CAPABILITY_LABEL[c]}</span><span className="block text-sm text-slate-500">{CAPABILITY_DESCRIPTION[c]}</span></span>
                </label>
              ))}
            </div>
            {errors.capabilities && <p role="alert" className="mt-2 text-sm text-red-600">{errors.capabilities}</p>}
            <p className="mt-2 text-xs text-slate-500">A service may offer either capability or both. External biometric verification needs both.</p>
          </fieldset>
          <Field label="Reference Identifier Label" required={v.capabilities.includes('lookup')} error={errors.referenceLabel} hint="What the identifier people present is called, shown when looking up their record.">
            {(p) => <Input {...p} maxLength={40} placeholder="External Reference ID" value={v.referenceLabel} onChange={(e) => set('referenceLabel', e.target.value)} />}
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Service</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([['simulated', 'Simulated Identity Service', 'Demonstration service with fictional records and deterministic outcomes. No real identity data or matching.'],
                ['external', 'External identity service', 'Your organization’s own service. Real requests need FixID’s secure integration backend, which this prototype doesn’t have.']] as const).map(([id, title, body]) => (
                <label key={id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', v.target === id ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                  <input type="radio" name="int-target" className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600" checked={v.target === id} onChange={() => { set('target', id); if (id === 'simulated') set('baseUrl', SIMULATED_BASE_URL); else if (v.baseUrl === SIMULATED_BASE_URL) set('baseUrl', ''); }} />
                  <span><span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">{id === 'simulated' && <FlaskConical className="h-4 w-4 text-amber-600" aria-hidden="true" />}{title}</span><span className="block text-sm text-slate-500">{body}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          {v.target === 'external' && (
            <p role="note" className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              You can save the configuration, but real external requests are disabled in this prototype: there’s no secure integration backend (secret storage, destination controls, SSRF protection). Its connection test will fail until that backend exists.
            </p>
          )}
          <Field label="Base API URL" required error={errors.baseUrl} hint={v.target === 'simulated' ? 'Fixed for the Simulated Identity Service.' : 'HTTPS only.'}>
            {(p) => <Input {...p} type="url" readOnly={v.target === 'simulated'} className={v.target === 'simulated' ? 'bg-slate-50 font-mono text-xs' : ''} value={v.target === 'simulated' ? SIMULATED_BASE_URL : v.baseUrl} placeholder="https://identity.example.com/api" onChange={(e) => set('baseUrl', e.target.value)} />}
          </Field>
          <Field label="Authentication Method">
            {(p) => (
              <Select {...p} value={v.authMethod} onChange={(e) => set('authMethod', e.target.value as IntegrationAuthMethod)}>
                {(Object.keys(AUTH_METHOD_LABEL) as IntegrationAuthMethod[]).map((m) => <option key={m} value={m}>{AUTH_METHOD_LABEL[m]}</option>)}
              </Select>
            )}
          </Field>
          {v.authMethod === 'oauth2-client-credentials' && v.target === 'external' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Token Endpoint" required error={errors.tokenEndpoint}>{(p) => <Input {...p} type="url" placeholder="https://identity.example.com/oauth/token" value={v.tokenEndpoint} onChange={(e) => set('tokenEndpoint', e.target.value)} />}</Field>
              <Field label="Client ID" required error={errors.clientId}>{(p) => <Input {...p} autoComplete="off" value={v.clientId} onChange={(e) => set('clientId', e.target.value)} />}</Field>
              <Field label="Scope" hint="Optional">{(p) => <Input {...p} autoComplete="off" value={v.scope} onChange={(e) => set('scope', e.target.value)} />}</Field>
            </div>
          )}
          {v.authMethod === 'api-key' && (
            <Field label="Header Name" required error={errors.headerName} hint="The header that carries the API key. Authentication and routing headers are reserved.">{(p) => <Input {...p} autoComplete="off" value={v.headerName} onChange={(e) => set('headerName', e.target.value)} />}</Field>
          )}
          {v.authMethod === 'mtls' && v.target === 'external' && (
            <Field label="Managed certificate reference" required error={errors.certificateRef} hint="A certificate provisioned in FixID’s certificate store, not a file upload.">{(p) => <Input {...p} autoComplete="off" value={v.certificateRef} onChange={(e) => set('certificateRef', e.target.value)} />}</Field>
          )}
          <SecretNotice target={v.target} method={v.authMethod} />
          <Field label="Connection Timeout (seconds)" error={errors.timeoutSeconds} hint={`Between ${TIMEOUT_RANGE.min} and ${TIMEOUT_RANGE.max} seconds.`}>
            {(p) => <Input {...p} type="number" min={TIMEOUT_RANGE.min} max={TIMEOUT_RANGE.max} value={v.timeoutSeconds} onChange={(e) => set('timeoutSeconds', Number(e.target.value))} />}
          </Field>
          <p className="text-xs text-slate-500">Custom HTTP headers can’t be added: FixID sets authentication and request headers itself.</p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">Your service must implement the FixID external identity verification contract, version <span className="font-semibold">{CONTRACT_VERSION}</span>. A service with a different API needs a compatible adapter; field mapping isn’t configurable.</p>
          {v.capabilities.includes('lookup') && (
            <Field label="Permitted lookup attributes" required error={errors.permittedAttributes} hint="Comma-separated. Only these attributes from a lookup response can be used for verification; everything else is discarded and nothing is stored.">
              {(p) => <Input {...p} value={v.permittedAttributes.join(', ')} onChange={(e) => set('permittedAttributes', e.target.value.split(',').map((a) => a.trim()).filter(Boolean))} />}
            </Field>
          )}
          <ContractReference capabilities={v.capabilities} />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 text-sm">
          {sensitive && <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900 ring-1 ring-inset ring-amber-200">These changes affect the connection. The current successful test will no longer count{integration?.status === 'active' ? ' and the integration will stop being active' : ''}: test it again before activating.</p>}
          <dl className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2" aria-label="Review">
            <div><dt className="text-slate-500">Integration Name</dt><dd className="font-medium text-slate-900">{v.name}</dd></div>
            <div><dt className="text-slate-500">Capabilities</dt><dd className="text-slate-900">{v.capabilities.map((c) => CAPABILITY_LABEL[c]).join(', ')}</dd></div>
            <div><dt className="text-slate-500">Service</dt><dd className="text-slate-900">{v.target === 'simulated' ? 'Simulated Identity Service' : v.baseUrl}</dd></div>
            <div><dt className="text-slate-500">Authentication Method</dt><dd className="text-slate-900">{AUTH_METHOD_LABEL[v.authMethod]}</dd></div>
            {v.capabilities.includes('lookup') && <div><dt className="text-slate-500">Reference Identifier Label</dt><dd className="text-slate-900">{v.referenceLabel}</dd></div>}
            <div><dt className="text-slate-500">API Contract</dt><dd className="text-slate-900">Version {CONTRACT_VERSION}</dd></div>
          </dl>
          <p className="text-slate-500">Saving doesn’t activate the integration. Test the connection on the next screen, then activate it.</p>
        </div>
      )}
    </Drawer>
  );
}

function SecretNotice({ target, method }: { target: 'simulated' | 'external'; method: IntegrationAuthMethod }) {
  const label = method === 'oauth2-client-credentials' ? 'Client Secret' : method === 'api-key' ? 'API Key' : 'Certificate private key';
  return (
    <div className="flex gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      <p><span className="font-semibold text-slate-800">{label}: </span>
        {target === 'simulated'
          ? 'The Simulated Identity Service uses a simulated credential. No real secret is needed or collected.'
          : 'Secrets are stored only in FixID’s server-side secret manager and are never shown again. This prototype has no secret manager, so it doesn’t collect them.'}
      </p>
    </div>
  );
}
