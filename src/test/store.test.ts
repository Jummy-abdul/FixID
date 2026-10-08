import { loadState, saveState } from '@/store/persistence';
import { selectOrgData } from '@/store/AppStore';
import { createInitialState, reducer, STATE_VERSION, STORAGE_KEY } from '@/store/state';

const NOW = new Date('2026-10-08T12:00:00Z');

describe('reducer', () => {
  it('scopes all data to the current organization and re-scopes on switch', () => {
    const s0 = createInitialState(NOW);
    const before = selectOrgData(s0);
    expect(before.members.every((m) => m.organizationId === s0.session.currentOrganizationId)).toBe(true);
    const target = s0.data.organizations[1].id;
    const s1 = reducer(s0, { type: 'session/switchOrganization', organizationId: target });
    const after = selectOrgData(s1);
    expect(after.organization.id).toBe(target);
    for (const list of [after.members, after.credentials, after.activities, after.transactions, after.audit, after.credentialTypes]) {
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((x) => x.organizationId === target)).toBe(true);
    }
  });

  it('ignores switching to an organization the admin cannot access', () => {
    const s0 = createInitialState(NOW);
    expect(reducer(s0, { type: 'session/switchOrganization', organizationId: 'org_unknown' })).toBe(s0);
  });

  it('updates the organization profile and appends an audit event', () => {
    const s0 = createInitialState(NOW);
    const org = s0.data.organizations[0];
    const s1 = reducer(s0, {
      type: 'organization/updateProfile', organizationId: org.id, at: NOW.toISOString(),
      changes: { name: 'Northbridge University of Technology', shortName: org.shortName, industry: org.industry, country: org.country, timezone: org.timezone, contactEmail: org.contactEmail, memberLabel: org.memberLabel },
    });
    expect(s1.data.organizations[0].name).toBe('Northbridge University of Technology');
    expect(s1.data.audit[0]).toMatchObject({ action: 'organization.updated', organizationId: org.id, result: 'success' });
    expect(s1.data.audit[0].summary).toContain('name');
    expect(s1.data.audit.length).toBe(s0.data.audit.length + 1);
    // Other organizations untouched
    expect(s1.data.organizations[1]).toBe(s0.data.organizations[1]);
  });

  it('is a no-op when nothing changed', () => {
    const s0 = createInitialState(NOW);
    const org = s0.data.organizations[0];
    const { name, shortName, industry, country, timezone, contactEmail, memberLabel } = org;
    const s1 = reducer(s0, { type: 'organization/updateProfile', organizationId: org.id, at: NOW.toISOString(), changes: { name, shortName, industry, country, timezone, contactEmail, memberLabel } });
    expect(s1).toBe(s0);
  });
});

describe('persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips state through localStorage', () => {
    const s = createInitialState(NOW);
    expect(saveState(s)).toBe(true);
    expect(loadState()).toEqual(s);
  });

  it('discards incompatible or corrupt state', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STATE_VERSION - 1, data: {} }));
    expect(loadState()).toBeNull();
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadState()).toBeNull();
  });
});
