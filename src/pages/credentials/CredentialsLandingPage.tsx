import { useAuthorization } from '@/auth/authorization';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Pencil, Plus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, OverflowMenu, PageHeader, SearchInput } from '@/components/ui';
import { CredentialSetup } from '@/components/config/CredentialSetup';
import { assignUrl } from '@/components/issuance/assignment';
import type { CredentialType } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

export const configPath = (id: string, tab?: 'issued') => `/credentials/configurations/${id}${tab ? '?tab=issued' : ''}`;

/** Subtle digital ID illustration for the first-time state. */
function IdCardIllustration() {
  return (
    <svg viewBox="0 0 220 150" className="h-36 w-auto" aria-hidden="true">
      <defs>
        <linearGradient id="idc-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <ellipse cx="110" cy="138" rx="80" ry="7" fill="#e2e8f0" />
      <rect x="44" y="18" width="150" height="96" rx="12" fill="#eef2ff" transform="rotate(6 119 66)" />
      <rect x="28" y="26" width="150" height="96" rx="12" fill="url(#idc-a)" />
      <rect x="28" y="26" width="150" height="22" rx="12" fill="#ffffff" opacity="0.12" />
      <rect x="40" y="58" width="36" height="44" rx="6" fill="#ffffff" opacity="0.9" />
      <circle cx="58" cy="74" r="8" fill="#c7d2fe" />
      <path d="M45 98c3-9 23-9 26 0" fill="#c7d2fe" />
      <rect x="86" y="60" width="66" height="7" rx="3.5" fill="#ffffff" opacity="0.95" />
      <rect x="86" y="74" width="48" height="5" rx="2.5" fill="#ffffff" opacity="0.6" />
      <rect x="86" y="85" width="56" height="5" rx="2.5" fill="#ffffff" opacity="0.6" />
      <circle cx="160" cy="102" r="9" fill="#fde68a" opacity="0.9" />
      <rect x="40" y="33" width="12" height="9" rx="2" fill="#fde68a" />
    </svg>
  );
}

export function CredentialsLandingPage() {
  const { credentialTypes, credentials, identifierConfigById } = useOrgData();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<{ open: boolean; existing?: CredentialType }>({ open: false });
  const [q, setQ] = useState('');
  const canConfigure = useAuthorization().can('credentials.configure');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const configs = useMemo(() => credentialTypes.filter((t) => t.status !== 'retired'), [credentialTypes]);
  const issuedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of credentials) m.set(c.credentialTypeId, (m.get(c.credentialTypeId) ?? 0) + 1);
    return m;
  }, [credentials]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return configs
      .filter((t) => !query || t.name.toLowerCase().includes(query) || identifierName(t).toLowerCase().includes(query))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    function identifierName(t: CredentialType) { return t.identifierConfigId ? identifierConfigById.get(t.identifierConfigId)?.name ?? '' : t.identifier.label; }
  }, [configs, q, identifierConfigById]);

  // Selection follows the visible rows.
  const visibleKey = filtered.map((t) => t.id).join(',');
  useEffect(() => {
    const visible = new Set(visibleKey.split(','));
    setSelected((s) => ([...s].some((id) => !visible.has(id)) ? new Set([...s].filter((id) => visible.has(id))) : s));
  }, [visibleKey]);
  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));
  const someSelected = filtered.some((t) => selected.has(t.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const setupDrawer = (
    <CredentialSetup open={setup.open} existing={setup.existing} onClose={() => setSetup((s) => ({ ...s, open: false }))}
      onAssign={(id) => navigate(assignUrl({ recipientIds: [], credentialTypeId: id, step: 'recipients', from: 'config' }))}
      onLater={() => undefined} />
  );

  if (configs.length === 0) {
    return (
      <>
        <PageHeader title="Credentials" />
        <section className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-card sm:py-20">
          <IdCardIllustration />
          <h2 className="mt-6 text-xl font-semibold text-slate-900">No credentials configured yet</h2>
          <p className="mt-2 max-w-md text-slate-500">Create a credential to start issuing digital IDs to your users.</p>
          {canConfigure && <Button className="mt-7" icon={<Plus className="h-4 w-4" />} onClick={() => setSetup({ open: true })}>Create credential</Button>}
        </section>
        {setupDrawer}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Credentials"
        actions={canConfigure ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setSetup({ open: true })}>Create credential</Button> : undefined} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search credentials" className="sm:w-80" label="Search credentials" />
          {someSelected && <span className="text-sm text-slate-600 sm:ml-auto" aria-live="polite">{filtered.filter((t) => selected.has(t.id)).length} selected</span>}
        </div>
        <DataTable
          rows={filtered}
          rowKey={(t) => t.id}
          empty={<EmptyState title="No matching credentials" description="Try a different search." />}
          columns={[
            {
              key: 'select', className: 'w-10',
              header: <SelectAll checked={allSelected} indeterminate={someSelected && !allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((t) => t.id)))} />,
              cell: (t) => (
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.name}`}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              ),
            },
            { key: 'sn', header: 'SN', className: 'w-12', cell: (t) => <span className="tabular-nums text-slate-500">{filtered.indexOf(t) + 1}</span> },
            { key: 'name', header: 'Credential Name', cell: (t) => <Link to={configPath(t.id)} className="font-medium text-slate-900 hover:text-brand-700">{t.name}</Link> },
            { key: 'identifier', header: 'Identifier', cell: (t) => <span className="text-slate-600">{t.identifierConfigId ? identifierConfigById.get(t.identifierConfigId)?.name ?? '—' : t.identifier.label}</span> },
            { key: 'issued', header: 'Issued Count', cell: (t) => <span className="tabular-nums text-slate-700">{(issuedCount.get(t.id) ?? 0).toLocaleString()} issued</span> },
            { key: 'created', header: 'Date Created', cell: (t) => <span className="text-slate-500">{formatDate(t.createdAt)}</span> },
            {
              key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right',
              cell: (t) => (
                <OverflowMenu label={`Actions for ${t.name}`} items={[
                  { key: 'view', label: 'View Details', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(configPath(t.id)) },
                  ...(canConfigure ? [{ key: 'edit', label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => setSetup({ open: true, existing: t }) }] : []),
                ]} />
              ),
            },
          ]}
        />
      </Card>
      {setupDrawer}
    </>
  );
}

function SelectAll({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label="Select all credentials"
      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
  );
}
