import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createIssuanceService } from './issuance';
import { createMockEnrollment } from './mockEnrollment';
import { createMockIdSwitch } from './mockIdSwitch';
import { createMockWallet } from './mockWallet';
import { createBrowserGeolocation, createDefaultMaps } from './location';
import type { Services } from './types';

export function createDefaultServices(): Services {
  return {
    enrollment: createMockEnrollment(), idSwitch: createMockIdSwitch(), issuance: createIssuanceService(), wallet: createMockWallet(),
    maps: createDefaultMaps(), geolocation: createBrowserGeolocation(),
  };
}

const ServicesContext = createContext<Services | null>(null);

/** Swap `services` to point the prototype at real adapters without touching UI code. */
export function ServicesProvider({ children, services }: { children: ReactNode; services?: Services }) {
  const value = useMemo(() => services ?? createDefaultServices(), [services]);
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used inside ServicesProvider');
  return ctx;
}
