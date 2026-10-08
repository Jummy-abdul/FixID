import { Layers, Plus } from 'lucide-react';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';

export function GroupsPage() {
  return (
    <>
      <PageHeader
        title="Groups"
        description="Organize users into meaningful collections."
        meta={<Badge tone="violet">Planned</Badge>}
        actions={<PlannedButton variant="primary" icon={<Plus className="h-4 w-4" />} info={PLANNED.groups}>Create group</PlannedButton>}
      />
      <Card>
        <EmptyState
          icon={<Layers className="h-5 w-5" />}
          title="Groups are not available yet"
          description="Groups will let you organize users, for example by class, department or event cohort, and use those collections for issuance and verification eligibility. No groups have been created."
        />
      </Card>
    </>
  );
}
