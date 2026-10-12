import type { CustomIntegration, IntegrationCapability, IntegrationCheck, IntegrationTestRun } from '@/domain/integrations';
import {
  lookupSchemaProblem, matchSchemaProblem, minimizeLookup, toMatchResult, type BiometricMatchRequest, type BiometricMatchResult, type IdentityLookupRequest,
  type IdentityLookupResult, type LookupResponseV1, type MatchResponseV1,
} from './contract';
import { simulatedLookup, simulatedMatch } from './simulatedIdentityService';

/**
 * The integration service future verification workflows call: they ask for a lookup or a match through an
 * organization's integration and get a validated, minimized result, without knowing the provider. It
 * separates the transport (simulated service, or an external service through a secure backend) from
 * contract validation, minimization and error handling. It never writes anything: no Person records, no
 * enrollment, no stored biometrics or lookup attributes.
 */

/** Demo-only scenarios for connection tests against the Simulated Identity Service. */
export type TestScenario = 'healthy' | 'auth-failure' | 'lookup-invalid' | 'matching-invalid' | 'unavailable' | 'timeout';
export const TEST_SCENARIOS: { id: TestScenario; label: string }[] = [
  { id: 'healthy', label: 'Healthy service (all checks pass)' },
  { id: 'auth-failure', label: 'Authentication fails' },
  { id: 'lookup-invalid', label: 'Lookup response breaks the contract' },
  { id: 'matching-invalid', label: 'Matching response breaks the contract' },
  { id: 'unavailable', label: 'Service unavailable' },
  { id: 'timeout', label: 'Request times out' },
];

class TransportError extends Error {
  constructor(readonly kind: 'auth' | 'unavailable' | 'timeout' | 'disabled', message: string) { super(message); }
}

interface Transport {
  simulated: boolean;
  authenticate(): Promise<void>;
  lookup(req: IdentityLookupRequest): Promise<unknown>;
  match(req: BiometricMatchRequest): Promise<unknown>;
}

const tick = () => new Promise((r) => setTimeout(r, 120));

function simulatedTransport(scenario: TestScenario): Transport {
  const fail = () => {
    if (scenario === 'unavailable') throw new TransportError('unavailable', 'The service didn’t respond (HTTP 503).');
    if (scenario === 'timeout') throw new TransportError('timeout', 'No response within the configured timeout.');
  };
  return {
    simulated: true,
    async authenticate() { await tick(); fail(); if (scenario === 'auth-failure') throw new TransportError('auth', 'The service rejected the credentials (HTTP 401).'); },
    async lookup(req) {
      await tick(); fail();
      // A deliberately broken response, so contract validation can be demonstrated.
      if (scenario === 'lookup-invalid') return { requestId: req.requestId, status: 'OK', person: { name: 'Sample' } };
      return simulatedLookup(req);
    },
    async match(req) {
      await tick(); fail();
      if (scenario === 'matching-invalid') return { requestId: req.requestId, status: 'MATCH', confidence: 'high' };
      return simulatedMatch(req);
    },
  };
}

/**
 * External services are only ever called through a secure FixID integration backend (secret manager,
 * destination allow-listing, SSRF and private-network protection, no redirects). This prototype has no such
 * backend, so real external requests are disabled; the browser never calls customer URLs.
 */
const DISABLED = 'Real external requests are disabled in this prototype: FixID has no secure integration backend or secret manager. Use the Simulated Identity Service to test.';
const externalTransport: Transport = {
  simulated: false,
  async authenticate() { throw new TransportError('disabled', DISABLED); },
  async lookup() { throw new TransportError('disabled', DISABLED); },
  async match() { throw new TransportError('disabled', DISABLED); },
};

export const transportFor = (i: CustomIntegration, scenario: TestScenario = 'healthy') => (i.connection.target === 'simulated' ? simulatedTransport(scenario) : externalTransport);

let counter = 0;
const requestId = () => `REQ-${Date.now().toString(36).toUpperCase()}-${(++counter).toString().padStart(3, '0')}`;

/* ---------------- Operations (for verification workflows) ---------------- */

export async function lookupIdentity(i: CustomIntegration, referenceValue: string, transport = transportFor(i)): Promise<IdentityLookupResult> {
  const req: IdentityLookupRequest = { referenceType: 'EXTERNAL_ID', referenceValue, requestId: requestId(), purpose: 'IDENTITY_VERIFICATION' };
  try {
    const raw = await transport.lookup(req);
    const problem = lookupSchemaProblem(raw, req.requestId);
    if (problem) return { status: 'ERROR', message: `The service’s response didn’t follow the contract: ${problem}`, simulated: transport.simulated };
    return minimizeLookup(raw as LookupResponseV1, i.permittedAttributes);
  } catch (e) {
    return { status: e instanceof TransportError && e.kind !== 'disabled' ? 'UNAVAILABLE' : 'ERROR', message: (e as Error).message, simulated: transport.simulated };
  }
}

export async function matchBiometric(i: CustomIntegration, input: Omit<BiometricMatchRequest, 'requestId' | 'modality'>, transport = transportFor(i)): Promise<BiometricMatchResult> {
  const req: BiometricMatchRequest = { ...input, requestId: requestId(), modality: 'FACE' };
  try {
    const raw = await transport.match(req);
    const problem = matchSchemaProblem(raw, req.requestId);
    if (problem) return { status: 'ERROR', message: `The service’s response didn’t follow the contract: ${problem}`, simulated: transport.simulated };
    return toMatchResult(raw as MatchResponseV1);
  } catch (e) {
    return { status: e instanceof TransportError && e.kind !== 'disabled' ? 'UNAVAILABLE' : 'ERROR', message: (e as Error).message, simulated: transport.simulated };
  }
}

/* ---------------- Connection test ---------------- */

const has = (i: CustomIntegration, c: IntegrationCapability) => i.capabilities.includes(c);

/**
 * Runs the real contract against the configured service and validates every response: configuration,
 * authentication, lookup and matching compatibility (when enabled), response schemas and error handling.
 * Never includes secrets in results.
 */
export async function runConnectionTest(i: CustomIntegration, scenario: TestScenario = 'healthy'): Promise<Pick<IntegrationTestRun, 'ok' | 'summary' | 'checks' | 'simulated' | 'scenario' | 'configVersion'>> {
  const transport = transportFor(i, scenario);
  const checks: IntegrationCheck[] = [];
  const add = (c: IntegrationCheck) => { checks.push(c); return c.outcome !== 'failed'; };
  const finish = (summary: string) => {
    const ids: IntegrationCheck['id'][] = ['configuration', 'authentication', 'lookup', 'matching', 'schema', 'errors'];
    const labels: Record<IntegrationCheck['id'], string> = { configuration: 'Connection configuration', authentication: 'Authentication', lookup: 'Lookup endpoint compatibility', matching: 'Matching endpoint compatibility', schema: 'Response schema validity', errors: 'Error handling' };
    for (const id of ids) if (!checks.some((c) => c.id === id)) checks.push({ id, label: labels[id], outcome: 'skipped', detail: 'Not run.' });
    checks.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return { ok: checks.every((c) => c.outcome !== 'failed'), summary, checks, simulated: transport.simulated, scenario: transport.simulated ? scenario : undefined, configVersion: i.configVersion };
  };
  const failure = (e: unknown, fallback: string) => {
    if (e instanceof TransportError) return e.kind === 'timeout' ? 'Request timed out.' : e.kind === 'unavailable' ? 'Service unavailable.' : e.kind === 'auth' ? 'Authentication failed.' : 'External requests are disabled in this prototype.';
    return fallback;
  };

  // 1. Configuration
  const c = i.connection;
  const configProblem = !i.capabilities.length ? 'No capability is enabled.' : c.target === 'external' && !/^https:\/\//.test(c.baseUrl) ? 'The base API URL must use https.' : null;
  if (!add({ id: 'configuration', label: 'Connection configuration', outcome: configProblem ? 'failed' : 'passed', detail: configProblem ?? `Contract ${i.contractVersion}, ${c.authMethod} authentication, ${c.timeoutSeconds}s timeout.` })) return finish('Connection configuration is invalid.');

  // 2. Authentication
  if (c.target === 'external' && c.credential !== 'stored') {
    add({ id: 'authentication', label: 'Authentication', outcome: 'failed', detail: 'No credential is held by the FixID secret manager. The secure integration backend isn’t available in this prototype, so real external requests are disabled.' });
    return finish('Authentication failed.');
  }
  try {
    await transport.authenticate();
    add({ id: 'authentication', label: 'Authentication', outcome: 'passed', detail: transport.simulated ? 'Simulated credential accepted (no real secret is used).' : 'Credential accepted.' });
  } catch (e) {
    add({ id: 'authentication', label: 'Authentication', outcome: 'failed', detail: (e as Error).message });
    return finish(failure(e, 'Authentication failed.'));
  }

  let schemaOk = true;
  // 3. Lookup
  if (has(i, 'lookup')) {
    try {
      const found = { requestId: 'TEST-LOOKUP-1', referenceType: 'EXTERNAL_ID' as const, referenceValue: 'DEMO-10001', purpose: 'IDENTITY_VERIFICATION' as const };
      const missing = { ...found, requestId: 'TEST-LOOKUP-2', referenceValue: 'DEMO-20001' };
      const a = await transport.lookup(found);
      const b = await transport.lookup(missing);
      const problem = lookupSchemaProblem(a, found.requestId) ?? lookupSchemaProblem(b, missing.requestId)
        ?? ((a as LookupResponseV1).status !== 'FOUND' || (b as LookupResponseV1).status !== 'NOT_FOUND' ? 'Test references didn’t return FOUND and NOT_FOUND.' : null);
      if (problem) { schemaOk = false; add({ id: 'lookup', label: 'Lookup endpoint compatibility', outcome: 'failed', detail: problem }); return finish('Lookup contract validation failed.'); }
      add({ id: 'lookup', label: 'Lookup endpoint compatibility', outcome: 'passed', detail: 'FOUND and NOT_FOUND responses follow contract 1.0.' });
    } catch (e) {
      add({ id: 'lookup', label: 'Lookup endpoint compatibility', outcome: 'failed', detail: (e as Error).message });
      return finish(failure(e, 'Lookup contract validation failed.'));
    }
  } else add({ id: 'lookup', label: 'Lookup endpoint compatibility', outcome: 'skipped', detail: 'Identity Record Lookup isn’t enabled.' });

  // 4. Matching
  if (has(i, 'matching')) {
    try {
      const req: BiometricMatchRequest = { requestId: 'TEST-MATCH-1', referenceId: 'REF-10001', modality: 'FACE', captureReference: 'SIM-CAPTURE-MATCH' };
      const r = await transport.match(req);
      const problem = matchSchemaProblem(r, req.requestId);
      if (problem) { schemaOk = false; add({ id: 'matching', label: 'Matching endpoint compatibility', outcome: 'failed', detail: problem }); return finish('Matching contract validation failed.'); }
      const m = r as MatchResponseV1;
      add({ id: 'matching', label: 'Matching endpoint compatibility', outcome: 'passed', detail: `${m.status} response follows contract 1.0${m.result ? ` (score ${m.result.score} on scale ${m.result.scoreScale}, provider threshold ${m.result.threshold ?? 'not given'})` : ''}.${transport.simulated ? ' Simulated: no faces were compared.' : ''}` });
    } catch (e) {
      add({ id: 'matching', label: 'Matching endpoint compatibility', outcome: 'failed', detail: (e as Error).message });
      return finish(failure(e, 'Matching contract validation failed.'));
    }
  } else add({ id: 'matching', label: 'Matching endpoint compatibility', outcome: 'skipped', detail: 'Biometric Matching isn’t enabled.' });

  // 5. Schema
  add({ id: 'schema', label: 'Response schema validity', outcome: schemaOk ? 'passed' : 'failed', detail: 'All responses validated against contract 1.0.' });

  // 6. Error handling: an invalid request must come back as a well-formed ERROR.
  try {
    const bad = has(i, 'lookup')
      ? lookupSchemaProblem(await transport.lookup({ requestId: 'TEST-ERR-1', referenceType: 'EXTERNAL_ID', referenceValue: 'DEMO-40001', purpose: 'IDENTITY_VERIFICATION' }), 'TEST-ERR-1')
      : matchSchemaProblem(await transport.match({ requestId: 'TEST-ERR-1', referenceId: 'REF-UNKNOWN', modality: 'FACE', captureReference: 'SIM-CAPTURE-UNSUPPORTED' }), 'TEST-ERR-1');
    if (bad) { add({ id: 'errors', label: 'Error handling', outcome: 'failed', detail: bad }); return finish('The service’s error responses don’t follow the contract.'); }
    add({ id: 'errors', label: 'Error handling', outcome: 'passed', detail: 'An invalid request returned a well-formed ERROR.' });
  } catch (e) {
    add({ id: 'errors', label: 'Error handling', outcome: 'failed', detail: (e as Error).message });
    return finish(failure(e, 'Error handling check failed.'));
  }
  return finish('Connection successful.');
}
