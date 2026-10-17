import { useAuthorization } from '@/auth/authorization';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgePlus, Pencil, Printer, ShieldCheck } from 'lucide-react';
import { Button, ButtonLink, Card, DataTable, EmptyState, PageHeader, Tabs } from '@/components/ui';
import { CredentialSetup } from '@/components/config/CredentialSetup';
import { FlippableCredentialCard } from '@/components/credentials/CredentialCard';
import { CredentialStatusBadge } from '@/components/domain/StatusBadges';
import { SelectAllBox } from '@/components/groups/AddMembersDrawer';
import { PrintCredentialsDialog } from '@/components/credentials/print/PrintCredentialsDialog';
import { printProblem } from '@/components/credentials/print/printing';
import { assignUrl } from '@/components/issuance/assignment';
import { effectiveDateLabel, expirationLabel } from '@/domain/labels';
import { sampleExpiry, templateById } from '@/domain/templates';
import { formatDate } from '@/lib/dates';
import { useQueryState } from '@/hooks/useQueryState';
import { useOrgData } from '@/store/AppStore';
import { NotFoundPage } from '../NotFoundPage';
import { issuedCredentialPath } from './IssuedCredentialDetailPage';

type TabId = 'configuration' | 'issued';

/** A reusable credential configuration: its rules and template, and everyone it has been issued to. */
export function CredentialConfigDetailPage() {
  const { typeId } = useParams();
  const { organization, credentialTypeById, credentials, memberById, identifierConfigById, logoAssetById } = useOrgData();
  const [tab, setTab] = useQueryState('tab', 'configuration');
  const [editing, setEditing] = useState(false);
  // Recipients selected for printing (Issued To). Only printable credentials can be selected.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState(false);
  const navigate = useNavigate();
  const type = typeId ? credentialTypeById.get(typeId) : undefined;
  if (!type) return <NotFoundPage entity="credential" backTo="/credentials" />;

  const identifierName = type.identifierConfigId ? identifierConfigById.get(type.identifierConfigId)?.name ?? '—' : type.identifier.label;
  const issued = credentials.filter((c) => c.credentialTypeId === type.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const current: TabId = tab === 'issued' ? 'issued' : 'configuration';
  const issueHref = assignUrl({ recipientIds: [], credentialTypeId: type.id, step: 'recipients', from: 'config' });
  const { can } = useAuthorization();
  const canIssue = type.status === 'active' && can('credentials.issue');
  const template = templateById(type.templateId);
  // Printing ID cards is for the people who issue them; it only reads the issued credentials.
  const canPrint = can('credentials.issue');
  // The list isn't paginated, so "this page" is every recipient listed.
  const pageRows = issued;
  const problemOf = new Map(pageRows.map((c) => [c.id, printProblem(c)]));
  const printableIds = pageRows.filter((c) => !problemOf.get(c.id)).map((c) => c.id);
  const selectedIds = printableIds.filter((id) => selected.has(id));
  const allSelected = printableIds.length > 0 && selectedIds.length === printableIds.length;
  const blocked = pageRows.length - printableIds.length;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const holder = (memberId: string) => memberById.get(memberId)?.displayName ?? 'Unknown user';

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Credentials', to: '/credentials' }, { label: type.name }]}
        title={type.name}
        meta={<span className="text-sm text-slate-500">{identifierName} · Created {formatDate(type.createdAt)}</span>}
        actions={can('credentials.manage') ? <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button> : undefined}
      />
      <Tabs<TabId> value={current} onChange={setTab} tabs={[
        { value: 'configuration', label: 'Configuration' },
        { value: 'issued', label: 'Issued To', count: issued.length },
      ]} />

      <div className="mt-6" role="tabpanel" aria-label={current === 'issued' ? 'Issued To' : 'Configuration'}>
        {current === 'configuration' ? (
          <Card>
            <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto]">
              <dl className="grid content-start gap-x-8 gap-y-6 sm:grid-cols-2">
                {[
                  ['Credential name', type.name],
                  ['Identifier', identifierName],
                  ['Effective date', effectiveDateLabel(type.effectiveDate)],
                  ['Expiration', expirationLabel(type.validity)],
                  ['Renewable', type.renewal.allowed ? 'Yes' : 'No'],
                  ['Date created', formatDate(type.createdAt)],
                  ['Template', `${template.name} (${template.orientation === 'landscape' ? 'Landscape' : 'Portrait'})`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-sm text-slate-500">{label}</dt>
                    <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex justify-center rounded-2xl bg-slate-50 p-6">
                <FlippableCredentialCard templateId={type.templateId} organization={organization} label="Template side"
                  content={{ credentialName: type.name, holderName: 'Sample Holder', identifierLabel: identifierName, identifierValue: 'ABC-00001', expiresAt: sampleExpiry(type.validity), sample: true, logoUrl: logoAssetById.get(type.logoAssetId ?? '')?.dataUrl }} />
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">Recipients</h2>
              {issued.length > 0 && canIssue && <ButtonLink to={issueHref} variant="secondary" icon={<BadgePlus className="h-4 w-4" />}>Issue credential</ButtonLink>}
            </div>
            {canPrint && issued.length > 0 && (selectedIds.length > 0 ? (
              <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50/60 px-4 py-2.5 sm:px-6">
                <span className="mr-2 text-sm font-medium text-slate-700" aria-live="polite">{selectedIds.length} selected</span>
                <Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => setPrinting(true)}>{`Print ID cards (${selectedIds.length})`}</Button>
                <button type="button" className="ml-auto rounded text-sm font-medium text-brand-600 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  onClick={() => setSelected(new Set())}>Clear selection</button>
              </div>
            ) : (
              <p className="border-b border-slate-100 px-4 py-2.5 text-sm text-slate-500 sm:px-6" aria-live="polite">
                {printableIds.length === 0
                  ? 'None of these credentials can be printed. Only active, current credentials can be printed as ID cards.'
                  : `Select recipients to print their ID cards. The header checkbox selects all ${printableIds.length} printable on this page.${blocked ? ` ${blocked} can’t be printed (not active, or expired).` : ''}`}
              </p>
            ))}
            {issued.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No credentials issued yet" description="This credential is ready to be issued to users."
                action={canIssue ? <ButtonLink to={issueHref} variant="primary" icon={<BadgePlus className="h-4 w-4" />}>Issue credential</ButtonLink> : undefined} />
            ) : (
              <DataTable
                rows={issued}
                rowKey={(c) => c.id}
                columns={[
                  ...(canPrint ? [{
                    key: 'select', className: 'w-10',
                    header: <SelectAllBox label="Select all printable recipients on this page" checked={allSelected} disabled={printableIds.length === 0}
                      indeterminate={selectedIds.length > 0 && !allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(printableIds))} />,
                    cell: (c: (typeof issued)[number]) => {
                      const problem = problemOf.get(c.id);
                      return (
                        <input type="checkbox" checked={!problem && selected.has(c.id)} disabled={!!problem} onChange={() => toggle(c.id)}
                          aria-label={problem ? `Can't print ${holder(c.memberId)}: ${problem}` : `Select ${holder(c.memberId)}`} title={problem ?? undefined}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40" />
                      );
                    },
                  }] : []),
                  { key: 'sn', header: 'SN', className: 'w-12', cell: (c) => <span className="tabular-nums text-slate-500">{issued.indexOf(c) + 1}</span> },
                  {
                    key: 'name', header: 'Recipient Name', cell: (c) => {
                      const m = memberById.get(c.memberId);
                      return m ? <Link to={`/users/${m.id}`} className="font-medium text-slate-900 hover:text-brand-700">{m.displayName}</Link> : <span className="text-slate-400">Unknown user</span>;
                    },
                  },
                  { key: 'identifier', header: 'Identifier', cell: (c) => <span className="font-mono text-xs text-slate-700">{c.identifier}</span> },
                  { key: 'issued', header: 'Date Issued', cell: (c) => <span className="text-slate-600">{formatDate(c.issuedAt)}</span> },
                  { key: 'expires', header: 'Expiration Date', cell: (c) => <span className="text-slate-600">{c.expiresAt ? formatDate(c.expiresAt) : 'No expiry'}</span> },
                  {
                    key: 'status', header: 'Credential Status', cell: (c) => (
                      <span className="inline-flex flex-col items-start gap-0.5">
                        <CredentialStatusBadge status={c.status} />
                        {/* An active record past its expiry date isn't printed as a valid card. */}
                        {canPrint && c.status === 'active' && problemOf.get(c.id) && <span className="text-xs text-slate-500">{problemOf.get(c.id)}</span>}
                      </span>
                    ),
                  },
                  {
                    key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right',
                    cell: (c) => (
                      <button type="button" onClick={() => navigate(issuedCredentialPath(c.id, { kind: 'config', id: type.id }))}
                        className="whitespace-nowrap text-sm font-medium text-brand-600 hover:text-brand-700">
                        View Details<span className="sr-only"> for {memberById.get(c.memberId)?.displayName ?? c.identifier}</span>
                      </button>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        )}
      </div>
      {canPrint && (
        <PrintCredentialsDialog open={printing} onClose={() => setPrinting(false)} credentialIds={printing ? selectedIds : []}
          onComplete={() => { setPrinting(false); setSelected(new Set()); }} />
      )}
      <CredentialSetup open={editing} existing={type} onClose={() => setEditing(false)} onAssign={() => undefined} onLater={() => undefined} />
    </>
  );
}
