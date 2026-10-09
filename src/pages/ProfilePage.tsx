import { Pencil } from 'lucide-react';
import { Avatar, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { useSession } from '@/store/AppStore';

export function ProfilePage() {
  const { admin, organization } = useSession();
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
            { label: 'Role', value: <Badge tone="brand">{admin.role}</Badge> },
            { label: 'Organization', value: organization.name },
          ]} />
        </CardBody>
      </Card>
    </>
  );
}
