import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { CheckCircle2, Copy, FlaskConical, KeyRound, Pencil, PlugZap, Power, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardBody, ConfirmDialog, Field, Input, useToast } from '@/components/ui';
import { NoAccess, useAuthorization } from '@/auth/authorization';
import { SESSION_POLICY } from '@/auth/authCore';
import {
  SSO_PROVIDERS, SSO_STATUS_LABEL, canActivate, changesAuthentication, normalizeIssuer, providerName, redirectUri, ssoStatus, validateSsoForm,
  versionUnderReview, type SsoFormErrors, type SsoFormValues,
} from '@/domain/sso';
import type { SsoConfigVersion, SsoConnection } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { ssoService } from '@/services/sso';
import { adminsOf } from '@/store/adminOps';
import { ssoFor } from '@/store/ssoOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { startSso, useGoToProvider, type SsoNotice } from '../auth/SsoPages';

/**
 * Settings → Security → Single Sign-On (SSO). One OIDC connection per organization (R1). Saving never
 * activates; activation needs a successful test of exactly the configuration being activated; changes to an
 * active connection stay pending while the active one keeps working.
 */
export function SecurityPanel() {
  const { can } = useAuthorization();
  if (!can('sso.manage')) return <NoAccess />;
  return <SsoSection />;
}

const STATUS_TONE = { 'not-configured': 'neutral', 'not-activated': 'warning', active: 'success' } as const;

function SsoSection() {
  const { organization } = useSession();
  const { state } = useStore();
  const actions = useActions();
  const toast = useToast();
  const go = useGoToProvider();
  const notice = (useLocation().state as { ssoNotice?: SsoNotice } | null)?.ssoNotice;
  const c = ssoFor(state, organization.id);
  const status = ssoStatus(c);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'disable' | 'discard' | null>(null);
  const review = versionUnderReview(c);
  const demo = ssoService().mode === 'demonstration';
  const admins = adminsOf(state, organization.id);
  const linked = admins.filter((a) => a.ssoIdentity && a.status === 'active').length;
  const localAdmins = admins.filter((a) => a.status === 'active' && a.roleIds.includes('organization-admin')).length;

  const act = (r: { ok: true } | { ok: false; error: string }, title: string, description?: string) =>
    toast(r.ok ? { tone: 'success', title, description } : { tone: 'error', title: 'Nothing was changed', description: r.error });

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
              Single Sign-On (SSO)
              <Badge tone={STATUS_TONE[status]} dot>{SSO_STATUS_LABEL[status]}</Badge>
              {c?.pending && <Badge tone="info">Changes pending</Badge>}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">Connect your organization's identity provider to allow administrators to sign in using Single Sign-On.</p>
          </div>
          {!editing && (status === 'not-configured'
            ? <Button icon={<PlugZap className="h-4 w-4" />} onClick={() => setEditing(true)}>Set up SSO</Button>
            : <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit configuration</Button>)}
        </div>
        <CardBody className="space-y-5">
          {demo && (
            <p role="note" className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span><span className="font-semibold">Demonstration mode.</span> This prototype has no OIDC backend, so connection tests and SSO sign-in use a clearly labelled simulated identity provider. No real provider is contacted, no tokens are issued, and the client secret isn’t kept.</span>
            </p>
          )}
          {notice && (
            <p role="status" className={cn('flex gap-2 rounded-xl px-4 py-3 text-sm ring-1 ring-inset', notice.ok ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-red-50 text-red-800 ring-red-200')}>
              {notice.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
              <span><span className="font-semibold">{notice.ok ? `Connection test successful${notice.mode === 'demonstration' ? ' (demonstration)' : ''}.` : 'Connection test failed.'}</span> {notice.message}</span>
            </p>
          )}

          {editing ? (
            <SsoForm connection={c} onDone={() => setEditing(false)} />
          ) : status === 'not-configured' ? (
            <p className="text-sm text-slate-600">No identity provider is configured. Administrators sign in with their email and password.</p>
          ) : (
            <>
              {c?.pending && c.current && (
                <ConfigSummary title="Active configuration" version={c.current} note="Administrators sign in with this configuration until the pending changes are activated." />
              )}
              {review && (
                <ConfigSummary title={c?.pending ? 'Pending changes (not active yet)' : 'Configuration'} version={review} />
              )}
              <RedirectUri />
              <TestState connection={c!} />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} onClick={() => go(startSso('test', c!))}>Test Connection</Button>
                {(status !== 'active' || c?.pending) && (
                  <Button icon={<Power className="h-4 w-4" />} disabled={!canActivate(c)} onClick={() => act(actions.activateSso(organization.id), c?.pending ? 'Changes activated' : 'SSO activated', 'Administrators with a linked identity can now sign in with SSO. Email and password sign-in remains available.')}>
                    {c?.pending ? 'Activate Changes' : 'Activate SSO'}
                  </Button>
                )}
                {c?.pending && <Button variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={() => setConfirm('discard')}>Discard pending changes</Button>}
                {status === 'active' && <Button variant="ghost" className="text-red-600 hover:text-red-700" icon={<Power className="h-4 w-4" />} onClick={() => setConfirm('disable')}>Disable SSO</Button>}
              </div>
              {!canActivate(c) && (status !== 'active' || c?.pending) && (
                <p className="text-sm text-slate-500">Activation is available after a successful connection test of this configuration.</p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3 text-sm text-slate-600">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden="true" />Sign-in and recovery</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>Email and password sign-in stays available for every administrator, including when SSO is active, disabled or unavailable. {localAdmins} active Organization {localAdmins === 1 ? 'Admin' : 'Admins'} can always recover access this way and manage these settings.</li>
            <li>SSO signs in existing administrators only. Each administrator links their own identity from My Profile; FixID never creates administrators or assigns roles from SSO, and never matches by email. {status === 'active' ? `${linked} active ${linked === 1 ? 'administrator has' : 'administrators have'} linked an identity.` : ''}</li>
            <li>Sessions end after {SESSION_POLICY.idleMinutes} minutes without activity or {SESSION_POLICY.maxHours} hours in total, whichever comes first. <span className="text-amber-700">Provisional defaults, pending product and security confirmation.</span></li>
          </ul>
        </CardBody>
      </Card>

      <ConfirmDialog open={confirm === 'disable'} tone="danger" title="Disable SSO?" confirmLabel="Disable SSO"
        description="Administrators won’t be able to start new SSO sign-ins. They can still sign in with their email and password, and anyone already signed in stays signed in. The configuration is kept, so you can test and activate it again later."
        onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); act(actions.disableSso(organization.id), 'SSO disabled', 'Email and password sign-in remains available.'); }} />
      <ConfirmDialog open={confirm === 'discard'} title="Discard pending changes?" confirmLabel="Discard changes"
        description="The pending configuration is removed. The active configuration stays as it is."
        onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); act(actions.discardSsoChanges(organization.id), 'Pending changes discarded'); }} />
    </div>
  );
}

function RedirectUri() {
  const toast = useToast();
  const uri = redirectUri(window.location.origin);
  const copy = async () => {
    try { await navigator.clipboard.writeText(uri); toast({ tone: 'success', title: 'Redirect URI copied' }); } catch { toast({ tone: 'error', title: 'Couldn’t copy', description: 'Select the address and copy it instead.' }); }
  };
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">FixID Redirect URI</p>
      <div className="flex flex-wrap items-center gap-2">
        <input readOnly aria-label="FixID Redirect URI" value={uri} onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-lg border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700" />
        <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copy()}>Copy</Button>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">Register this address as an allowed redirect (callback) URI with your identity provider.</p>
    </div>
  );
}

function ConfigSummary({ title, version: v, note }: { title: string; version: SsoConfigVersion; note?: string }) {
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200">
      <h3 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">{title}</h3>
      <dl className="grid gap-x-6 gap-y-3 px-4 py-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">Provider</dt><dd className="text-slate-900">{providerName(v.provider)}</dd></div>
        <div><dt className="text-slate-500">Issuer URL</dt><dd className="break-all font-mono text-xs text-slate-900">{v.issuer}</dd></div>
        <div><dt className="text-slate-500">Client ID</dt><dd className="break-all font-mono text-xs text-slate-900">{v.clientId}</dd></div>
        <div><dt className="text-slate-500">Client secret</dt><dd className="text-slate-900">{v.clientSecretSet ? 'Saved (hidden)' : 'Not set'}</dd></div>
        <div><dt className="text-slate-500">Saved</dt><dd className="text-slate-900">{formatDateTime(v.savedAt)} by {v.savedBy}</dd></div>
        <div><dt className="text-slate-500">Connection test</dt><dd className="text-slate-900">{v.testedAt ? `Successful ${formatDateTime(v.testedAt)}${v.testMode === 'demonstration' ? ' (demonstration)' : ''}` : 'Not tested'}</dd></div>
      </dl>
      {note && <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">{note}</p>}
    </section>
  );
}

function TestState({ connection: c }: { connection: SsoConnection }) {
  const t = c.lastTest;
  const v = versionUnderReview(c);
  if (!t || t.versionId !== v?.id || t.ok) return null;
  return (
    <p role="alert" className="flex gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span><span className="font-semibold">Last connection test failed</span> ({formatDateTime(t.at)}). {t.message}</span>
    </p>
  );
}

function SsoForm({ connection: c, onDone }: { connection: SsoConnection | undefined; onDone: () => void }) {
  const { organization } = useSession();
  const { saveSso } = useActions();
  const toast = useToast();
  const base = versionUnderReview(c);
  const [values, setValues] = useState<SsoFormValues>({ provider: base?.provider ?? 'fixiam', issuer: base?.issuer ?? '', clientId: base?.clientId ?? '', clientSecret: '' });
  const [errors, setErrors] = useState<SsoFormErrors>({});
  const secretAlreadySet = !!base?.clientSecretSet && base.provider === values.provider && base.clientId === values.clientId.trim();
  const set = (k: keyof SsoFormValues, v: string) => { setValues((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };
  const issuerChanges = !!c?.current && normalizeIssuer(values.issuer) !== c.current.issuer;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateSsoForm(values, { secretAlreadySet });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (base && !changesAuthentication(values, base)) { onDone(); return; }
    const r = saveSso(organization.id, values);
    if (!r.ok) return toast({ tone: 'error', title: 'Configuration not saved', description: r.error });
    toast({ tone: 'success', title: c?.enabled ? 'Changes saved as pending' : 'SSO configuration saved', description: c?.enabled ? 'The active configuration keeps working until you test and activate the changes.' : 'Test the connection, then activate SSO.' });
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-label="SSO configuration">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Identity provider</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SSO_PROVIDERS.map((p) => (
            <label key={p.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', values.provider === p.id ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
              <input type="radio" name="sso-provider" className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600" checked={values.provider === p.id} onChange={() => set('provider', p.id)} />
              <span><span className="block text-sm font-semibold text-slate-900">{p.name}</span><span className="block text-sm text-slate-500">{p.description}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Issuer URL" required error={errors.issuer} hint="The provider’s OIDC issuer, e.g. https://id.example.com/realms/acme.">
        {(p) => <Input {...p} type="url" inputMode="url" autoComplete="off" value={values.issuer} onChange={(e) => set('issuer', e.target.value)} />}
      </Field>
      {issuerChanges && <p className="-mt-3 text-xs text-amber-700">Changing the issuer means administrators must link their SSO identity again after the change is activated.</p>}
      <Field label="Client ID" required error={errors.clientId}>
        {(p) => <Input {...p} autoComplete="off" value={values.clientId} onChange={(e) => set('clientId', e.target.value)} />}
      </Field>
      <Field label="Client secret" required={SSO_PROVIDERS.find((x) => x.id === values.provider)!.secretRequired && !secretAlreadySet} error={errors.clientSecret}
        hint={secretAlreadySet ? 'A secret is saved and stays hidden. Leave blank to keep it, or enter a new one to replace it.' : values.provider === 'custom-oidc' ? 'Required for confidential clients. Leave blank for a public client that uses PKCE.' : undefined}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={values.clientSecret} onChange={(e) => set('clientSecret', e.target.value)} />}
      </Field>
      <RedirectUri />
      <p className="text-xs text-slate-500">Saving doesn’t activate SSO. {c?.enabled ? 'Changes are kept as pending until they’re tested and activated; the active configuration keeps working meanwhile.' : 'Test the connection after saving, then activate it.'}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit">Save configuration</Button>
      </div>
    </form>
  );
}
