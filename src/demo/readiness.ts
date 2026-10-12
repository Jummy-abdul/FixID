import { DEMO_PERSONAS } from '@/data/demoPersonas';
import { exceptionsOf } from '@/store/exceptionOps';
import type { AppState } from '@/store/state';
import { SCENARIOS, type CheckResult } from './scenarios';

/**
 * Demonstration readiness: what can be checked from stored data is checked; what needs a person to look
 * (screens, wording, a real browser) is listed as Not Tested until someone confirms it outside the app.
 */
export function readinessChecklist(state: AppState, demoEnabled: boolean): CheckResult[] {
  const d = state.data;
  const r = (label: string, ok: boolean, yes: string, no: string, kind: CheckResult['kind'] = 'data'): CheckResult => ({ label, status: ok ? 'passed' : 'failed', detail: ok ? yes : no, kind });
  const manual = (label: string, detail: string): CheckResult => ({ label, status: 'not-tested', detail, kind: 'outcome' });
  const blocked = SCENARIOS.filter((s) => s.prerequisites(state).length);
  const json = JSON.stringify(d);
  return [
    r('Demonstration build', demoEnabled, 'Demo accounts and tools are enabled (VITE_DEMO_AUTH is not off).', 'Demo tools are disabled in this build.', 'permission'),
    r('Seeded organizations present', ['org_northbridge', 'org_meridian', 'org_meridian_harbourside', 'org_meridian_eastgate', 'org_lts'].every((id) => d.organizations.some((o) => o.id === id)), 'A, B, B1, B2 and C exist.', 'A seeded organization is missing. Reset the demo data.'),
    r('Demonstration accounts linked to workspaces', DEMO_PERSONAS.filter((p) => p.organizationId).every((p) => d.administrators.some((a) => a.userId === p.accountId && a.organizationId === p.organizationId && a.status === 'active')), 'Every persona has an active administrator record.', 'A persona has no active administrator record. Reset the demo data.', 'permission'),
    r('Every scenario can be loaded', blocked.length === 0, `${SCENARIOS.length} scenarios ready.`, `Missing prerequisites: ${blocked.map((s) => s.id).join(', ')}.`),
    r('Seeded transactions and exceptions present', d.verificationAttempts.length >= 9 && exceptionsOf(state).length >= 3, `${d.verificationAttempts.length} transactions, ${exceptionsOf(state).length} exceptions.`, 'Seeded transactions are missing. Reset the demo data.'),
    r('No integration credentials stored', !/"(secret|password|clientSecret|privateKey)"\s*:/i.test(JSON.stringify(d.customIntegrations ?? [])), 'Integrations store a credential status only.', 'Secret-like fields found in integrations.', 'permission'),
    r('No raw biometric images stored', !json.includes('data:image'), 'No image data in stored records.', 'Image data found in stored records.', 'permission'),
    r('Simulated services labelled', (d.customIntegrations ?? []).filter((i) => i.connection.target === 'simulated').every((i) => i.tests.every((t) => t.simulated)), 'Simulated connection tests are marked simulated.', 'A simulated test isn’t marked.'),
    manual('Walk through each scenario in a browser', 'Run each scenario from the control centre and evaluate it; record results outside the app.'),
    manual('Presenter familiar with Load, Run, Evaluate and Reset', 'Confirm before the session.'),
    manual('Browser storage cleared or reset before the demonstration', 'Use Reset Demo Data, or a fresh browser profile.'),
    manual('Known limitations communicated', 'Prototype: browser-only data, simulated identity services, no production isolation. See the README.'),
  ];
}
