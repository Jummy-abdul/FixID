import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, CheckCircle2, CircleSlash, Eye, XCircle } from 'lucide-react';
import { Badge, Button, Card, DataTable, Drawer, EmptyState, Field, Input, SearchInput } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { SelectAllBox } from '@/components/groups/AddMembersDrawer';
import { membershipsOfGroup } from '@/domain/groups';
import { validityLabel } from '@/domain/labels';
import type { CredentialType, Group, IssuanceBatch, IssuanceBatchResult, Member } from '@/domain/types';
import { formatDate, formatDateTime } from '@/lib/dates';
import { newId } from '@/lib/identifiers';
import { cn } from '@/lib/cn';
import { issuedCredentialPath } from '@/pages/credentials/IssuedCredentialDetailPage';
import { useServices } from '@/services/ServicesProvider';
import { useActions, useOrgData, useSession, useStore } from '@/store/AppStore';
import { issuanceEligibility, type EligibilityStatus } from '@/store/operations';

const STATUS_BADGE: Record<IssuanceBatch['status'], { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  completed: { tone: 'success', label: 'Completed' },
  partial: { tone: 'warning', label: 'Partially completed' },
  failed: { tone: 'danger', label: 'Nothing issued' },
};

const tally = (b: IssuanceBatch) => ({
  issued: b.results.filter((r) => r.outcome === 'issued').length,
  failed: b.results.filter((r) => r.outcome === 'failed').length,
  skipped: b.results.filter((r) => r.outcome === 'skipped').length,
});

/**
 * Issuance runs started from this group. A group isn't a credential configuration: runs issue an
 * existing configuration from Credentials, and each credential belongs to its holder. Credentials
 * members got some other way aren't listed here.
 */
export function GroupCredentialsTab({ group, batches }: { group: Group; batches: IssuanceBatch[] }) {
  const { can } = useAuthorization();
  const canIssue = can('credentials.issue');
  const [params, setParams] = useSearchParams();
  const [issuing, setIssuing] = useState(false);
  const openId = params.get('batch');
  const open = openId ? batches.find((b) => b.id === openId) : undefined;
  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('batch', id); else n.delete('batch'); return n; }, { replace: true });
  const sorted = [...batches].sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
  const issueButton = canIssue ? <Button icon={<BadgeCheck className="h-4 w-4" />} onClick={() => setIssuing(true)}>Issue Credentials</Button> : undefined;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Credential issuance</h2>
          <p className="text-sm text-slate-500">Credentials issued to members from this group. Each credential belongs to the person who holds it.</p>
        </div>
        {sorted.length > 0 && issueButton}
      </div>
      <DataTable
        rows={sorted}
        rowKey={(b) => b.id}
        empty={(
          <EmptyState icon={<BadgeCheck className="h-5 w-5" />} title="No credentials have been issued through this group yet."
            description={canIssue ? 'Issue an existing credential to some or all members. Everyone is checked for eligibility first.' : 'Issuance started from this group will appear here.'}
            action={issueButton} />
        )}
        columns={[
          { key: 'credential', header: 'Credential', cell: (b) => <span className="font-medium text-slate-900">{b.credentialName}</span> },
          { key: 'recipients', header: 'Recipients', cell: (b) => <span className="tabular-nums text-slate-700">{b.results.length}</span> },
          { key: 'issued', header: 'Issued', cell: (b) => <span className="tabular-nums text-emerald-700">{tally(b).issued}</span> },
          {
            key: 'notissued', header: 'Failed / Skipped', cell: (b) => {
              const t = tally(b);
              return <span className="tabular-nums text-slate-700">{t.failed} / {t.skipped}</span>;
            },
          },
          { key: 'date', header: 'Issuance Date', cell: (b) => <span className="whitespace-nowrap text-slate-500">{formatDateTime(b.initiatedAt)}</span> },
          { key: 'status', header: 'Status', cell: (b) => <Badge tone={STATUS_BADGE[b.status].tone} dot>{STATUS_BADGE[b.status].label}</Badge> },
          {
            key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right',
            cell: (b) => (
              <button type="button" onClick={() => setOpen(b.id)} className="whitespace-nowrap text-sm font-medium text-brand-600 hover:text-brand-700">
                View Details<span className="sr-only"> for {b.credentialName} issuance on {formatDate(b.initiatedAt)}</span>
              </button>
            ),
          },
        ]}
      />
      {open && (
        <Drawer open onClose={() => setOpen(null)} width="xl" title={`${open.credentialName} issuance`}
          description={`Started ${formatDateTime(open.initiatedAt)} by ${open.initiatedBy}`}
          footer={<Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>}>
          <BatchResults batch={open} />
        </Drawer>
      )}
      {canIssue && <IssueCredentialsDrawer group={group} open={issuing} onClose={() => setIssuing(false)} onViewRun={(id) => { setIssuing(false); setOpen(id); }} />}
    </Card>
  );
}

/** Per-recipient outcome of a run, with reasons and links to the credentials it created. */
export function BatchResults({ batch }: { batch: IssuanceBatch }) {
  const t = tally(batch);
  const { credentialById } = useOrgData();
  const [filter, setFilter] = useState<'all' | IssuanceBatchResult['outcome']>('all');
  const rows = batch.results.filter((r) => filter === 'all' || r.outcome === filter);
  const banner = batch.status === 'completed'
    ? { tone: 'bg-emerald-50 text-emerald-900 ring-emerald-200', text: `All ${t.issued} ${t.issued === 1 ? 'credential was' : 'credentials were'} issued.` }
    : batch.status === 'partial'
      ? { tone: 'bg-amber-50 text-amber-900 ring-amber-200', text: `${t.issued} of ${batch.results.length} recipients received ${batch.credentialName}. The others weren't issued; see the reasons below.` }
      : { tone: 'bg-red-50 text-red-900 ring-red-200', text: `No credentials were issued. See the reasons below.` };
  return (
    <div className="space-y-5">
      <p role="status" className={cn('rounded-xl px-4 py-3 text-sm ring-1 ring-inset', banner.tone)}>{banner.text}</p>
      <dl className="grid grid-cols-3 gap-3">
        {([['Issued', t.issued, 'text-emerald-700'], ['Failed', t.failed, 'text-red-700'], ['Skipped', t.skipped, 'text-slate-700']] as const).map(([label, n, tone]) => (
          <div key={label} className="rounded-xl border border-slate-200 px-4 py-3">
            <dt className="text-sm text-slate-500">{label}</dt><dd className={cn('mt-1 text-2xl font-semibold tabular-nums', n > 0 ? tone : 'text-slate-400')}>{n}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show results">
        {(['all', 'issued', 'failed', 'skipped'] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={cn('rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset', filter === f ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'text-slate-600 ring-slate-200 hover:bg-slate-50')}>
            {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Recipients">
        {rows.map((r) => {
          const c = r.credentialId ? credentialById.get(r.credentialId) : undefined;
          return (
            <li key={r.memberId} className="flex items-start gap-3 px-4 py-3">
              {r.outcome === 'issued' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                : r.outcome === 'failed' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                  : <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">{r.memberName}</span>
                <span className="block text-sm text-slate-500">
                  {r.outcome === 'issued' ? (c ? <>Issued {c.identifier} · {c.status === 'pending' ? 'awaiting approval' : c.status}</> : 'Issued') : r.reason}
                </span>
              </span>
              <span className="sr-only">{r.outcome}</span>
              {c && <Link to={issuedCredentialPath(c.id, { kind: 'user', id: r.memberId })} className="shrink-0 text-sm font-medium text-brand-600 hover:text-brand-700">View credential<span className="sr-only"> for {r.memberName}</span></Link>}
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No recipients with this result.</li>}
      </ul>
    </div>
  );
}

type Step = 'credential' | 'recipients' | 'eligibility' | 'review' | 'results';
const STEPS: { id: Step; label: string }[] = [
  { id: 'credential', label: 'Credential' }, { id: 'recipients', label: 'Recipients' }, { id: 'eligibility', label: 'Eligibility' },
  { id: 'review', label: 'Review' }, { id: 'results', label: 'Results' },
];

const ELIGIBILITY_BADGE: Record<EligibilityStatus, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  eligible: { tone: 'success', label: 'Eligible' },
  attention: { tone: 'warning', label: 'Needs attention' },
  ineligible: { tone: 'danger', label: 'Not eligible' },
};

function IssueCredentialsDrawer({ group, open, onClose, onViewRun }: { group: Group; open: boolean; onClose: () => void; onViewRun: (id: string) => void }) {
  const { organization } = useSession();
  const { state, getState } = useStore();
  const org = useOrgData();
  const { can } = useAuthorization();
  const { issueToGroup, updateWalletStatus } = useActions();
  const { wallet } = useServices();
  const [step, setStep] = useState<Step>('credential');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [mode, setMode] = useState<'all' | 'some'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<IssuanceBatch | null>(null);
  const batchId = useRef<string>('');

  useEffect(() => {
    if (!open) return;
    setStep('credential'); setTypeId(null); setMode('all'); setPicked(new Set()); setQ(''); setConfirmed(false);
    setEffectiveDate(new Date().toISOString().slice(0, 10)); setExpiryDate(''); setError(null); setBusy(false); setBatch(null);
    batchId.current = newId('iss');
  }, [open]);

  const members: Member[] = useMemo(() => membershipsOfGroup(state.data, organization.id, group.id)
    .flatMap((m) => { const x = org.memberById.get(m.memberId); return x ? [x] : []; })
    .sort((a, b) => a.displayName.localeCompare(b.displayName)), [state.data, organization.id, group.id, org.memberById]);
  const types = org.credentialTypes.filter((t) => t.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
  const type: CredentialType | undefined = typeId ? org.credentialTypeById.get(typeId) : undefined;
  const recipients = mode === 'all' ? members : members.filter((m) => picked.has(m.id));
  const checks = useMemo(() => (type ? recipients.map((m) => ({ member: m, ...issuanceEligibility(state, m.id, type) })) : []), [type, recipients, state]);
  const eligible = checks.filter((c) => c.status === 'eligible');
  const attention = checks.filter((c) => c.status === 'attention');
  const ineligible = checks.filter((c) => c.status === 'ineligible');

  const today = new Date().toISOString().slice(0, 10);
  const needsEffective = type?.effectiveDate === 'custom-date';
  const needsExpiry = type?.validity.kind === 'set-at-issuance';
  const dateErrors = {
    effective: needsEffective && !effectiveDate ? 'Choose the date these credentials become effective.' : undefined,
    expiry: !needsExpiry ? undefined : !expiryDate ? 'Choose an expiration date.' : expiryDate < today ? 'The expiration date must be in the future.'
      : needsEffective && effectiveDate && expiryDate <= effectiveDate ? 'The expiration date must be after the effective date.' : undefined,
  };

  const issue = async () => {
    if (!type || busy) return;
    setBusy(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 400));
    const r = issueToGroup({
      organizationId: organization.id, groupId: group.id, batchId: batchId.current, credentialTypeId: type.id, memberIds: recipients.map((m) => m.id),
      effectiveDate: needsEffective ? new Date(`${effectiveDate}T00:00:00`).toISOString() : undefined,
      expiresAt: needsExpiry ? new Date(`${expiryDate}T23:59:59`).toISOString() : undefined,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    // Wallet delivery is separate from issuance, as in the rest of Credentials (simulated in this prototype).
    for (const res of r.batch.results) {
      const c = res.credentialId ? r.state.data.credentials.find((x) => x.id === res.credentialId) : undefined;
      if (c?.wallet.status === 'pending') void wallet.deliver(org.organization, c).then((s) => updateWalletStatus(c.id, s)).catch(() => updateWalletStatus(c.id, 'failed'));
    }
    setBatch(r.batch);
    setStep('results');
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const back = () => setStep(STEPS[Math.max(0, stepIndex - 1)].id);
  const canContinue = step === 'credential' ? !!type : step === 'recipients' ? recipients.length > 0 : step === 'eligibility' ? eligible.length > 0 : false;
  const filteredMembers = members.filter((m) => { const query = q.trim().toLowerCase(); return !query || m.displayName.toLowerCase().includes(query) || (m.identifier?.value.toLowerCase().includes(query) ?? false); });
  const allPicked = filteredMembers.length > 0 && filteredMembers.every((m) => picked.has(m.id));

  const footer = step === 'results' ? (
    <>
      {batch && <Button variant="secondary" className="mr-auto" icon={<Eye className="h-4 w-4" />} onClick={() => onViewRun(batch.id)}>Open in issuance history</Button>}
      <Button onClick={onClose}>Done</Button>
    </>
  ) : (
    <>
      {stepIndex > 0 && <Button variant="ghost" className="mr-auto" icon={<ArrowLeft className="h-4 w-4" />} onClick={back} disabled={busy}>Back</Button>}
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      {step === 'review'
        ? <Button onClick={issue} loading={busy} disabled={!confirmed || eligible.length === 0 || !!dateErrors.effective || !!dateErrors.expiry} icon={busy ? undefined : <BadgeCheck className="h-4 w-4" />}>
          {busy ? 'Issuing…' : `Issue ${eligible.length} ${eligible.length === 1 ? 'credential' : 'credentials'}`}
        </Button>
        : <Button onClick={() => setStep(STEPS[stepIndex + 1].id)} disabled={!canContinue} icon={<ArrowRight className="h-4 w-4" />}>Continue</Button>}
    </>
  );

  return (
    <Drawer open={open} onClose={busy ? () => {} : onClose} width="xl" title="Issue credentials" description={`Issue an existing credential to members of ${group.name}.`} footer={footer}>
      <ol className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} aria-current={s.id === step ? 'step' : undefined} className={cn('flex items-center gap-1.5', i <= stepIndex ? 'font-medium text-brand-700' : 'text-slate-400')}>
            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs', i < stepIndex ? 'bg-brand-600 text-white' : i === stepIndex ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>{i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error} Nothing was issued.</p>}

      {step === 'credential' && (
        types.length === 0 ? (
          <EmptyState icon={<BadgeCheck className="h-5 w-5" />} title="No active credentials"
            description="Credentials are configured in Credential Management. Create or activate one there, then come back to issue it."
            action={can('credentials.manage') ? <Link to="/credentials" className="text-sm font-semibold text-brand-600 hover:text-brand-700">Go to Credentials</Link> : undefined} />
        ) : (
          <div role="radiogroup" aria-label="Credential" className="grid gap-3 md:grid-cols-2">
            {types.map((t) => {
              const idc = t.identifierConfigId ? org.identifierConfigById.get(t.identifierConfigId) : undefined;
              return (
                <button key={t.id} type="button" role="radio" aria-checked={typeId === t.id} onClick={() => setTypeId(t.id)}
                  className={cn('rounded-xl border p-4 text-left transition-colors', typeId === t.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                  <span className="block text-sm font-semibold text-slate-900">{t.name}</span>
                  <span className="mt-1 block text-sm text-slate-500">{idc?.name ?? t.identifier.label}</span>
                  <span className="block text-sm text-slate-500">{validityLabel(t.validity)}{t.lifecycle.requiresApproval ? ' · Needs approval' : ''}</span>
                </button>
              );
            })}
          </div>
        )
      )}

      {step === 'recipients' && (
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Recipients" className="grid gap-3 sm:grid-cols-2">
            {([['all', `All current members (${members.length})`, 'Everyone in the group right now.'], ['some', 'Select specific members', 'Choose who to include.']] as const).map(([id, label, hint]) => (
              <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}
                className={cn('rounded-xl border p-4 text-left', mode === id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                <span className="block text-sm font-semibold text-slate-900">{label}</span>
                <span className="mt-0.5 block text-sm text-slate-500">{hint}</span>
              </button>
            ))}
          </div>
          {members.length === 0 && <p className="text-sm text-slate-500">This group has no members yet. Add members first.</p>}
          {mode === 'some' && members.length > 0 && (
            <div className="space-y-3">
              <SearchInput value={q} onChange={setQ} placeholder="Search name or identifier" label="Search members" />
              <div className="rounded-xl border border-slate-200">
                <label className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700">
                  <SelectAllBox checked={allPicked} indeterminate={!allPicked && filteredMembers.some((m) => picked.has(m.id))}
                    onChange={() => setPicked((s) => { const n = new Set(s); for (const m of filteredMembers) { if (allPicked) n.delete(m.id); else n.add(m.id); } return n; })} />
                  Select all {filteredMembers.length} shown
                </label>
                <ul className="max-h-[45vh] divide-y divide-slate-100 overflow-y-auto">
                  {filteredMembers.map((m) => (
                    <li key={m.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                        <input type="checkbox" checked={picked.has(m.id)} aria-label={`Select ${m.displayName}`} className="h-4 w-4 rounded border-slate-300 text-brand-600"
                          onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} />
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{m.displayName}</span>
                        <span className="font-mono text-xs text-slate-500">{m.identifier?.value ?? '—'}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <p className="text-sm font-medium text-slate-700" aria-live="polite">{recipients.length} {recipients.length === 1 ? 'recipient' : 'recipients'} selected</p>
        </div>
      )}

      {step === 'eligibility' && type && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Checked against {type.name}: user status, the identifier it uses, and whether they already hold it. Anyone not eligible will be skipped.</p>
          <dl className="grid grid-cols-3 gap-3">
            {([['Eligible', eligible.length, 'text-emerald-700'], ['Needs attention', attention.length, 'text-amber-700'], ['Not eligible', ineligible.length, 'text-red-700']] as const).map(([label, n, tone]) => (
              <div key={label} className="rounded-xl border border-slate-200 px-4 py-3"><dt className="text-sm text-slate-500">{label}</dt><dd className={cn('mt-1 text-2xl font-semibold tabular-nums', n > 0 ? tone : 'text-slate-400')}>{n}</dd></div>
            ))}
          </dl>
          {eligible.length === 0 && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">None of the selected members can receive {type.name}. Resolve the issues below or choose different recipients.</p>}
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Eligibility">
            {[...attention, ...ineligible, ...eligible].map((c) => (
              <li key={c.member.id} className="flex items-start gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{c.member.displayName}</span>
                  {c.reason && <span className="block text-sm text-slate-500">{c.reason}</span>}
                </span>
                <Badge tone={ELIGIBILITY_BADGE[c.status].tone} dot>{ELIGIBILITY_BADGE[c.status].label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 'review' && type && (
        <div className="space-y-6">
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Credential</dt><dd className="mt-0.5 font-medium text-slate-900">{type.name}</dd></div>
            <div><dt className="text-slate-500">Group</dt><dd className="mt-0.5 font-medium text-slate-900">{group.name}</dd></div>
            <div><dt className="text-slate-500">Selected users</dt><dd className="mt-0.5 font-medium text-slate-900">{recipients.length}</dd></div>
            <div><dt className="text-slate-500">Eligible recipients</dt><dd className="mt-0.5 font-medium text-emerald-700">{eligible.length}</dd></div>
            <div><dt className="text-slate-500">Not eligible</dt><dd className="mt-0.5 font-medium text-slate-900">{ineligible.length}</dd></div>
            <div><dt className="text-slate-500">Needs attention</dt><dd className="mt-0.5 font-medium text-slate-900">{attention.length}</dd></div>
            <div><dt className="text-slate-500">Will be skipped</dt><dd className="mt-0.5 font-medium text-slate-900">{ineligible.length + attention.length}</dd></div>
            <div><dt className="text-slate-500">Expected to be issued</dt><dd className="mt-0.5 text-lg font-semibold text-slate-900">{eligible.length}</dd></div>
          </dl>
          {(needsEffective || needsExpiry) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {needsEffective && <Field label="Effective date" required error={dateErrors.effective}>{(p) => <Input {...p} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />}</Field>}
              {needsExpiry && <Field label="Expiration date" required error={dateErrors.expiry}>{(p) => <Input {...p} type="date" min={today} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />}</Field>}
            </div>
          )}
          {type.lifecycle.requiresApproval && <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">{type.name} needs approval, so new credentials start as pending.</p>}
          <p className="flex gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            Credentials are recorded in FixID for each person. In this prototype, delivery to Seamfix Wallet is simulated. Group membership doesn't change.
          </p>
          <label className="flex items-start gap-3 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I confirm issuing {type.name} to {eligible.length} eligible {eligible.length === 1 ? 'member' : 'members'}{ineligible.length + attention.length ? ` and skipping ${ineligible.length + attention.length}` : ''}.
          </label>
        </div>
      )}

      {step === 'results' && batch && <BatchResults batch={getState().data.issuanceBatches.find((b) => b.id === batch.id) ?? batch} />}
    </Drawer>
  );
}
