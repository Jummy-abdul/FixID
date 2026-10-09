import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import type { CanonicalIdentity } from '@/domain/types';
import { simulateLatency } from './latency';
import { IdSwitchUnavailableError, type IdSwitchService, type IdentityQuery, type ResolutionResult } from './types';

/** Simulated ID Switch storage. Separate from FixID's own state: ID Switch owns these records. */
export const ID_SWITCH_STORAGE_KEY = 'fixid.mock.idswitch';

interface MockStore { created: CanonicalIdentity[]; outage: boolean }

function load(): MockStore {
  try {
    const raw = window.localStorage.getItem(ID_SWITCH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockStore;
      if (Array.isArray(parsed.created)) return { created: parsed.created, outage: !!parsed.outage };
    }
  } catch {
    /* fall through to an empty store */
  }
  return { created: [], outage: false };
}

function save(store: MockStore) {
  try {
    window.localStorage.setItem(ID_SWITCH_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable: simulation continues in memory */
  }
}

export const normalizeEmail = (v?: string) => (v ?? '').trim().toLowerCase();
/** Compares the last 10 digits so +234 803… and 0803… are the same number. */
export const normalizePhone = (v?: string) => (v ?? '').replace(/\D/g, '').slice(-10);
const normalizeName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

/** Pure matching rules, exported for tests. Strong keys are email and phone; names alone are never enough to link. */
export function matchIdentity(query: IdentityQuery, identities: CanonicalIdentity[]): ResolutionResult {
  const email = normalizeEmail(query.email);
  const phone = normalizePhone(query.phone);
  const byEmail = email ? identities.filter((i) => normalizeEmail(i.email) === email) : [];
  const byPhone = phone.length >= 7 ? identities.filter((i) => normalizePhone(i.phone) === phone) : [];
  const strong = new Map<string, CanonicalIdentity>();
  for (const i of [...byEmail, ...byPhone]) strong.set(i.idSwitchId, i);

  const sameName = (i: CanonicalIdentity) =>
    normalizeName(i.givenName) === normalizeName(query.givenName) && normalizeName(i.familyName) === normalizeName(query.familyName);

  if (strong.size > 1) return { kind: 'conflict', field: 'email-and-phone' };
  if (strong.size === 1) {
    const identity = [...strong.values()][0];
    if (!sameName(identity)) return { kind: 'conflict', field: byEmail.length ? 'email' : 'phone' };
    const matchedOn: ('email' | 'phone')[] = [];
    if (byEmail.length) matchedOn.push('email');
    if (byPhone.length) matchedOn.push('phone');
    return { kind: 'match', identity, matchedOn };
  }
  const candidates = identities.filter(sameName).slice(0, 5);
  return candidates.length ? { kind: 'possible', candidates } : { kind: 'none' };
}

/**
 * Mock ID Switch adapter. The seeded registry is deterministic; identities "created" through FixID
 * are kept in the simulation's own storage. No live ID Switch integration exists.
 */
export function createMockIdSwitch(): IdSwitchService {
  const registry: CanonicalIdentity[] = buildIdSwitchRegistry();
  let store = load();
  const all = () => [...registry, ...store.created];
  const ensureAvailable = () => { if (store.outage) throw new IdSwitchUnavailableError(); };

  return {
    async getIdentity(idSwitchId) {
      await simulateLatency();
      ensureAvailable();
      return all().find((r) => r.idSwitchId === idSwitchId) ?? null;
    },
    async getContacts(idSwitchIds) {
      await simulateLatency();
      ensureAvailable();
      const wanted = new Set(idSwitchIds);
      return new Map(all().filter((r) => wanted.has(r.idSwitchId)).map((r) => [r.idSwitchId, { email: r.email, phone: r.phone }]));
    },
    async searchIdentities(query, limit = 10) {
      await simulateLatency();
      const q = query.trim().toLowerCase();
      if (q.length < 2) return [];
      return all()
        .filter((r) =>
          `${r.givenName} ${r.familyName}`.toLowerCase().includes(q) ||
          r.email.includes(q) ||
          r.idSwitchId.toLowerCase().includes(q) ||
          r.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')),
        )
        .slice(0, limit);
    },
    async resolveIdentity(query) {
      await simulateLatency();
      ensureAvailable();
      return matchIdentity(query, all());
    },
    async createIdentity(query) {
      await simulateLatency();
      ensureAvailable();
      const check = matchIdentity(query, all());
      if (check.kind === 'match' || check.kind === 'conflict') {
        throw new Error('This email address or phone number already belongs to another person.');
      }
      const n = registry.length + store.created.length + 1;
      const identity: CanonicalIdentity = {
        idSwitchId: `IDS-${(482100 + n * 37).toString().padStart(7, '0')}`,
        givenName: query.givenName.trim(),
        familyName: query.familyName.trim(),
        email: normalizeEmail(query.email),
        phone: (query.phone ?? '').trim(),
        ...(query.gender ? { gender: query.gender } : {}),
        ...(query.country ? { country: query.country } : {}),
        ...(query.region ? { region: query.region } : {}),
        dateOfBirth: '',
        nationality: '',
        verificationLevel: 'basic',
        linkedProducts: [],
      };
      store = { ...store, created: [...store.created, identity] };
      save(store);
      return identity;
    },
    async checkHealth(org) {
      const latencyMs = await simulateLatency();
      const ok = org.integrations.idSwitch.connected && !store.outage;
      return {
        ok,
        latencyMs,
        message: store.outage
          ? 'The identity service is unavailable. Adding users will fail until it is back.'
          : ok
            ? `Connected to tenant ${org.integrations.idSwitch.tenantRef}.`
            : 'No identity service tenant is linked to this organization.',
        checkedAt: new Date().toISOString(),
      };
    },
    simulation: {
      isOutage: () => store.outage,
      setOutage(on) {
        store = { ...store, outage: on };
        save(store);
      },
      reset() {
        store = { created: [], outage: false };
        save(store);
      },
    },
  };
}
