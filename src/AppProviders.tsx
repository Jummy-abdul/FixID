import type { ReactNode } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import type { AuthSession } from './auth/authCore';
import { PlannedFeatureProvider } from './components/domain/PlannedFeature';
import { ToastProvider } from './components/ui';
import type { Services } from './services/types';
import { ServicesProvider } from './services/ServicesProvider';
import { AppStoreProvider } from './store/AppStore';
import type { AppState } from './store/state';

export function AppProviders({ children, initialState, services, authSession }: {
  children: ReactNode;
  initialState?: AppState;
  services?: Services;
  /** Overrides the stored sign-in session (used by tests). */
  authSession?: AuthSession | null;
}) {
  return (
    <ServicesProvider services={services}>
      <AppStoreProvider initialState={initialState}>
        <AuthProvider initialSession={authSession}>
          <ToastProvider>
            <PlannedFeatureProvider>{children}</PlannedFeatureProvider>
          </ToastProvider>
        </AuthProvider>
      </AppStoreProvider>
    </ServicesProvider>
  );
}
