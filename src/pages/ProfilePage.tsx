import { useAuthorization } from '@/auth/authorization';
import { findRole } from '@/domain/roles';
import { Pencil } from 'lucide-react';
import { Avatar, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { useSession, useStore } from '@/store/AppStore';

export function ProfilePage() {
  const { admin, organization } = useSession();
  const { state } = useStore();
  const { record } = useAuthorization();
  return (
    <>
      <PageHeader
        title="My Profile"
        description="Your administrator details."
        actions={<PlannedButton icon={<Pencil className="h-4 w-4" />} info={PLANNED.profile}>Edit profile</PlannedButton>}
      />
      <Card className="max-w-3xl">
        <CardHeader
          title={<span className="flex items-center gap-3"><Avatar name={admin.name} initials={admin.initials} />{admin.name}</span>}
        />
        <CardBody>
          <DescriptionList items={[
            { label: 'Name', value: admin.name },
            { label: 'Email', value: admin.email },
            { label: 'Roles', value: record ? <span className="flex flex-wrap gap-1">{record.roleIds.map((id) => <Badge key={id} tone="brand">{findRole(state.data.customRoles ?? [], organization.id, id)?.name ?? 'Unknown role'}</Badge>)}</span> : '—' },
            { label: 'Organization', value: organization.name },
          ]} />
        </CardBody>
      </Card>
    </>
  );
}
