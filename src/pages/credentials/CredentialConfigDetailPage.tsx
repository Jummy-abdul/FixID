import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgePlus, Pencil, ShieldCheck } from 'lucide-react';
import { Button, ButtonLink, Card, DataTable, EmptyState, PageHeader, Tabs } from '@/components/ui';
import { CredentialSetup } from '@/components/config/CredentialSetup';
import { FlippableCredentialCard } from '@/components/credentials/CredentialCard';
import { CredentialStatusBadge } from '@/components/domain/StatusBadges';
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
  const { organization, credentialTypeById, credentials, memberById, identifierConfigById } = useOrgData();
  const [tab, setTab] = useQueryState('tab', 'configuration');
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const type = typeId ? credentialTypeById.get(typeId) : undefined;
  if (!type) return <NotFoundPage entity="credential" backTo="/credentials" />;

  const identifierName = type.identifierConfigId ? identifierConfigById.get(type.identifierConfigId)?.name ?? '—' : type.identifier.label;
  const issued = credentials.filter((c) => c.credentialTypeId === type.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const current: TabId = tab === 'issued' ? 'issued' : 'configuration';
  const issueHref = assignUrl({ recipientIds: [], credentialTypeId: type.id, step: 'recipients', from: 'config' });
  const canIssue = type.status === 'active';
  const template = templateById(type.templateId);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Credentials', to: '/credentials' }, { label: type.name }]}
        title={type.name}
        meta={<span className="text-sm text-slate-500">{identifierName} · Created {formatDate(type.createdAt)}</span>}
        actions={<Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
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
                  content={{ credentialName: type.name, holderName: 'Sample Holder', identifierLabel: identifierName, identifierValue: 'ABC-00001', expiresAt: sampleExpiry(type.validity), sample: true }} />
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">Recipients</h2>
              {issued.length > 0 && canIssue && <ButtonLink to={issueHref} variant="secondary" icon={<BadgePlus className="h-4 w-4" />}>Issue credential</ButtonLink>}
            </div>
            {issued.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No credentials issued yet" description="This credential is ready to be issued to users."
                action={canIssue ? <ButtonLink to={issueHref} variant="primary" icon={<BadgePlus className="h-4 w-4" />}>Issue credential</ButtonLink> : undefined} />
            ) : (
              <DataTable
                rows={issued}
                rowKey={(c) => c.id}
                columns={[
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
                  { key: 'status', header: 'Credential Status', cell: (c) => <CredentialStatusBadge status={c.status} /> },
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
      <CredentialSetup open={editing} existing={type} onClose={() => setEditing(false)} onAssign={() => undefined} onLater={() => undefined} />
    </>
  );
}
