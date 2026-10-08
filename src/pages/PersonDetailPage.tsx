import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, BadgePlus, Fingerprint, Link2, ScanFace, ShieldCheck } from 'lucide-react';
import { Avatar, Badge, Button, ButtonLink, Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { CredentialStatusBadge, MemberStatusBadge, SimulatedBadge, WalletBadge } from '@/components/domain/StatusBadges';
import { TransactionsTable } from '@/components/domain/TransactionsTable';
import { DigitalIdCard } from '@/components/domain/DigitalIdCard';
import { cn } from '@/lib/cn';
import type { CanonicalIdentity } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { useServices } from '@/services/ServicesProvider';
import { useOrgData } from '@/store/AppStore';
import { NotFoundPage } from './NotFoundPage';

type LoadState = { status: 'loading' } | { status: 'ready'; identity: CanonicalIdentity } | { status: 'missing' } | { status: 'error' };

export function PersonDetailPage() {
  const { personId } = useParams();
  const { organization, memberById, credentials, credentialTypeById, cardDesignById, transactions, identifierConfigById } = useOrgData();
  const { idSwitch } = useServices();
  const member = personId ? memberById.get(personId) : undefined;
  const [identity, setIdentity] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    setIdentity({ status: 'loading' });
    idSwitch.getIdentity(member.idSwitchId)
      .then((r) => { if (!cancelled) setIdentity(r ? { status: 'ready', identity: r } : { status: 'missing' }); })
      .catch(() => { if (!cancelled) setIdentity({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [member, idSwitch, attempt]);

  if (!member) return <NotFoundPage entity="user" backTo="/users" />;

  const memberCreds = credentials.filter((c) => c.memberId === member.id);
  const memberTx = transactions.filter((t) => t.memberId === member.id);
  const selected = memberCreds.find((c) => c.id === selectedCredentialId) ?? memberCreds.find((c) => c.status === 'active') ?? memberCreds[0];
  const selectedType = selected ? credentialTypeById.get(selected.credentialTypeId) : undefined;
  const selectedDesign = selectedType ? cardDesignById.get(selectedType.cardDesignId) ?? cardDesignById.get(organization.defaultCardDesignId) : undefined;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users', to: '/users' }, { label: member.displayName }]}
        title={<span className="flex items-center gap-3"><Avatar name={member.displayName} photoUrl={member.photoDataUrl} size="lg" />{member.displayName}</span>}
        meta={<><MemberStatusBadge status={member.status} />{member.relationship && <Badge>{member.relationship}</Badge>}{member.unit && <Badge tone="neutral">{member.unit}</Badge>}</>}
        actions={member.status === 'active' && <ButtonLink to={`/users/${member.id}/issue`} variant="secondary" icon={<BadgePlus className="h-4 w-4" />}>Issue credential</ButtonLink>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Canonical identity" description="Owned by ID Switch. Read-only in FixID."
            action={<span className="flex gap-1.5"><Badge tone="brand">ID Switch</Badge><SimulatedBadge /></span>} />
          <CardBody>
            {identity.status === 'loading' && (
              <div className="space-y-3" aria-label="Loading identity from ID Switch">
                {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            )}
            {identity.status === 'error' && (
              <div className="flex flex-col items-start gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-800">
                <p className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />ID Switch is temporarily unavailable. No identity data was changed.</p>
                <Button size="sm" variant="secondary" onClick={() => setAttempt((a) => a + 1)}>Retry</Button>
              </div>
            )}
            {identity.status === 'missing' && (
              <p className="text-sm text-slate-600">The referenced identity <span className="font-mono">{member.idSwitchId}</span> could not be resolved in ID Switch.</p>
            )}
            {identity.status === 'ready' && (
              <DescriptionList items={[
                { label: 'ID Switch ID', value: <span className="font-mono">{identity.identity.idSwitchId}</span> },
                { label: 'Legal name', value: `${identity.identity.givenName} ${identity.identity.familyName}` },
                { label: 'Email', value: identity.identity.email || '—' },
                { label: 'Phone', value: identity.identity.phone || '—' },
                { label: 'Date of birth', value: formatDate(identity.identity.dateOfBirth) },
                { label: 'Assurance', value: <Badge tone={identity.identity.verificationLevel === 'basic' ? 'neutral' : 'success'}>{identity.identity.verificationLevel.replace('-', ' ')}</Badge> },
                {
                  label: 'Also used by', value: identity.identity.linkedProducts.length
                    ? identity.identity.linkedProducts.map((p) => <Badge key={p} tone="violet" className="mr-1">{p}</Badge>)
                    : <span className="text-slate-400">No other Seamfix products</span>,
                  hint: 'Other products only see what their own permissions allow.',
                },
              ]} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Organization context" description="Owned by FixID for this organization only." action={<Badge tone="brand">FixID</Badge>} />
          <CardBody>
            <DescriptionList items={[
              ...(member.identifier ? [{
                label: identifierConfigById.get(member.identifier.configId)?.name ?? 'Identifier',
                value: <span className="font-mono">{member.identifier.value}</span>,
                hint: member.identifier.source ? `Source: ${member.identifier.source}` : 'Organizational identifier',
              }] : []),
              { label: 'Status', value: <MemberStatusBadge status={member.status} />, hint: 'User status is separate from credential status.' },
              ...(member.relationship ? [{ label: 'Role', value: member.relationship }] : []),
              ...(member.unit ? [{ label: 'Unit', value: member.unit }] : []),
              {
                label: 'Identity resolution', value: member.resolution === 'linked-existing'
                  ? <span className="flex items-center gap-1.5"><Link2 className="h-4 w-4 text-sky-600" />Existing ID Switch identity reused</span>
                  : 'New canonical identity requested from ID Switch',
              },
              {
                label: 'Verification factors', value: (
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone={member.factors.face ? 'success' : 'neutral'}><ScanFace className="h-3 w-3" />Face {member.factors.face ? 'enrolled' : 'not enrolled'}</Badge>
                    <Badge tone={member.factors.fingerprint ? 'success' : 'neutral'}><Fingerprint className="h-3 w-3" />Fingerprint {member.factors.fingerprint ? 'enrolled' : 'not enrolled'}</Badge>
                  </span>
                ),
                hint: 'Enrollment status only. Biometric data is never displayed.',
              },
              { label: 'Linked on', value: formatDate(member.joinedAt) },
            ]} />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Credentials" description={`${memberCreds.length} issued to ${member.displayName}`} />
        {memberCreds.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No credentials issued yet"
            description={member.status === 'pending' ? 'Onboarding is pending. A credential can be issued once onboarding completes.' : "Issue a digital ID whenever you're ready."}
            action={member.status === 'active' ? <ButtonLink to={`/users/${member.id}/issue`} variant="primary" icon={<BadgePlus className="h-4 w-4" />}>Issue credential</ButtonLink> : undefined} />
        ) : (
          <div className="grid lg:grid-cols-5">
            <ul className="divide-y divide-slate-100 lg:col-span-3 lg:border-r lg:border-slate-100">
              {memberCreds.map((c) => (
                <li key={c.id} className={cn('flex flex-wrap items-center gap-4 px-5 py-3', selected?.id === c.id && 'bg-brand-50/50')}>
                  <button type="button" onClick={() => setSelectedCredentialId(c.id)} aria-pressed={selected?.id === c.id}
                    className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <span className="block text-sm font-medium text-slate-900">{credentialTypeById.get(c.credentialTypeId)?.name}</span>
                    <span className="block font-mono text-xs text-slate-500">{c.identifier}</span>
                  </button>
                  <span className="text-xs text-slate-500">Expires {c.expiresAt ? formatDate(c.expiresAt) : 'never'}</span>
                  <WalletBadge status={c.wallet.status} />
                  <CredentialStatusBadge status={c.status} />
                  <Link to={`/credentials/${c.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">Open<span className="sr-only"> {c.identifier}</span></Link>
                </li>
              ))}
            </ul>
            {selected && selectedType && selectedDesign && (
              <div role="region" className="flex flex-col items-center gap-3 bg-slate-50/60 p-6 lg:col-span-2" aria-label="Digital ID preview">
                <div className="origin-top scale-[0.85] 2xl:scale-100">
                  <DigitalIdCard design={selectedDesign} organization={organization} content={{
                    name: member.displayName, identifier: selected.identifier, identifierLabel: selectedType.identifier.label, credentialTypeName: selectedType.name,
                    relationship: member.relationship, unit: member.unit, expiresAt: selected.expiresAt, issuedAt: selected.issuedAt, photoUrl: member.photoDataUrl,
                  }} />
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Recent verifications" description="Latest 10 attempts involving this person"
          action={memberTx.length > 0 && <Link to={`/verification-history?person=${member.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View all {memberTx.length}</Link>} />
        <TransactionsTable rows={memberTx.slice(0, 10)} hide={['person', 'id', 'result']} emptyTitle="No verification attempts" />
      </Card>
    </>
  );
}
