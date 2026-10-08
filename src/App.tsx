import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { ActivityDetailPage } from './pages/ActivityDetailPage';
import { AuditPage } from './pages/AuditPage';
import { CardDesignsPage } from './pages/CardDesignsPage';
import { CredentialDetailPage } from './pages/CredentialDetailPage';
import { CredentialsPage } from './pages/CredentialsPage';
import { CredentialTypeDetailPage } from './pages/CredentialTypeDetailPage';
import { CredentialTypesPage } from './pages/CredentialTypesPage';
import { AddUserEntryPage } from './pages/users/AddUserEntryPage';
import { ManualAddUserPage } from './pages/users/add/ManualAddUserPage';
import { IssueCredentialPage } from './pages/users/IssueCredentialPage';
import { IdentifiersPage } from './pages/IdentifiersPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { GroupsPage } from './pages/GroupsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PeoplePage } from './pages/PeoplePage';
import { PersonDetailPage } from './pages/PersonDetailPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { TransactionDetailPage } from './pages/TransactionDetailPage';
import { TransactionsPage } from './pages/TransactionsPage';

/** Redirect a renamed route, keeping the `:id` param and query string (e.g. dashboard filters). */
function RenamedRoute({ to }: { to: string }) {
  const { id } = useParams();
  const { search, hash } = useLocation();
  return <Navigate replace to={`${id ? `${to}/${id}` : to}${search}${hash}`} />;
}

/** Previous paths kept working after the navigation rename. */
const RENAMED: [from: string, to: string][] = [
  ['people', '/users'],
  ['transactions', '/verification-history'],
  ['card-designs', '/templates'],
  ['credential-types', '/templates/credential-types'],
];

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<PeoplePage />} />
        <Route path="users/new" element={<AddUserEntryPage />} />
        <Route path="users/new/manual" element={<ManualAddUserPage />} />
        <Route path="users/:personId" element={<PersonDetailPage />} />
        <Route path="users/:personId/issue" element={<IssueCredentialPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="credentials" element={<CredentialsPage />} />
        <Route path="credentials/:credentialId" element={<CredentialDetailPage />} />
        <Route path="templates" element={<CardDesignsPage />} />
        <Route path="templates/credential-types" element={<CredentialTypesPage />} />
        <Route path="templates/identifiers" element={<IdentifiersPage />} />
        <Route path="templates/credential-types/:typeId" element={<CredentialTypeDetailPage />} />
        <Route path="activities" element={<ActivitiesPage />} />
        <Route path="activities/:activityId" element={<ActivityDetailPage />} />
        <Route path="verification-history" element={<TransactionsPage />} />
        <Route path="verification-history/:transactionId" element={<TransactionDetailPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {RENAMED.flatMap(([from, to]) => [
          <Route key={from} path={from} element={<RenamedRoute to={to} />} />,
          <Route key={`${from}/:id`} path={`${from}/:id`} element={<RenamedRoute to={to} />} />,
        ])}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
