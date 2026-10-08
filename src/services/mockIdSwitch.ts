import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import type { CanonicalIdentity } from '@/domain/types';
import { simulateLatency } from './latency';
import type { IdSwitchService } from './types';

/**
 * Mock ID Switch adapter. The registry is owned by "ID Switch", not by FixID state,
 * which is why it lives here rather than in the app store.
 */
export function createMockIdSwitch(): IdSwitchService {
  const registry: CanonicalIdentity[] = buildIdSwitchRegistry();
  const byId = new Map(registry.map((r) => [r.idSwitchId, r]));
  return {
    async getIdentity(idSwitchId) {
      await simulateLatency();
      return byId.get(idSwitchId) ?? null;
    },
    async searchIdentities(query, limit = 10) {
      await simulateLatency();
      const q = query.trim().toLowerCase();
      if (q.length < 2) return [];
      return registry
        .filter((r) =>
          `${r.givenName} ${r.familyName}`.toLowerCase().includes(q) ||
          r.email.includes(q) ||
          r.idSwitchId.toLowerCase().includes(q) ||
          r.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')),
        )
        .slice(0, limit);
    },
    async checkHealth(org) {
      const latencyMs = await simulateLatency();
      const ok = org.integrations.idSwitch.connected;
      return {
        ok,
        latencyMs,
        message: ok
          ? `Connected to tenant ${org.integrations.idSwitch.tenantRef}. ${registry.length} canonical identities reachable (simulated).`
          : 'No ID Switch tenant is linked to this organization.',
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
