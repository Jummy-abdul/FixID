import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreditCard, Plus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, PageHeader } from '@/components/ui';
import { CredentialSetup } from '@/components/config/CredentialSetup';
import { assignUrl } from '@/components/issuance/assignment';
import { TypeStatusBadge } from '@/components/domain/StatusBadges';
import { TemplatesTabs } from '@/components/domain/TemplatesTabs';
import { EFFECTIVE_DATE_LABEL, validityLabel } from '@/domain/labels';
import { useServices } from '@/services/ServicesProvider';
import { useOrgData } from '@/store/AppStore';

export function CredentialTypesPage() {
  const { credentialTypes, credentials, cardDesignById, identifierConfigById } = useOrgData();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const { issuance } = useServices();
  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable identifiers, credentials and designs."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setDrawerOpen(true)}>New credential type</Button>}
      />
      <TemplatesTabs />
      <Card>
        <DataTable
          rows={credentialTypes}
          rowKey={(t) => t.id}
          rowHref={(t) => `/templates/credential-types/${t.id}`}
          empty={<EmptyState icon={<CreditCard className="h-5 w-5" />} title="No credential types yet" description="Create a credential configuration here or from Credentials." />}
          columns={[
            { key: 'name', header: 'Name', cell: (t) => <span><span className="block font-medium text-slate-900">{t.name}</span><span className="block max-w-xs truncate text-xs text-slate-500">{t.description}</span></span> },
            { key: 'next', header: 'Identifier', cell: (t) => { if (t.identifierConfigId) return <span className="text-sm">{identifierConfigById.get(t.identifierConfigId)?.name}</span>; const next = issuance.previewIdentifier(t); return next ? <span className="font-mono text-xs">{next}</span> : <span className="text-xs text-slate-500">Entered per person</span>; } },
            { key: 'effective', header: 'Effective', cell: (t) => <span className="text-slate-600">{EFFECTIVE_DATE_LABEL[t.effectiveDate]}</span> },
            { key: 'validity', header: 'Validity', cell: (t) => <span className="text-slate-600">{validityLabel(t.validity)}</span> },
            { key: 'design', header: 'Card design', cell: (t) => <Link to="/templates" onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline">{cardDesignById.get(t.cardDesignId)?.name}</Link> },
            { key: 'issued', header: 'Issued', cell: (t) => <span className="tabular-nums">{credentials.filter((c) => c.credentialTypeId === t.id).length}</span> },
            { key: 'status', header: 'Status', cell: (t) => <TypeStatusBadge status={t.status} /> },
          ]}
        />
      </Card>
      <CredentialSetup open={drawerOpen} onClose={() => setDrawerOpen(false)}
        onAssign={(id) => navigate(assignUrl({ recipientIds: [], credentialTypeId: id, step: 'recipients' }))} onLater={() => undefined} />
    </>
  );
}
