import type {
  AuditEvent, Credential, CredentialStatus, CredentialType, EffectiveDateRule, Member, UserType, ValidityRule,
} from '@/domain/types';
import { formatIdentifier } from '@/lib/identifiers';
import { computeValidity } from '@/services/issuance';
import type { AppState } from './state';

type Result<T> = ({ ok: true; state: AppState } & T) | { ok: false; errors: Record<string, string> };

const ci = (v: string) => v.trim().toLowerCase();

function nextAuditId(audit: AuditEvent[], offset = 0): string {
  const max = audit.reduce((m, e) => Math.max(m, Number(e.id.replace(/\D/g, '')) || 0), 0);
  return `AUD-${String(max + 1 + offset).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Credential setup: reusable, organization-level configuration         */
/* ------------------------------------------------------------------ */

export interface NewCredentialConfig {
  name: string;
  identifierLabel: string;
  identifierMode: 'generated' | 'manual';
  prefix: string;
  digits: number;
  effectiveDate: Extract<EffectiveDateRule, 'on-issue' | 'custom-date'>;
  validity: ValidityRule;
  renewal: { allowed: boolean; windowDays: number };
  cardDesignId: string;
}

export interface CredentialSetupInput {
  organizationId: string;
  at: string;
  /** Existing user type, or the name of a new one. */
  userType: { id: string } | { name: string };
  /** Reuse an existing credential type, or create a new one. */
  credential: { existingId: string } | { config: NewCredentialConfig };
  ids: { userTypeId: string; credentialTypeId: string };
}

export function validateCredentialConfig(state: AppState, organizationId: string, c: NewCredentialConfig, now = new Date()) {
  const errors: Record<string, string> = {};
  const types = state.data.credentialTypes.filter((t) => t.organizationId === organizationId);
  if (c.name.trim().length < 2) errors.name = 'Enter a name for this credential, e.g. Student ID.';
  else if (c.name.trim().length > 60) errors.name = 'Keep the name under 60 characters.';
  else if (types.some((t) => ci(t.name) === ci(c.name))) errors.name = `A credential called "${c.name.trim()}" already exists. Choose it instead, or use a different name.`;
  if (c.identifierLabel.trim().length < 2) errors.identifierLabel = 'Name the identifier, e.g. Matric number.';
  if (c.identifierMode === 'generated') {
    if (!/^[A-Z0-9][A-Z0-9/-]{0,11}$/.test(c.prefix) && c.prefix !== '') errors.prefix = 'Use up to 12 capital letters, numbers, "-" or "/".';
    if (!(c.digits >= 3 && c.digits <= 10)) errors.digits = 'Choose between 3 and 10 digits.';
    else if (c.prefix && types.some((t) => t.identifier.mode === 'generated' && t.identifier.prefix === c.prefix)) {
      errors.prefix = 'Another credential already uses this prefix. Use a different one so identifiers stay distinct.';
    }
  }
  if (c.validity.kind === 'duration' && !(c.validity.months >= 1 && c.validity.months <= 120)) errors.validity = 'Choose a validity period.';
  if (c.validity.kind === 'fixed-date') {
    if (!c.validity.date || Number.isNaN(new Date(c.validity.date).getTime())) errors.validity = 'Choose an expiry date.';
    else if (new Date(c.validity.date) <= now) errors.validity = 'The expiry date must be in the future.';
  }
  if (c.renewal.allowed && !(c.renewal.windowDays >= 1 && c.renewal.windowDays <= 180)) errors.renewal = 'Renewal window must be 1–180 days.';
  if (!state.data.cardDesigns.some((d) => d.id === c.cardDesignId && d.organizationId === organizationId)) errors.cardDesignId = 'Choose a template.';
  return errors;
}

export function applyCredentialSetup(state: AppState, input: CredentialSetupInput): Result<{ userTypeId: string; credentialTypeId: string }> {
  const { organizationId, at } = input;
  const actor = state.data.admin.name;
  const audit: AuditEvent[] = [];
  let credentialTypes = state.data.credentialTypes;
  let userTypes = state.data.userTypes;

  // Credential type
  let credentialTypeId: string;
  if ('existingId' in input.credential) {
    const existing = credentialTypes.find((t) => t.id === (input.credential as { existingId: string }).existingId && t.organizationId === organizationId);
    if (!existing) return { ok: false, errors: { credential: 'That credential no longer exists.' } };
    credentialTypeId = existing.id;
  } else {
    const c = input.credential.config;
    const errors = validateCredentialConfig(state, organizationId, c);
    if (Object.keys(errors).length) return { ok: false, errors };
    credentialTypeId = input.ids.credentialTypeId;
    const type: CredentialType = {
      id: credentialTypeId,
      organizationId,
      name: c.name.trim(),
      description: '',
      identifier: { label: c.identifierLabel.trim(), mode: c.identifierMode, prefix: c.prefix, digits: c.digits, nextSequence: 1 },
      effectiveDate: c.effectiveDate,
      validity: c.validity,
      renewal: c.renewal.allowed ? c.renewal : { allowed: false, windowDays: 0 },
      lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: c.validity.kind !== 'no-expiry' },
      cardDesignId: c.cardDesignId,
      status: 'active',
      createdAt: at,
    };
    credentialTypes = [...credentialTypes, type];
    audit.push({
      id: '', organizationId, action: 'credential-type.created', actor, actorType: 'admin', resourceType: 'credential-type',
      resourceId: type.id, result: 'success', occurredAt: at, summary: `Created credential "${type.name}"`, href: `/templates/credential-types/${type.id}`,
    });
  }

  // User type
  let userTypeId: string;
  if ('id' in input.userType) {
    const existing = userTypes.find((u) => u.id === (input.userType as { id: string }).id && u.organizationId === organizationId);
    if (!existing) return { ok: false, errors: { userType: 'That user type no longer exists.' } };
    userTypeId = existing.id;
    if (!existing.credentialTypeId) {
      userTypes = userTypes.map((u) => (u.id === existing.id ? { ...u, credentialTypeId } : u));
    }
  } else {
    const name = input.userType.name.trim();
    if (name.length < 2) return { ok: false, errors: { userType: 'Enter a user type, e.g. Student.' } };
    if (userTypes.some((u) => u.organizationId === organizationId && ci(u.name) === ci(name))) {
      return { ok: false, errors: { userType: `"${name}" already exists. Select it instead.` } };
    }
    userTypeId = input.ids.userTypeId;
    const ut: UserType = { id: userTypeId, organizationId, name, credentialTypeId, createdAt: at };
    userTypes = [...userTypes, ut];
    audit.push({
      id: '', organizationId, action: 'user-type.created', actor, actorType: 'admin', resourceType: 'user-type',
      resourceId: ut.id, result: 'success', occurredAt: at, summary: `Added user type "${name}"`,
    });
  }

  const numbered = audit.map((e, i) => ({ ...e, id: nextAuditId(state.data.audit, i) })).reverse();
  return {
    ok: true,
    userTypeId,
    credentialTypeId,
    state: { ...state, data: { ...state.data, credentialTypes, userTypes, audit: [...numbered, ...state.data.audit] } },
  };
}

/* ------------------------------------------------------------------ */
/* Issuance                                                            */
/* ------------------------------------------------------------------ */

/** Statuses that count as already holding a credential of a type (prevents duplicate issuance). */
const HOLDING: CredentialStatus[] = ['active', 'pending', 'suspended'];

export interface IssuanceInput {
  requestId: string;
  organizationId: string;
  at: string;
  userTypeId: string;
  credentialTypeId: string;
  person: { givenName: string; familyName: string; photoDataUrl?: string };
  identity: { idSwitchId: string; resolution: Member['resolution'] };
  /** Issue to someone already in the organization instead of creating a relationship. */
  existingMemberId?: string;
  /** Required when the credential type uses manually entered identifiers. */
  identifierValue?: string;
  /** Used when the credential type lets the issuer choose the effective date. */
  effectiveDate?: string;
  ids: { memberId: string; credentialId: string };
}

export function findDuplicateIdentifier(state: AppState, credentialTypeId: string, value: string) {
  return state.data.credentials.find((c) => c.credentialTypeId === credentialTypeId && ci(c.identifier) === ci(value));
}

export function applyIssuance(state: AppState, input: IssuanceInput): Result<{ credentialId: string; memberId: string; duplicateRequest?: boolean }> {
  // Idempotency: a repeated request returns the original result without issuing again.
  const prior = state.data.credentials.find((c) => c.issuanceRequestId === input.requestId);
  if (prior) return { ok: true, state, credentialId: prior.id, memberId: prior.memberId, duplicateRequest: true };

  const d = state.data;
  const org = d.organizations.find((o) => o.id === input.organizationId);
  const type = d.credentialTypes.find((t) => t.id === input.credentialTypeId && t.organizationId === input.organizationId);
  const userType = d.userTypes.find((u) => u.id === input.userTypeId && u.organizationId === input.organizationId);
  if (!org || !type || !userType) return { ok: false, errors: { form: 'The selected user type or credential is no longer available.' } };
  if (type.status !== 'active') return { ok: false, errors: { form: `${type.name} is not active and cannot be issued.` } };

  const givenName = input.person.givenName.trim();
  const familyName = input.person.familyName.trim();
  if (!givenName || !familyName) return { ok: false, errors: { form: 'First and last name are required.' } };

  // Organization relationship
  let member: Member;
  let isNewMember = false;
  if (input.existingMemberId) {
    const existing = d.members.find((m) => m.id === input.existingMemberId && m.organizationId === input.organizationId);
    if (!existing) return { ok: false, errors: { form: 'That user is no longer in your organization.' } };
    if (existing.idSwitchId !== input.identity.idSwitchId) return { ok: false, errors: { form: 'Identity does not match the selected user.' } };
    member = existing;
  } else {
    const already = d.members.find((m) => m.organizationId === input.organizationId && m.idSwitchId === input.identity.idSwitchId);
    if (already) return { ok: false, errors: { form: `${already.displayName} is already a user in your organization.` } };
    isNewMember = true;
    member = {
      id: input.ids.memberId,
      organizationId: input.organizationId,
      idSwitchId: input.identity.idSwitchId,
      displayName: `${givenName} ${familyName}`,
      relationship: userType.name,
      userTypeId: userType.id,
      unit: '',
      status: 'active',
      resolution: input.identity.resolution,
      factors: { face: false, fingerprint: false },
      photoDataUrl: input.person.photoDataUrl,
      joinedAt: input.at,
    };
  }

  const holding = d.credentials.find((c) => c.memberId === member.id && c.credentialTypeId === type.id && HOLDING.includes(c.status));
  if (holding) return { ok: false, errors: { form: `${member.displayName} already holds ${type.name} ${holding.identifier}.` } };

  // Identifier
  let identifier: string;
  let nextSequence = type.identifier.nextSequence;
  if (type.identifier.mode === 'manual') {
    identifier = (input.identifierValue ?? '').trim();
    if (!identifier) return { ok: false, errors: { identifier: `Enter the ${type.identifier.label.toLowerCase()}.` } };
    const dup = findDuplicateIdentifier(state, type.id, identifier);
    if (dup) return { ok: false, errors: { identifier: `${identifier} is already assigned to another ${type.name}.` } };
  } else {
    do {
      identifier = formatIdentifier(type.identifier.prefix, type.identifier.digits, nextSequence++);
    } while (findDuplicateIdentifier(state, type.id, identifier));
  }

  // Validity: the effective date is a rule; the issuance timestamp is when it actually happened.
  const issuedAt = new Date(input.at);
  const chosen = type.effectiveDate === 'custom-date' && input.effectiveDate ? new Date(input.effectiveDate) : undefined;
  const { effectiveFrom, expiresAt } = computeValidity(type, issuedAt, chosen);
  if (expiresAt && expiresAt <= effectiveFrom) return { ok: false, errors: { form: 'This credential would expire before it becomes effective. Check its validity rules.' } };

  const status: CredentialStatus = type.lifecycle.requiresApproval ? 'pending' : 'active';
  const credential: Credential = {
    id: input.ids.credentialId,
    organizationId: input.organizationId,
    memberId: member.id,
    credentialTypeId: type.id,
    identifier,
    status,
    issuedAt: input.at,
    effectiveFrom: effectiveFrom.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    wallet: { status: org.integrations.seamfixWallet.connected && status === 'active' ? 'pending' : 'not-sent', updatedAt: input.at },
    issuanceRequestId: input.requestId,
  };

  const actor = d.admin.name;
  const events: AuditEvent[] = [];
  if (isNewMember) {
    events.push({
      id: '', organizationId: input.organizationId, actor, actorType: 'admin', resourceType: 'member', resourceId: member.id,
      result: 'success', occurredAt: input.at, href: `/users/${member.id}`,
      action: input.identity.resolution === 'created-new' ? 'identity.created' : 'identity.linked',
      summary: input.identity.resolution === 'created-new'
        ? `Added ${member.displayName} as ${userType.name} with new ID Switch identity ${member.idSwitchId}`
        : `Added ${member.displayName} as ${userType.name}, reusing ID Switch identity ${member.idSwitchId}`,
    });
  }
  events.push({
    id: '', organizationId: input.organizationId, action: 'credential.issued', actor, actorType: 'admin', resourceType: 'credential',
    resourceId: credential.id, result: 'success', occurredAt: input.at, href: `/credentials/${credential.id}`,
    summary: `Issued ${type.name} ${identifier} to ${member.displayName}`,
  });
  const numbered = events.map((e, i) => ({ ...e, id: nextAuditId(d.audit, i) })).reverse();

  return {
    ok: true,
    credentialId: credential.id,
    memberId: member.id,
    state: {
      ...state,
      data: {
        ...d,
        members: isNewMember ? [...d.members, member] : d.members,
        credentials: [...d.credentials, credential],
        credentialTypes: type.identifier.mode === 'generated'
          ? d.credentialTypes.map((t) => (t.id === type.id ? { ...t, identifier: { ...t.identifier, nextSequence } } : t))
          : d.credentialTypes,
        audit: [...numbered, ...d.audit],
      },
    },
  };
}

/** Records the simulated Seamfix Wallet delivery outcome. Separate from issuance. */
export function applyWalletUpdate(state: AppState, credentialId: string, status: Credential['wallet']['status'], at: string): AppState {
  const c = state.data.credentials.find((x) => x.id === credentialId);
  if (!c || c.wallet.status === status) return state;
  const event: AuditEvent = {
    id: nextAuditId(state.data.audit), organizationId: c.organizationId,
    action: status === 'failed' ? 'wallet.failed' : 'wallet.delivered', actor: 'Seamfix Wallet (simulated)', actorType: 'integration',
    resourceType: 'credential', resourceId: c.id, result: status === 'failed' ? 'failure' : 'success', occurredAt: at,
    summary: status === 'failed' ? `Wallet delivery failed for ${c.identifier}` : `${c.identifier} made available in Seamfix Wallet`,
    href: `/credentials/${c.id}`,
  };
  return {
    ...state,
    data: {
      ...state.data,
      credentials: state.data.credentials.map((x) => (x.id === credentialId ? { ...x, wallet: { status, updatedAt: at } } : x)),
      audit: status === 'not-sent' ? state.data.audit : [event, ...state.data.audit],
    },
  };
}
