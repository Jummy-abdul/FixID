import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, Lock, XCircle } from 'lucide-react';
import { Badge, EmptyState, Field, Select } from '@/components/ui';
import { roleById } from '@/domain/roles';
import type { ActivityCheck, ActivityConfig, ActivityVersion } from '@/domain/types';
import {
  CHECKS, CATEGORY_LABEL, TYPE_INFO, checkById, eligibleVerifiers, providersFor, rulesSummary, type ProviderInfo,
} from '@/domain/verification';
import { cn } from '@/lib/cn';
import { describeParams } from '@/store/activityOps';
import { useSession, useStore } from '@/store/AppStore';

export function ActivityStatusBadge({ status }: { status: ActivityConfig['status'] }) {
  const map = { draft: { tone: 'neutral', label: 'Draft' }, active: { tone: 'success', label: 'Active' }, inactive: { tone: 'warning', label: 'Inactive' } } as const;
  return <Badge tone={map[status].tone} dot>{map[status].label}</Badge>;
}

export const typeName = (t: ActivityVersion['type']) => TYPE_INFO[t].name;

const PROVIDER_STATUS = {
  available: { tone: 'success', label: 'Available' },
  'not-configured': { tone: 'neutral', label: 'Not configured' },
  unavailable: { tone: 'danger', label: 'Unavailable' },
} as const;

export function ProviderStatusBadge({ status }: { status: ProviderInfo['status'] }) {
  return <Badge tone={PROVIDER_STATUS[status].tone} dot>{PROVIDER_STATUS[status].label}</Badge>;
}

/**
 * Choose a trusted identity source or verification provider for a check. Shows each option's status
 * and what it supports; unavailable options can be chosen in a draft but block activation.
 */
export function ProviderSelect({ label, kind, options, value, onChange, disabled }: {
  label: string; kind: 'provider' | 'source'; options: string[]; value?: string; onChange: (id: string) => void; disabled?: boolean;
}) {
  const { organization } = useSession();
  const providers = providersFor(organization);
  const list = options.map((id) => providers.find((p) => p.id === id)!).filter(Boolean);
  const selected = list.find((p) => p.id === value);
  const supports = selected ? CHECKS.filter((c) => (kind === 'provider' ? c.providers : c.sources ?? []).includes(selected.id)).map((c) => c.name) : [];
  return (
    <div>
      <Field label={label}>
        {(p) => (
          <Select {...p} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
            {!value && <option value="">Choose…</option>}
            {list.map((x) => <option key={x.id} value={x.id}>{x.name} — {PROVIDER_STATUS[x.status].label}</option>)}
          </Select>
        )}
      </Field>
      {selected && (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
          <div className="flex flex-wrap items-center gap-2"><ProviderStatusBadge status={selected.status} /><span>{selected.statusNote}</span></div>
          <p className="mt-1">{selected.description}</p>
          {supports.length > 0 && <p className="mt-1 text-slate-500">Supports: {supports.join(', ')}</p>}
        </div>
      )}
    </div>
  );
}

const REQ_BADGE = {
  required: { tone: 'brand', label: 'Required' },
  optional: { tone: 'neutral', label: 'Optional' },
  alternative: { tone: 'violet', label: 'Approved alternative' },
} as const;

export function RequirementBadge({ check }: { check: ActivityCheck }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={REQ_BADGE[check.requirement].tone}>{REQ_BADGE[check.requirement].label}</Badge>
      {check.locked && <Badge tone="warning"><Lock className="h-3 w-3" aria-hidden="true" />{check.policySource === 'platform' ? 'Platform policy' : 'Mandatory policy'}</Badge>}
    </span>
  );
}

/** Configured checks, grouped by category, with requirement, provider, source and settings. */
export function ChecksSummary({ version, issues = [] }: { version: Pick<ActivityVersion, 'type' | 'checks'>; issues?: { checkId?: string; message: string }[] }) {
  const { state } = useStore();
  const { organization } = useSession();
  const providers = providersFor(organization);
  const pname = (id?: string) => providers.find((p) => p.id === id);
  if (version.checks.length === 0) return <EmptyState title="No checks configured" description="Add verification checks to define what this activity verifies." />;
  return (
    <div className="space-y-5">
      {TYPE_INFO[version.type].categories.map((cat) => {
        const checks = version.checks.filter((c) => checkById(c.type).category === cat);
        if (!checks.length) return null;
        return (
          <section key={cat} aria-label={CATEGORY_LABEL[cat]}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{CATEGORY_LABEL[cat]}</h4>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {checks.map((c) => {
                const def = checkById(c.type);
                const p = pname(c.providerId);
                const src = pname(c.sourceId);
                const mine = issues.filter((i) => i.checkId === c.id);
                return (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{def.name}</span>
                      <RequirementBadge check={c} />
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">{def.description}</p>
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                      <div><dt className="text-slate-400">Provider</dt><dd className="flex items-center gap-1.5 text-slate-700">{p?.name ?? 'Not chosen'}{p && p.status !== 'available' && <ProviderStatusBadge status={p.status} />}</dd></div>
                      {def.sources && <div><dt className="text-slate-400">Trusted source</dt><dd className="flex items-center gap-1.5 text-slate-700">{src?.name ?? 'Not chosen'}{src && src.status !== 'available' && <ProviderStatusBadge status={src.status} />}</dd></div>}
                      {def.fields?.length ? <div><dt className="text-slate-400">Settings</dt><dd className="text-slate-700">{describeParams(state, c)}</dd></div> : null}
                    </dl>
                    {mine.map((i) => <p key={i.message} className="mt-2 flex gap-1.5 text-xs text-red-700"><XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{i.message}</p>)}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function RulesList({ version }: { version: Pick<ActivityVersion, 'checks' | 'outcome'> }) {
  return (
    <ul className="space-y-1.5 text-sm text-slate-700" aria-label="Outcome rules">
      {rulesSummary(version).map((r) => <li key={r} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />{r}</li>)}
    </ul>
  );
}

/** Blocking problems and warnings, in plain language. */
export function IssuesList({ blockers, warnings, title = 'Resolve before activating' }: { blockers: string[]; warnings: string[]; title?: string }) {
  if (!blockers.length && !warnings.length) {
    return <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Ready to activate. All required configuration is complete.</p>;
  }
  return (
    <div className="space-y-3">
      {blockers.length > 0 && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-inset ring-red-200">
          <p className="font-semibold">{title}</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Worth checking</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/** Pick administrators with the Verifier role. Assignment lets them perform this activity, nothing more. */
export function VerifierPicker({ value, onChange, readOnly }: { value: string[]; onChange: (ids: string[]) => void; readOnly?: boolean }) {
  const { organization } = useSession();
  const { state } = useStore();
  const eligible = eligibleVerifiers(state.data, organization.id);
  if (eligible.length === 0) {
    return (
      <EmptyState icon={<Info className="h-5 w-5" />} title="No eligible verifiers yet"
        description="Verifiers are administrators with the Verifier role. Invite one in Settings → Administrators & Roles, then assign them here."
        action={<Link to="/settings?tab=admins" className="text-sm font-semibold text-brand-600 hover:text-brand-700">Go to Administrators & Roles</Link>} />
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Eligible verifiers">
        {eligible.map((a) => {
          const on = value.includes(a.id);
          return (
            <li key={a.id}>
              <label className={cn('flex items-center gap-3 px-4 py-3', readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-slate-50')}>
                <input type="checkbox" checked={on} disabled={readOnly} aria-label={`Assign ${a.name ?? a.email}`}
                  onChange={() => onChange(on ? value.filter((x) => x !== a.id) : [...value, a.id])}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{a.name ?? a.email}</span>
                  <span className="block text-xs text-slate-500">{a.email} · {a.roleIds.map((r) => roleById(r)?.name).join(', ')}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-sm font-medium text-slate-700" aria-live="polite">{value.length} {value.length === 1 ? 'verifier' : 'verifiers'} assigned</p>
    </div>
  );
}
