import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY, DEMO_SESSION } from '@/auth/authCore';
import { ALL_PERSONAS, ORG_A, ORG_B, ORG_B1, ORG_C } from '@/data/demoPersonas';
import { permissionsFor } from '@/domain/roles';
import { emptyIntegrationForm, type CustomIntegration, type IntegrationFormValues } from '@/domain/integrations';
import { lookupIdentity, matchBiometric, runConnectionTest } from '@/services/integrations/integrationService';
import { SIMULATED_LOOKUP_REFERENCES, SIMULATED_MATCH_FIXTURES, simulatedLookup, simulatedMatch } from '@/services/integrations/simulatedIdentityService';
import {
  applyActivateIntegration, applyDeactivateIntegration, applyIntegrationTestResult, applyIntegrationTestStarted, applySaveIntegration, integrationFor, integrationsOf,
  usableIntegration,
} from '@/store/integrationOps';
import { loadState } from '@/store/persistence';
import { createInitialState, reducer, type AppState } from '@/store/state';

const AT = new Date().toISOString();
const persona = (id: string) => ALL_PERSONAS.find((p) => p.accountId === id)!;
function as(accountId: string, s = createInitialState(new Date())): AppState {
  const p = persona(accountId);
  return { ...s, data: { ...s.data, admin: { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner', organizationIds: [p.organizationId!] } }, session: { ...s.session, currentOrganizationId: p.organizationId! } };
}
const form = (over: Partial<IntegrationFormValues> = {}): IntegrationFormValues => ({ ...emptyIntegrationForm(), name: 'My Identity Verification Service', referenceLabel: 'External Reference ID', ...over });
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };

/** Saves, tests (healthy simulated service) and returns the state. */
async function savedAndTested(s: AppState, org: string, over: Partial<IntegrationFormValues> = {}, id = 'int_new') {
  s = ok(applySaveIntegration(s, { organizationId: org, id, values: form(over), at: AT })).state;
  s = ok(applyIntegrationTestStarted(s, { organizationId: org, integrationId: id, at: AT })).state;
  const result = await runConnectionTest(integrationFor(s, org, id)!);
  return ok(applyIntegrationTestResult(s, { organizationId: org, integrationId: id, run: { ...result, id: 't1', at: AT, by: 'Test' }, at: AT })).state;
}

function renderApp(path: string, state: AppState = createInitialState(new Date()), accountId?: string) {
  if (accountId) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  const utils = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} {...(accountId ? {} : { authSession: DEMO_SESSION })}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('Simulated Identity Service (contract 1.0)', () => {
  it('returns deterministic lookup outcomes, always marked as simulated', () => {
    const outcomes = SIMULATED_LOOKUP_REFERENCES.map((r) => simulatedLookup({ referenceType: 'EXTERNAL_ID', referenceValue: r.value, requestId: 'R1', purpose: 'IDENTITY_VERIFICATION' }));
    expect(outcomes.map((o) => o.status)).toEqual(['FOUND', 'FOUND', 'NOT_FOUND', 'MULTIPLE_MATCHES', 'UNAVAILABLE', 'ERROR']);
    expect(outcomes.every((o) => o.simulated && o.requestId === 'R1')).toBe(true);
    expect(outcomes[0].record).toMatchObject({ referenceId: 'REF-10001', displayName: 'Sample Person A' });
    // Same input, same output.
    expect(simulatedLookup({ referenceType: 'EXTERNAL_ID', referenceValue: 'DEMO-10001', requestId: 'R1', purpose: 'IDENTITY_VERIFICATION' })).toEqual(outcomes[0]);
  });

  it('returns deterministic matching outcomes from fixtures, keeping the provider’s score semantics', () => {
    const outcomes = SIMULATED_MATCH_FIXTURES.map((f) => simulatedMatch({ requestId: 'R2', referenceId: 'REF-10001', modality: 'FACE', captureReference: f.captureReference }));
    expect(outcomes.map((o) => o.status)).toEqual(['MATCH', 'NO_MATCH', 'INCONCLUSIVE', 'UNAVAILABLE', 'ERROR']);
    expect(outcomes[0]).toMatchObject({ simulated: true, result: { score: 0.96, scoreScale: '0_TO_1', threshold: 0.85 } });
    expect(simulatedMatch({ requestId: 'R3', referenceId: 'REF-UNKNOWN', modality: 'FACE', captureReference: 'SIM-CAPTURE-MATCH' }).status).toBe('ERROR');
  });

  it('lookups and matches return minimized, validated results and change nothing in FixID', async () => {
    const s = createInitialState(new Date());
    const before = JSON.stringify(s.data);
    const i = integrationFor(s, ORG_B, 'int_b_identity')!;
    const found = await lookupIdentity(i, 'DEMO-10001');
    // recordType isn't a permitted attribute, so it never reaches FixID.
    expect(found).toEqual({ status: 'FOUND', referenceId: 'REF-10001', displayName: 'Sample Person A', permittedAttributes: { displayName: 'Sample Person A', recordStatus: 'ACTIVE' }, simulated: true });
    expect(await matchBiometric(i, { referenceId: 'REF-10001', captureReference: 'SIM-CAPTURE-MATCH' })).toMatchObject({ status: 'MATCH', score: 0.96, scoreScale: '0_TO_1', threshold: 0.85, simulated: true });
    expect(await matchBiometric(i, { referenceId: 'REF-10001', captureReference: 'SIM-CAPTURE-INCONCLUSIVE' })).toMatchObject({ status: 'INCONCLUSIVE' });
    // No Person record, enrollment or biometric is created or changed.
    expect(JSON.stringify(s.data)).toBe(before);
  });
});

describe('connection tests', () => {
  const integ = (over: Partial<CustomIntegration> = {}): CustomIntegration => ({ ...integrationFor(createInitialState(new Date()), ORG_B, 'int_b_identity')!, ...over });

  it('validates every check against the contract, and only enabled capabilities', async () => {
    const all = await runConnectionTest(integ());
    expect(all).toMatchObject({ ok: true, summary: 'Connection successful.', simulated: true });
    expect(all.checks.map((c) => [c.id, c.outcome])).toEqual([['configuration', 'passed'], ['authentication', 'passed'], ['lookup', 'passed'], ['matching', 'passed'], ['schema', 'passed'], ['errors', 'passed']]);
    const lookupOnly = await runConnectionTest(integ({ capabilities: ['lookup'] }));
    expect(lookupOnly.ok).toBe(true);
    expect(lookupOnly.checks.find((c) => c.id === 'matching')!.outcome).toBe('skipped');
  });

  it('reports meaningful failures for each simulated scenario, and refuses real external requests', async () => {
    expect((await runConnectionTest(integ(), 'auth-failure')).summary).toBe('Authentication failed.');
    expect((await runConnectionTest(integ(), 'lookup-invalid')).summary).toBe('Lookup contract validation failed.');
    expect((await runConnectionTest(integ(), 'matching-invalid')).summary).toBe('Matching contract validation failed.');
    expect((await runConnectionTest(integ(), 'unavailable')).summary).toBe('Service unavailable.');
    expect((await runConnectionTest(integ(), 'timeout')).summary).toBe('Request timed out.');
    const external = integrationFor(createInitialState(new Date()), ORG_B1, 'int_d_harbourside')!;
    const r = await runConnectionTest(external);
    expect(r).toMatchObject({ ok: false, summary: 'Authentication failed.', simulated: false });
    expect(r.checks.find((c) => c.id === 'authentication')!.detail).toMatch(/real external requests are disabled/);
  });
});

describe('integration lifecycle and access (store)', () => {
  it('Draft until validated; activation needs a passing test; sensitive edits need retesting; deactivation blocks new use', async () => {
    let s = as('acct_demo_a_admin');
    s = ok(applySaveIntegration(s, { organizationId: ORG_A, id: 'int_new', values: form(), at: AT })).state;
    expect(integrationFor(s, ORG_A, 'int_new')).toMatchObject({ status: 'draft', organizationId: ORG_A, contractVersion: '1.0', configVersion: 1 });
    expect(applyActivateIntegration(s, { organizationId: ORG_A, integrationId: 'int_new', at: AT })).toMatchObject({ ok: false });
    s = await savedAndTested(s, ORG_A);
    s = ok(applyActivateIntegration(s, { organizationId: ORG_A, integrationId: 'int_new', at: AT })).state;
    expect(usableIntegration(s, ORG_A, 'int_new', 'matching')).toMatchObject({ ok: true });
    // A name change isn't security-sensitive.
    s = ok(applySaveIntegration(s, { organizationId: ORG_A, id: 'int_new', values: form({ name: 'Renamed Service' }), at: AT })).state;
    expect(integrationFor(s, ORG_A, 'int_new')!.status).toBe('active');
    // Changing the authentication method is: back to Draft, test no longer counts.
    s = ok(applySaveIntegration(s, { organizationId: ORG_A, id: 'int_new', values: form({ name: 'Renamed Service', authMethod: 'api-key' }), at: AT })).state;
    expect(integrationFor(s, ORG_A, 'int_new')).toMatchObject({ status: 'draft', configVersion: 2, validatedConfigVersion: undefined });
    expect(applyActivateIntegration(s, { organizationId: ORG_A, integrationId: 'int_new', at: AT })).toMatchObject({ ok: false });
    s = await savedAndTested(s, ORG_A, { name: 'Renamed Service', authMethod: 'api-key' });
    s = ok(applyActivateIntegration(s, { organizationId: ORG_A, integrationId: 'int_new', at: AT })).state;
    s = ok(applyDeactivateIntegration(s, { organizationId: ORG_A, integrationId: 'int_new', at: AT })).state;
    expect(integrationFor(s, ORG_A, 'int_new')!.status).toBe('inactive');
    expect(usableIntegration(s, ORG_A, 'int_new', 'lookup')).toMatchObject({ ok: false, error: expect.stringMatching(/isn’t active/) });
    expect(s.data.audit.slice(0, 2).map((e) => e.action)).toEqual(['integration.deactivated', 'integration.activated']);
  });

  it('a lookup-only integration activates without matching; a failed test puts it in Error', async () => {
    let s = await savedAndTested(as('acct_demo_a_admin'), ORG_A, { capabilities: ['lookup'] });
    expect(integrationFor(s, ORG_A, 'int_new')!.validatedConfigVersion).toBe(1);
    s = ok(applyIntegrationTestStarted(s, { organizationId: ORG_A, integrationId: 'int_new', at: AT })).state;
    expect(integrationFor(s, ORG_A, 'int_new')!.status).toBe('testing');
    const failed = await runConnectionTest(integrationFor(s, ORG_A, 'int_new')!, 'unavailable');
    s = ok(applyIntegrationTestResult(s, { organizationId: ORG_A, integrationId: 'int_new', run: { ...failed, id: 't2', at: AT, by: 'Test' }, at: AT })).state;
    expect(integrationFor(s, ORG_A, 'int_new')).toMatchObject({ status: 'error', validatedConfigVersion: undefined });
    expect(applyActivateIntegration(s, { organizationId: ORG_A, integrationId: 'int_new', at: AT })).toMatchObject({ ok: false });
  });

  it('each organization sees only its own; roles without the permission can’t change anything', () => {
    const s = createInitialState(new Date());
    expect(integrationsOf(s, ORG_A)).toEqual([]);
    expect(integrationsOf(s, ORG_B).map((i) => [i.name, i.status])).toEqual([['Group Identity Service', 'active']]);
    // Brightwater: the draft Attendee Records Service, plus the active Brightwater Identity Service used by programme scenarios C and D.
    expect(integrationsOf(s, ORG_C).map((i) => [i.name, i.status])).toEqual([['Attendee Records Service', 'draft'], ['Brightwater Identity Service', 'active']]);
    expect(integrationsOf(s, ORG_B1).map((i) => i.status)).toEqual(['error']);
    // Parent and sub-organization never see each other's integrations.
    expect(integrationFor(s, ORG_B, 'int_d_harbourside')).toBeUndefined();
    expect(integrationFor(s, ORG_B1, 'int_b_identity')).toBeUndefined();
    expect(usableIntegration(s, ORG_B1, 'int_b_identity', 'lookup')).toMatchObject({ ok: false });
    // Verifier and Auditor.
    expect(permissionsFor(['verifier']).has('integrations.view')).toBe(false);
    expect(permissionsFor(['auditor']).has('integrations.view')).toBe(true);
    expect(permissionsFor(['auditor']).has('integrations.manage')).toBe(false);
    const auditor = as(`${ORG_A}_usr_2`, s);
    expect(applySaveIntegration(auditor, { organizationId: ORG_A, id: 'x', values: form(), at: AT })).toMatchObject({ ok: false });
    // A change aimed at another organization's integration is refused, even by its parent's Organization Admin.
    const parent = as('acct_demo_b_admin', s);
    expect(reducer(parent, { type: 'integrations/deactivate', organizationId: ORG_B1, integrationId: 'int_d_harbourside', at: AT })).toBe(parent);
    expect(applyDeactivateIntegration(parent, { organizationId: ORG_B, integrationId: 'int_d_harbourside', at: AT })).toMatchObject({ ok: false });
  });

  it('keeps no secrets in workspace data', () => {
    const s = createInitialState(new Date());
    const json = JSON.stringify(s.data.customIntegrations);
    expect(json).not.toMatch(/"(clientSecret|apiKey|secret|privateKey|password)"\s*:\s*"/i);
    for (const i of s.data.customIntegrations) expect(['simulated', 'stored', 'missing']).toContain(i.connection.credential);
  });
});

describe('Settings → Integrations (screens)', () => {
  it('Organization A: empty state, then add, test, activate and deactivate a simulated integration', async () => {
    const { user } = renderApp('/settings?tab=integrations', createInitialState(new Date()), 'acct_demo_a_admin');
    expect(await screen.findByText('FixID Local Verification', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Verify people against identity references enrolled and managed within your organization.')).toBeInTheDocument();
    expect(await screen.findByText('No custom identity services have been configured.')).toBeInTheDocument();
    expect(screen.getByText('Connect an authorized identity service to look up identity records and perform verification.')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add Custom Integration' })[0]);
    const wizard = screen.getByRole('dialog', { name: 'Add custom integration' });
    await user.click(within(wizard).getByRole('button', { name: 'Continue' }));
    expect(within(wizard).getByText('Enter an integration name.')).toBeInTheDocument();
    await user.type(within(wizard).getByLabelText(/Integration Name/), 'Campus Identity Service');
    await user.type(within(wizard).getByLabelText(/Reference Identifier Label/), 'External Reference ID');
    await user.click(within(wizard).getByRole('button', { name: 'Continue' }));
    // Step 2: no secret is ever typed into the browser.
    expect(within(wizard).queryByLabelText(/secret/i)).toBeNull();
    expect(wizard.querySelector('input[type="password"]')).toBeNull();
    expect(within(wizard).getByText(/No real secret is needed or collected/)).toBeInTheDocument();
    await user.click(within(wizard).getByRole('button', { name: 'Continue' }));
    expect(within(wizard).getByLabelText('API contract 1.0')).toHaveTextContent('Operation A — Identity Record Lookup');
    expect(within(wizard).getByLabelText('API contract 1.0')).toHaveTextContent('Operation B — Biometric Matching');
    await user.click(within(wizard).getByRole('button', { name: 'Continue' }));
    await user.click(within(wizard).getByRole('button', { name: 'Save integration' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Campus Identity Service' })).toBeInTheDocument();
    expect(screen.getByLabelText('Integration details')).toHaveTextContent('Connection statusDraft');
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();

    // A failing simulated scenario: Error, still can't activate.
    await user.click(screen.getByRole('button', { name: 'Test Connection' }));
    let dialog = screen.getByRole('dialog', { name: 'Test Campus Identity Service' });
    expect(dialog).toHaveTextContent('No real biometric comparison happens.');
    await user.selectOptions(within(dialog).getByLabelText('Demo tools — simulation only'), 'auth-failure');
    await user.click(within(dialog).getByRole('button', { name: 'Run test' }));
    expect(await within(dialog).findByRole('status', { name: 'Test result' })).toHaveTextContent('Authentication failed. (simulated)');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByLabelText('Integration details')).toHaveTextContent('Connection statusError');

    await user.click(screen.getByRole('button', { name: 'Test Connection' }));
    dialog = screen.getByRole('dialog', { name: 'Test Campus Identity Service' });
    await user.click(within(dialog).getByRole('button', { name: 'Run test' }));
    expect(await within(dialog).findByRole('status', { name: 'Test result' })).toHaveTextContent('Connection successful. (simulated)');
    expect(dialog).toHaveTextContent('Simulated: no faces were compared.');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(screen.getByLabelText('Integration details')).toHaveTextContent('Connection statusActive'));
    expect(screen.getByRole('list', { name: 'Test history' }).querySelectorAll(':scope > li')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const confirm = screen.getByRole('dialog', { name: 'Deactivate Campus Identity Service?' });
    expect(confirm).toHaveTextContent('isn’t used by any verification configuration');
    await user.click(within(confirm).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(screen.getByLabelText('Integration details')).toHaveTextContent('Connection statusInactive'));
    expect(loadState()!.data.customIntegrations.find((i) => i.name === 'Campus Identity Service')).toMatchObject({ organizationId: ORG_A, status: 'inactive' });
  }, 30_000);

  it('Organization B lists its active service; its sub-organization’s integration isn’t reachable by URL', async () => {
    const a = renderApp('/settings?tab=integrations', createInitialState(new Date()), 'acct_demo_b_admin');
    const row = await screen.findByRole('row', { name: /Group Identity Service/ }, { timeout: 4000 });
    expect(row).toHaveTextContent('Active');
    expect(row).toHaveTextContent('Identity Record Lookup');
    expect(row).toHaveTextContent('Biometric Matching');
    expect(screen.queryByText('Harbourside Identity Service')).toBeNull();
    a.unmount();
    renderApp('/settings/integrations/int_d_harbourside', createInitialState(new Date()), 'acct_demo_b_admin');
    expect(await screen.findByRole('heading', { name: 'Integration not available' }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('the sub-organization sees its own failed integration, can’t activate it, and can’t reach the parent’s', async () => {
    const a = renderApp('/settings/integrations/int_d_harbourside', createInitialState(new Date()), 'acct_demo_b1_admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Harbourside Identity Service' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Integration details')).toHaveTextContent('Connection statusError');
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
    expect(screen.getByLabelText('Connection configuration')).toHaveTextContent('Not stored: the secret manager isn’t available in this prototype');
    a.unmount();
    renderApp('/settings/integrations/int_b_identity', createInitialState(new Date()), 'acct_demo_b1_admin');
    expect(await screen.findByRole('heading', { name: 'Integration not available' }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('Auditor: read-only metadata, no connection details or actions; Verifier: no access', async () => {
    const s = createInitialState(new Date());
    s.session.currentOrganizationId = ORG_B;
    const auditorView = reducer(s, { type: 'preview/start', roleId: 'auditor' });
    const a = renderApp('/settings/integrations/int_b_identity', auditorView);
    expect(await screen.findByRole('heading', { level: 1, name: 'Group Identity Service' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Connection configuration')).toBeNull();
    expect(screen.getByText(/Connection details are visible only to administrators who manage integrations/)).toBeInTheDocument();
    for (const name of ['Edit configuration', 'Test Connection', 'Activate', 'Deactivate']) expect(screen.queryByRole('button', { name })).toBeNull();
    a.unmount();
    const b = renderApp('/settings?tab=integrations', createInitialState(new Date()), 'acct_demo_b1_verifier');
    expect(await screen.findByRole('heading', { name: "You don't have access to this page" }, { timeout: 4000 })).toBeInTheDocument();
    b.unmount();
    renderApp('/settings/integrations/int_d_harbourside', createInitialState(new Date()), 'acct_demo_b1_verifier');
    expect(await screen.findByRole('heading', { name: "You don't have access to this page" }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('Platform Administrator sees integration status and error summaries, not configuration', async () => {
    renderApp('/platform', createInitialState(new Date()), 'acct_demo_platform');
    expect(await screen.findByRole('heading', { level: 1, name: 'Platform overview' }, { timeout: 4000 })).toBeInTheDocument();
    const table = screen.getAllByRole('table')[1];
    expect(within(table).getByRole('row', { name: /Harbourside Identity Service/ })).toHaveTextContent('Authentication failed.');
    expect(document.body.textContent).not.toMatch(/identity\.harbourside\.example|fixid-harbourside/);
  });
});
