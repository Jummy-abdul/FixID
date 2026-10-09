import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { RequirePermission } from './auth/authorization';
import {
  CreatePasswordPage, ForgotPasswordPage, PublicOnly, RequireApp, RequireOnboarding, SignInPage, SignUpPage, VerifyEmailPage,
} from './pages/auth/AuthPages';
import { OnboardingOrganizationPage, OnboardingPersonalPage } from './pages/auth/OnboardingPages';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { ActivityDetailPage } from './pages/ActivityDetailPage';
import { AuditPage } from './pages/AuditPage';
import { CardDesignsPage } from './pages/CardDesignsPage';
import { CredentialConfigDetailPage } from './pages/credentials/CredentialConfigDetailPage';
import { CredentialsLandingPage } from './pages/credentials/CredentialsLandingPage';
import { IssuedCredentialDetailPage } from './pages/credentials/IssuedCredentialDetailPage';
import { IssuedCredentialsPage } from './pages/credentials/IssuedCredentialsPage';
import { CredentialTypesPage } from './pages/CredentialTypesPage';
import { AddUserEntryPage } from './pages/users/AddUserEntryPage';
import { ManualAddUserPage } from './pages/users/add/ManualAddUserPage';
import { AssignCredentialPage } from './pages/credentials/AssignCredentialPage';
import { assignUrl } from './components/issuance/assignment';
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
/** Issuing from a user's page continues in Credential Management with that user preselected. */
function UserIssueRedirect() {
  const { personId = '' } = useParams();
  return <Navigate to={assignUrl({ recipientIds: [personId], from: 'user' })} replace />;
}

/** Credential configurations moved from Templates to Credentials. */
function ConfigRedirect() {
  const { typeId = '' } = useParams();
  return <Navigate to={`/credentials/configurations/${typeId}`} replace />;
}

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
      <Route element={<PublicOnly />}>
        <Route path="signin" element={<SignInPage />} />
        <Route path="signup" element={<SignUpPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="create-password" element={<CreatePasswordPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route element={<RequireOnboarding />}>
        <Route path="onboarding/personal" element={<OnboardingPersonalPage />} />
        <Route path="onboarding/organization" element={<OnboardingOrganizationPage />} />
      </Route>
      <Route element={<RequireApp />}>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<RequirePermission permission="users.view"><PeoplePage /></RequirePermission>} />
        <Route path="users/new" element={<RequirePermission permission="users.manage"><AddUserEntryPage /></RequirePermission>} />
        <Route path="users/new/manual" element={<RequirePermission permission="users.manage"><ManualAddUserPage /></RequirePermission>} />
        <Route path="users/:personId" element={<RequirePermission permission="users.view"><PersonDetailPage /></RequirePermission>} />
        <Route path="users/:personId/issue" element={<UserIssueRedirect />} />
        <Route path="groups" element={<RequirePermission permission="groups.view"><GroupsPage /></RequirePermission>} />
        <Route path="credentials" element={<RequirePermission permission="credentials.view"><CredentialsLandingPage /></RequirePermission>} />
        <Route path="credentials/issue" element={<RequirePermission permission="credentials.issue"><AssignCredentialPage /></RequirePermission>} />
        <Route path="credentials/issued" element={<RequirePermission permission="credentials.view"><IssuedCredentialsPage /></RequirePermission>} />
        <Route path="credentials/configurations/:typeId" element={<RequirePermission permission="credentials.view"><CredentialConfigDetailPage /></RequirePermission>} />
        <Route path="credentials/:credentialId" element={<RequirePermission permission="credentials.view"><IssuedCredentialDetailPage /></RequirePermission>} />
        <Route path="templates" element={<RequirePermission permission="credentials.view"><CardDesignsPage /></RequirePermission>} />
        <Route path="templates/credential-types" element={<RequirePermission permission="credentials.view"><CredentialTypesPage /></RequirePermission>} />
        <Route path="templates/identifiers" element={<RequirePermission permission="credentials.view"><IdentifiersPage /></RequirePermission>} />
        <Route path="templates/credential-types/:typeId" element={<ConfigRedirect />} />
        <Route path="activities" element={<RequirePermission permission="verification.activities.view"><ActivitiesPage /></RequirePermission>} />
        <Route path="activities/:activityId" element={<RequirePermission permission="verification.activities.view"><ActivityDetailPage /></RequirePermission>} />
        <Route path="verification-history" element={<RequirePermission permission="verification.results.view"><TransactionsPage /></RequirePermission>} />
        <Route path="verification-history/:transactionId" element={<RequirePermission permission="verification.results.view"><TransactionDetailPage /></RequirePermission>} />
        <Route path="audit" element={<RequirePermission permission="audit.view"><AuditPage /></RequirePermission>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {RENAMED.flatMap(([from, to]) => [
          <Route key={from} path={from} element={<RenamedRoute to={to} />} />,
          <Route key={`${from}/:id`} path={`${from}/:id`} element={<RenamedRoute to={to} />} />,
        ])}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      </Route>
    </Routes>
  );
}
