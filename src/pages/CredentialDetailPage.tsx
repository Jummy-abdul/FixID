import { Link, useParams } from 'react-router-dom';
import { Check, ExternalLink } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui';
import { DigitalIdCard } from '@/components/domain/DigitalIdCard';
import { CredentialStatusBadge, SimulatedBadge, WalletBadge } from '@/components/domain/StatusBadges';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { TransactionsTable } from '@/components/domain/TransactionsTable';
import { formatDate, formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useServices } from '@/services/ServicesProvider';
import { useOrgData } from '@/store/AppStore';
import { NotFoundPage } from './NotFoundPage';

export function CredentialDetailPage() {
  const { credentialId } = useParams();
  const { organization, credentialById, memberById, credentialTypeById, cardDesignById, transactions, audit } = useOrgData();
  const { issuance, wallet } = useServices();
  const credential = credentialId ? credentialById.get(credentialId) : undefined;
  if (!credential) return <NotFoundPage entity="credential" backTo="/credentials" />;

  const member = memberById.get(credential.memberId)!;
  const type = credentialTypeById.get(credential.credentialTypeId)!;
  const design = cardDesignById.get(type.cardDesignId) ?? cardDesignById.get(organization.defaultCardDesignId)!;
  const tx = transactions.filter((t) => t.credentialId === credential.id);
  const renewalOpens = issuance.renewalOpensAt(type, credential);
  const history = audit.filter((e) => e.resourceType === 'credential' && e.resourceId === credential.id);

  const lifecycle = [
    { label: 'Created', done: true },
    { label: 'Issued', done: credential.status !== 'pending' },
    { label: 'Active', done: ['active', 'suspended', 'revoked', 'expired'].includes(credential.status) },
    { label: credential.status === 'revoked' ? 'Revoked' : credential.status === 'expired' ? 'Expired' : credential.status === 'suspended' ? 'Suspended' : 'Retired', done: ['revoked', 'expired', 'suspended'].includes(credential.status) },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Credentials', to: '/credentials' }, { label: credential.identifier }]}
        title={<span className="font-mono">{credential.identifier}</span>}
        meta={<><CredentialStatusBadge status={credential.status} /><Badge>{type.name}</Badge></>}
        actions={<PlannedButton info={PLANNED.credentialLifecycle}>Manage lifecycle</PlannedButton>}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Digital ID" description={`${design.name} design`} />
          <CardBody className="flex justify-center bg-slate-50/60 py-8">
            <DigitalIdCard design={design} organization={organization} content={{
              name: member.displayName, identifier: credential.identifier, credentialTypeName: type.name,
              relationship: member.relationship, unit: member.unit, expiresAt: credential.expiresAt, issuedAt: credential.issuedAt,
            }} />
          </CardBody>
        </Card>
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList items={[
                { label: 'Holder', value: <Link to={`/users/${member.id}`} className="font-medium text-brand-700 hover:underline">{member.displayName}</Link>, hint: `ID Switch ${member.idSwitchId}` },
                { label: 'Credential type', value: <Link to={`/templates/credential-types/${type.id}`} className="text-brand-700 hover:underline">{type.name}</Link> },
                { label: 'Issued', value: formatDate(credential.issuedAt) },
                { label: 'Effective from', value: formatDate(credential.effectiveFrom) },
                { label: 'Expires', value: credential.expiresAt ? formatDate(credential.expiresAt) : 'Does not expire' },
                { label: 'Renewal', value: renewalOpens ? `Renewal window opens ${formatDate(renewalOpens.toISOString())}` : 'Not renewable' },
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Seamfix Wallet" description="The holder experience is provided by Seamfix Wallet." action={<SimulatedBadge />} />
            <CardBody>
              <DescriptionList items={[
                { label: 'Delivery', value: <WalletBadge status={credential.wallet.status} />, hint: credential.wallet.status === 'not-sent' ? (organization.integrations.seamfixWallet.connected ? 'Credentials are delivered once active.' : 'Seamfix Wallet is not connected for this organization.') : `Updated ${formatDateTime(credential.wallet.updatedAt)}` },
                ...(credential.wallet.status === 'delivered' ? [{ label: 'Holder link', value: <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-600">{wallet.getHolderLink(credential)}<ExternalLink className="h-3 w-3" /></span>, hint: 'Illustrative link (not live).' }] : []),
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Lifecycle" />
            <CardBody>
              <ol className="flex items-center gap-2">
                {lifecycle.map((s, i) => (
                  <li key={s.label} className="flex flex-1 items-center gap-2">
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', s.done ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400')}>
                      {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className={cn('text-sm', s.done ? 'text-slate-900' : 'text-slate-400')}>{s.label}</span>
                    {i < lifecycle.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
                  </li>
                ))}
              </ol>
              {history.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
                  {history.map((e) => (
                    <li key={e.id} className="flex justify-between gap-4"><span className="text-slate-700">{e.summary}</span><span className="shrink-0 text-xs text-slate-500">{formatDateTime(e.occurredAt)}</span></li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      <Card className="mt-6">
        <CardHeader title="Presentations" description="Verification attempts using this credential" />
        <TransactionsTable rows={tx.slice(0, 15)} hide={['person', 'credential', 'id']} emptyTitle="Not presented yet" />
      </Card>
    </>
  );
}
