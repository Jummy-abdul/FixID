import { Link } from 'react-router-dom';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { FlippableCredentialCard } from '@/components/credentials/CredentialCard';
import { TemplatesTabs } from '@/components/domain/TemplatesTabs';
import { DEFAULT_TEMPLATE_ID, STARTER_TEMPLATES } from '@/domain/templates';
import { useOrgData } from '@/store/AppStore';

/** Starter templates and which credentials use them. Templates are chosen when creating a credential. */
export function CardDesignsPage() {
  const { organization, credentialTypes } = useOrgData();
  return (
    <>
      <PageHeader title="Templates" description="Starter designs for your digital IDs. Choose one when you create a credential." />
      <TemplatesTabs />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {STARTER_TEMPLATES.map((t) => {
          const usedBy = credentialTypes.filter((c) => c.templateId === t.id);
          return (
            <Card key={t.id}>
              <CardHeader title={<span className="flex items-center gap-2">{t.name}{t.id === DEFAULT_TEMPLATE_ID && <Badge tone="brand">Default</Badge>}</span>}
                description={`${t.orientation === 'landscape' ? 'Landscape' : 'Portrait'} · ${t.description}`} />
              <CardBody className="flex justify-center bg-slate-50/60 py-8">
                <FlippableCredentialCard templateId={t.id} organization={organization} label={`${t.name} side`}
                  content={{ credentialName: usedBy[0]?.name ?? 'Digital ID', holderName: 'Sample Holder', identifierLabel: 'ID number', identifierValue: 'ABC-00001', sample: true }} />
              </CardBody>
              <div className="border-t border-slate-100 px-5 py-3 text-sm">
                <span className="text-slate-500">Used by: </span>
                {usedBy.length === 0 ? <span className="text-slate-400">No credentials yet</span> :
                  usedBy.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Link to={`/credentials/configurations/${c.id}`} className="text-brand-700 hover:underline">{c.name}</Link></span>)}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
