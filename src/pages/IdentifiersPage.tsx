import { useState } from 'react';
import { Fingerprint, Plus } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, PageHeader } from '@/components/ui';
import { IdentifierDrawer } from '@/components/config/IdentifierDrawer';
import { TemplatesTabs } from '@/components/domain/TemplatesTabs';
import { describePattern, previewIdentifier } from '@/domain/identifierPattern';
import type { IdentifierConfig } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { useOrgData } from '@/store/AppStore';

/** Configuration management for identifiers, using the same drawer as Add user. */
export function IdentifiersPage() {
  const { organization, identifierConfigs, members, credentialTypes } = useOrgData();
  const [drawer, setDrawer] = useState<{ open: boolean; existing?: IdentifierConfig }>({ open: false });
  return (
    <>
      <PageHeader title="Templates" description="Reusable identifiers, credentials and designs."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setDrawer({ open: true })}>New identifier</Button>} />
      <TemplatesTabs />
      <Card>
        <DataTable
          rows={identifierConfigs}
          rowKey={(c) => c.id}
          empty={<EmptyState icon={<Fingerprint className="h-5 w-5" />} title="No identifiers yet"
            description="Identifiers like Matric Number or Staff ID are set up once, the first time you add a user." />}
          columns={[
            { key: 'name', header: 'Identifier', cell: (c) => <span className="font-medium text-slate-900">{c.name}</span> },
            { key: 'mode', header: 'Assignment', cell: (c) => <Badge tone={c.mode === 'manual' ? 'neutral' : 'brand'}>{c.mode === 'manual' ? 'Entered manually' : 'Generated'}</Badge> },
            { key: 'pattern', header: 'Pattern', cell: (c) => c.mode === 'manual' ? <span className="text-slate-400">—</span> : <span className="font-mono text-xs">{describePattern(c.segments)}</span> },
            { key: 'next', header: 'Next value', cell: (c) => c.mode === 'manual' ? <span className="text-slate-400">—</span> : <span className="font-mono text-xs">{previewIdentifier(c.segments, c.nextSequence, organization.timezone)}</span> },
            { key: 'users', header: 'Users', cell: (c) => <span className="tabular-nums">{members.filter((m) => m.identifier?.configId === c.id).length}</span> },
            { key: 'creds', header: 'Credentials', cell: (c) => credentialTypes.filter((t) => t.identifierConfigId === c.id).map((t) => t.name).join(', ') || <span className="text-slate-400">—</span> },
            { key: 'updated', header: 'Updated', cell: (c) => <span className="text-slate-500">{formatDate(c.updatedAt)}</span> },
            { key: 'edit', header: '', cell: (c) => <Button size="sm" variant="ghost" onClick={() => setDrawer({ open: true, existing: c })}>Edit<span className="sr-only"> {c.name}</span></Button> },
          ]}
        />
      </Card>
      <IdentifierDrawer open={drawer.open} existing={drawer.existing} onClose={() => setDrawer({ open: false })} onSaved={() => setDrawer({ open: false })} />
    </>
  );
}
