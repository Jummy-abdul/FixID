import { ORG_B, ORG_B1, ORG_B2, ORG_C } from '@/data/demoPersonas';
import { minimizeLookup, toMatchResult } from '@/services/integrations/contract';
import { simulatedLookup, simulatedMatch } from '@/services/integrations/simulatedIdentityService';
import { WEB_CLIENT } from './attemptOps';
import { reducer, type Action, type AppState } from './state';

/**
 * Demonstration verification history (all fictional, all simulated). Each transaction is produced by the
 * same reducer steps a verifier's actions produce (start, lookup, liveness and matching, end), against the
 * Simulated Identity Service, so the records, exceptions and audit events are what the application itself
 * would have stored. Nothing is written directly. Timestamps are in the recent past, relative to `now`.
 */

interface Step {
  key: string;
  org: string;
  userId: string;
  activityId: string;
  daysAgo: number;
  reference: string;
  /** Simulated liveness result and matching fixture; omitted when the lookup doesn't find one identity. */
  liveness?: 'passed' | 'failed';
  match?: string;
  /** End the transaction after an unsuccessful lookup. */
  end?: boolean;
}

const STEPS: Step[] = [
  // Meridian programme, Harbourside (Tomi Okon): a success, a mismatch for programme review, an eligibility question.
  { key: 'D01', org: ORG_B1, userId: 'acct_demo_b1_verifier', activityId: `${ORG_B1}_va_staff_entry`, daysAgo: 6, reference: 'DEMO-10001', liveness: 'passed', match: 'SIM-CAPTURE-MATCH' },
  { key: 'D02', org: ORG_B1, userId: 'acct_demo_b1_verifier', activityId: `${ORG_B1}_va_staff_entry`, daysAgo: 3, reference: 'DEMO-10001', liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' },
  { key: 'D03', org: ORG_B1, userId: 'acct_demo_b1_verifier', activityId: `${ORG_B1}_va_staff_entry`, daysAgo: 2, reference: 'DEMO-10002', liveness: 'passed', match: 'SIM-CAPTURE-MATCH' },
  // Meridian programme, Eastgate (Mira Santos): a success and an identity service outage.
  { key: 'D04', org: ORG_B2, userId: 'acct_demo_b2_admin', activityId: `${ORG_B2}_va_contractor_check`, daysAgo: 5, reference: 'DEMO-10001', liveness: 'passed', match: 'SIM-CAPTURE-MATCH' },
  { key: 'D05', org: ORG_B2, userId: 'acct_demo_b2_admin', activityId: `${ORG_B2}_va_contractor_check`, daysAgo: 1, reference: 'DEMO-50001', end: true },
  // Brightwater (Tobyson): a success, a definitive denial (no exception), a mismatch for local review, an outage.
  { key: 'D06', org: ORG_C, userId: 'usr_tobyson', activityId: `${ORG_C}_va_delegate_checkin`, daysAgo: 4, reference: 'DEMO-10001', liveness: 'passed', match: 'SIM-CAPTURE-MATCH' },
  { key: 'D07', org: ORG_C, userId: 'usr_tobyson', activityId: `${ORG_C}_va_delegate_checkin`, daysAgo: 4, reference: 'DEMO-10002', liveness: 'passed', match: 'SIM-CAPTURE-MATCH' },
  { key: 'D08', org: ORG_C, userId: 'usr_tobyson', activityId: `${ORG_C}_va_speaker_lounge`, daysAgo: 2, reference: 'DEMO-10001', liveness: 'passed', match: 'SIM-CAPTURE-NO-MATCH' },
  { key: 'D09', org: ORG_C, userId: 'usr_tobyson', activityId: `${ORG_C}_va_delegate_checkin`, daysAgo: 1, reference: 'DEMO-10001', liveness: 'passed', match: 'SIM-CAPTURE-UNAVAILABLE' },
];

export function seedDemoTransactions(initial: AppState, now: Date): AppState {
  if (!initial.data.activityConfigs.some((a) => a.id === `${ORG_C}_va_delegate_checkin`)) return initial;
  let s = initial;
  const as = (userId: string, org: string) => {
    s = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: userId } }, session: { ...s.session, currentOrganizationId: org } };
  };
  const run = (a: Action) => { s = reducer(s, a); };
  const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000).toISOString();

  for (const step of STEPS) {
    const at = new Date(now.getTime() - step.daysAgo * 86_400_000);
    at.setHours(10, Number(step.key.slice(1)) * 5, 0, 0);
    const id = `VER-${at.toISOString().slice(0, 10).replace(/-/g, '')}-${step.key}`;
    as(step.userId, step.org);
    run({ type: 'verify/start', organizationId: step.org, activityId: step.activityId, attemptId: id, at: at.toISOString(), client: WEB_CLIENT });
    const requestId = `${id}-L1`;
    const result = minimizeLookup(simulatedLookup({ referenceType: 'EXTERNAL_ID', referenceValue: step.reference, requestId, purpose: 'IDENTITY_VERIFICATION' }),
      s.data.customIntegrations.find((i) => i.id === s.data.verificationAttempts.find((x) => x.id === id)?.integrationId)?.permittedAttributes ?? []);
    run({ type: 'verify/lookup', attemptId: id, at: minutes(at, 1), reference: step.reference, requestId, result });
    if (step.end) { run({ type: 'verify/end', attemptId: id, at: minutes(at, 2) }); continue; }
    if (!step.match) continue;
    const attempt = s.data.verificationAttempts.find((x) => x.id === id);
    if (!attempt?.lookup?.referenceId) continue;
    const m = toMatchResult(simulatedMatch({ requestId: `${id}-M1`, referenceId: attempt.lookup.referenceId, modality: 'FACE', captureReference: step.match }));
    const status = ({ MATCH: 'match', NO_MATCH: 'no-match', INCONCLUSIVE: 'inconclusive', UNAVAILABLE: 'unavailable', ERROR: 'error' } as const)[m.status];
    run({
      type: 'verify/externalComplete', input: {
        attemptId: id, submissionId: `seed-${step.key}`, at: minutes(at, 3), liveness: { status: step.liveness ?? 'passed', simulated: true },
        match: { status, simulated: true, service: attempt.serviceName, requestId: `${id}-M1`, ...(m.providerTransactionId ? { providerTransactionId: m.providerTransactionId } : {}), ...(m.score !== undefined && m.scoreScale ? { score: m.score, scoreScale: m.scoreScale, threshold: m.threshold } : {}) },
        ...(m.message && (m.status === 'UNAVAILABLE' || m.status === 'ERROR') ? { diagnostic: m.message } : {}),
      },
    });
  }

  // Programme review in progress: Victor Hale (Meridian) takes the eligibility exception and adds a note.
  const eligibility = (s.data.verificationExceptions ?? []).find((e) => e.reason === 'eligibility-not-met' && e.route === 'programme');
  if (eligibility) {
    as('acct_demo_b_admin', ORG_B);
    const reviewer = s.data.administrators.find((a) => a.organizationId === ORG_B && a.userId === 'acct_demo_b_admin');
    const at = new Date(now.getTime() - 1 * 86_400_000);
    if (reviewer) {
      run({ type: 'exceptions/assign', organizationId: ORG_B, exceptionId: eligibility.id, reviewerId: reviewer.id, at: at.toISOString() });
      run({ type: 'exceptions/startReview', organizationId: ORG_B, exceptionId: eligibility.id, at: minutes(at, 5) });
      run({ type: 'exceptions/note', organizationId: ORG_B, exceptionId: eligibility.id, comment: 'The identity service reports the record as suspended. Checking whether the suspension is still current.', evidenceRefs: ['CASE-NOTE-001'], at: minutes(at, 10) });
    }
  }
  return { ...s, data: { ...s.data, admin: initial.data.admin }, session: initial.session };
}
