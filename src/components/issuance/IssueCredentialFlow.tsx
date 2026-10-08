import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, CheckCircle2, Plus } from 'lucide-react';
import { Badge, Button, Field, Input } from '@/components/ui';
import { CredentialDrawer } from '@/components/config/CredentialDrawer';
import { DigitalIdCard } from '@/components/domain/DigitalIdCard';
import { CredentialStatusBadge, SimulatedBadge, WalletBadge } from '@/components/domain/StatusBadges';
import { validityLabel } from '@/domain/labels';
import { formatDate, formatDateTime } from '@/lib/dates';
import { newId } from '@/lib/identifiers';
import { cn } from '@/lib/cn';
import { computeValidity } from '@/services/issuance';
import { useServices } from '@/services/ServicesProvider';
import { useActions, useOrgData, useStore } from '@/store/AppStore';
import { issuability } from '@/store/operations';

type Step = 'select' | 'review' | 'issued';

function Panel({ title, description, children, footer }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section aria-labelledby="issue-title" className="rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="px-6 pt-7 sm:px-8">
        <h2 id="issue-title" className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-1.5 text-slate-500">{description}</p>}
      </div>
      <div className="px-6 py-6 sm:px-8">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">{footer}</div>}
    </section>
  );
}

/**
 * The one issuance experience: choose (or configure) a credential, review, issue.
 * Used after creating a user and from an existing user's page.
 */
export function IssueCredentialFlow({ memberId, onCancel, cancelLabel = 'Cancel', issuedActions }: {
  memberId: string;
  onCancel: () => void;
  cancelLabel?: string;
  issuedActions: (credentialId: string) => ReactNode;
}) {
  const org = useOrgData();
  const { getState } = useStore();
  const { issueDigitalId, updateWalletStatus } = useActions();
  const { wallet } = useServices();
  const member = org.memberById.get(memberId)!;
  const idConfig = member.identifier ? org.identifierConfigById.get(member.identifier.configId) : undefined;

  const options = useMemo(() => org.credentialTypes
    .filter((t) => t.status === 'active')
    .map((t) => ({ type: t, check: issuability(getState(), memberId, t) }))
    // Credentials matching this user's identifier first.
    .sort((a, b) => Number(b.check.ok) - Number(a.check.ok)), [org.credentialTypes, memberId, getState]);

  const [step, setStep] = useState<Step>('select');
  const [selectedId, setSelectedId] = useState<string | null>(() => options.find((o) => o.check.ok)?.type.id ?? null);
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issuedId, setIssuedId] = useState<string | null>(null);
  const requestId = useRef(newId('req'));
  const inFlight = useRef(false);

  const type = selectedId ? org.credentialTypeById.get(selectedId) : undefined;
  const selectable = options.filter((o) => o.check.ok);
  const effectiveInput = type?.effectiveDate === 'custom-date' && effectiveDate ? new Date(`${effectiveDate}T00:00:00`) : undefined;

  const issue = async () => {
    if (!type || inFlight.current) return;
    inFlight.current = true;
    setIssuing(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 300));
    const r = issueDigitalId({
      requestId: requestId.current, organizationId: org.organization.id, at: new Date().toISOString(), memberId,
      credentialTypeId: type.id, effectiveDate: effectiveInput?.toISOString(), credentialId: newId('cr'),
    });
    inFlight.current = false;
    setIssuing(false);
    if (!r.ok) return setError(Object.values(r.errors)[0] ?? 'The digital ID could not be issued.');
    setIssuedId(r.credentialId);
    setStep('issued');
    const issued = r.state.data.credentials.find((c) => c.id === r.credentialId)!;
    if (issued.wallet.status === 'pending') {
      void wallet.deliver(org.organization, issued).then((s) => updateWalletStatus(issued.id, s)).catch(() => updateWalletStatus(issued.id, 'failed'));
    }
  };

  const design = type ? org.cardDesignById.get(type.cardDesignId) ?? org.cardDesignById.get(org.organization.defaultCardDesignId)! : undefined;
  const validity = type ? computeValidity(type, new Date(), effectiveInput) : null;
  const card = (identifier: string, expiresAt: string | null, issuedAt?: string) => design && type && (
    <DigitalIdCard design={design} organization={org.organization} content={{
      name: member.displayName, identifier, identifierLabel: idConfig?.name ?? type.identifier.label, credentialTypeName: type.name,
      relationship: member.relationship || undefined, expiresAt, issuedAt, photoUrl: member.photoDataUrl,
    }} />
  );

  if (step === 'issued' && issuedId) {
    const c = org.credentialById.get(issuedId)!;
    const t = org.credentialTypeById.get(c.credentialTypeId)!;
    return (
      <section aria-labelledby="issued-title" className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-emerald-50/60 shadow-card">
        <div className="grid items-center gap-10 px-6 py-10 sm:px-10 lg:grid-cols-2 lg:px-14 lg:py-14">
          <div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white"><CheckCircle2 className="h-6 w-6" aria-hidden="true" /></span>
            <h2 id="issued-title" className="mt-6 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Digital ID issued successfully</h2>
            <p className="mt-3 text-lg text-slate-600">{member.displayName} now has a {t.name}.</p>
            <dl className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div><dt className="text-slate-500">{idConfig?.name ?? t.identifier.label}</dt><dd className="mt-0.5 font-mono font-medium text-slate-900">{c.identifier}</dd></div>
              <div><dt className="text-slate-500">Status</dt><dd className="mt-0.5"><CredentialStatusBadge status={c.status} /></dd></div>
              <div><dt className="text-slate-500">Issued</dt><dd className="mt-0.5 text-slate-900">{formatDateTime(c.issuedAt)}</dd></div>
              <div><dt className="text-slate-500">Expires</dt><dd className="mt-0.5 text-slate-900">{c.expiresAt ? formatDate(c.expiresAt) : 'Never'}</dd></div>
              <div className="col-span-2">
                <dt className="flex items-center gap-2 text-slate-500">Seamfix Wallet <SimulatedBadge /></dt>
                <dd className="mt-1 flex items-center gap-2" aria-live="polite">
                  <WalletBadge status={c.wallet.status} />
                  <span className="text-xs text-slate-500">
                    {c.wallet.status === 'pending' ? 'Making it available to the holder…' : c.wallet.status === 'delivered' ? 'Available to the holder.'
                      : c.wallet.status === 'not-sent' ? 'Not sent to a wallet.' : 'Delivery failed. The digital ID is still issued.'}
                  </span>
                </dd>
              </div>
            </dl>
            <div className="mt-10 flex flex-wrap gap-3">{issuedActions(c.id)}</div>
          </div>
          <div className="flex justify-center">{card(c.identifier, c.expiresAt, c.issuedAt)}</div>
        </div>
      </section>
    );
  }

  return (
    <>
      {step === 'select' && (
        <Panel
          title="Issue a digital ID"
          description={<>Choose the credential to issue to {member.displayName}{idConfig ? <> ({idConfig.name} <span className="font-mono">{member.identifier!.value}</span>)</> : ''}.</>}
          footer={
            <>
              <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
              <Button disabled={!type || !selectable.some((o) => o.type.id === type.id)} onClick={() => { setError(null); setStep('review'); }}>
                Review <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          }>
          {selectable.length === 0 && (
            <div className="mb-5 rounded-2xl border border-dashed border-slate-300 p-6 text-center">
              <p className="font-semibold text-slate-900">No credential set up for {idConfig?.name ?? 'this identifier'} yet</p>
              <p className="mt-1 text-sm text-slate-500">Configure one once and reuse it for everyone with this identifier.</p>
              <Button className="mt-4" icon={<Plus className="h-4 w-4" />} onClick={() => setDrawerOpen(true)}>Configure credential</Button>
            </div>
          )}
          {options.length > 0 && (
            <div role="radiogroup" aria-label="Credential" className="grid gap-3 md:grid-cols-2">
              {options.map(({ type: t, check }) => {
                const d = org.cardDesignById.get(t.cardDesignId);
                const idc = t.identifierConfigId ? org.identifierConfigById.get(t.identifierConfigId) : undefined;
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={selectedId === t.id} disabled={!check.ok}
                    onClick={() => setSelectedId(t.id)}
                    className={cn('rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      selectedId === t.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">{t.name}{check.ok && <Badge tone="neutral">Saved</Badge>}</span>
                    <span className="mt-1 block text-sm text-slate-500">{idc?.name ?? t.identifier.label} · {d?.name ?? 'Default digital ID'}</span>
                    <span className="block text-sm text-slate-500">{validityLabel(t.validity)}</span>
                    {!check.ok && <span className="mt-1 block text-xs text-amber-700">{check.reason}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {selectable.length > 0 && (
            <button type="button" onClick={() => setDrawerOpen(true)} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              <Plus className="h-4 w-4" aria-hidden="true" /> Configure a new credential
            </button>
          )}
          {type?.effectiveDate === 'custom-date' && (
            <div className="mt-6 max-w-xs">
              <Field label="Effective from" required hint="When this digital ID becomes valid.">
                {(p) => <Input {...p} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />}
              </Field>
            </div>
          )}
        </Panel>
      )}

      {step === 'review' && type && validity && (
        <Panel title="Review and issue" description="Check the details. The issuance time is recorded automatically."
          footer={
            <>
              <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep('select')} disabled={issuing}>Back</Button>
              <Button onClick={issue} loading={issuing} icon={issuing ? undefined : <BadgeCheck className="h-4 w-4" />}>{issuing ? 'Issuing…' : 'Issue digital ID'}</Button>
            </>
          }>
          {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error} Nothing was issued.</p>}
          <div className="grid items-start gap-8 lg:grid-cols-2">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div><dt className="text-slate-500">User</dt><dd className="mt-0.5 font-medium text-slate-900">{member.displayName}</dd></div>
              <div><dt className="text-slate-500">{idConfig?.name ?? type.identifier.label}</dt><dd className="mt-0.5 font-mono text-slate-900">{type.identifierConfigId ? member.identifier?.value : 'Assigned on issue'}</dd></div>
              <div><dt className="text-slate-500">Credential</dt><dd className="mt-0.5 text-slate-900">{type.name}</dd></div>
              <div><dt className="text-slate-500">Template</dt><dd className="mt-0.5 text-slate-900">{design?.name}</dd></div>
              <div><dt className="text-slate-500">Effective from</dt><dd className="mt-0.5 text-slate-900">{type.effectiveDate === 'on-issue' ? 'When issued' : formatDate(validity.effectiveFrom.toISOString())}</dd></div>
              <div><dt className="text-slate-500">Expires</dt><dd className="mt-0.5 text-slate-900">{validity.expiresAt ? formatDate(validity.expiresAt.toISOString()) : 'Never'}<span className="block text-xs text-slate-500">{validityLabel(type.validity)}</span></dd></div>
              <div className="col-span-2 text-xs text-slate-500">After issuing, FixID makes the digital ID available to Seamfix Wallet. Delivery is tracked separately (simulated).</div>
            </dl>
            <div className="flex justify-center overflow-hidden">
              <div className="origin-top scale-[0.85] sm:scale-100">{card(type.identifierConfigId ? member.identifier?.value ?? '' : 'Assigned on issue', validity.expiresAt ? validity.expiresAt.toISOString() : null)}</div>
            </div>
          </div>
        </Panel>
      )}

      <CredentialDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} defaultIdentifierConfigId={member.identifier?.configId}
        onSaved={(id) => { setDrawerOpen(false); setSelectedId(id); }} />
    </>
  );
}
