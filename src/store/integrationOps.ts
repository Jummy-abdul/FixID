import {
  CONTRACT_VERSION, connectionFromForm, isSecuritySensitiveChange, validateIntegrationForm, canActivateIntegration,
  type CustomIntegration, type IntegrationCapability, type IntegrationFormValues, type IntegrationTestRun,
} from '@/domain/integrations';
import type { AuditEvent } from '@/domain/types';
import { actorPermissions } from './adminOps';
import type { AppState } from './state';

/**
 * Custom integration lifecycle: Draft → (Testing) → Active ⇄ Inactive, Error when a test fails. Every
 * operation re-checks the actor's permission in the owning organization; integrations are never visible to,
 * or usable by, any other organization (parents and sub-organizations included). Client-side stand-in for
 * server-side checks.
 */

type Result = { ok: true; state: AppState } | { ok: false; error: string };
const DENIED = "You don't have permission to manage integrations.";

/** The organization's own integrations. Nothing else is ever listed. */
export const integrationsOf = (state: AppState, organizationId: string) => (state.data.customIntegrations ?? []).filter((i) => i.organizationId === organizationId);

/** One integration, only when it belongs to the organization asking (a guessed or foreign ID finds nothing). */
export const integrationFor = (state: AppState, organizationId: string, id: string) => integrationsOf(state, organizationId).find((i) => i.id === id);

/**
 * Whether an organization may use an integration for a new verification operation: only its own, active
 * integrations that offer the capability. Prompt 3 will extend this with explicitly authorized programme
 * access; organization relationships alone never grant it.
 */
export function usableIntegration(state: AppState, organizationId: string, id: string, capability: IntegrationCapability): { ok: true; integration: CustomIntegration } | { ok: false; error: string } {
  const i = integrationFor(state, organizationId, id);
  if (!i) return { ok: false, error: 'This integration isn’t available.' };
  if (i.status !== 'active') return { ok: false, error: `${i.name} isn’t active, so it can’t be used for new verification operations.` };
  if (!i.capabilities.includes(capability)) return { ok: false, error: `${i.name} doesn’t offer this capability.` };
  return { ok: true, integration: i };
}

/** Configurations that use an integration (none yet; verification programmes will add references in Prompt 3). */
export const integrationReferences = (_state: AppState, _integrationId: string): string[] => [];

function write(state: AppState, next: CustomIntegration, e: Pick<AuditEvent, 'action' | 'summary'> & { changes?: AuditEvent['changes'] }, at: string): AppState {
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const event: AuditEvent = {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: next.organizationId, actor: state.data.admin.name, actorType: 'admin', result: 'success', occurredAt: at,
    resourceType: 'integration', resourceId: next.id, subject: { id: next.id, name: next.name }, href: `/settings/integrations/${next.id}`, ...e,
  };
  const others = (state.data.customIntegrations ?? []).filter((i) => i.id !== next.id);
  return { ...state, data: { ...state.data, customIntegrations: [...others, next], audit: [event, ...state.data.audit] } };
}

const canManage = (state: AppState, organizationId: string) => actorPermissions(state, organizationId).has('integrations.manage');

export interface SaveIntegrationInput { organizationId: string; id: string; values: IntegrationFormValues; at: string }

/**
 * Creates or updates an integration. A new one is a Draft. A security-sensitive change (connection,
 * authentication or capabilities) invalidates earlier successful tests: an Active integration goes back to
 * Draft and needs a new test before it can be activated again.
 */
export function applySaveIntegration(state: AppState, input: SaveIntegrationInput): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const errors = validateIntegrationForm(input.values);
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]! };
  const existing = (state.data.customIntegrations ?? []).find((i) => i.id === input.id);
  if (existing && existing.organizationId !== input.organizationId) return { ok: false, error: 'This integration isn’t available.' };
  if (existing?.status === 'testing') return { ok: false, error: 'Wait for the connection test to finish.' };
  const v = input.values;
  const by = state.data.admin.name;
  const connection = connectionFromForm(v);
  const capabilities = (['lookup', 'matching'] as const).filter((c) => v.capabilities.includes(c));
  const base = {
    name: v.name.trim(), description: v.description.trim(), capabilities, referenceLabel: v.referenceLabel.trim(),
    permittedAttributes: [...new Set(v.permittedAttributes.map((a) => a.trim()).filter(Boolean))], connection, updatedAt: input.at, updatedBy: by,
  };
  if (!existing) {
    const created: CustomIntegration = { ...base, id: input.id, organizationId: input.organizationId, contractVersion: CONTRACT_VERSION, configVersion: 1, status: 'draft', tests: [], createdAt: input.at, createdBy: by };
    return { ok: true, state: write(state, created, { action: 'integration.created', summary: `${by} added the custom identity service ${created.name} (Draft).` }, input.at) };
  }
  const sensitive = isSecuritySensitiveChange(existing, { capabilities, connection });
  const next: CustomIntegration = sensitive
    ? { ...existing, ...base, configVersion: existing.configVersion + 1, validatedConfigVersion: undefined, status: existing.status === 'inactive' ? 'inactive' : 'draft' }
    : { ...existing, ...base };
  return {
    ok: true,
    state: write(state, next, {
      action: 'integration.updated',
      summary: `${by} updated ${next.name}${sensitive ? '. Connection settings changed, so it needs a new successful test before it can be active again.' : '.'}`,
      changes: sensitive ? [{ field: 'Status', from: existing.status, to: next.status }] : undefined,
    }, input.at),
  };
}

export function applyIntegrationTestStarted(state: AppState, input: { organizationId: string; integrationId: string; at: string }): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const i = integrationFor(state, input.organizationId, input.integrationId);
  if (!i) return { ok: false, error: 'This integration isn’t available.' };
  if (i.status === 'testing') return { ok: false, error: 'A connection test is already running.' };
  const next: CustomIntegration = { ...i, status: 'testing', statusBeforeTest: i.status };
  return { ok: true, state: { ...state, data: { ...state.data, customIntegrations: (state.data.customIntegrations ?? []).map((x) => (x.id === i.id ? next : x)) } } };
}

/**
 * Records a finished test. Success validates exactly the configuration version tested. Failure puts the
 * integration in Error (unless it was deliberately Inactive), so it can't be used until a test passes.
 */
export function applyIntegrationTestResult(state: AppState, input: { organizationId: string; integrationId: string; run: IntegrationTestRun; at: string }): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const i = integrationFor(state, input.organizationId, input.integrationId);
  if (!i) return { ok: false, error: 'This integration isn’t available.' };
  const before = i.statusBeforeTest ?? (i.status === 'testing' ? 'draft' : i.status);
  if (input.run.configVersion !== i.configVersion) return { ok: false, error: 'The configuration changed while it was being tested. Test it again.' };
  const ok = input.run.ok;
  const status = ok ? (before === 'error' ? 'draft' : before) : before === 'inactive' ? 'inactive' : 'error';
  const next: CustomIntegration = {
    ...i, status, statusBeforeTest: undefined, validatedConfigVersion: ok ? i.configVersion : undefined,
    ...(ok ? { lastSuccessfulTestAt: input.run.at } : { lastFailedTestAt: input.run.at }),
    tests: [input.run, ...i.tests].slice(0, 10),
  };
  return {
    ok: true,
    state: write(state, next, {
      action: ok ? 'integration.tested' : 'integration.test-failed',
      summary: `${state.data.admin.name} tested ${i.name}${input.run.simulated ? ' against the Simulated Identity Service' : ''}: ${input.run.summary}`,
    }, input.at),
  };
}

export function applyActivateIntegration(state: AppState, input: { organizationId: string; integrationId: string; at: string }): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const i = integrationFor(state, input.organizationId, input.integrationId);
  if (!i) return { ok: false, error: 'This integration isn’t available.' };
  if (i.status === 'active') return { ok: true, state };
  if (!canActivateIntegration(i)) return { ok: false, error: 'Run a successful connection test of the current configuration before activating.' };
  return { ok: true, state: write(state, { ...i, status: 'active', updatedAt: input.at }, { action: 'integration.activated', summary: `${state.data.admin.name} activated ${i.name}.`, changes: [{ field: 'Status', from: i.status, to: 'active' }] }, input.at) };
}

/** Stops new verification operations from using it. Configuration, tests and history are kept. */
export function applyDeactivateIntegration(state: AppState, input: { organizationId: string; integrationId: string; at: string }): Result {
  if (!canManage(state, input.organizationId)) return { ok: false, error: DENIED };
  const i = integrationFor(state, input.organizationId, input.integrationId);
  if (!i) return { ok: false, error: 'This integration isn’t available.' };
  if (i.status === 'inactive') return { ok: true, state };
  if (i.status === 'testing') return { ok: false, error: 'Wait for the connection test to finish.' };
  return { ok: true, state: write(state, { ...i, status: 'inactive', updatedAt: input.at }, { action: 'integration.deactivated', summary: `${state.data.admin.name} deactivated ${i.name}. Configuration and history are kept.`, changes: [{ field: 'Status', from: i.status, to: 'inactive' }] }, input.at) };
}

/** A test interrupted by leaving the page never leaves an integration stuck in Testing. */
export function settleInterruptedTests(state: AppState): AppState {
  const list = state.data.customIntegrations ?? [];
  if (!list.some((i) => i.status === 'testing')) return state;
  return { ...state, data: { ...state.data, customIntegrations: list.map((i) => (i.status === 'testing' ? { ...i, status: i.statusBeforeTest ?? 'draft', statusBeforeTest: undefined } : i)) } };
}
