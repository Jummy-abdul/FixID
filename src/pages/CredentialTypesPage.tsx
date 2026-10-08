import { Link } from 'react-router-dom';
import { CreditCard, Plus } from 'lucide-react';
import { Card, DataTable, EmptyState, PageHeader } from '@/components/ui';
import { TypeStatusBadge } from '@/components/domain/StatusBadges';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { TemplatesTabs } from '@/components/domain/TemplatesTabs';
import { EFFECTIVE_DATE_LABEL, validityLabel } from '@/domain/labels';
import { useServices } from '@/services/ServicesProvider';
import { useOrgData } from '@/store/AppStore';

export function CredentialTypesPage() {
  const { credentialTypes, credentials, cardDesignById } = useOrgData();
  const { issuance } = useServices();
  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable definitions for the credentials you issue: identifier format, effective date, validity, renewal and lifecycle rules."
        actions={<PlannedButton variant="primary" icon={<Plus className="h-4 w-4" />} info={PLANNED.credentialTypeEditor}>New credential type</PlannedButton>}
      />
      <TemplatesTabs />
      <Card>
        <DataTable
          rows={credentialTypes}
          rowKey={(t) => t.id}
          rowHref={(t) => `/templates/credential-types/${t.id}`}
          empty={<EmptyState icon={<CreditCard className="h-5 w-5" />} title="No credential types yet" description="Credential types can be created here or during the guided issuance journey." />}
          columns={[
            { key: 'name', header: 'Name', cell: (t) => <span><span className="block font-medium text-slate-900">{t.name}</span><span className="block max-w-xs truncate text-xs text-slate-500">{t.description}</span></span> },
            { key: 'next', header: 'Next identifier', cell: (t) => <span className="font-mono text-xs">{issuance.previewIdentifier(t)}</span> },
            { key: 'effective', header: 'Effective', cell: (t) => <span className="text-slate-600">{EFFECTIVE_DATE_LABEL[t.effectiveDate]}</span> },
            { key: 'validity', header: 'Validity', cell: (t) => <span className="text-slate-600">{validityLabel(t.validity)}</span> },
            { key: 'design', header: 'Card design', cell: (t) => <Link to="/templates" onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline">{cardDesignById.get(t.cardDesignId)?.name}</Link> },
            { key: 'issued', header: 'Issued', cell: (t) => <span className="tabular-nums">{credentials.filter((c) => c.credentialTypeId === t.id).length}</span> },
            { key: 'status', header: 'Status', cell: (t) => <TypeStatusBadge status={t.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
