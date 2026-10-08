import { buildSeed } from '@/data/seed';
import { getSetupProgress } from '@/domain/setupProgress';
import { previewData } from '@/pages/dashboard/preview';

const seed = buildSeed(new Date('2026-10-08T12:00:00Z'));
const org = (id: string) => {
  const f = <T extends { organizationId: string }>(xs: T[]) => xs.filter((x) => x.organizationId === id);
  return { members: f(seed.members), credentials: f(seed.credentials), activities: f(seed.activities), transactions: f(seed.transactions), audit: f(seed.audit) };
};
const nbu = org('org_northbridge');

describe('setup progress', () => {
  it('is empty for a new organization, with the first ID as next step', () => {
    expect(getSetupProgress({ credentials: [], activities: [] })).toMatchObject({ completed: 0, next: 'first-id', isComplete: false });
  });

  it('does not count users alone, pending issuance or draft activities', () => {
    const pending = { ...nbu.credentials[0], status: 'pending' as const };
    const draft = { ...nbu.activities[0], status: 'draft' as const };
    expect(getSetupProgress({ credentials: [pending], activities: [draft] })).toMatchObject({ completed: 0, next: 'first-id' });
  });

  it('moves to verification once an ID is issued, and completes with a live activity', () => {
    const issued = { ...nbu.credentials[0], status: 'active' as const };
    expect(getSetupProgress({ credentials: [issued], activities: [] })).toMatchObject({ completed: 1, next: 'first-verification' });
    expect(getSetupProgress({ credentials: [issued], activities: [nbu.activities[0]] })).toMatchObject({ completed: 2, next: null, isComplete: true });
  });

  it('counts an issued credential even if wallet delivery failed', () => {
    const c = { ...nbu.credentials[0], status: 'active' as const, wallet: { status: 'failed' as const, updatedAt: '' } };
    expect(getSetupProgress({ credentials: [c], activities: [] }).completed).toBe(1);
  });
});

describe('dashboard preview data', () => {
  it('derives stages from real data without mutating it', () => {
    const snapshot = JSON.stringify(nbu);
    expect(previewData('first-time-new', nbu)).toEqual({ members: [], credentials: [], activities: [], transactions: [], audit: [] });
    const issued = previewData('first-time-issued', nbu);
    expect(issued.credentials).toHaveLength(1);
    expect(issued.credentials[0].status).not.toBe('pending');
    expect(issued.members.map((m) => m.id)).toEqual([issued.credentials[0].memberId]);
    expect(issued.activities).toHaveLength(0);
    expect(nbu.credentials).toContain(issued.credentials[0]);
    expect(JSON.stringify(nbu)).toBe(snapshot);
  });
});
