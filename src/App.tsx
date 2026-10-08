import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { ActivityDetailPage } from './pages/ActivityDetailPage';
import { AuditPage } from './pages/AuditPage';
import { CardDesignsPage } from './pages/CardDesignsPage';
import { CredentialDetailPage } from './pages/CredentialDetailPage';
import { CredentialsPage } from './pages/CredentialsPage';
import { CredentialTypeDetailPage } from './pages/CredentialTypeDetailPage';
import { CredentialTypesPage } from './pages/CredentialTypesPage';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PeoplePage } from './pages/PeoplePage';
import { PersonDetailPage } from './pages/PersonDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransactionDetailPage } from './pages/TransactionDetailPage';
import { TransactionsPage } from './pages/TransactionsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="people/:personId" element={<PersonDetailPage />} />
        <Route path="credentials" element={<CredentialsPage />} />
        <Route path="credentials/:credentialId" element={<CredentialDetailPage />} />
        <Route path="activities" element={<ActivitiesPage />} />
        <Route path="activities/:activityId" element={<ActivityDetailPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="transactions/:transactionId" element={<TransactionDetailPage />} />
        <Route path="credential-types" element={<CredentialTypesPage />} />
        <Route path="credential-types/:typeId" element={<CredentialTypeDetailPage />} />
        <Route path="card-designs" element={<CardDesignsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
