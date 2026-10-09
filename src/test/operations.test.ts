import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import { NEW_ORGANIZATION_ID, SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { generateIdentifier, previewIdentifier, renderPattern, validatePattern } from '@/domain/identifierPattern';
import { getSetupProgress } from '@/domain/setupProgress';
import type { IdentifierSegment } from '@/domain/types';
import { matchIdentity } from '@/services/mockIdSwitch';
import { selectOrgData } from '@/store/AppStore';
import {
  applyCreateUser, applyCredentialConfig, applyIdentifierConfig, applyIssuance, prepareCreateUser, type CreateUserInput,
} from '@/store/operations';
import { createInitialState, reducer, type AppState } from '@/store/state';

const NOW = new Date('2026-10-08T12:00:00Z');
const AT = NOW.toISOString();
const ORG = NEW_ORGANIZATION_ID;

const STU_PATTERN: IdentifierSegment[] = [
  { id: 's1', kind: 'static', value: 'STU' },
  { id: 's2', kind: 'separator', value: '/' },
  { id: 's3', kind: 'date', format: 'YYYY' },
  { id: 's4', kind: 'separator', value: '/' },
  { id: 's5', kind: 'sequence', start: 1, digits: 5, zeroPad: true },
];

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { errors: unknown }).errors));
  return r as Extract<T, { ok: true }>;
}

function withIdentifier(mode: 'manual' | 'generated' = 'generated', state = createInitialState(NOW)) {
  return ok(applyIdentifierConfig(state, { organizationId: ORG, at: AT, id: 'idc_1', name: 'Matric Number', mode, segments: mode === 'generated' ? STU_PATTERN : [] })).state;
}

const userInput = (over: Partial<CreateUserInput> = {}): CreateUserInput => ({
  requestId: 'req_u1', organizationId: ORG, at: AT, identifierConfigId: 'idc_1', person: { givenName: 'Amara', familyName: 'Okonkwo' },
  identity: { idSwitchId: 'IDS-NEW-1', resolution: 'created-new' }, memberId: 'mem_1', ...over,
});

function createUser(state: AppState, over: Partial<CreateUserInput> = {}) {
  const prepared = prepareCreateUser(state, userInput(over), () => 0.42);
  if (!prepared.ok) return prepared;
  return applyCreateUser(state, prepared.prepared);
}

function withCredential(state: AppState) {
  return ok(applyCredentialConfig(state, {
    organizationId: ORG, at: AT, id: 'ct_1', name: 'Student ID', identifierConfigId: 'idc_1', templateId: 'classic-landscape',
    effectiveDate: 'on-issue', validity: { kind: 'duration', months: 12 }, renewable: true,
  })).state;
}

describe('new organization', () => {
  it('starts with nothing configured', () => {
    const org = selectOrgData(createInitialState(NOW));
    expect(org.organization.id).toBe(ORG);
    expect([org.members, org.credentials, org.credentialTypes, org.identifierConfigs, org.activities]).toEqual([[], [], [], [], []]);
  });
});

describe('identifier patterns', () => {
  it('renders the configured segments in order', () => {
    expect(previewIdentifier(STU_PATTERN, 1, 'Africa/Lagos', NOW)).toBe('STU/2026/00001');
    expect(renderPattern([{ id: 'a', kind: 'static', value: 'EMP' }, { id: 'b', kind: 'separator', value: '-' }, { id: 'c', kind: 'sequence', start: 1, digits: 5, zeroPad: true }],
      { sequence: 42, date: NOW, timeZone: 'Africa/Lagos', random: () => 0 })).toBe('EMP-00042');
  });

  it('uses the organization time zone for date segments', () => {
    const lateNightUtc = new Date('2026-12-31T23:30:00Z'); // already 1 Jan 2027 in Lagos (UTC+1)
    expect(previewIdentifier([{ id: 'd', kind: 'date', format: 'YYYYMMDD' }, { id: 'r', kind: 'random-numeric', length: 3 }], 1, 'Africa/Lagos', lateNightUtc).slice(0, 8)).toBe('20270101');
  });

  it('builds random segments from the allowed characters and lengths', () => {
    const value = renderPattern([{ id: 'a', kind: 'static', value: 'MEM' }, { id: 'b', kind: 'separator', value: '-' }, { id: 'c', kind: 'random-alphanumeric', length: 6, charset: 'upper' }],
      { sequence: 1, date: NOW, timeZone: 'Africa/Lagos', random: Math.random });
    expect(value).toMatch(/^MEM-[A-Z0-9]{6}$/);
  });

  it('rejects invalid patterns with understandable messages', () => {
    expect(validatePattern([])).toEqual({ pattern: 'Add at least one segment.' });
    expect(validatePattern([{ id: 'x', kind: 'static', value: 'STU' }]).pattern).toMatch(/sequential or random/);
    expect(validatePattern([{ id: 'q', kind: 'sequence', start: Number.NaN, digits: 5, zeroPad: true }]).q).toMatch(/whole number/);
    expect(validatePattern([{ id: 'r', kind: 'random-numeric', length: 1 }]).r).toMatch(/between 3 and 16/);
    expect(validatePattern([{ id: 'd', kind: 'date', format: 'DDMMYYYY' as never }, { id: 'n', kind: 'random-numeric', length: 4 }]).d).toMatch(/supported date format/);
    expect(validatePattern([...STU_PATTERN, { id: 's6', kind: 'sequence', start: 1, digits: 3, zeroPad: true }]).pattern).toMatch(/only one sequential/);
  });

  it('skips taken sequence values and retries random collisions', () => {
    const taken = new Set(['STU/2026/00001', 'STU/2026/00002']);
    expect(generateIdentifier({ segments: STU_PATTERN, nextSequence: 1 }, (v) => taken.has(v), 'Africa/Lagos', NOW))
      .toEqual({ value: 'STU/2026/00003', nextSequence: 4 });
    const values = [0, 0, 0, 0.5, 0.5, 0.5];
    let i = 0;
    const random = () => values[i++ % values.length];
    const r = generateIdentifier({ segments: [{ id: 'r', kind: 'random-numeric', length: 3 }], nextSequence: 1 }, (v) => v === '000', 'Africa/Lagos', NOW, random);
    expect(r?.value).toBe('555');
  });
});

describe('identifier configuration', () => {
  it('saves with a stable id, starting sequence and audit event', () => {
    const state = withIdentifier();
    const [c] = selectOrgData(state).identifierConfigs;
    expect(c).toMatchObject({ id: 'idc_1', name: 'Matric Number', mode: 'generated', nextSequence: 1 });
    expect(selectOrgData(state).audit[0].action).toBe('identifier.created');
  });

  it('rejects duplicate names in the same organization but allows them elsewhere', () => {
    const state = withIdentifier();
    const dup = applyIdentifierConfig(state, { organizationId: ORG, at: AT, id: 'idc_2', name: 'matric number', mode: 'manual', segments: [] });
    expect(dup.ok).toBe(false);
    const other = applyIdentifierConfig(state, { organizationId: SAMPLE_ORGANIZATION_ID, at: AT, id: 'idc_3', name: 'Matric Number 2', mode: 'manual', segments: [] });
    expect(other.ok).toBe(true);
  });

  it('editing the pattern keeps assigned identifiers and the sequence position', () => {
    const s1 = ok(createUser(withIdentifier())).state;
    const edited = ok(applyIdentifierConfig(s1, {
      organizationId: ORG, at: AT, id: 'idc_1', name: 'Matric Number', mode: 'generated',
      segments: [{ id: 'n1', kind: 'static', value: 'NEW' }, { id: 'n2', kind: 'separator', value: '-' }, { id: 'n3', kind: 'sequence', start: 1, digits: 4, zeroPad: true }],
    })).state;
    expect(selectOrgData(edited).members[0].identifier?.value).toBe('STU/2026/00001');
    const s2 = ok(createUser(edited, { requestId: 'r2', memberId: 'mem_2', identity: { idSwitchId: 'IDS-2', resolution: 'created-new' } })).state;
    expect(selectOrgData(s2).members[1].identifier?.value).toBe('NEW-0002');
  });
});

describe('user creation', () => {
  it('creates a user with a generated identifier and persists the sequence', () => {
    let state = withIdentifier();
    expect(previewIdentifier(STU_PATTERN, selectOrgData(state).identifierConfigs[0].nextSequence, 'Africa/Lagos', NOW)).toBe('STU/2026/00001');
    state = ok(createUser(state)).state;
    state = ok(createUser(state, { requestId: 'r2', memberId: 'mem_2', identity: { idSwitchId: 'IDS-2', resolution: 'created-new' } })).state;
    const org = selectOrgData(state);
    expect(org.members.map((m) => m.identifier?.value)).toEqual(['STU/2026/00001', 'STU/2026/00002']);
    expect(org.identifierConfigs[0].nextSequence).toBe(3);
    expect(org.members[0]).toMatchObject({ status: 'active', relationship: '' });
    expect(org.credentials).toHaveLength(0);
    expect(org.audit[0].action).toBe('user.created');
  });

  it('validates manual identifiers and prevents duplicates', () => {
    const state = withIdentifier('manual');
    expect(createUser(state, { identifierValue: '' })).toMatchObject({ ok: false, errors: { identifier: 'Enter a value.' } });
    const s1 = ok(createUser(state, { identifierValue: 'MAT/2026/1025' })).state;
    const dup = createUser(s1, { requestId: 'r2', memberId: 'm2', identity: { idSwitchId: 'IDS-2', resolution: 'created-new' }, identifierValue: 'mat/2026/1025' });
    expect(dup).toMatchObject({ ok: false, errors: { identifier: expect.stringMatching(/already assigned/) } });
  });

  it('is idempotent and prevents duplicate organization relationships', () => {
    const s1 = ok(createUser(withIdentifier())).state;
    expect(reducer(s1, { type: 'users/create', prepared: { ...userInput(), assigned: { value: 'X', nextSequence: null } } })).toBe(s1);
    const sameIdentity = createUser(s1, { requestId: 'r2', memberId: 'm2' });
    expect(sameIdentity).toMatchObject({ ok: false, errors: { form: expect.stringMatching(/already a user/) } });
  });
});

describe('credential configuration and issuance', () => {
  const base = () => withCredential(ok(createUser(withIdentifier())).state);

  it('requires an existing identifier and a unique name', () => {
    const state = base();
    expect(applyCredentialConfig(state, {
      organizationId: ORG, at: AT, id: 'ct_2', name: 'student id', identifierConfigId: 'missing', templateId: 'classic-landscape',
      effectiveDate: 'on-issue', validity: { kind: 'fixed-date', date: '2020-01-01T00:00:00Z' }, renewable: false,
    })).toMatchObject({ ok: false, errors: { name: expect.any(String), identifierConfigId: expect.any(String), validity: expect.any(String) } });
  });

  it("issues using the user's existing identifier, without regenerating it", () => {
    const state = base();
    const progressBefore = getSetupProgress(selectOrgData(state));
    expect(progressBefore).toMatchObject({ firstUserCreated: true, firstCredentialIssued: false, completed: 0, next: 'first-id' });
    const r = ok(applyIssuance(state, { requestId: 'iss_1', organizationId: ORG, at: AT, memberId: 'mem_1', credentialTypeId: 'ct_1', credentialId: 'cr_1' }));
    const org = selectOrgData(r.state);
    expect(org.credentials[0]).toMatchObject({ identifier: 'STU/2026/00001', status: 'active', issuedAt: AT, memberId: 'mem_1' });
    expect(org.identifierConfigs[0].nextSequence).toBe(2);
    expect(getSetupProgress(org)).toMatchObject({ firstCredentialIssued: true, completed: 1, next: 'first-verification' });
  });

  it('prevents duplicate issuance and mismatched identifiers', () => {
    const state = base();
    const first = ok(applyIssuance(state, { requestId: 'iss_1', organizationId: ORG, at: AT, memberId: 'mem_1', credentialTypeId: 'ct_1', credentialId: 'cr_1' }));
    expect(applyIssuance(first.state, { requestId: 'iss_1', organizationId: ORG, at: AT, memberId: 'mem_1', credentialTypeId: 'ct_1', credentialId: 'cr_x' }))
      .toMatchObject({ ok: true, duplicateRequest: true, credentialId: 'cr_1' });
    expect(applyIssuance(first.state, { requestId: 'iss_2', organizationId: ORG, at: AT, memberId: 'mem_1', credentialTypeId: 'ct_1', credentialId: 'cr_2' }))
      .toMatchObject({ ok: false, errors: { form: expect.stringMatching(/Already holds/) } });
    const staff = ok(applyIdentifierConfig(first.state, { organizationId: ORG, at: AT, id: 'idc_2', name: 'Staff ID', mode: 'manual', segments: [] })).state;
    const withStaffUser = ok(createUser(staff, { requestId: 'r3', memberId: 'mem_3', identifierConfigId: 'idc_2', identifierValue: 'SF-1', identity: { idSwitchId: 'IDS-3', resolution: 'created-new' } })).state;
    expect(applyIssuance(withStaffUser, { requestId: 'iss_3', organizationId: ORG, at: AT, memberId: 'mem_3', credentialTypeId: 'ct_1', credentialId: 'cr_3' }))
      .toMatchObject({ ok: false, errors: { form: expect.stringMatching(/Matric Number, which this user doesn't have/) } });
  });

  it('keeps organizations separate', () => {
    expect(selectOrgData(base(), SAMPLE_ORGANIZATION_ID).members.some((m) => m.id === 'mem_1')).toBe(false);
  });
});

describe('ID Switch matching rules', () => {
  const registry = buildIdSwitchRegistry();
  const daniel = registry[3];

  it('matches confidently on email or phone plus name', () => {
    expect(matchIdentity({ givenName: daniel.givenName, familyName: daniel.familyName, email: daniel.email.toUpperCase() }, registry))
      .toMatchObject({ kind: 'match', identity: { idSwitchId: daniel.idSwitchId }, matchedOn: ['email'] });
  });

  it('never links when the email belongs to someone with a different name', () => {
    expect(matchIdentity({ givenName: 'Someone', familyName: 'Else', email: daniel.email }, registry)).toEqual({ kind: 'conflict', field: 'email' });
  });

  it('treats name-only similarity as a possible match, not a link', () => {
    expect(matchIdentity({ givenName: daniel.givenName, familyName: daniel.familyName, email: 'new@x.example' }, registry).kind).toBe('possible');
  });

  it('returns none for a new person', () => {
    expect(matchIdentity({ givenName: 'Zara', familyName: 'Quill', email: 'zara@x.example' }, registry)).toEqual({ kind: 'none' });
  });
});
