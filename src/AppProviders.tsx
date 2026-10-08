import type { ReactNode } from 'react';
import { PlannedFeatureProvider } from './components/domain/PlannedFeature';
import { ToastProvider } from './components/ui';
import type { Services } from './services/types';
import { ServicesProvider } from './services/ServicesProvider';
import { AppStoreProvider } from './store/AppStore';
import type { AppState } from './store/state';

export function AppProviders({ children, initialState, services }: { children: ReactNode; initialState?: AppState; services?: Services }) {
  return (
    <ServicesProvider services={services}>
      <AppStoreProvider initialState={initialState}>
        <ToastProvider>
          <PlannedFeatureProvider>{children}</PlannedFeatureProvider>
        </ToastProvider>
      </AppStoreProvider>
    </ServicesProvider>
  );
}
