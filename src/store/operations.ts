import { generateIdentifier, validateManualValue, validatePattern, type PatternErrors } from '@/domain/identifierPattern';
import { STARTER_TEMPLATES } from '@/domain/templates';
import type {
  AuditEvent, Credential, CredentialStatus, CredentialType, EffectiveDateRule, TemplateId, IdentifierConfig, IdentifierSegment, Member, ValidityRule,
} from '@/domain/types';
import { formatIdentifier } from '@/lib/identifiers';
import { computeValidity } from '@/services/issuance';
import type { AppState } from './state';

type Result<T> = ({ ok: true; state: AppState } & T) | { ok: false; errors: Record<string, string> };

const ci = (v: string) => v.trim().toLowerCase();

function withAudit(state: AppState, events: Omit<AuditEvent, 'id'>[]): AuditEvent[] {
  const max = state.data.audit.reduce((m, e) => Math.max(m, Number(e.id.replace(/\D/g, '')) || 0), 0);
  const numbered = events.map((e, i) => ({ ...e, id: `AUD-${String(max + 1 + i).padStart(5, '0')}` }));
  return [...numbered.reverse(), ...state.data.audit];
}

/* ------------------------------------------------------------------ */
/* Identifier configurations                                           */
/* ------------------------------------------------------------------ */

export interface IdentifierConfigInput {
  organizationId: string;
  at: string;
  /** Existing id to update, or the id to create. */
  id: string;
  name: string;
  mode: 'manual' | 'generated';
  segments: IdentifierSegment[];
}

export interface IdentifierConfigErrors { name?: string; segments?: PatternErrors }

export function validateIdentifierConfig(state: AppState, input: Omit<IdentifierConfigInput, 'at'>): IdentifierConfigErrors {
  const errors: IdentifierConfigErrors = {};
  const name = input.name.trim();
  if (name.length < 2) errors.name = 'Enter a name of at least 2 characters, e.g. Matric Number.';
  else if (name.length > 40) errors.name = 'Keep the name under 40 characters.';
  else if (!/[A-Za-z]/.test(name)) errors.name = 'Use a meaningful name that includes letters.';
  else if (state.data.identifierConfigs.some((c) => c.organizationId === input.organizationId && c.id !== input.id && ci(c.name) === ci(name))) {
    errors.name = `An identifier called "${name}" already exists. Select it instead, or use a different name.`;
  }
  if (input.mode === 'generated') {
    const patternErrors = validatePattern(input.segments);
    if (Object.keys(patternErrors).length) errors.segments = patternErrors;
  }
  return errors;
}

export function applyIdentifierConfig(state: AppState, input: IdentifierConfigInput): Result<{ configId: string }> {
  const errors = validateIdentifierConfig(state, input);
  if (errors.name || errors.segments) {
    return { ok: false, errors: { ...(errors.name ? { name: errors.name } : {}), ...(errors.segments ?? {}) } };
  }
  const existing = state.data.identifierConfigs.find((c) => c.id === input.id);
  if (existing && existing.organizationId !== input.organizationId) return { ok: false, errors: { name: 'Not found.' } };
  const segments = input.mode === 'generated' ? input.segments : [];
  const seq = segments.find((s) => s.kind === 'sequence');
  const config: IdentifierConfig = existing
    // Editing keeps the sequence counter: values already assigned never change or get reused.
    ? { ...existing, name: input.name.trim(), mode: input.mode, segments, updatedAt: input.at }
    : {
      id: input.id, organizationId: input.organizationId, name: input.name.trim(), mode: input.mode, segments,
      nextSequence: seq && seq.kind === 'sequence' ? seq.start : 1, createdAt: input.at, updatedAt: input.at,
    };
  return {
    ok: true,
    configId: config.id,
    state: {
      ...state,
      data: {
        ...state.data,
        identifierConfigs: existing
          ? state.data.identifierConfigs.map((c) => (c.id === config.id ? config : c))
          : [...state.data.identifierConfigs, config],
        audit: withAudit(state, [{
          organizationId: input.organizationId, action: existing ? 'identifier.updated' : 'identifier.created', actor: state.data.admin.name,
          actorType: 'admin', resourceType: 'identifier', resourceId: config.id, result: 'success', occurredAt: input.at,
          summary: `${existing ? 'Updated' : 'Created'} identifier "${config.name}" (${config.mode === 'manual' ? 'entered manually' : 'generated automatically'})`,
          href: '/templates/identifiers',
        }]),
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export interface CreateUserInput {
  requestId: string;
  organizationId: string;
  at: string;
  identifierConfigId: string;
  /** Required for manual identifiers. Ignored for generated ones. */
  identifierValue?: string;
  person: { givenName: string; familyName: string };
  identity: { idSwitchId: string; resolution: Member['resolution'] };
  memberId: string;
}

/** A create request with its identifier already assigned, so the reducer stays deterministic. */
export interface PreparedUser extends CreateUserInput {
  assigned: { value: string; nextSequence: number | null };
}

export function isIdentifierTaken(state: AppState, configId: string, value: string) {
  return state.data.members.some((m) => m.identifier?.configId === configId && ci(m.identifier.value) === ci(value));
}

type PrepareResult = { ok: true; prepared: PreparedUser; duplicateRequest?: { memberId: string } } | { ok: false; errors: Record<string, string> };

/** Validates a new user and assigns the identifier. Generation happens here, once per create request. */
export function prepareCreateUser(state: AppState, input: CreateUserInput, random: () => number = Math.random): PrepareResult {
  const prior = state.data.members.find((m) => m.creationRequestId === input.requestId);
  if (prior) return { ok: true, prepared: { ...input, assigned: { value: prior.identifier?.value ?? '', nextSequence: null } }, duplicateRequest: { memberId: prior.id } };

  const org = state.data.organizations.find((o) => o.id === input.organizationId);
  const config = state.data.identifierConfigs.find((c) => c.id === input.identifierConfigId && c.organizationId === input.organizationId);
  if (!org || !config) return { ok: false, errors: { form: 'The selected identifier is no longer available.' } };
  if (!input.person.givenName.trim() || !input.person.familyName.trim()) return { ok: false, errors: { form: 'First and last name are required.' } };

  const existing = state.data.members.find((m) => m.organizationId === input.organizationId && m.idSwitchId === input.identity.idSwitchId);
  if (existing) return { ok: false, errors: { form: `${existing.displayName} is already a user in your organization.` } };

  if (config.mode === 'manual') {
    const value = (input.identifierValue ?? '').trim();
    const invalid = validateManualValue(value);
    if (invalid) return { ok: false, errors: { identifier: invalid } };
    if (isIdentifierTaken(state, config.id, value)) return { ok: false, errors: { identifier: `${value} is already assigned to another user.` } };
    return { ok: true, prepared: { ...input, assigned: { value, nextSequence: null } } };
  }
  const generated = generateIdentifier(config, (v) => isIdentifierTaken(state, config.id, v), org.timezone, new Date(input.at), random);
  if (!generated) return { ok: false, errors: { identifier: `A unique ${config.name} could not be generated. Review the identifier pattern.` } };
  return { ok: true, prepared: { ...input, assigned: { value: generated.value, nextSequence: generated.nextSequence } } };
}

export function applyCreateUser(state: AppState, p: PreparedUser): Result<{ memberId: string; duplicateRequest?: boolean }> {
  const prior = state.data.members.find((m) => m.creationRequestId === p.requestId);
  if (prior) return { ok: true, state, memberId: prior.id, duplicateRequest: true };
  const config = state.data.identifierConfigs.find((c) => c.id === p.identifierConfigId && c.organizationId === p.organizationId);
  if (!config) return { ok: false, errors: { form: 'The selected identifier is no longer available.' } };
  if (state.data.members.some((m) => m.organizationId === p.organizationId && m.idSwitchId === p.identity.idSwitchId)) {
    return { ok: false, errors: { form: 'This person is already a user in your organization.' } };
  }
  if (!p.assigned.value || isIdentifierTaken(state, config.id, p.assigned.value)) {
    return { ok: false, errors: { identifier: `${p.assigned.value} is already assigned to another user.` } };
  }
  const member: Member = {
    id: p.memberId,
    organizationId: p.organizationId,
    idSwitchId: p.identity.idSwitchId,
    displayName: `${p.person.givenName.trim()} ${p.person.familyName.trim()}`,
    relationship: '',
    unit: '',
    identifier: { configId: config.id, value: p.assigned.value },
    status: 'active',
    resolution: p.identity.resolution,
    // Never enrolled on creation: face enrollment is a separate, user-initiated step.
    faceEnrollment: { status: 'not-enrolled' },
    factors: { fingerprint: false },
    joinedAt: p.at,
    createdBy: state.data.admin.name,
    creationRequestId: p.requestId,
  };
  return {
    ok: true,
    memberId: member.id,
    state: {
      ...state,
      data: {
        ...state.data,
        members: [...state.data.members, member],
        identifierConfigs: p.assigned.nextSequence === null
          ? state.data.identifierConfigs
          : state.data.identifierConfigs.map((c) => (c.id === config.id ? { ...c, nextSequence: p.assigned.nextSequence! } : c)),
        audit: withAudit(state, [{
          organizationId: p.organizationId, action: 'user.created', actor: state.data.admin.name, actorType: 'admin',
          resourceType: 'member', resourceId: member.id, result: 'success', occurredAt: p.at, href: `/users/${member.id}`,
          summary: `Added ${member.displayName} (${config.name} ${member.identifier!.value})`,
        }]),
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* User lifecycle                                                      */
/* ------------------------------------------------------------------ */

export interface MemberStatusInput { organizationId: string; memberId: string; status: 'active' | 'inactive'; at: string }

/**
 * Activates or deactivates a user. Only Active ↔ Inactive; pending onboarding is unaffected.
 * Credential statuses are deliberately left unchanged: credential lifecycle is handled separately.
 */
export function applyMemberStatus(state: AppState, input: MemberStatusInput): Result<{ changed: boolean }> {
  const m = state.data.members.find((x) => x.id === input.memberId && x.organizationId === input.organizationId);
  if (!m) return { ok: false, errors: { form: 'This user no longer exists.' } };
  if (m.status === input.status) return { ok: true, state, changed: false };
  if (m.status === 'pending') return { ok: false, errors: { form: `${m.displayName} hasn't finished onboarding yet.` } };
  return {
    ok: true,
    changed: true,
    state: {
      ...state,
      data: {
        ...state.data,
        members: state.data.members.map((x) => (x.id === m.id ? { ...x, status: input.status } : x)),
        audit: withAudit(state, [{
          organizationId: m.organizationId, action: input.status === 'active' ? 'user.activated' : 'user.deactivated',
          actor: state.data.admin.name, actorType: 'admin', resourceType: 'member', resourceId: m.id, result: 'success',
          occurredAt: input.at, href: `/users/${m.id}`,
          summary: `${input.status === 'active' ? 'Activated' : 'Deactivated'} ${m.displayName}`,
        }]),
      },
    },
  };
}

/** Minimum time between sends of the same enrollment link. */
export const RESEND_COOLDOWN_MS = 60_000;

export interface EnrollmentInviteInput { organizationId: string; memberId: string; invitationId: string; sentTo: string; at: string }

/** Whether a portrait enrollment link can be sent to this user, and why not. */
export function enrollmentInviteEligibility(m: Member, now: Date = new Date()): { ok: true; resend: boolean } | { ok: false; reason: string } {
  if (m.faceEnrollment.status === 'enrolled') return { ok: false, reason: `${m.displayName} has already completed portrait enrollment.` };
  if (m.status !== 'active') return { ok: false, reason: 'Only active users can be invited to enroll.' };
  const inv = m.faceEnrollment.invitation;
  if (inv && m.faceEnrollment.status === 'pending' && now.getTime() - new Date(inv.sentAt).getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, reason: 'An enrollment link was sent less than a minute ago. Please wait before resending.' };
  }
  return { ok: true, resend: !!inv && m.faceEnrollment.status === 'pending' };
}

/**
 * Records a portrait enrollment invitation and marks enrollment Pending. A user has at most one open
 * invitation: resending refreshes it rather than creating another. Delivery is simulated.
 */
export function applyEnrollmentInvite(state: AppState, input: EnrollmentInviteInput): Result<{ resend: boolean }> {
  const m = state.data.members.find((x) => x.id === input.memberId && x.organizationId === input.organizationId);
  if (!m) return { ok: false, errors: { form: 'This user no longer exists.' } };
  if (!input.sentTo.trim()) return { ok: false, errors: { form: `${m.displayName} has no email address on record.` } };
  const prior = m.faceEnrollment.invitation;
  if (prior?.id === input.invitationId) return { ok: true, state, resend: prior.sendCount > 1 };
  const eligible = enrollmentInviteEligibility(m, new Date(input.at));
  if (!eligible.ok) return { ok: false, errors: { form: eligible.reason } };
  const invitation = {
    id: input.invitationId, sentTo: input.sentTo, sentAt: input.at, simulated: true as const,
    firstSentAt: eligible.resend && prior ? prior.firstSentAt : input.at,
    sendCount: eligible.resend && prior ? prior.sendCount + 1 : 1,
  };
  return {
    ok: true,
    resend: eligible.resend,
    state: {
      ...state,
      data: {
        ...state.data,
        members: state.data.members.map((x) => (x.id === m.id
          ? { ...x, faceEnrollment: { ...x.faceEnrollment, status: 'pending' as const, updatedAt: input.at, invitation } } : x)),
        audit: withAudit(state, [{
          organizationId: m.organizationId, action: 'enrollment.invited', actor: state.data.admin.name, actorType: 'admin',
          resourceType: 'member', resourceId: m.id, result: 'success', occurredAt: input.at, href: `/users/${m.id}`,
          summary: `${eligible.resend ? 'Resent' : 'Sent'} portrait enrollment link to ${m.displayName} at ${input.sentTo}`,
        }]),
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Credential configurations                                           */
/* ------------------------------------------------------------------ */

export interface CredentialConfigInput {
  organizationId: string;
  at: string;
  /** New id when creating; the configuration's id when editing (see `editing`). */
  id: string;
  /** True to update an existing configuration in place. */
  editing?: boolean;
  name: string;
  identifierConfigId: string;
  templateId: TemplateId;
  effectiveDate: Extract<EffectiveDateRule, 'on-issue' | 'custom-date'>;
  validity: ValidityRule;
  renewable: boolean;
}

export function validateCredentialConfig(state: AppState, c: Omit<CredentialConfigInput, 'at'>, now = new Date()) {
  const errors: Record<string, string> = {};
  const types = state.data.credentialTypes.filter((t) => t.organizationId === c.organizationId && !(c.editing && t.id === c.id));
  if (c.editing && !state.data.credentialTypes.some((t) => t.id === c.id && t.organizationId === c.organizationId)) {
    errors.form = 'This credential no longer exists.';
  }
  if (c.name.trim().length < 2) errors.name = 'Enter a name for this credential, e.g. Student ID.';
  else if (c.name.trim().length > 60) errors.name = 'Keep the name under 60 characters.';
  else if (types.some((t) => ci(t.name) === ci(c.name))) errors.name = `A credential called "${c.name.trim()}" already exists. Use a different name.`;
  if (!state.data.identifierConfigs.some((i) => i.id === c.identifierConfigId && i.organizationId === c.organizationId)) {
    errors.identifierConfigId = 'Choose the identifier shown on this credential.';
  }
  if (!STARTER_TEMPLATES.some((t) => t.id === c.templateId)) errors.templateId = 'Choose a template.';
  if (c.validity.kind === 'duration' && !(Number.isInteger(c.validity.months) && c.validity.months >= 1 && c.validity.months <= 600)) {
    errors.validity = 'Enter a validity period between 1 month and 50 years.';
  }
  if (c.validity.kind === 'fixed-date') {
    const d = new Date(c.validity.date);
    if (!c.validity.date || Number.isNaN(d.getTime())) errors.validity = 'Choose an expiry date.';
    else if (d <= now) errors.validity = 'The expiry date must be in the future.';
  }
  return errors;
}

export function applyCredentialConfig(state: AppState, input: CredentialConfigInput): Result<{ credentialTypeId: string }> {
  const errors = validateCredentialConfig(state, input, new Date(input.at));
  if (Object.keys(errors).length) return { ok: false, errors };
  const idConfig = state.data.identifierConfigs.find((i) => i.id === input.identifierConfigId)!;
  const org = state.data.organizations.find((o) => o.id === input.organizationId)!;
  const existing = input.editing ? state.data.credentialTypes.find((t) => t.id === input.id) : undefined;
  const rules = {
    name: input.name.trim(),
    identifier: { label: idConfig.name, mode: 'manual' as const, prefix: '', digits: 0, nextSequence: 1 },
    identifierConfigId: idConfig.id,
    effectiveDate: input.effectiveDate,
    validity: input.validity,
    // Only whether it can be renewed is stored; renewal windows aren't part of this release.
    renewal: { allowed: input.renewable, windowDays: 0 },
    templateId: input.templateId,
  };
  const type: CredentialType = existing
    ? { ...existing, ...rules, lifecycle: { ...existing.lifecycle, autoExpire: input.validity.kind !== 'no-expiry' }, updatedAt: input.at }
    : {
      id: input.id,
      organizationId: input.organizationId,
      description: '',
      ...rules,
      lifecycle: { requiresApproval: false, allowSuspension: true, autoExpire: input.validity.kind !== 'no-expiry' },
      cardDesignId: org.defaultCardDesignId,
      status: 'active',
      createdAt: input.at,
    };
  return {
    ok: true,
    credentialTypeId: type.id,
    state: {
      ...state,
      data: {
        ...state.data,
        // Editing updates the configuration only; credentials already issued keep their snapshot.
        credentialTypes: existing
          ? state.data.credentialTypes.map((t) => (t.id === type.id ? type : t))
          : [...state.data.credentialTypes, type],
        audit: withAudit(state, [{
          organizationId: input.organizationId, action: existing ? 'credential-type.updated' : 'credential-type.created',
          actor: state.data.admin.name, actorType: 'admin', resourceType: 'credential-type', resourceId: type.id, result: 'success',
          occurredAt: input.at, href: `/credentials/configurations/${type.id}`,
          summary: existing ? `Updated credential "${type.name}"` : `Created credential "${type.name}" using ${idConfig.name}`,
        }]),
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Issuance                                                            */
/* ------------------------------------------------------------------ */

/** Statuses that count as already holding a credential of a type (prevents duplicate issuance). */
export const HOLDING: CredentialStatus[] = ['active', 'pending', 'suspended'];

export interface IssuanceInput {
  requestId: string;
  organizationId: string;
  at: string;
  memberId: string;
  credentialTypeId: string;
  /** Used when the credential type lets the issuer choose the effective date. */
  effectiveDate?: string;
  /** Required when the credential type's expiry date is chosen at issuance. */
  expiresAt?: string;
  credentialId: string;
  /** Set when the credential is issued as part of an issuance run. */
  batchId?: string;
}

export type EligibilityStatus = 'eligible' | 'attention' | 'ineligible';

/**
 * Whether a credential type can be issued to a member under the existing issuance rules, and why not.
 * `attention`: fixable on the user's record (missing identifier, onboarding not finished).
 * `ineligible`: blocked by a rule (inactive user, already holds it, credential not active).
 * Portrait enrollment isn't checked: credential configurations don't require it.
 */
export function issuanceEligibility(state: AppState, memberId: string, type: CredentialType): { status: EligibilityStatus; reason?: string } {
  const member = state.data.members.find((m) => m.id === memberId);
  if (!member) return { status: 'ineligible', reason: 'User not found.' };
  if (type.status !== 'active') return { status: 'ineligible', reason: `${type.name} is not active.` };
  if (!member.displayName.trim()) return { status: 'attention', reason: 'The user has no name recorded.' };
  if (member.status === 'inactive') return { status: 'ineligible', reason: 'The user is inactive. Activate them to issue credentials.' };
  if (member.status === 'pending') return { status: 'attention', reason: "The user hasn't completed onboarding yet." };
  if (type.identifierConfigId && member.identifier?.configId !== type.identifierConfigId) {
    const needed = state.data.identifierConfigs.find((c) => c.id === type.identifierConfigId)?.name ?? 'a different identifier';
    return member.identifier
      ? { status: 'ineligible', reason: `Uses ${needed}, which this user doesn't have.` }
      : { status: 'attention', reason: `The user has no ${needed} yet.` };
  }
  const holding = state.data.credentials.find((c) => c.memberId === member.id && c.credentialTypeId === type.id && HOLDING.includes(c.status));
  if (holding) return { status: 'ineligible', reason: `Already holds ${type.name} (${holding.status}).` };
  return { status: 'eligible' };
}

/** Why a credential type can or can't be issued to a member. */
export function issuability(state: AppState, memberId: string, type: CredentialType): { ok: true } | { ok: false; reason: string } {
  const e = issuanceEligibility(state, memberId, type);
  return e.status === 'eligible' ? { ok: true } : { ok: false, reason: e.reason! };
}

export function applyIssuance(state: AppState, input: IssuanceInput): Result<{ credentialId: string; duplicateRequest?: boolean }> {
  const prior = state.data.credentials.find((c) => c.issuanceRequestId === input.requestId);
  if (prior) return { ok: true, state, credentialId: prior.id, duplicateRequest: true };

  const d = state.data;
  const org = d.organizations.find((o) => o.id === input.organizationId);
  const type = d.credentialTypes.find((t) => t.id === input.credentialTypeId && t.organizationId === input.organizationId);
  const member = d.members.find((m) => m.id === input.memberId && m.organizationId === input.organizationId);
  if (!org || !type || !member) return { ok: false, errors: { form: 'The user or credential is no longer available.' } };
  const check = issuability(state, member.id, type);
  if (!check.ok) return { ok: false, errors: { form: check.reason } };

  // The credential shows the user's existing organizational identifier; it is never regenerated here.
  let identifier: string;
  let nextSequence = type.identifier.nextSequence;
  if (type.identifierConfigId) {
    identifier = member.identifier!.value;
  } else {
    // Legacy sample-data credential types generate their own numbers.
    do {
      identifier = formatIdentifier(type.identifier.prefix, type.identifier.digits, nextSequence++);
    } while (d.credentials.some((c) => c.credentialTypeId === type.id && c.identifier === identifier));
  }

  // Validity: the effective date is a rule; the issuance timestamp is when it actually happened.
  const issuedAt = new Date(input.at);
  if (type.effectiveDate === 'custom-date' && (!input.effectiveDate || Number.isNaN(new Date(input.effectiveDate).getTime()))) {
    return { ok: false, errors: { form: 'Choose the date this credential becomes effective.' } };
  }
  if (type.validity.kind === 'set-at-issuance' && (!input.expiresAt || Number.isNaN(new Date(input.expiresAt).getTime()))) {
    return { ok: false, errors: { form: 'Choose an expiry date before issuing.' } };
  }
  const chosen = type.effectiveDate === 'custom-date' && input.effectiveDate ? new Date(input.effectiveDate) : undefined;
  const { effectiveFrom, expiresAt } = computeValidity(type, issuedAt, chosen, input.expiresAt ? new Date(input.expiresAt) : undefined);
  if (expiresAt && expiresAt <= effectiveFrom) {
    return { ok: false, errors: { form: 'This credential would expire before it becomes effective. Choose a different effective date or update its validity.' } };
  }

  const status: CredentialStatus = type.lifecycle.requiresApproval ? 'pending' : 'active';
  const credential: Credential = {
    id: input.credentialId,
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
    ...(input.batchId ? { issuanceBatchId: input.batchId } : {}),
    snapshot: {
      credentialName: type.name,
      templateId: type.templateId,
      identifierLabel: type.identifierConfigId ? d.identifierConfigs.find((c) => c.id === type.identifierConfigId)?.name ?? type.identifier.label : type.identifier.label,
    },
  };

  return {
    ok: true,
    credentialId: credential.id,
    state: {
      ...state,
      data: {
        ...d,
        credentials: [...d.credentials, credential],
        credentialTypes: type.identifierConfigId ? d.credentialTypes
          : d.credentialTypes.map((t) => (t.id === type.id ? { ...t, identifier: { ...t.identifier, nextSequence } } : t)),
        audit: withAudit(state, [{
          organizationId: input.organizationId, action: 'credential.issued', actor: d.admin.name, actorType: 'admin', resourceType: 'credential',
          resourceId: credential.id, result: 'success', occurredAt: input.at, href: `/credentials/${credential.id}`,
          summary: `Issued ${type.name} ${identifier} to ${member.displayName}`,
        }]),
      },
    },
  };
}

/** Records the simulated Seamfix Wallet delivery outcome. Separate from issuance. */
export function applyWalletUpdate(state: AppState, credentialId: string, status: Credential['wallet']['status'], at: string): AppState {
  const c = state.data.credentials.find((x) => x.id === credentialId);
  if (!c || c.wallet.status === status) return state;
  return {
    ...state,
    data: {
      ...state.data,
      credentials: state.data.credentials.map((x) => (x.id === credentialId ? { ...x, wallet: { status, updatedAt: at } } : x)),
      audit: status === 'not-sent' ? state.data.audit : withAudit(state, [{
        organizationId: c.organizationId, action: status === 'failed' ? 'wallet.failed' : 'wallet.delivered', actor: 'Seamfix Wallet',
        actorType: 'integration', resourceType: 'credential', resourceId: c.id, result: status === 'failed' ? 'failure' : 'success', occurredAt: at,
        summary: status === 'failed' ? `Wallet delivery failed for ${c.identifier}` : `${c.identifier} made available in Seamfix Wallet`,
        href: `/credentials/${c.id}`,
      }]),
    },
  };
}
