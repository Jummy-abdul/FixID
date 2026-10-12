import { normalizeIssuer, providerName, versionUnderReview, type SsoFormValues } from '@/domain/sso';
import type { AuditEvent, OrgAdministrator, SsoConfigVersion, SsoConnection } from '@/domain/types';
import { actorPermissions, actorRecord } from './adminOps';
import type { AppState } from './state';

/**
 * SSO configuration, testing, activation and identity links. Every operation re-checks the actor's
 * permission from state and stays within one organization. Client-side stand-in for the FixID backend.
 */

type Result = { ok: true; state: AppState } | { ok: false; error: string };
const DENIED = "You don't have permission to manage SSO.";

export const ssoFor = (state: AppState, organizationId: string): SsoConnection | undefined =>
  (state.data.ssoConnections ?? []).find((c) => c.organizationId === organizationId);

function write(state: AppState, organizationId: string, next: SsoConnection | null, e?: Omit<AuditEvent, 'id' | 'organizationId' | 'actor' | 'actorType' | 'result' | 'href' | 'resourceType' | 'resourceId'> & { resourceType?: AuditEvent['resourceType']; resourceId?: string; actor?: string }): AppState {
  const others = (state.data.ssoConnections ?? []).filter((c) => c.organizationId !== organizationId);
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const audit = e ? [{
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId, actor: e.actor ?? state.data.admin.name, actorType: 'admin' as const,
    resourceType: e.resourceType ?? 'sso', resourceId: e.resourceId ?? `${organizationId}_sso`, result: 'success' as const, href: '/settings?tab=security', ...e,
  } as AuditEvent, ...state.data.audit] : state.data.audit;
  return { ...state, data: { ...state.data, ssoConnections: next ? [...others, next] : others, audit } };
}

const canManage = (state: AppState, organizationId: string) => actorPermissions(state, organizationId).has('sso.manage');

export interface SsoSaveInput { organizationId: string; versionId: string; values: SsoFormValues; at: string }

/**
 * Saves a configuration. Never activates SSO: the first save leaves it Not Activated; a change to an active
 * connection is kept as pending, and the active configuration keeps working until the change is tested and
 * activated. The client secret itself isn't stored (see SsoConfigVersion).
 */
export function applySaveSso(state: AppState, input: SsoSaveInput): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const c = ssoFor(state, input.organizationId);
  const base = versionUnderReview(c);
  const v = input.values;
  const version: SsoConfigVersion = {
    id: input.versionId, provider: v.provider, issuer: normalizeIssuer(v.issuer), clientId: v.clientId.trim(),
    // Keeping the saved secret is only possible with the same provider and client.
    clientSecretSet: !!v.clientSecret || (!!base?.clientSecretSet && base.provider === v.provider && base.clientId === v.clientId.trim()),
    savedAt: input.at, savedBy: state.data.admin.name,
  };
  const next: SsoConnection = c?.enabled
    ? { ...c, pending: version, lastTest: undefined }
    : { organizationId: input.organizationId, current: version, enabled: false, activatedAt: c?.activatedAt, lastTest: undefined };
  return {
    ok: true,
    state: write(state, input.organizationId, next, {
      action: 'sso.saved', occurredAt: input.at, subject: { id: version.id, name: `${providerName(v.provider)} SSO` },
      summary: `${state.data.admin.name} ${c?.current ? 'updated' : 'configured'} ${providerName(v.provider)} SSO${c?.enabled ? ' (pending; the active configuration keeps working until the change is activated)' : ''}.`,
      changes: [
        { field: 'Issuer URL', from: base?.issuer ?? '—', to: version.issuer },
        { field: 'Client ID', from: base?.clientId ?? '—', to: version.clientId },
        ...(v.clientSecret ? [{ field: 'Client secret', from: base?.clientSecretSet ? 'Set' : '—', to: 'Replaced (hidden)' }] : []),
      ],
    }),
  };
}

/** Records a completed connection test. Only a successful test of the same version allows activation. */
export function applySsoTestResult(state: AppState, input: { organizationId: string; versionId: string; ok: boolean; message: string; mode: 'live' | 'demonstration'; at: string }): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const c = ssoFor(state, input.organizationId);
  const v = versionUnderReview(c);
  if (!c || !v || v.id !== input.versionId) return { ok: false, error: 'The configuration changed while it was being tested. Test it again.' };
  const tested: SsoConfigVersion = input.ok ? { ...v, testedAt: input.at, testMode: input.mode } : { ...v, testedAt: undefined, testMode: undefined };
  const next: SsoConnection = { ...c, ...(c.pending ? { pending: tested } : { current: tested }), lastTest: { versionId: v.id, at: input.at, ok: input.ok, message: input.message, mode: input.mode } };
  return {
    ok: true,
    state: write(state, input.organizationId, next, {
      action: input.ok ? 'sso.tested' : 'sso.test-failed', occurredAt: input.at, subject: { id: v.id, name: `${providerName(v.provider)} SSO` },
      summary: `${state.data.admin.name} tested the ${providerName(v.provider)} SSO connection${input.mode === 'demonstration' ? ' with the demonstration provider' : ''}: ${input.ok ? 'successful' : 'failed'}. ${input.message}`,
    }),
  };
}

export function applyActivateSso(state: AppState, input: { organizationId: string; at: string }): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const c = ssoFor(state, input.organizationId);
  const v = versionUnderReview(c);
  if (!c || !v) return { ok: false, error: 'Save an SSO configuration first.' };
  if (!v.testedAt) return { ok: false, error: 'Test this configuration successfully before activating it.' };
  if (c.enabled && !c.pending) return { ok: true, state };
  const next: SsoConnection = { ...c, current: v, pending: undefined, enabled: true, activatedAt: input.at };
  return {
    ok: true,
    state: write(state, input.organizationId, next, {
      action: 'sso.activated', occurredAt: input.at, subject: { id: v.id, name: `${providerName(v.provider)} SSO` },
      summary: `${state.data.admin.name} activated ${c.pending ? 'the updated ' : ''}${providerName(v.provider)} SSO configuration.`,
      changes: [{ field: 'Status', from: c.enabled ? 'Active' : 'Not Activated', to: 'Active' }],
    }),
  };
}

/** Stops new SSO sign-ins. The configuration is kept, and needs a new successful test to be activated again. Existing sessions continue. */
export function applyDisableSso(state: AppState, input: { organizationId: string; at: string }): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const c = ssoFor(state, input.organizationId);
  if (!c?.enabled || !c.current) return { ok: false, error: 'SSO isn’t active.' };
  const next: SsoConnection = { ...c, enabled: false, current: { ...c.current, testedAt: undefined, testMode: undefined }, lastTest: undefined };
  return {
    ok: true,
    state: write(state, input.organizationId, next, {
      action: 'sso.disabled', occurredAt: input.at, subject: { id: c.current.id, name: `${providerName(c.current.provider)} SSO` },
      summary: `${state.data.admin.name} disabled SSO. Email and password sign-in remains available; the configuration was kept.`,
      changes: [{ field: 'Status', from: 'Active', to: 'Not Activated' }],
    }),
  };
}

export function applyDiscardSsoChanges(state: AppState, input: { organizationId: string; at: string }): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const c = ssoFor(state, input.organizationId);
  if (!c?.pending) return { ok: false, error: 'There are no pending changes.' };
  return {
    ok: true,
    state: write(state, input.organizationId, { ...c, pending: undefined, lastTest: undefined }, {
      action: 'sso.changes-discarded', occurredAt: input.at, subject: { id: c.pending.id, name: `${providerName(c.pending.provider)} SSO` },
      summary: `${state.data.admin.name} discarded pending SSO changes. The active configuration is unchanged.`,
    }),
  };
}

export interface ExternalIdentity { issuer: string; subject: string; audience: string; email?: string; mode: 'verified' | 'demonstration' }

/** Who an authenticated external identity belongs to in an organization: only an explicit link counts, never the email. */
export function linkedAdministrator(state: AppState, organizationId: string, issuer: string, subject: string): OrgAdministrator | undefined {
  return state.data.administrators.find((a) => a.organizationId === organizationId && a.ssoIdentity?.issuer === issuer && a.ssoIdentity.subject === subject);
}

/** Why an identity can't be used with an organization's active SSO connection, or null. */
export function identityProblem(state: AppState, organizationId: string, id: Pick<ExternalIdentity, 'issuer' | 'audience'>): string | null {
  const c = ssoFor(state, organizationId);
  if (!c?.enabled || !c.current) return 'SSO isn’t active for this organization.';
  if (id.issuer !== c.current.issuer || id.audience !== c.current.clientId) return 'The response came from an identity provider this organization doesn’t trust.';
  return null;
}

/**
 * Links the signed-in administrator's own account to an identity from the organization's active provider.
 * Keeps their role, status and organization. One external identity links to one administrator only.
 */
export function applyLinkSsoIdentity(state: AppState, input: { organizationId: string; identity: ExternalIdentity; at: string }): Result {
  const me = actorRecord(state, input.organizationId);
  if (!me || me.status !== 'active') return { ok: false, error: 'Only an active administrator can link an SSO identity.' };
  const problem = identityProblem(state, input.organizationId, input.identity);
  if (problem) return { ok: false, error: problem };
  const { issuer, subject } = input.identity;
  const taken = state.data.administrators.find((a) => a.id !== me.id && a.ssoIdentity?.issuer === issuer && a.ssoIdentity.subject === subject);
  if (taken) return { ok: false, error: 'This identity is already linked to another FixID administrator account.' };
  const linked: OrgAdministrator = { ...me, ssoIdentity: { issuer, subject, linkedAt: input.at, email: input.identity.email, mode: input.identity.mode } };
  return {
    ok: true,
    state: write({ ...state, data: { ...state.data, administrators: state.data.administrators.map((a) => (a.id === me.id ? linked : a)) } }, input.organizationId, ssoFor(state, input.organizationId)!, {
      action: 'admin.sso-linked', occurredAt: input.at, resourceType: 'administrator', resourceId: me.id, subject: { id: me.id, name: me.name ?? me.email },
      summary: `${me.name ?? me.email} linked their SSO identity${input.identity.mode === 'demonstration' ? ' (demonstration provider)' : ''}.`,
    }),
  };
}

export function applyUnlinkSsoIdentity(state: AppState, input: { organizationId: string; at: string }): Result {
  const me = actorRecord(state, input.organizationId);
  if (!me?.ssoIdentity) return { ok: false, error: 'No SSO identity is linked.' };
  const { ssoIdentity: _, ...rest } = me;
  return {
    ok: true,
    state: write({ ...state, data: { ...state.data, administrators: state.data.administrators.map((a) => (a.id === me.id ? rest : a)) } }, input.organizationId, ssoFor(state, input.organizationId) ?? null, {
      action: 'admin.sso-unlinked', occurredAt: input.at, resourceType: 'administrator', resourceId: me.id, subject: { id: me.id, name: me.name ?? me.email },
      summary: `${me.name ?? me.email} unlinked their SSO identity.`,
    }),
  };
}
