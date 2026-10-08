import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui';
import { DigitalIdCard } from '@/components/domain/DigitalIdCard';
import { CredentialStatusBadge, TypeStatusBadge } from '@/components/domain/StatusBadges';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { EFFECTIVE_DATE_LABEL, validityLabel } from '@/domain/labels';
import type { CredentialStatus } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { useServices } from '@/services/ServicesProvider';
import { useOrgData } from '@/store/AppStore';
import { NotFoundPage } from './NotFoundPage';

export function CredentialTypeDetailPage() {
  const { typeId } = useParams();
  const { organization, credentialTypeById, credentials, cardDesignById, activities } = useOrgData();
  const { issuance } = useServices();
  const type = typeId ? credentialTypeById.get(typeId) : undefined;
  const preview = useMemo(() => (type ? issuance.computeValidity(type, new Date()) : null), [type, issuance]);
  if (!type || !preview) return <NotFoundPage entity="credential type" backTo="/templates/credential-types" />;

  const design = cardDesignById.get(type.cardDesignId)!;
  const issued = credentials.filter((c) => c.credentialTypeId === type.id);
  const byStatus = issued.reduce<Partial<Record<CredentialStatus, number>>>((m, c) => { m[c.status] = (m[c.status] ?? 0) + 1; return m; }, {});
  const usedBy = activities.filter((a) => a.eligibility.credentialTypeIds.includes(type.id));
  const nextId = issuance.previewIdentifier(type);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Templates', to: '/templates' }, { label: 'Credential Types', to: '/templates/credential-types' }, { label: type.name }]}
        title={type.name}
        description={type.description}
        meta={<TypeStatusBadge status={type.status} />}
        actions={<PlannedButton icon={<Pencil className="h-4 w-4" />} info={PLANNED.credentialTypeEditor}>Edit</PlannedButton>}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Rules" />
            <CardBody>
              <DescriptionList items={[
                { label: 'Identifier format', value: <span className="font-mono">{type.identifier.prefix}{'#'.repeat(type.identifier.digits)}</span>, hint: `Next: ${nextId}` },
                { label: 'Effective date', value: EFFECTIVE_DATE_LABEL[type.effectiveDate] },
                { label: 'Validity', value: validityLabel(type.validity) },
                { label: 'Renewal', value: type.renewal.allowed ? `Allowed, window opens ${type.renewal.windowDays} days before expiry` : 'Not renewable' },
                { label: 'Approval', value: type.lifecycle.requiresApproval ? 'Requires approval before activation' : 'Active on issue' },
                { label: 'Suspension', value: type.lifecycle.allowSuspension ? 'Allowed' : 'Not allowed' },
                { label: 'Auto-expire', value: type.lifecycle.autoExpire ? 'Yes' : 'No' },
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="If issued today" description="Calculated from the rules above by the issuance service" />
            <CardBody>
              <DescriptionList items={[
                { label: 'Identifier', value: <span className="font-mono">{nextId}</span> },
                { label: 'Effective from', value: type.effectiveDate === 'custom-date' ? 'Chosen by the issuer (defaults to today)' : formatDate(preview.effectiveFrom.toISOString()) },
                { label: 'Expires', value: preview.expiresAt ? formatDate(preview.expiresAt.toISOString()) : 'Does not expire' },
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Usage" />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {issued.length === 0 ? <span className="text-sm text-slate-500">Not issued yet.</span> :
                  (Object.entries(byStatus) as [CredentialStatus, number][]).map(([s, n]) => (
                    <Link key={s} to={`/credentials?type=${type.id}&status=${s}`} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50">
                      <CredentialStatusBadge status={s} /><span className="text-sm font-medium tabular-nums">{n}</span>
                    </Link>
                  ))}
              </div>
              <div>
                <p className="mb-1.5 text-sm text-slate-500">Accepted by verification activities</p>
                {usedBy.length === 0 ? <p className="text-sm text-slate-400">Not accepted by any activity yet.</p> : (
                  <div className="flex flex-wrap gap-1.5">
                    {usedBy.map((a) => <Link key={a.id} to={`/activities/${a.id}`}><Badge tone="brand">{a.name}</Badge></Link>)}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
        <Card className="h-fit lg:col-span-2">
          <CardHeader title="Card design" description={design.name} action={<Link to="/templates" className="text-sm font-medium text-brand-600 hover:text-brand-700">Designs</Link>} />
          <CardBody className="flex justify-center bg-slate-50/60 py-8">
            <DigitalIdCard design={design} organization={organization} content={{
              name: 'Sample Holder', identifier: nextId, credentialTypeName: type.name, relationship: organization.memberLabel,
              unit: 'Sample unit', expiresAt: preview.expiresAt?.toISOString() ?? null, issuedAt: new Date().toISOString(),
            }} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
