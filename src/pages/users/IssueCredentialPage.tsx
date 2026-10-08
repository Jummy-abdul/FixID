import { useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, UserRound } from 'lucide-react';
import { ButtonLink, PageHeader } from '@/components/ui';
import { IssueCredentialFlow } from '@/components/issuance/IssueCredentialFlow';
import { useOrgData } from '@/store/AppStore';
import { NotFoundPage } from '../NotFoundPage';

/** Issue a credential to an existing user, using the same issuance experience as Add user. */
export function IssueCredentialPage() {
  const { personId } = useParams();
  const { memberById } = useOrgData();
  const navigate = useNavigate();
  const member = personId ? memberById.get(personId) : undefined;
  if (!member) return <NotFoundPage entity="user" backTo="/users" />;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Users', to: '/users' }, { label: member.displayName, to: `/users/${member.id}` }, { label: 'Issue credential' }]}
        title="Issue credential" />
      <IssueCredentialFlow key={member.id} memberId={member.id} onCancel={() => navigate(`/users/${member.id}`)}
        issuedActions={() => (
          <>
            <ButtonLink to={`/users/${member.id}`} variant="primary" icon={<UserRound className="h-4 w-4" />}>View user</ButtonLink>
            <ButtonLink to="/" variant="ghost" icon={<LayoutDashboard className="h-4 w-4" />}>Return to dashboard</ButtonLink>
          </>
        )} />
    </>
  );
}
