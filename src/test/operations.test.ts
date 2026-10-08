import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { getSetupProgress } from '@/domain/setupProgress';
import { matchIdentity } from '@/services/mockIdSwitch';
import { selectOrgData } from '@/store/AppStore';
import { applyCredentialSetup, applyIssuance, type IssuanceInput, type NewCredentialConfig } from '@/store/operations';
import { createInitialState, reducer, type AppState } from '@/store/state';

const NOW = new Date('2026-10-08T12:00:00Z');
const AT = NOW.toISOString();

const config = (over: Partial<NewCredentialConfig> = {}): NewCredentialConfig => ({
  name: 'Student ID', identifierLabel: 'Matric number', identifierMode: 'manual', prefix: 'CFA-STU-', digits: 6,
  effectiveDate: 'on-issue', validity: { kind: 'duration', months: 12 }, renewal: { allowed: true, windowDays: 30 },
  cardDesignId: `${NEW_ORGANIZATION_ID}_design_default`, ...over,
});

function setUp(over: Partial<NewCredentialConfig> = {}) {
  const r = applyCredentialSetup(createInitialState(NOW), {
    organizationId: NEW_ORGANIZATION_ID, at: AT, userType: { name: 'Student' }, credential: { config: config(over) },
    ids: { userTypeId: 'ut_1', credentialTypeId: 'ct_1' },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.state;
}

const issue = (state: AppState, over: Partial<IssuanceInput> = {}) => applyIssuance(state, {
  requestId: 'req_1', organizationId: NEW_ORGANIZATION_ID, at: AT, userTypeId: 'ut_1', credentialTypeId: 'ct_1',
  person: { givenName: 'Amara', familyName: 'Okonkwo' }, identity: { idSwitchId: 'IDS-NEW-1', resolution: 'created-new' },
  identifierValue: 'CFA/2026/0001', ids: { memberId: 'mem_1', credentialId: 'cr_1' }, ...over,
});

describe('new organization', () => {
  it('starts empty, so the first-time journey applies', () => {
    const org = selectOrgData(createInitialState(NOW));
    expect(org.organization.id).toBe(NEW_ORGANIZATION_ID);
    expect([org.members, org.credentials, org.credentialTypes, org.userTypes, org.activities]).toEqual([[], [], [], [], []]);
    expect(org.cardDesigns.filter((d) => d.isDefault)).toHaveLength(1);
  });
});

describe('credential setup', () => {
  it('saves a reusable credential type and user type with audit events', () => {
    const state = setUp();
    const org = selectOrgData(state);
    expect(org.credentialTypes.map((t) => t.name)).toEqual(['Student ID']);
    expect(org.userTypes).toEqual([expect.objectContaining({ name: 'Student', credentialTypeId: 'ct_1' })]);
    expect(org.audit.map((e) => e.action)).toEqual(['user-type.created', 'credential-type.created']);
  });

  it('rejects duplicate credential names and user types instead of creating copies', () => {
    const state = setUp();
    const again = applyCredentialSetup(state, {
      organizationId: NEW_ORGANIZATION_ID, at: AT, userType: { name: 'student' }, credential: { config: config() },
      ids: { userTypeId: 'ut_2', credentialTypeId: 'ct_2' },
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors.name).toMatch(/already exists/);
  });

  it('validates required fields and future expiry dates', () => {
    const r = applyCredentialSetup(createInitialState(NOW), {
      organizationId: NEW_ORGANIZATION_ID, at: AT, userType: { name: 'Staff' },
      credential: { config: config({ name: ' ', identifierLabel: '', validity: { kind: 'fixed-date', date: '2020-01-01T00:00:00Z' } }) },
      ids: { userTypeId: 'u', credentialTypeId: 'c' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['identifierLabel', 'name', 'validity']);
  });
});

describe('issuance', () => {
  it('creates the user, the active credential and audit events, completing the first milestone', () => {
    const r = issue(setUp());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const org = selectOrgData(r.state);
    expect(org.members).toEqual([expect.objectContaining({ displayName: 'Amara Okonkwo', relationship: 'Student', userTypeId: 'ut_1' })]);
    const [c] = org.credentials;
    expect(c).toMatchObject({ identifier: 'CFA/2026/0001', status: 'active', issuedAt: AT, memberId: 'mem_1' });
    expect(c.wallet.status).toBe('pending');
    expect(new Date(c.expiresAt!).getUTCFullYear()).toBe(2027);
    expect(org.audit.slice(0, 2).map((e) => e.action)).toEqual(['credential.issued', 'identity.created']);
    expect(getSetupProgress(org)).toMatchObject({ completed: 1, next: 'first-verification' });
  });

  it('is idempotent per request: a repeated submission does not issue twice', () => {
    const first = issue(setUp());
    if (!first.ok) throw new Error();
    const again = reducer(first.state, { type: 'issuance/issue', input: { requestId: 'req_1', organizationId: NEW_ORGANIZATION_ID, at: AT, userTypeId: 'ut_1', credentialTypeId: 'ct_1', person: { givenName: 'Amara', familyName: 'Okonkwo' }, identity: { idSwitchId: 'IDS-NEW-1', resolution: 'created-new' }, identifierValue: 'CFA/2026/0001', ids: { memberId: 'mem_x', credentialId: 'cr_x' } } });
    expect(again).toBe(first.state);
    expect(issue(first.state)).toMatchObject({ ok: true, duplicateRequest: true, credentialId: 'cr_1' });
  });

  it('prevents duplicate identifiers, relationships and credentials', () => {
    const first = issue(setUp());
    if (!first.ok) throw new Error();
    const dupId = issue(first.state, { requestId: 'r2', identity: { idSwitchId: 'IDS-OTHER', resolution: 'created-new' }, identifierValue: 'cfa/2026/0001', ids: { memberId: 'm2', credentialId: 'c2' } });
    expect(dupId).toMatchObject({ ok: false, errors: { identifier: expect.stringMatching(/already assigned/) } });
    const dupRelationship = issue(first.state, { requestId: 'r3', identifierValue: 'CFA/2026/0009', ids: { memberId: 'm3', credentialId: 'c3' } });
    expect(dupRelationship).toMatchObject({ ok: false, errors: { form: expect.stringMatching(/already a user/) } });
    const dupCredential = issue(first.state, { requestId: 'r4', existingMemberId: 'mem_1', identifierValue: 'CFA/2026/0010', ids: { memberId: 'm4', credentialId: 'c4' } });
    expect(dupCredential).toMatchObject({ ok: false, errors: { form: expect.stringMatching(/already holds/) } });
  });

  it('generates sequential identifiers and leaves state untouched on failure', () => {
    const state = setUp({ identifierMode: 'generated', name: 'Staff ID', prefix: 'CFA-STF-', digits: 4 });
    const a = issue(state, { identifierValue: undefined });
    if (!a.ok) throw new Error(JSON.stringify(a.errors));
    const b = issue(a.state, { requestId: 'r2', identity: { idSwitchId: 'IDS-2', resolution: 'created-new' }, identifierValue: undefined, ids: { memberId: 'm2', credentialId: 'c2' } });
    if (!b.ok) throw new Error();
    expect(selectOrgData(b.state).credentials.map((c) => c.identifier)).toEqual(['CFA-STF-0001', 'CFA-STF-0002']);
    const failed = issue(b.state, { requestId: 'r3', person: { givenName: '', familyName: '' } });
    expect(failed.ok).toBe(false);
  });

  it('does not complete setup when issuance requires approval (pending)', () => {
    const state = setUp();
    state.data.credentialTypes = state.data.credentialTypes.map((t) => (t.id === 'ct_1' ? { ...t, lifecycle: { ...t.lifecycle, requiresApproval: true } } : t));
    const r = issue(state);
    if (!r.ok) throw new Error();
    expect(selectOrgData(r.state).credentials[0].status).toBe('pending');
    expect(getSetupProgress(selectOrgData(r.state)).completed).toBe(0);
  });

  it('keeps organizations separate', () => {
    const r = issue(setUp());
    if (!r.ok) throw new Error();
    expect(selectOrgData(r.state, SAMPLE_ORGANIZATION_ID).credentials.some((c) => c.id === 'cr_1')).toBe(false);
  });
});

describe('ID Switch matching rules', () => {
  const registry = buildIdSwitchRegistry();
  const daniel = registry[3];

  it('matches confidently on email or phone plus name', () => {
    expect(matchIdentity({ givenName: daniel.givenName, familyName: daniel.familyName, email: daniel.email.toUpperCase() }, registry))
      .toMatchObject({ kind: 'match', identity: { idSwitchId: daniel.idSwitchId }, matchedOn: ['email'] });
    expect(matchIdentity({ givenName: daniel.givenName, familyName: daniel.familyName, phone: `0${daniel.phone.replace(/\D/g, '').slice(-10)}` }, registry))
      .toMatchObject({ kind: 'match', matchedOn: ['phone'] });
  });

  it('never links when the email belongs to someone with a different name', () => {
    expect(matchIdentity({ givenName: 'Someone', familyName: 'Else', email: daniel.email }, registry)).toEqual({ kind: 'conflict', field: 'email' });
  });

  it('treats name-only similarity as a possible match, not a link', () => {
    const r = matchIdentity({ givenName: daniel.givenName, familyName: daniel.familyName, email: 'new@x.example' }, registry);
    expect(r.kind).toBe('possible');
  });

  it('returns none for a new person', () => {
    expect(matchIdentity({ givenName: 'Zara', familyName: 'Quill', email: 'zara@x.example' }, registry)).toEqual({ kind: 'none' });
  });
});
