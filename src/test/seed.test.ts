import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import { buildSeed } from '@/data/seed';
import { METHOD_ASSURANCE, meetsAssurance } from '@/domain/rules';

const NOW = new Date('2026-10-08T12:00:00Z');
const seed = buildSeed(NOW);

describe('demo seed: connected data model', () => {
  it('is deterministic for a given point in time', () => {
    expect(JSON.stringify(buildSeed(NOW))).toEqual(JSON.stringify(seed));
  });

  it('covers multiple industries', () => {
    expect(new Set(seed.organizations.map((o) => o.industry)).size).toBeGreaterThanOrEqual(3);
  });

  it('gives every organization exactly one default card design, referenced by the org', () => {
    for (const org of seed.organizations) {
      const defaults = seed.cardDesigns.filter((d) => d.organizationId === org.id && d.isDefault);
      expect(defaults).toHaveLength(1);
      expect(org.defaultCardDesignId).toBe(defaults[0].id);
    }
  });

  it('keeps every reference inside the same organization', () => {
    const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
    const members = byId(seed.members);
    const types = byId(seed.credentialTypes);
    const creds = byId(seed.credentials);
    const activities = byId(seed.activities);
    const designs = byId(seed.cardDesigns);
    for (const t of seed.credentialTypes) expect(designs.get(t.cardDesignId)?.organizationId).toBe(t.organizationId);
    for (const c of seed.credentials) {
      expect(members.get(c.memberId)?.organizationId).toBe(c.organizationId);
      expect(types.get(c.credentialTypeId)?.organizationId).toBe(c.organizationId);
    }
    for (const a of seed.activities) {
      for (const id of a.eligibility.credentialTypeIds) expect(types.get(id)?.organizationId).toBe(a.organizationId);
    }
    for (const t of seed.transactions) {
      expect(activities.get(t.activityId)?.organizationId).toBe(t.organizationId);
      if (t.credentialId) expect(creds.get(t.credentialId)?.organizationId).toBe(t.organizationId);
      if (t.memberId) expect(members.get(t.memberId)?.organizationId).toBe(t.organizationId);
    }
  });

  it('generates unique identifiers per credential type', () => {
    const ids = seed.credentials.map((c) => c.identifier);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of seed.credentialTypes) {
      const issued = seed.credentials.filter((c) => c.credentialTypeId === t.id).length;
      expect(t.identifier.nextSequence).toBe(issued + 1);
    }
  });
});

describe('demo seed: ID Switch boundary', () => {
  const registry = new Set(buildIdSwitchRegistry().map((r) => r.idSwitchId));

  it('references a resolvable ID Switch identity for every member', () => {
    for (const m of seed.members) expect(registry.has(m.idSwitchId)).toBe(true);
  });

  it('does not copy canonical identity attributes into FixID state', () => {
    const json = JSON.stringify(seed.members);
    expect(json).not.toMatch(/dateOfBirth|"email"|"phone"|nationality/);
  });

  it('reuses one canonical identity across organizations without duplicating it', () => {
    const orgsPerIdentity = new Map<string, Set<string>>();
    for (const m of seed.members) {
      if (!orgsPerIdentity.has(m.idSwitchId)) orgsPerIdentity.set(m.idSwitchId, new Set());
      orgsPerIdentity.get(m.idSwitchId)!.add(m.organizationId);
    }
    expect([...orgsPerIdentity.values()].some((s) => s.size > 1)).toBe(true);
    for (const org of seed.organizations) {
      const ids = seed.members.filter((m) => m.organizationId === org.id).map((m) => m.idSwitchId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('demo seed: PRD trust rules', () => {
  const activities = new Map(seed.activities.map((a) => [a.id, a]));

  it('never lets a fallback downgrade the required assurance level', () => {
    for (const t of seed.transactions.filter((x) => x.fallbackUsed)) {
      const a = activities.get(t.activityId)!;
      expect(a.fallback.permitted).toBe(true);
      expect(meetsAssurance(METHOD_ASSURANCE[t.method], a.assuranceLevel)).toBe(true);
    }
  });

  it('only allows when verification succeeded', () => {
    for (const t of seed.transactions.filter((x) => x.decision === 'allow')) {
      expect(t.result).toBe('success');
      expect(t.memberId).not.toBeNull();
    }
  });

  it('never treats an indeterminate outcome as an allow', () => {
    const indeterminate = seed.transactions.filter((x) => x.decision === 'indeterminate');
    expect(indeterminate.length).toBeGreaterThan(0);
    for (const t of indeterminate) expect(t.reason).toMatch(/not granted/i);
  });

  it('records denials of verified people as authorization failures, not verification failures', () => {
    expect(seed.transactions.some((t) => t.result === 'success' && t.decision === 'deny')).toBe(true);
  });

  it('only records transactions for active activities', () => {
    for (const t of seed.transactions) expect(activities.get(t.activityId)?.status).toBe('active');
  });
});
