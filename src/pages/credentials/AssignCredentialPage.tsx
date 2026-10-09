import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BadgeCheck, CheckCircle2, CreditCard, LayoutDashboard, Plus, UserRound, Users } from 'lucide-react';
import { Avatar, Badge, Button, ButtonLink, Field, Input, PageHeader, SearchInput } from '@/components/ui';
import { CredentialSetup } from '@/components/config/CredentialSetup';
import { DigitalIdCard } from '@/components/domain/DigitalIdCard';
import { CredentialStatusBadge, WalletBadge } from '@/components/domain/StatusBadges';
import { assignUrl, readList, type AssignContext, type AssignOrigin, type AssignStep } from '@/components/issuance/assignment';
import { validityLabel } from '@/domain/labels';
import type { CredentialType, Member } from '@/domain/types';
import { formatDate, formatDateTime } from '@/lib/dates';
import { newId } from '@/lib/identifiers';
import { cn } from '@/lib/cn';
import { computeValidity } from '@/services/issuance';
import { useServices } from '@/services/ServicesProvider';
import { useActions, useOrgData, useStore, type OrgData } from '@/store/AppStore';
import { issuability } from '@/store/operations';

function Panel({ title, description, children, footer }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section aria-labelledby="assign-title" className="rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="px-6 pt-7 sm:px-8">
        <h2 id="assign-title" className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-1.5 text-slate-500">{description}</p>}
      </div>
      <div className="px-6 py-6 sm:px-8">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">{footer}</div>}
    </section>
  );
}

const identifierOf = (org: OrgData, m: Member) => m.identifier
  ? { name: org.identifierConfigById.get(m.identifier.configId)?.name ?? 'Identifier', value: m.identifier.value }
  : undefined;

/**
 * Credential Management: assign a credential configuration to recipients and issue it.
 * Select credential (or create one) → select recipients (when none were carried in) → review → issue.
 * Reached directly, after creating a user, or from a user's page; context lives in the URL.
 */
export function AssignCredentialPage() {
  const org = useOrgData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { getState } = useStore();
  const { issueDigitalId, updateWalletStatus } = useActions();
  const { wallet } = useServices();

  const recipients = readList(params, 'recipients').map((id) => org.memberById.get(id)).filter((m): m is Member => !!m);
  const recipientIds = recipients.map((m) => m.id);
  const from = (params.get('from') as AssignOrigin | null) ?? undefined;
  const typeId = params.get('credential') ?? undefined;
  const type = typeId ? org.credentialTypeById.get(typeId) : undefined;
  const issuedIds = readList(params, 'issued').filter((id) => org.credentialById.has(id));
  const requested = (params.get('step') as AssignStep | null) ?? 'select';
  const step: AssignStep = !type ? 'select' : requested === 'review' && recipients.length === 0 ? 'recipients' : requested;

  const go = (patch: Partial<AssignContext>) => navigate(assignUrl({ recipientIds, credentialTypeId: type?.id, from, step, ...patch }));

  const [setupOpen, setSetupOpen] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  // One idempotency key per recipient for this page visit; holders of an active credential are also blocked.
  const requestIds = useRef(new Map<string, string>());
  const inFlight = useRef(false);

  const activeTypes = org.credentialTypes.filter((t) => t.status === 'active');
  const single = recipients.length === 1 ? recipients[0] : undefined;
  const singleId = single ? identifierOf(org, single) : undefined;
  const contextIdentifierConfigId = single?.identifier?.configId;

  const checksFor = (t: CredentialType) => recipients.map((m) => ({ member: m, check: issuability(getState(), m.id, t) }));

  const issue = async () => {
    if (!type || inFlight.current) return;
    inFlight.current = true;
    setIssuing(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 300));
    const effectiveInput = type.effectiveDate === 'custom-date' && effectiveDate ? new Date(`${effectiveDate}T00:00:00`).toISOString() : undefined;
    const issued: string[] = [];
    const failures: string[] = [];
    for (const m of recipients) {
      if (!requestIds.current.has(m.id)) requestIds.current.set(m.id, newId('req'));
      const r = issueDigitalId({
        requestId: requestIds.current.get(m.id)!, organizationId: org.organization.id, at: new Date().toISOString(), memberId: m.id,
        credentialTypeId: type.id, effectiveDate: effectiveInput, credentialId: newId('cr'),
      });
      if (!r.ok) { failures.push(Object.values(r.errors)[0] ?? `${m.displayName} could not be issued.`); continue; }
      issued.push(r.credentialId);
      const c = r.state.data.credentials.find((x) => x.id === r.credentialId)!;
      if (c.wallet.status === 'pending') {
        void wallet.deliver(org.organization, c).then((s) => updateWalletStatus(c.id, s)).catch(() => updateWalletStatus(c.id, 'failed'));
      }
    }
    inFlight.current = false;
    setIssuing(false);
    if (failures.length && !issued.length) return setError(failures[0]);
    const next = new URLSearchParams(params);
    next.delete('step');
    next.set('issued', issued.join(','));
    setParams(next);
  };

  const fromLabel = from === 'new-user' ? 'Continuing for' : 'Issuing to';

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Credentials', to: '/credentials' }, { label: 'Issue credential' }]}
      title="Issue credential"
      description="Assign a credential configuration to a user and issue their digital ID."
    />
  );

  const contextBanner = single && issuedIds.length === 0 && (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-5 py-3.5" aria-label="Recipient">
      <Avatar name={single.displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-700">{fromLabel} <span className="font-semibold text-slate-900">{single.displayName}</span>
          {singleId && <span className="ml-2 font-mono text-xs text-slate-600">{singleId.value}</span>}</p>
        {step === 'select' && <p className="text-xs text-slate-500">Select or create a credential to issue to this user.</p>}
      </div>
    </div>
  );

  // ---- Issued -------------------------------------------------------------------------------
  if (issuedIds.length) {
    const creds = issuedIds.map((id) => org.credentialById.get(id)!);
    const first = creds[0];
    const holder = org.memberById.get(first.memberId)!;
    const t = org.credentialTypeById.get(first.credentialTypeId)!;
    const design = org.cardDesignById.get(t.cardDesignId) ?? org.cardDesignById.get(org.organization.defaultCardDesignId)!;
    const hid = identifierOf(org, holder);
    return (
      <>
        {header}
        <section aria-labelledby="issued-title" className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-emerald-50/60 shadow-card">
          <div className="grid items-center gap-10 px-6 py-10 sm:px-10 lg:grid-cols-2 lg:px-14 lg:py-14">
            <div>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white"><CheckCircle2 className="h-6 w-6" aria-hidden="true" /></span>
              <h2 id="issued-title" className="mt-6 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Digital ID issued successfully</h2>
              <p className="mt-3 text-lg text-slate-600">
                {creds.length === 1 ? `${holder.displayName} now has a ${t.name}.` : `${creds.length} users now have a ${t.name}.`}
              </p>
              {creds.length === 1 && (
                <dl className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div><dt className="text-slate-500">{hid?.name ?? t.identifier.label}</dt><dd className="mt-0.5 font-mono font-medium text-slate-900">{first.identifier}</dd></div>
                  <div><dt className="text-slate-500">Status</dt><dd className="mt-0.5"><CredentialStatusBadge status={first.status} /></dd></div>
                  <div><dt className="text-slate-500">Issued</dt><dd className="mt-0.5 text-slate-900">{formatDateTime(first.issuedAt)}</dd></div>
                  <div><dt className="text-slate-500">Expires</dt><dd className="mt-0.5 text-slate-900">{first.expiresAt ? formatDate(first.expiresAt) : 'Never'}</dd></div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Seamfix Wallet</dt>
                    <dd className="mt-1 flex items-center gap-2" aria-live="polite">
                      <WalletBadge status={first.wallet.status} />
                      <span className="text-xs text-slate-500">
                        {first.wallet.status === 'pending' ? 'Making it available to the holder…' : first.wallet.status === 'delivered' ? 'Available to the holder.'
                          : first.wallet.status === 'not-sent' ? 'Not sent to a wallet.' : 'Delivery failed. The digital ID is still issued.'}
                      </span>
                    </dd>
                  </div>
                </dl>
              )}
              <div className="mt-10 flex flex-wrap gap-3">
                {creds.length === 1 && <ButtonLink to={`/users/${holder.id}`} variant="primary" icon={<UserRound className="h-4 w-4" />}>View user</ButtonLink>}
                <ButtonLink to="/credentials" variant="secondary" icon={<CreditCard className="h-4 w-4" />}>View credentials</ButtonLink>
                {from === 'new-user'
                  ? <ButtonLink to="/users/new/manual" variant="ghost" icon={<Users className="h-4 w-4" />}>Add another user</ButtonLink>
                  : <ButtonLink to="/" variant="ghost" icon={<LayoutDashboard className="h-4 w-4" />}>Return to dashboard</ButtonLink>}
              </div>
            </div>
            <div className="flex justify-center">
              <DigitalIdCard design={design} organization={org.organization} content={{
                name: holder.displayName, identifier: first.identifier, identifierLabel: hid?.name ?? t.identifier.label, credentialTypeName: t.name,
                relationship: holder.relationship || undefined, expiresAt: first.expiresAt, issuedAt: first.issuedAt,
              }} />
            </div>
          </div>
        </section>
      </>
    );
  }

  const setup = (
    <CredentialSetup open={setupOpen} onClose={() => setSetupOpen(false)} defaultIdentifierConfigId={contextIdentifierConfigId}
      onAssign={(id) => go({ credentialTypeId: id, step: recipients.length ? 'review' : 'recipients' })}
      onLater={() => navigate('/credentials')} />
  );

  // ---- Select credential --------------------------------------------------------------------
  if (step === 'select') {
    const options = activeTypes
      .map((t) => {
        const checks = checksFor(t);
        const blocked = checks.find((c) => !c.check.ok);
        return { type: t, ok: !blocked, reason: blocked && !blocked.check.ok ? blocked.check.reason : undefined };
      })
      .sort((a, b) => Number(b.ok) - Number(a.ok));
    const selectable = options.filter((o) => o.ok);
    const selected = typeId && selectable.some((o) => o.type.id === typeId) ? typeId : selectable[0]?.type.id;
    return (
      <>
        {header}
        {contextBanner}
        {activeTypes.length === 0 ? (
          <section className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><CreditCard className="h-6 w-6" aria-hidden="true" /></span>
            <h2 className="mt-5 text-xl font-semibold text-slate-900">No credentials configured yet</h2>
            <p className="mt-1.5 max-w-md text-slate-500">Create a credential configuration to start issuing digital IDs.</p>
            <Button className="mt-6" icon={<Plus className="h-4 w-4" />} onClick={() => setSetupOpen(true)}>Create credential</Button>
            <p className="mt-4 text-xs text-slate-400">A default template is ready to use. Creating a credential doesn't issue it to anyone.</p>
          </section>
        ) : (
          <Panel title="Select a credential"
            description={single ? `Choose which credential to issue to ${single.displayName}.` : 'Choose the credential configuration to assign.'}
            footer={
              <>
                <Button variant="ghost" onClick={() => navigate(single ? `/users/${single.id}` : '/credentials')}>Cancel</Button>
                <Button disabled={!selected} onClick={() => go({ credentialTypeId: selected, step: recipients.length ? 'review' : 'recipients' })}>
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            }>
            {selectable.length === 0 && (
              <div className="mb-5 rounded-2xl border border-dashed border-slate-300 p-6 text-center">
                <p className="font-semibold text-slate-900">No credential suits {single ? single.displayName : 'these users'} yet</p>
                <p className="mt-1 text-sm text-slate-500">Create one for {singleId?.name ?? 'their identifier'} and reuse it for everyone who has it.</p>
                <Button className="mt-4" icon={<Plus className="h-4 w-4" />} onClick={() => setSetupOpen(true)}>Create credential</Button>
              </div>
            )}
            <div role="radiogroup" aria-label="Credential" className="grid gap-3 md:grid-cols-2">
              {options.map(({ type: t, ok, reason }) => {
                const d = org.cardDesignById.get(t.cardDesignId);
                const idc = t.identifierConfigId ? org.identifierConfigById.get(t.identifierConfigId) : undefined;
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={selected === t.id} disabled={!ok}
                    onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('credential', t.id); return n; }, { replace: true })}
                    className={cn('rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      selected === t.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                    <span className="block text-sm font-semibold text-slate-900">{t.name}</span>
                    <span className="mt-1 block text-sm text-slate-500">{idc?.name ?? t.identifier.label} · {d?.name ?? 'Default digital ID'}</span>
                    <span className="block text-sm text-slate-500">{validityLabel(t.validity)}</span>
                    {reason && <span className="mt-1 block text-xs text-amber-700">{reason}</span>}
                  </button>
                );
              })}
            </div>
            {selectable.length > 0 && (
              <button type="button" onClick={() => setSetupOpen(true)} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                <Plus className="h-4 w-4" aria-hidden="true" /> Create a new credential
              </button>
            )}
          </Panel>
        )}
        {setup}
      </>
    );
  }

  // ---- Select recipients (when none were carried in) -----------------------------------------
  if (step === 'recipients' && type) return (
    <>
      {header}
      <RecipientPicker org={org} type={type} onBack={() => go({ step: 'select' })}
        onContinue={(ids) => navigate(assignUrl({ recipientIds: ids, credentialTypeId: type.id, from, step: 'review' }))} />
    </>
  );

  // ---- Review ------------------------------------------------------------------------------
  if (!type) return null;
  const checks = checksFor(type);
  const blocked = checks.filter((c) => !c.check.ok);
  const design = org.cardDesignById.get(type.cardDesignId) ?? org.cardDesignById.get(org.organization.defaultCardDesignId)!;
  const effectiveInput = type.effectiveDate === 'custom-date' && effectiveDate ? new Date(`${effectiveDate}T00:00:00`) : undefined;
  const validity = computeValidity(type, new Date(), effectiveInput);
  const idName = type.identifierConfigId ? org.identifierConfigById.get(type.identifierConfigId)?.name : type.identifier.label;
  const valueFor = (m: Member) => (type.identifierConfigId ? m.identifier?.value ?? '' : 'Assigned on issue');

  return (
    <>
      {header}
      {contextBanner}
      <Panel title="Review and issue" description="Check the details. Nothing is issued until you confirm; the issuance time is recorded automatically."
        footer={
          <>
            <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} disabled={issuing}
              onClick={() => go({ step: from ? 'select' : 'recipients' })}>Back</Button>
            <Button onClick={issue} loading={issuing} disabled={blocked.length > 0} icon={issuing ? undefined : <BadgeCheck className="h-4 w-4" />}>
              {issuing ? 'Issuing…' : recipients.length > 1 ? `Issue to ${recipients.length} users` : 'Issue digital ID'}
            </Button>
          </>
        }>
        {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error} Nothing was issued. The user and credential configuration are unchanged.</p>}
        {blocked.map(({ member, check }) => !check.ok && (
          <p key={member.id} role="alert" className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">{member.displayName}: {check.reason}</p>
        ))}
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div className="col-span-2">
                <dt className="text-slate-500">{recipients.length > 1 ? `Recipients (${recipients.length})` : 'Recipient'}</dt>
                <dd className="mt-1 space-y-1">
                  {recipients.map((m) => (
                    <span key={m.id} className="flex items-center gap-2 font-medium text-slate-900">{m.displayName}
                      <span className="font-mono text-xs font-normal text-slate-500">{valueFor(m)}</span></span>
                  ))}
                </dd>
              </div>
              <div><dt className="text-slate-500">Credential</dt><dd className="mt-0.5 text-slate-900">{type.name}</dd></div>
              <div><dt className="text-slate-500">Identifier</dt><dd className="mt-0.5 text-slate-900">{idName}</dd></div>
              <div><dt className="text-slate-500">Template</dt><dd className="mt-0.5 text-slate-900">{design.name}</dd></div>
              <div><dt className="text-slate-500">Effective from</dt><dd className="mt-0.5 text-slate-900">{type.effectiveDate === 'on-issue' ? 'When issued' : formatDate(validity.effectiveFrom.toISOString())}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Expires</dt><dd className="mt-0.5 text-slate-900">{validity.expiresAt ? formatDate(validity.expiresAt.toISOString()) : 'Never'}<span className="ml-2 text-xs text-slate-500">{validityLabel(type.validity)}</span></dd></div>
            </dl>
            {type.effectiveDate === 'custom-date' && (
              <div className="max-w-xs">
                <Field label="Effective from" required hint="When this digital ID becomes valid.">
                  {(p) => <Input {...p} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />}
                </Field>
              </div>
            )}
            <p className="text-xs text-slate-500">After issuing, FixID makes the digital ID available to Seamfix Wallet. Delivery is tracked separately.</p>
          </div>
          {recipients[0] && (
            <div className="flex justify-center overflow-hidden">
              <div className="origin-top scale-[0.85] sm:scale-100">
                <DigitalIdCard design={design} organization={org.organization} content={{
                  name: recipients[0].displayName, identifier: valueFor(recipients[0]), identifierLabel: idName ?? 'Identifier', credentialTypeName: type.name,
                  relationship: recipients[0].relationship || undefined, expiresAt: validity.expiresAt ? validity.expiresAt.toISOString() : null,
                }} />
              </div>
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}

/**
 * Choose who receives the credential. Single selection for this milestone; it returns a list
 * so assigning one configuration to many users can be added without changing the flow.
 */
function RecipientPicker({ org, type, onBack, onContinue }: {
  org: OrgData; type: CredentialType; onBack: () => void; onContinue: (ids: string[]) => void;
}) {
  const { getState } = useStore();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const eligible = useMemo(() => org.members
    .filter((m) => issuability(getState(), m.id, type).ok)
    .sort((a, b) => a.displayName.localeCompare(b.displayName)), [org.members, type, getState]);
  const query = q.trim().toLowerCase();
  const shown = eligible.filter((m) => !query || m.displayName.toLowerCase().includes(query) || m.identifier?.value.toLowerCase().includes(query)).slice(0, 50);

  return (
    <Panel title="Select recipient" description={`Who should receive a ${type.name}? Only users who can hold it are listed.`}
      footer={
        <>
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>Back</Button>
          <Button disabled={!selected} onClick={() => selected && onContinue([selected])}>Review <ArrowRight className="h-4 w-4" /></Button>
        </>
      }>
      {eligible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
          <p className="font-semibold text-slate-900">No users can receive {type.name} yet</p>
          <p className="mt-1 text-sm text-slate-500">Add users with this credential's identifier, then assign it. The configuration is saved for later.</p>
          <ButtonLink to="/users/new" variant="primary" className="mt-4" icon={<Plus className="h-4 w-4" />}>Add user</ButtonLink>
        </div>
      ) : (
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Search name or identifier" className="mb-4 sm:w-80" />
          <div role="radiogroup" aria-label="Recipient" className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {shown.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={selected === m.id} onClick={() => setSelected(m.id)}
                className={cn('flex w-full items-center gap-3 px-4 py-3 text-left first:rounded-t-xl last:rounded-b-xl', selected === m.id ? 'bg-brand-50/70' : 'hover:bg-slate-50')}>
                <Avatar name={m.displayName} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{m.displayName}</span>
                  {m.identifier && <span className="block font-mono text-xs text-slate-500">{m.identifier.value}</span>}
                </span>
                {selected === m.id && <Badge tone="brand">Selected</Badge>}
              </button>
            ))}
            {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No matching users.</p>}
          </div>
          <p className="mt-3 text-xs text-slate-400">Assigning to several users at once is planned.</p>
        </>
      )}
    </Panel>
  );
}
