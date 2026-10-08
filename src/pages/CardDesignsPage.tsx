import { Link } from 'react-router-dom';
import { Palette } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { DigitalIdCard } from '@/components/domain/DigitalIdCard';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { TemplatesTabs } from '@/components/domain/TemplatesTabs';
import { useOrgData } from '@/store/AppStore';

export function CardDesignsPage() {
  const { organization, cardDesigns, credentialTypes } = useOrgData();
  return (
    <>
      <PageHeader
        title="Templates"
        description="How your credentials look in Seamfix Wallet. Every organization starts with a default digital ID design."
        actions={<PlannedButton variant="primary" icon={<Palette className="h-4 w-4" />} info={PLANNED.cardDesignEditor}>Customize design</PlannedButton>}
      />
      <TemplatesTabs />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {cardDesigns.map((d) => {
          const usedBy = credentialTypes.filter((t) => t.cardDesignId === d.id);
          return (
            <Card key={d.id}>
              <CardHeader title={<span className="flex items-center gap-2">{d.name}{d.isDefault && <Badge tone="brand">Default</Badge>}</span>}
                description={`${d.layout === 'vertical' ? 'Portrait' : 'Landscape'} · ${d.fields.length} fields · ${d.showQr ? 'QR' : 'No QR'}${d.showPhoto ? ' · Photo' : ''}`} />
              <CardBody className="flex justify-center bg-slate-50/60 py-8">
                <DigitalIdCard design={d} organization={organization} content={{
                  name: 'Amara Okafor', identifier: `${usedBy[0]?.identifier.prefix ?? 'ID-'}000123`, credentialTypeName: usedBy[0]?.name ?? 'Digital ID',
                  relationship: organization.memberLabel, unit: 'Sample unit', expiresAt: new Date(Date.now() + 31536e6).toISOString(), issuedAt: new Date().toISOString(),
                }} />
              </CardBody>
              <div className="border-t border-slate-100 px-5 py-3 text-sm">
                <span className="text-slate-500">Used by: </span>
                {usedBy.length === 0 ? <span className="text-slate-400">No credential types</span> :
                  usedBy.map((t, i) => <span key={t.id}>{i > 0 && ', '}<Link to={`/templates/credential-types/${t.id}`} className="text-brand-700 hover:underline">{t.name}</Link></span>)}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
