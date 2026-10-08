import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, BadgePlus, Fingerprint, Link2, ScanFace, ShieldCheck } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { CredentialStatusBadge, MemberStatusBadge, SimulatedBadge, WalletBadge } from '@/components/domain/StatusBadges';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { TransactionsTable } from '@/components/domain/TransactionsTable';
import type { CanonicalIdentity } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { useServices } from '@/services/ServicesProvider';
import { useOrgData } from '@/store/AppStore';
import { NotFoundPage } from './NotFoundPage';

type LoadState = { status: 'loading' } | { status: 'ready'; identity: CanonicalIdentity } | { status: 'missing' } | { status: 'error' };

export function PersonDetailPage() {
  const { personId } = useParams();
  const { memberById, credentials, credentialTypeById, transactions } = useOrgData();
  const { idSwitch } = useServices();
  const member = personId ? memberById.get(personId) : undefined;
  const [identity, setIdentity] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    setIdentity({ status: 'loading' });
    idSwitch.getIdentity(member.idSwitchId)
      .then((r) => { if (!cancelled) setIdentity(r ? { status: 'ready', identity: r } : { status: 'missing' }); })
      .catch(() => { if (!cancelled) setIdentity({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [member, idSwitch, attempt]);

  if (!member) return <NotFoundPage entity="person" backTo="/people" />;

  const memberCreds = credentials.filter((c) => c.memberId === member.id);
  const memberTx = transactions.filter((t) => t.memberId === member.id);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'People', to: '/people' }, { label: member.displayName }]}
        title={<span className="flex items-center gap-3"><Avatar name={member.displayName} size="lg" />{member.displayName}</span>}
        meta={<><MemberStatusBadge status={member.status} /><Badge>{member.relationship}</Badge><Badge tone="neutral">{member.unit}</Badge></>}
        actions={<PlannedButton icon={<BadgePlus className="h-4 w-4" />} info={PLANNED.issueAdditional}>Issue another credential</PlannedButton>}
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
                { label: 'Email', value: identity.identity.email },
                { label: 'Phone', value: identity.identity.phone },
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
              { label: 'Relationship', value: member.relationship },
              { label: 'Unit', value: member.unit },
              ...(member.externalRef ? [{ label: member.externalRef.label, value: <span className="font-mono">{member.externalRef.value}</span>, hint: `Source: ${member.externalRef.source}` }] : []),
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
          <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No credentials issued"
            description={member.status === 'pending' ? 'Onboarding is pending. A credential can be issued once onboarding completes.' : 'This person has not been issued a credential yet.'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {memberCreds.map((c) => (
              <li key={c.id}>
                <Link to={`/credentials/${c.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{credentialTypeById.get(c.credentialTypeId)?.name}</p>
                    <p className="font-mono text-xs text-slate-500">{c.identifier}</p>
                  </div>
                  <span className="text-xs text-slate-500">Expires {c.expiresAt ? formatDate(c.expiresAt) : 'never'}</span>
                  <WalletBadge status={c.wallet.status} />
                  <CredentialStatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Recent verifications" description="Latest 10 attempts involving this person"
          action={memberTx.length > 0 && <Link to={`/transactions?person=${member.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View all {memberTx.length}</Link>} />
        <TransactionsTable rows={memberTx.slice(0, 10)} hide={['person', 'id', 'result']} emptyTitle="No verification attempts" />
      </Card>
    </>
  );
}
