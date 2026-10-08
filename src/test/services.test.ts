import { buildSeed } from '@/data/seed';
import { invalidFallbacks } from '@/domain/rules';
import { createIssuanceService } from '@/services/issuance';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import { createMockWallet } from '@/services/mockWallet';

const seed = buildSeed(new Date('2026-10-08T12:00:00Z'));
const type = (id: string) => seed.credentialTypes.find((t) => t.id === id)!;

describe('credential issuance service', () => {
  const issuance = createIssuanceService();

  it('previews the next identifier from the type format', () => {
    const t = { ...type('org_northbridge_ct_student'), identifier: { label: 'ID number', mode: 'generated' as const, prefix: 'NBU-STU-', digits: 6, nextSequence: 42 } };
    expect(issuance.previewIdentifier(t)).toBe('NBU-STU-000042');
  });

  it('computes validity from effective date and duration rules', () => {
    const staff = type('org_northbridge_ct_staff'); // on-issue, 24 months
    const { effectiveFrom, expiresAt } = issuance.computeValidity(staff, new Date(2026, 9, 8));
    expect(effectiveFrom).toEqual(new Date(2026, 9, 8));
    expect(expiresAt).toEqual(new Date(2028, 9, 8));
  });

  it('starts "start-of-term" credentials at the next term start', () => {
    const student = type('org_northbridge_ct_student');
    expect(issuance.computeValidity(student, new Date(2026, 9, 8)).effectiveFrom).toEqual(new Date(2027, 0, 1));
  });

  it('returns no expiry for non-expiring types and no renewal window when renewal is off', () => {
    const library = type('org_northbridge_ct_library');
    expect(issuance.computeValidity(library, new Date()).expiresAt).toBeNull();
    const cred = seed.credentials.find((c) => c.credentialTypeId === library.id)!;
    expect(issuance.renewalOpensAt(library, cred)).toBeNull();
  });
});

describe('mock ID Switch', () => {
  const idSwitch = createMockIdSwitch();
  it('resolves identities by ID and searches by name', async () => {
    const member = seed.members[0];
    const identity = await idSwitch.getIdentity(member.idSwitchId);
    expect(`${identity?.givenName} ${identity?.familyName}`).toBe(member.displayName);
    const found = await idSwitch.searchIdentities(identity!.familyName);
    expect(found.some((f) => f.idSwitchId === member.idSwitchId)).toBe(true);
    expect(await idSwitch.getIdentity('IDS-NOPE')).toBeNull();
  });
  it('reports disconnected tenants as unhealthy', async () => {
    const org = { ...seed.organizations[0], integrations: { ...seed.organizations[0].integrations, idSwitch: { connected: false, tenantRef: '' } } };
    expect((await idSwitch.checkHealth(org)).ok).toBe(false);
  });
});

describe('mock wallet', () => {
  it('reflects issuer registration', async () => {
    const wallet = createMockWallet();
    const lts = seed.organizations.find((o) => o.id === 'org_lts')!;
    expect((await wallet.checkHealth(lts)).ok).toBe(false);
    expect((await wallet.checkHealth(seed.organizations[0])).ok).toBe(true);
  });
});

describe('assurance rules', () => {
  it('flags fallbacks that would downgrade assurance', () => {
    expect(invalidFallbacks(['nfc', 'qr'], 'substantial')).toEqual(['qr']);
    expect(invalidFallbacks(['fingerprint'], 'high')).toEqual([]);
  });
});
