import { ORG_A, ORG_B, ORG_B1, ORG_B2, ORG_C } from '@/data/demoPersonas';
import { DEMO_LOCAL_PEOPLE, DEMO_SHARED_ACTIVITY } from '@/data/seed';
import { evaluateDecision } from '@/domain/transactions';
import type { VerificationAttempt } from '@/domain/types';
import { getVerificationStatus } from '@/services/statusApi/statusApi';
import { WEB_CLIENT, authorizeExecution } from '@/store/attemptOps';
import { applyResolveException, exceptionsOf, exceptionsVisibleTo } from '@/store/exceptionOps';
import { integrationsOf } from '@/store/integrationOps';
import { activityPolicy, activityPolicyProblems, participation } from '@/store/sharingOps';
import { applySaveActivity } from '@/store/activityOps';
import { sharedActivityTransactions, sharedResults, summarize } from '@/store/reporting';
import { transactionPolicy } from '@/store/transactionOps';
import type { AppState } from '@/store/state';

/**
 * Demo Control Centre scenarios (demonstration builds only). One reusable definition model: each scenario
 * says what it sets out to show, who performs each step through the normal sign-in, which screens to use,
 * and how to check the result against the application's actual stored state. Evaluation only looks at
 * records created after the scenario was loaded (the baseline), never at what screens were visited, and a
 * check that can't be observed from stored state is reported as Not Tested, never Passed.
 */

export type CheckStatus = 'passed' | 'failed' | 'not-tested';
export interface CheckResult { label: string; status: CheckStatus; detail: string; kind: 'outcome' | 'permission' | 'data' }

/** What existed when the scenario was loaded. */
export interface Baseline {
  at: string;
  attemptIds: string[];
  exceptionIds: string[];
  /** Exception status and history length when loaded, to see what changed. */
  exceptionStates: Record<string, { status: string; history: number }>;
  auditIds: string[];
  memberCount: number;
  integrationIds: string[];
  activityIds: string[];
  /** Stored verification settings of shared activities (to see whether they changed). */
  activitySettings: Record<string, string>;
}

export function takeBaseline(state: AppState): Baseline {
  return {
    at: new Date().toISOString(),
    attemptIds: state.data.verificationAttempts.map((a) => a.id),
    exceptionIds: exceptionsOf(state).map((e) => e.id),
    exceptionStates: Object.fromEntries(exceptionsOf(state).map((e) => [e.id, { status: e.status, history: e.history.length }])),
    auditIds: state.data.audit.map((a) => a.id),
    memberCount: state.data.members.length,
    integrationIds: (state.data.customIntegrations ?? []).map((i) => i.id),
    activityIds: state.data.activityConfigs.map((a) => a.id),
    activitySettings: Object.fromEntries(state.data.activityConfigs.filter((a) => a.sharing).map((a) => [a.id, JSON.stringify(a.verification ?? null)])),
  };
}

/** Records created since the baseline. */
export function sinceBaseline(state: AppState, b: Baseline) {
  const attempts = new Set(b.attemptIds); const exc = new Set(b.exceptionIds); const audit = new Set(b.auditIds);
  return {
    attempts: state.data.verificationAttempts.filter((a) => !attempts.has(a.id) && a.status !== 'in-progress'),
    exceptions: exceptionsOf(state).filter((e) => !exc.has(e.id)),
    changedExceptions: exceptionsOf(state).filter((e) => exc.has(e.id) && (b.exceptionStates[e.id]?.history ?? 0) < e.history.length),
    audit: state.data.audit.filter((a) => !audit.has(a.id)),
    newMembers: state.data.members.length - b.memberCount,
    integrations: (state.data.customIntegrations ?? []).filter((i) => !b.integrationIds.includes(i.id)),
    activities: state.data.activityConfigs.filter((a) => !b.activityIds.includes(a.id)),
  };
}

export interface ScenarioStep {
  title: string;
  /** Demonstration account (email) to sign in as for this step. */
  account?: string;
  /** Where to start, computed from current state when needed. */
  route?: string | ((state: AppState) => string);
  instructions: string;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  purpose: string;
  initialData: string;
  organizationStructure: string;
  users: string[];
  /** The shared activity the scenario uses, if any. */
  sharedActivity?: string;
  activity: string;
  identitySource: string;
  integration: string;
  eligibility: string;
  controls: string[];
  expectedOutcome: string;
  expectedTransactionState: string;
  expectedExceptionState?: string;
  permissionBoundaries: string[];
  steps: ScenarioStep[];
  resetBehavior: string;
  /** Missing prerequisites (empty when the scenario can be run). */
  prerequisites: (state: AppState) => string[];
  evaluate: (state: AppState, baseline: Baseline) => CheckResult[];
}

/* ---------------- helpers ---------------- */

const ACCOUNTS = {
  platform: 'platform.admin@fixid.example',
  aAdmin: 'esther.lawal@northbridge.example',
  aAuditor: 'adaora.nwosu@northbridge.example',
  owner: 'victor.hale@meridian.example',
  reviewer: 'sam.rivera@meridian.example',
  b1Admin: 'lina.ford@harbourside.example',
  b1Verifier: 'tomi.okon@harbourside.example',
  b2Admin: 'mira.santos@eastgate.example',
  cAdmin: 'jordan.blake@brightwater.example',
  cVerifier: 'halima.bello@brightwater.example',
  cAuditor: 'adaora.nwosu@brightwater.example',
} as const;
export const SCENARIO_ACCOUNTS = ACCOUNTS;

const VISITOR = `${ORG_C}_va_visitor_checkin`;
const LOUNGE = `${ORG_C}_va_restricted_lounge`;
const BADGE = `${ORG_C}_va_badge_collection`;
const STAFF = DEMO_SHARED_ACTIVITY;

const pass = (label: string, detail: string, kind: CheckResult['kind'] = 'outcome'): CheckResult => ({ label, status: 'passed', detail, kind });
const fail = (label: string, detail: string, kind: CheckResult['kind'] = 'outcome'): CheckResult => ({ label, status: 'failed', detail, kind });
const untested = (label: string, detail: string, kind: CheckResult['kind'] = 'outcome'): CheckResult => ({ label, status: 'not-tested', detail, kind });
const check = (label: string, ok: boolean, yes: string, no: string, kind: CheckResult['kind'] = 'outcome') => (ok ? pass(label, yes, kind) : fail(label, no, kind));

/** A check that needs a transaction: Not Tested until one exists. */
function withTx(label: string, tx: VerificationAttempt | undefined, test: (a: VerificationAttempt) => [boolean, string], none = 'No matching transaction was created after the scenario was loaded.'): CheckResult {
  if (!tx) return untested(label, none);
  const [ok, detail] = test(tx);
  return ok ? pass(label, detail) : fail(label, detail);
}

const activityExists = (state: AppState, id: string, label: string) => (state.data.activityConfigs.some((a) => a.id === id && a.status === 'active') ? [] : [`${label} isn’t available and active. Reset the demo data.`]);
const integrationActive = (state: AppState, id: string, label: string) => ((state.data.customIntegrations ?? []).some((i) => i.id === id && i.status === 'active') ? [] : [`${label} isn’t active. Reset the demo data.`]);
const noSecrets = (state: AppState) => !/"(secret|password|clientSecret|apiKeyValue|privateKey)"\s*:/i.test(JSON.stringify(state.data.customIntegrations ?? []));
const noRawBiometrics = (state: AppState) => !JSON.stringify(state.data.verificationAttempts).includes('data:image') && !JSON.stringify(exceptionsOf(state)).includes('data:image');
const txLabel = (a: VerificationAttempt) => `${a.id} (${a.activityName})`;
const seededTx = (state: AppState, key: string) => state.data.verificationAttempts.find((a) => a.id.endsWith(`-${key}`));

/* ---------------- scenarios ---------------- */

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'S01', name: 'Independent Organization Setup',
    description: 'An organization configures and launches a verification activity on its own.',
    purpose: 'Show that an organization operates independently without a parent organization, and its records stay in its workspace.',
    initialData: 'Organization A (independent) with administrators, people, groups and local records.',
    organizationStructure: 'Organization A, no parent and no sub-organizations.', users: [ACCOUNTS.aAdmin],
    activity: 'A new activity created during the scenario', identitySource: 'FixID Local Records (or a new private integration)', integration: 'None required',
    eligibility: 'Local eligible population (groups or users)', controls: ['Face verification with liveness (default)', 'At least one assigned verifier'],
    expectedOutcome: 'A new active activity in Organization A with eligibility and a verifier, visible only in that workspace.',
    expectedTransactionState: 'No transaction required.', permissionBoundaries: ['Only Organization A’s administrators can see or change the activity.'],
    steps: [
      { title: 'Inspect the workspace', account: ACCOUNTS.aAdmin, route: '/', instructions: 'Review the dashboard, then Settings → Organization and Administrators & Roles.' },
      { title: 'Identity source', account: ACCOUNTS.aAdmin, route: '/settings?tab=integrations', instructions: 'Local verification is built in. Optionally add a simulated custom integration (see scenario 14).' },
      { title: 'Create and launch an activity', account: ACCOUNTS.aAdmin, route: '/verification-activities/new', instructions: 'Name it, keep FixID Local Records, choose an eligible group on Eligibility & Verifiers, keep yourself (or a verifier) assigned, then Create & Activate.' },
    ],
    resetBehavior: 'Reset Demo Data removes the activity and restores Organization A’s seeded configuration.',
    prerequisites: (s) => (s.data.organizations.some((o) => o.id === ORG_A) ? [] : ['Organization A is missing. Reset the demo data.']),
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const act = d.activities.find((a) => a.organizationId === ORG_A);
      const parent = (s.data.organizationRelationships ?? []).some((r) => r.childOrganizationId === ORG_A);
      return [
        check('No parent organization is required', !parent, 'Organization A has no parent relationship.', 'Organization A has a parent relationship.', 'data'),
        act ? pass('A verification activity was created in Organization A', act.name) : untested('A verification activity was created in Organization A', 'No new activity in Organization A yet.'),
        ...(act ? [
          check('Identity source configured', !!act.verification, `Identity source: ${act.verification?.identitySource.kind === 'external' ? 'external integration' : 'FixID Local Records'}.`, 'The activity has no verification settings.'),
          check('Eligibility defined', act.verification?.eligibility.approach !== 'none' || !!act.participants?.groupIds.length || !!act.participants?.memberIds.length, 'Eligibility requirements are set.', 'No eligibility requirement was set.'),
          check('A verifier is assigned', s.data.verifierAssignments.some((v) => v.activityId === act.id && v.status === 'active'), 'At least one active verifier assignment.', 'No verifier is assigned.'),
          check('The activity was launched', act.status === 'active', 'Status: Active.', `Status: ${act.status}. Activate it to launch.`),
          check('Records stay in the workspace', act.organizationId === ORG_A && !s.data.organizations.filter((o) => o.id !== ORG_A).some((o) => s.data.activityConfigs.some((x) => x.id === act.id && x.organizationId === o.id)), 'The activity belongs to Organization A only.', 'The activity is visible elsewhere.', 'permission'),
        ] : []),
      ];
    },
  },
  {
    id: 'S02', name: 'Shared Activity Across Organizations',
    description: 'An organization’s shared activity is run by another organization from its own workspace.',
    purpose: 'Show one shared activity record: the invited organization accepts, assigns its own staff and verifies; the owner sees that activity’s results only.',
    initialData: 'Organization B’s shared activity Group Staff Entry (B1 and B2 take part; Organization C has a pending invitation).',
    organizationStructure: 'B owns the activity; B1, B2 and C are separate workspaces.', users: [ACCOUNTS.owner, ACCOUNTS.cAdmin, ACCOUNTS.cVerifier],
    sharedActivity: 'Group Staff Entry', activity: 'Group Staff Entry (owned by B)', identitySource: 'Group Identity Service (B’s connected source)',
    integration: 'Group Identity Service — SIMULATED', eligibility: 'Record status in the identity source', controls: ['Face match', 'Liveness required', 'Problems reviewed by the owner'],
    expectedOutcome: 'C takes part without registering again or recreating the activity; its verification is recorded in C’s workspace and counted in B’s results.',
    expectedTransactionState: 'Completed (Allow) for DEMO-10001, performed by C for B’s activity.', permissionBoundaries: ['B sees this activity’s results only, not C’s other records.', 'C can’t change the activity.'],
    steps: [
      { title: 'See the invitation', account: ACCOUNTS.owner, route: `/verification-activities/${STAFF}?tab=organizations`, instructions: 'Organization C is listed as Invited.' },
      { title: 'Accept and assign staff', account: ACCOUNTS.cAdmin, route: '/verification-activities', instructions: 'Under “Shared with your organization”, Accept Group Staff Entry → Manage staff → choose Halima Bello → Save staff.' },
      { title: 'Verify', account: ACCOUNTS.cVerifier, route: `/verify/activities/${STAFF}`, instructions: 'Start Verification → DEMO-10001 → Continue Verification → Use simulated capture → Liveness Passed → Matching Match → Verify Identity.' },
      { title: 'Owner sees the result', account: ACCOUNTS.owner, route: `/verification-activities/${STAFF}?tab=organizations`, instructions: 'Brightwater shows one verification. Open Verification History and filter Performed by.' },
    ],
    resetBehavior: 'Reset Demo Data restores the invitation and removes the transaction.',
    prerequisites: (s) => [...activityExists(s, STAFF, 'Group Staff Entry'), ...integrationActive(s, 'int_b_identity', 'Group Identity Service')],
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const act = s.data.activityConfigs.find((a) => a.id === STAFF);
      const tx = d.attempts.find((a) => a.activityId === STAFF && a.organizationId === ORG_C);
      const assigned = s.data.verifierAssignments.some((v) => v.activityId === STAFF && v.organizationId === ORG_C && v.status === 'active');
      return [
        check('Invited organization accepted', !!act && participation(act, ORG_C) === 'active', 'Organization C takes part.', 'Organization C hasn’t accepted yet.', 'data'),
        check('One shared activity record', s.data.activityConfigs.filter((a) => a.organizationId === ORG_C && a.name === act?.name).length === 0, 'C didn’t recreate the activity.', 'C has a duplicate of the activity.', 'data'),
        check('Participant assigned its own staff', assigned, 'C assigned its own verifier.', 'No C staff assigned yet.', 'data'),
        withTx('Participant verified with the shared activity', tx, (a) => [a.activityOwnerId === ORG_B, `${txLabel(a)} performed by C for B’s activity.`]),
        withTx('Owner’s requirements applied', tx, (a) => [a.integrationId === 'int_b_identity' && !!a.liveness?.required, 'B’s identity source and mandatory liveness were used.']),
        withTx('Owner sees it in the activity’s results', tx, (a) => [!!act && sharedActivityTransactions(s, act).some((x) => x.id === a.id), 'Counted in the shared activity’s results.']),
        check('Owner’s results exclude unrelated activity', !!act && sharedActivityTransactions(s, act).every((x) => x.activityId === STAFF), 'Only this activity’s transactions are counted.', 'Unrelated transactions were counted.', 'permission'),
        check('Unrelated exceptions stay private', !exceptionsVisibleTo(s, ORG_B).some((e) => e.activityId !== STAFF && e.organizationId !== ORG_B), 'The owner sees only its own and this activity’s exceptions.', 'The owner can see unrelated exceptions.', 'permission'),
      ];
    },
  },
  {
    id: 'S03', name: 'Successful Local Verification',
    description: 'A verifier verifies an enrolled person against their FixID enrollment.',
    purpose: 'Validate the local enrollment and verification model, with identity and eligibility kept separate.',
    initialData: `Organization C’s Badge Collection activity; people ${DEMO_LOCAL_PEOPLE.join(', ')} (eligible and enrolled; enrolled but not eligible; not enrolled).`,
    organizationStructure: 'Organization C (independent).', users: [ACCOUNTS.cVerifier],
    activity: 'Badge Collection', identitySource: 'FixID Local Records', integration: 'Simulated facial verification (no real provider configured) — SIMULATED',
    eligibility: 'Local eligible population', controls: ['Face verification', 'Liveness required'],
    expectedOutcome: `Allow for ${DEMO_LOCAL_PEOPLE[0]}, with identity match and eligibility shown separately and labelled Simulated.`,
    expectedTransactionState: 'Completed, decision Allow.', permissionBoundaries: ['Only assigned verifiers can start the activity.'],
    steps: [
      { title: 'Open the assigned activity', account: ACCOUNTS.cVerifier, route: `/verify/activities/${BADGE}`, instructions: 'Start Verification.' },
      { title: 'Identify and verify', account: ACCOUNTS.cVerifier, instructions: `Participant number ${DEMO_LOCAL_PEOPLE[0]} → Find Participant → Continue → Use simulated capture → Liveness Passed → Matching Match → Verify Identity.` },
      { title: 'Open the transaction in history', account: ACCOUNTS.cVerifier, route: '/verify/history', instructions: 'Open the new transaction and review identity, liveness and eligibility.' },
    ],
    resetBehavior: 'Reset Demo Data removes the transaction.',
    prerequisites: (s) => activityExists(s, BADGE, 'Badge Collection'),
    evaluate: (s, b) => {
      const tx = sinceBaseline(s, b).attempts.find((a) => a.activityId === BADGE && a.status === 'completed');
      return [
        withTx('Local transaction recorded', tx, (a) => [a.identitySource === 'local', `${txLabel(a)} uses FixID Local Records.`]),
        withTx('Identity matched', tx, (a) => [a.match?.status === 'match', `Identity match: ${a.match?.status}.`]),
        withTx('Eligibility evaluated separately', tx, (a) => [a.eligibilityStatus === 'eligible', `Eligibility: ${a.eligibilityStatus}.`]),
        withTx('Decision Allow', tx, (a) => [a.decision === 'allow', `Decision: ${a.decision}.`]),
        withTx('Simulated results labelled', tx, (a) => [a.simulated && !!a.match?.simulated, a.simulated ? 'Marked SIMULATED.' : 'Not marked simulated.']),
      ];
    },
  },
  {
    id: 'S04', name: 'Successful External Verification',
    description: 'A person who isn’t in FixID is verified through an external identity service.',
    purpose: 'Validate external lookup and matching without local enrollment.',
    initialData: 'Organization C’s Visitor Check-in activity and its simulated identity service (fictional references).',
    organizationStructure: 'Organization C (independent).', users: [ACCOUNTS.cVerifier],
    activity: 'Visitor Check-in', identitySource: 'Brightwater Identity Service (external)', integration: 'Brightwater Identity Service — SIMULATED (lookup + matching)',
    eligibility: 'External source eligibility (recordStatus = ACTIVE)', controls: ['Face verification', 'Liveness required', 'Failures marked unsuccessful'],
    expectedOutcome: 'Allow for DEMO-10001; no FixID person or enrollment created.', expectedTransactionState: 'Completed, decision Allow, simulated.',
    permissionBoundaries: ['The verifier can’t change the identity service or skip liveness.'],
    steps: [
      { title: 'Open the external activity', account: ACCOUNTS.cVerifier, route: `/verify/activities/${VISITOR}`, instructions: 'Start Verification.' },
      { title: 'Identify, capture and match', account: ACCOUNTS.cVerifier, instructions: 'External Reference ID DEMO-10001 → Find Identity → review the permitted attributes → Continue Verification → Use simulated capture → Liveness Passed → Matching Match → Verify Identity.' },
      { title: 'Inspect the transaction', account: ACCOUNTS.cVerifier, route: '/verify/history', instructions: 'Open it and confirm the identity source and simulated labels.' },
    ],
    resetBehavior: 'Reset Demo Data removes the transaction.',
    prerequisites: (s) => [...activityExists(s, VISITOR, 'Visitor Check-in'), ...integrationActive(s, 'int_c_delegates', 'Brightwater Identity Service')],
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const tx = d.attempts.find((a) => a.activityId === VISITOR && a.lookup?.status === 'FOUND' && a.match?.status === 'match');
      return [
        withTx('External lookup found the identity', tx, (a) => [a.lookup?.status === 'FOUND', `Lookup ${a.lookup?.status} for ${a.lookup?.reference}.`]),
        withTx('The configured integration was used', tx, (a) => [a.integrationId === 'int_c_delegates', `Service: ${a.serviceName}.`]),
        withTx('Decision Allow', tx, (a) => [a.decision === 'allow', `Decision: ${a.decision}.`]),
        withTx('No local person record created', tx, () => [d.newMembers === 0, d.newMembers === 0 ? 'No people were added to FixID.' : `${d.newMembers} people were added.`]),
        withTx('No local enrollment linked', tx, (a) => [!a.subject?.memberId, 'The transaction references the external identity only.']),
      ];
    },
  },
  {
    id: 'S05', name: 'Identity Record Not Found',
    description: 'An external lookup for an unknown reference.',
    purpose: 'Test lookup failure: matching doesn’t proceed and nobody is created locally.',
    initialData: 'Visitor Check-in and its simulated service (DEMO-20001 returns Not Found).', organizationStructure: 'Organization C.', users: [ACCOUNTS.cVerifier],
    activity: 'Visitor Check-in', identitySource: 'Brightwater Identity Service (external)', integration: 'SIMULATED', eligibility: 'External source',
    controls: ['Lookup must find one identity before capture'], expectedOutcome: 'Not Found shown; the attempt is ended and recorded as unresolved.',
    expectedTransactionState: 'Failed (lookup Not Found), decision Not verified.', permissionBoundaries: ['No local Person is created.'],
    steps: [
      { title: 'Start and look up an unknown reference', account: ACCOUNTS.cVerifier, route: `/verify/activities/${VISITOR}`, instructions: 'Start Verification → DEMO-20001 → Find Identity. Read the message.' },
      { title: 'End the attempt', account: ACCOUNTS.cVerifier, instructions: 'Choose End Verification and confirm (or correct the reference to see a successful lookup instead).' },
      { title: 'Inspect the transaction', account: ACCOUNTS.cVerifier, route: '/verify/history', instructions: 'Open the transaction.' },
    ],
    resetBehavior: 'Reset Demo Data removes the transaction.',
    prerequisites: (s) => activityExists(s, VISITOR, 'Visitor Check-in'),
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const tx = d.attempts.find((a) => a.activityId === VISITOR && a.lookup?.status === 'NOT_FOUND');
      const corrected = d.attempts.find((a) => a.activityId === VISITOR && (a.lookup?.count ?? 0) > 1);
      return [
        withTx('Lookup returned Not Found and was recorded', tx, (a) => [true, `${txLabel(a)}: ${a.failureReason}`], corrected ? 'The reference was corrected in the same transaction, so the Not Found result was superseded (lookup count recorded).' : undefined),
        withTx('Matching didn’t proceed', tx, (a) => [a.match?.status === 'not-evaluated' && !a.match.providerTransactionId, 'No matching request was made.']),
        withTx('Not represented as approved', tx, (a) => [a.decision !== 'allow', `Decision: ${a.decision}.`]),
        check('No local Person created', d.newMembers === 0, 'No people were added to FixID.', `${d.newMembers} people were added.`, 'data'),
      ];
    },
  },
  {
    id: 'S06', name: 'Identity Mismatch and Exception Review',
    description: 'A No Match result goes to review, is investigated and reverified.',
    purpose: 'Test the review workflow without changing original evidence.',
    initialData: 'Restricted Lounge Access (review policy, local review queue) and its simulated service.', organizationStructure: 'Organization C.',
    users: [ACCOUNTS.cVerifier, ACCOUNTS.cAdmin], activity: 'Restricted Lounge Access', identitySource: 'Brightwater Identity Service (external)', integration: 'SIMULATED',
    eligibility: 'Reference list (DEMO-10001 is listed)', controls: ['Face verification', 'Liveness required', 'Exceptions require review'],
    expectedOutcome: 'Pending Review with an exception; a note and a resolution or reverification are recorded; the original No Match stays.',
    expectedTransactionState: 'Pending Review; later a reviewed disposition beside the original result.', expectedExceptionState: 'Open → In Review / Awaiting Information → Resolved.',
    permissionBoundaries: ['Only Organization C reviewers can act on the exception.', 'Confirming requires a successful reverification.'],
    steps: [
      { title: 'Produce a mismatch', account: ACCOUNTS.cVerifier, route: `/verify/activities/${LOUNGE}`, instructions: 'DEMO-10001 → Continue → simulated capture → Liveness Passed → Matching No match → Verify Identity. Note the Pending Review result.' },
      { title: 'Review the exception', account: ACCOUNTS.cAdmin, route: '/exceptions?status=unresolved', instructions: 'Open the new Identity mismatch exception → Assign to me → Start Review → Add Review Note → Record decision: Return for a new check.' },
      { title: 'Reverify', account: ACCOUNTS.cVerifier, route: '/verify/history', instructions: 'Open the original transaction → Start Reverification → DEMO-10001, Passed + Match.' },
      { title: 'Resolve', account: ACCOUNTS.cAdmin, route: '/exceptions', instructions: 'Open the exception → Record decision: Approve → Close Exception.' },
    ],
    resetBehavior: 'Reset Demo Data removes the transactions and exception.',
    prerequisites: (s) => activityExists(s, LOUNGE, 'Restricted Lounge Access'),
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const tx = d.attempts.find((a) => a.activityId === LOUNGE && a.match?.status === 'no-match');
      const e = tx?.exceptionId ? exceptionsOf(s).find((x) => x.id === tx.exceptionId) : undefined;
      const re = e ? s.data.verificationAttempts.filter((a) => a.reverificationOf === e.id) : [];
      return [
        withTx('Mismatch transaction is Pending Review', tx, (a) => [a.decision === 'pending-review', `Decision: ${a.decision}.`]),
        withTx('Exception created by policy', tx, () => [!!e, e ? `${e.id} (${e.route} review queue).` : 'No exception.']),
        e ? check('Review note added', e.history.some((h) => h.action === 'note-added'), 'A note is in the review history.', 'No review note yet.') : untested('Review note added', 'No exception yet.'),
        e ? (e.resolution ? pass('Resolution or reverification recorded', `${e.resolution.outcome} by ${e.resolution.by}.`)
          : e.history.some((h) => h.action === 'resolution-recorded' || h.action === 'proposal-submitted') ? pass('Resolution or reverification recorded', 'A review decision is recorded in the history.')
            : untested('Resolution or reverification recorded', 'No resolution yet.')) : untested('Resolution or reverification recorded', 'No exception yet.'),
        withTx('Original match result unchanged', tx, (a) => [a.match?.status === 'no-match', `Original identity match: ${a.match?.status}.`]),
        e ? (re.length ? pass('Reverification created a new linked transaction', re.map((r) => `${r.id}: ${r.decision ?? r.status}`).join(', ')) : untested('Reverification created a new linked transaction', 'No reverification was started.')) : untested('Reverification created a new linked transaction', 'No exception yet.'),
        check('Review actions audited', d.audit.some((x) => x.action.startsWith('exception.')), `${d.audit.filter((x) => x.action.startsWith('exception.')).length} exception audit events.`, 'No exception audit events yet.', 'data'),
      ];
    },
  },
  {
    id: 'S07', name: 'External Service Unavailable',
    description: 'The identity service is unavailable during lookup or matching.',
    purpose: 'Test safe failure: no weaker fallback, never Allow, visible and recorded.',
    initialData: 'Visitor Check-in (simulated service: DEMO-50001 lookup unavailable; matching fixture Service unavailable).', organizationStructure: 'Organization C.',
    users: [ACCOUNTS.cVerifier, ACCOUNTS.cAuditor], activity: 'Visitor Check-in', identitySource: 'Brightwater Identity Service (external)', integration: 'SIMULATED',
    eligibility: 'External source', controls: ['No fallback to another identity source'], expectedOutcome: 'Unable to Decide / Unable to complete; retry starts a new linked transaction.',
    expectedTransactionState: 'Unable to complete.', permissionBoundaries: ['Retry only by the verifier who performed it.'],
    steps: [
      { title: 'Matching unavailable', account: ACCOUNTS.cVerifier, route: `/verify/activities/${VISITOR}`, instructions: 'DEMO-10001 → Continue → simulated capture → Passed → Matching: Service unavailable → Verify Identity. Optionally use Retry Verification.' },
      { title: 'Lookup unavailable (optional)', account: ACCOUNTS.cVerifier, route: `/verify/activities/${VISITOR}`, instructions: 'DEMO-50001 → Find Identity → End Verification.' },
      { title: 'History and reporting', account: ACCOUNTS.cAuditor, route: '/verification-history?result=incomplete&range=all', instructions: 'Find the transaction, then open Reports.' },
    ],
    resetBehavior: 'Reset Demo Data removes the transactions.',
    prerequisites: (s) => activityExists(s, VISITOR, 'Visitor Check-in'),
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const tx = d.attempts.find((a) => a.activityId === VISITOR && (a.match?.status === 'unavailable' || a.lookup?.status === 'UNAVAILABLE'));
      return [
        withTx('Unavailable result recorded', tx, (a) => [true, `${txLabel(a)}: ${a.failureReason ?? a.decisionExplanation}`]),
        withTx('Never Allow', tx, (a) => [a.decision !== 'allow' && !a.reviewDisposition, `Decision: ${a.decision}.`]),
        withTx('No weaker fallback used', tx, (a) => [a.identitySource === 'external' && a.integrationId === 'int_c_delegates', 'Same external service; no local fallback.']),
        withTx('Visible in reporting', tx, (a) => [summarize(s, [a]).unableToComplete === 1, 'Counted as Unable to Complete.']),
        withTx('Retry is a new linked transaction', tx, (a) => [true, d.attempts.some((x) => x.retryOf === a.id) ? 'A retry was linked to it.' : 'No retry was started (optional).']),
      ];
    },
  },
  {
    id: 'S08', name: 'Eligibility Failure',
    description: 'Identity matches but the person isn’t eligible.',
    purpose: 'Show identity confirmation doesn’t grant eligibility.',
    initialData: 'Visitor Check-in (DEMO-10002’s record is SUSPENDED, so external eligibility is Ineligible).', organizationStructure: 'Organization C.', users: [ACCOUNTS.cVerifier],
    activity: 'Visitor Check-in', identitySource: 'Brightwater Identity Service (external)', integration: 'SIMULATED', eligibility: 'External source eligibility (recordStatus = ACTIVE)',
    controls: ['Failures marked unsuccessful'], expectedOutcome: 'Identity Match: Match; Eligibility: Ineligible; Decision: Deny (activity policy).',
    expectedTransactionState: 'Completed, Deny.', permissionBoundaries: [],
    steps: [{ title: 'Verify an ineligible person', account: ACCOUNTS.cVerifier, route: `/verify/activities/${VISITOR}`, instructions: 'DEMO-10002 → Continue → simulated capture → Passed + Match → Verify Identity. Compare the three results.' }],
    resetBehavior: 'Reset Demo Data removes the transaction.',
    prerequisites: (s) => activityExists(s, VISITOR, 'Visitor Check-in'),
    evaluate: (s, b) => {
      const tx = sinceBaseline(s, b).attempts.find((a) => a.match?.status === 'match' && a.eligibilityStatus === 'ineligible');
      return [
        withTx('Identity Match remains Match', tx, (a) => [a.match?.status === 'match', `Identity match: ${a.match?.status}.`]),
        withTx('Eligibility remains Ineligible', tx, (a) => [a.eligibilityStatus === 'ineligible', `Eligibility: ${a.eligibilityStatus}.`]),
        withTx('Decision follows the configured policy', tx, (a) => {
          const expected = evaluateDecision({ match: a.match!.status, liveness: a.liveness?.status ?? 'not-required', livenessRequired: !!a.liveness?.required, eligibility: a.eligibilityStatus!, settings: transactionPolicy(s, a).settings }).decision;
          return [a.decision === expected && a.decision !== 'allow', `Decision ${a.decision} (policy gives ${expected}).`];
        }),
      ];
    },
  },
  {
    id: 'S09', name: 'Mandatory Liveness Failure',
    description: 'A required liveness check fails.',
    purpose: 'Test that a mandatory control can’t be bypassed.',
    initialData: 'Visitor Check-in (liveness required).', organizationStructure: 'Organization C.', users: [ACCOUNTS.cVerifier],
    activity: 'Visitor Check-in', identitySource: 'Brightwater Identity Service (external)', integration: 'SIMULATED', eligibility: 'External source',
    controls: ['Liveness required: matching never runs without it'], expectedOutcome: 'Matching not evaluated; decision isn’t Allow (Deny under this activity’s policy).',
    expectedTransactionState: 'Completed, not Allow.', permissionBoundaries: ['The verifier can’t skip liveness.'],
    steps: [{ title: 'Fail liveness', account: ACCOUNTS.cVerifier, route: `/verify/activities/${VISITOR}`, instructions: 'DEMO-10001 → Continue → simulated capture → Liveness Failed → Matching Match → Verify Identity.' }],
    resetBehavior: 'Reset Demo Data removes the transaction.',
    prerequisites: (s) => activityExists(s, VISITOR, 'Visitor Check-in'),
    evaluate: (s, b) => {
      const tx = sinceBaseline(s, b).attempts.find((a) => a.liveness?.required && a.liveness.status === 'failed');
      return [
        withTx('Mandatory liveness recorded as Failed', tx, (a) => [true, `${txLabel(a)}: liveness ${a.liveness?.status}.`]),
        withTx('Matching didn’t run', tx, (a) => [a.match?.status === 'not-evaluated', `Identity match: ${a.match?.status}.`]),
        withTx('Cannot produce Allow', tx, (a) => [a.decision !== 'allow', `Decision: ${a.decision}. ${a.decisionExplanation ?? ''}`]),
      ];
    },
  },
  {
    id: 'S10', name: 'Shared Activity Requirements',
    description: 'A participating organization tries to change a shared activity’s requirements.',
    purpose: 'Test that only the owner sets a shared activity’s mandatory requirements.',
    initialData: 'Group Staff Entry, owned by B, run by B1.', organizationStructure: 'B1 takes part in B’s shared activity.', users: [ACCOUNTS.b1Admin],
    sharedActivity: 'Group Staff Entry', activity: 'Group Staff Entry', identitySource: 'Group Identity Service (owner’s)', integration: 'SIMULATED',
    eligibility: 'Record status in the identity source', controls: ['Requirements set by the owner only', 'Shared activities need a connected identity source'],
    expectedOutcome: 'B1 sees the requirements read-only and can only manage its own staff; any change is refused.',
    expectedTransactionState: 'No transaction required.', permissionBoundaries: ['Participants manage their own staff, never the activity.'],
    steps: [{ title: 'Open the shared activity', account: ACCOUNTS.b1Admin, route: `/verification-activities/${STAFF}`, instructions: 'Requirements are shown as “Set by Meridian Group”. There is no Edit button; opening …/edit shows Not found.' }],
    resetBehavior: 'Reset Demo Data restores the activity.',
    prerequisites: (s) => activityExists(s, STAFF, 'Group Staff Entry'),
    evaluate: (s, b) => {
      const act = s.data.activityConfigs.find((a) => a.id === STAFF)!;
      const own = activityPolicy(s, act).effective;
      const asLina: AppState = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: 'acct_demo_b1_admin' } }, session: { ...s.session, currentOrganizationId: ORG_B1 } };
      const version = s.data.activityVersions.find((v) => v.id === act.activeVersionId)!;
      const attempt = applySaveActivity(asLina, { organizationId: ORG_B1, activityId: STAFF, ids: { activityId: 'x', versionId: 'y' }, at: new Date().toISOString(),
        form: { name: act.name, description: act.description, purpose: act.purpose, type: version.type, checks: version.checks, outcome: version.outcome, verifierIds: [], verification: { ...own, liveness: 'optional' } } });
      const localShared = activityPolicyProblems(s, ORG_B, { ...own, identitySource: { kind: 'local' } }, 'shared');
      const changed = b.activitySettings[STAFF] !== JSON.stringify(act.verification ?? null);
      return [
        check('A participant can’t change the shared activity', !attempt.ok, 'Refused: the activity belongs to another organization.', 'A participant changed the activity.', 'permission'),
        check('Shared activities keep a connected identity source', localShared.length > 0, 'FixID records can’t be used for a shared activity.', 'A shared activity accepted FixID records.', 'permission'),
        check('Requirements still in force', own.liveness === 'required' && own.identitySource.kind === 'external', 'Liveness required; owner’s identity source.', 'The requirements were weakened.'),
        changed ? pass('Owner changes are audited', `${sinceBaseline(s, b).audit.filter((x) => x.resourceId === STAFF).length} audit events for the activity.`, 'data') : untested('Owner changes are audited', 'The owner didn’t change the activity during the scenario.', 'data'),
        untested('Read-only view shown to the participant', 'Screens aren’t stored as records, so this can’t be checked here. Observe it on screen.'),
      ];
    },
  },
  {
    id: 'S11', name: 'Repeat Verification',
    description: 'A successful result is reused within the activity’s validity period.',
    purpose: 'Test permitted reuse, clearly distinguished from a fresh match.',
    initialData: 'Visitor Check-in allows reuse within 1 day.', organizationStructure: 'Organization C.', users: [ACCOUNTS.cVerifier],
    activity: 'Visitor Check-in', identitySource: 'Brightwater Identity Service (external)', integration: 'SIMULATED', eligibility: 'External source (re-checked on reuse)',
    controls: ['Reuse within 1 day; only completed Allow results with a real match'], expectedOutcome: 'The second transaction links to the first and says no new biometric match was performed.',
    expectedTransactionState: 'Completed, Allow, reusedFrom set.', permissionBoundaries: ['Results from other organizations or activities are never offered.'],
    steps: [
      { title: 'First verification', account: ACCOUNTS.cVerifier, route: `/verify/activities/${VISITOR}`, instructions: 'DEMO-10001, Passed + Match.' },
      { title: 'Second verification', account: ACCOUNTS.cVerifier, route: `/verify/activities/${VISITOR}`, instructions: 'Verify Next Participant → DEMO-10001 → Find Identity → Use previous verification.' },
    ],
    resetBehavior: 'Reset Demo Data removes both transactions.',
    prerequisites: (s) => activityExists(s, VISITOR, 'Visitor Check-in'),
    evaluate: (s, b) => {
      const tx = sinceBaseline(s, b).attempts.find((a) => a.reusedFrom);
      const prior = tx ? s.data.verificationAttempts.find((a) => a.id === tx.reusedFrom) : undefined;
      return [
        withTx('Reuse recorded and linked', tx, (a) => [!!prior, `${a.id} reused ${a.reusedFrom}.`]),
        withTx('Only a permitted result was reused', tx, () => [!!prior && prior.decision === 'allow' && prior.match?.status === 'match' && prior.organizationId === tx!.organizationId && prior.activityId === tx!.activityId, 'Same organization and activity; completed Allow with a match.']),
        withTx('Original transaction unchanged', tx, () => [!!prior && !prior.reusedFrom && prior.decision === 'allow', 'The earlier transaction keeps its own result.']),
        withTx('Distinguished from a fresh match', tx, (a) => [!a.match?.providerTransactionId || a.checks.some((c) => /No new biometric match/.test(c.explanation)), 'Marked as reused; no new matching request.']),
      ];
    },
  },
  {
    id: 'S12', name: 'Role and Organization Isolation',
    description: 'Unauthorized access attempts across roles and organizations.',
    purpose: 'Test permissions and tenant boundaries.',
    initialData: 'Seeded organizations, transactions and exceptions.', organizationStructure: 'A, B (with B1 and B2) and C.',
    users: [ACCOUNTS.b1Verifier, ACCOUNTS.cAuditor, ACCOUNTS.owner], activity: 'Various', identitySource: '—', integration: '—', eligibility: '—', controls: [],
    expectedOutcome: 'Every unauthorized attempt is refused; refusals of other organizations’ records are audited.', expectedTransactionState: 'No change.',
    permissionBoundaries: ['Verifier: assigned activities only', 'Auditor: read-only', 'Shared activity owner: that activity’s results only', 'No credentials or biometric data exposed'],
    steps: [
      { title: 'Verifier: unassigned activity', account: ACCOUNTS.b1Verifier, route: `/verify/activities/${ORG_B1}_va_membership`, instructions: 'The page refuses: not assigned.' },
      { title: 'Verifier: another organization’s transaction', account: ACCOUNTS.b1Verifier, route: (s) => `/verify/attempts/${seededTx(s, 'D06')?.id ?? 'unknown'}`, instructions: 'The page shows “Verification not available” and the refusal is audited.' },
      { title: 'Auditor: try to change an exception', account: ACCOUNTS.cAuditor, route: '/exceptions', instructions: 'Open any exception: it’s read-only, with no review actions.' },
      { title: 'Activity owner: unrelated records', account: ACCOUNTS.owner, route: (s) => `/verification-history/${seededTx(s, 'D06')?.id ?? 'unknown'}`, instructions: 'Organization C’s own transaction isn’t shown, even though C has been invited to B’s shared activity.' },
    ],
    resetBehavior: 'No data changes besides audit events.',
    prerequisites: (s) => (seededTx(s, 'D06') ? [] : ['Seeded transactions are missing. Reset the demo data.']),
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const denied = d.audit.filter((x) => x.action === 'access.denied');
      const tomiRec = s.data.administrators.find((a) => a.userId === 'acct_demo_b1_verifier');
      const asTomi: AppState = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: 'acct_demo_b1_verifier' } } };
      const asAuditor: AppState = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: `${ORG_C}_usr_2` } } };
      const anyExc = exceptionsOf(s).find((e) => e.reviewOrganizationId === ORG_C);
      return [
        denied.length ? pass('Cross-organization access refused and audited', `${denied.length} access.denied events.`, 'permission') : untested('Cross-organization access refused and audited', 'No refused access recorded since loading. Follow the steps.', 'permission'),
        check('Verifier can’t run another organization’s activity', !!tomiRec && !authorizeExecution(asTomi, ORG_C, VISITOR, WEB_CLIENT).ok, 'Execution refused.', 'Execution allowed.', 'permission'),
        check('Verifier can’t run an unassigned activity', !authorizeExecution(asTomi, ORG_B1, `${ORG_B1}_va_membership`, WEB_CLIENT).ok, 'Execution refused: not assigned.', 'Execution allowed.', 'permission'),
        anyExc ? check('Auditor can’t resolve an exception', !applyResolveException(asAuditor, { organizationId: ORG_C, exceptionId: anyExc.id, outcome: 'unable-to-resolve', reason: 'test', at: new Date().toISOString() }).ok, 'Refused: no review permission.', 'The auditor could resolve.', 'permission') : untested('Auditor can’t resolve an exception', 'No exception to test with.', 'permission'),
        check('Activity owner can’t see unrelated organizations’ exceptions', !exceptionsVisibleTo(s, ORG_B).some((e) => e.activityId !== STAFF && (e.organizationId === ORG_C || e.organizationId === ORG_A)), 'Only its own and its shared activity’s exceptions are visible.', 'Unrelated exceptions are visible.', 'permission'),
        check('Other organizations can’t list a private integration', !integrationsOf(s, ORG_B1).some((i) => i.organizationId !== ORG_B1) && !integrationsOf(s, ORG_A).length, 'Integrations are listed only to their owner.', 'An integration is visible elsewhere.', 'permission'),
        check('No integration credentials stored', noSecrets(s), 'No secret fields exist in integration records.', 'Secret-like fields found.', 'permission'),
        check('No raw biometric material stored', noRawBiometrics(s), 'Transactions and exceptions contain no images.', 'Image data found.', 'permission'),
      ];
    },
  },
  {
    id: 'S13', name: 'Exception and Status API Lifecycle',
    description: 'A transaction moves from Pending Review to a reviewed disposition, read through the status API.',
    purpose: 'Test status consistency between review and the (simulated) Verification Status API.',
    initialData: 'Group Staff Entry (problems reviewed by the owner); the status API demo page.', organizationStructure: 'B1 (participant) and B (activity owner and reviewer).',
    users: [ACCOUNTS.b1Verifier, ACCOUNTS.b1Admin, ACCOUNTS.reviewer], sharedActivity: 'Group Staff Entry', activity: 'Group Staff Entry', identitySource: 'Group Identity Service',
    integration: 'SIMULATED; status API SIMULATED', eligibility: 'External source', controls: ['Exceptions reviewed by the activity owner’s reviewers'],
    expectedOutcome: 'Status API: PENDING_REVIEW before review; after resolution COMPLETED with the reviewed decision, original NO_MATCH preserved.',
    expectedTransactionState: 'Pending Review → reviewed disposition.', expectedExceptionState: 'Open → Resolved.', permissionBoundaries: ['Unrelated clients get 404.'],
    steps: [
      { title: 'Create a review case', account: ACCOUNTS.b1Verifier, route: `/verify/activities/${STAFF}`, instructions: 'DEMO-10001 → Passed + No match → Verify Identity.' },
      { title: 'Status before review', account: ACCOUNTS.b1Admin, route: '/developer/status-api', instructions: 'Choose the new transaction and Request status: PENDING_REVIEW.' },
      { title: 'Review as the owner’s exception reviewer', account: ACCOUNTS.reviewer, route: '/exceptions?status=unresolved', instructions: 'Open the exception → Assign to me → Record decision: Reject.' },
      { title: 'Status after review', account: ACCOUNTS.b1Admin, route: '/developer/status-api', instructions: 'Request status again; also try “No client” and another organization’s client.' },
    ],
    resetBehavior: 'Reset Demo Data removes the transaction and exception.',
    prerequisites: (s) => activityExists(s, STAFF, 'Group Staff Entry'),
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const tx = d.attempts.find((a) => a.exceptionId && a.reviewDisposition) ?? d.attempts.find((a) => a.exceptionId);
      const res = tx ? getVerificationStatus(s, { clientId: `client_${tx.organizationId}`, transactionId: tx.id }) : undefined;
      const askedBefore = tx ? d.audit.some((x) => x.action === 'api.status-requested' && x.resourceId === tx.id) : false;
      return [
        withTx('A review case was created', tx, (a) => [true, `${txLabel(a)} with exception ${a.exceptionId}.`]),
        askedBefore ? pass('Status was requested through the API demo', 'Recorded in the audit trail.', 'data') : untested('Status was requested through the API demo', 'No status request recorded for it.', 'data'),
        withTx('Status reflects the current disposition', tx, (a) => {
          if (!res || res.httpStatus !== 200) return [false, 'Status not available to the owning client.'];
          const ok = a.reviewDisposition ? res.body.status === 'COMPLETED' && res.body.decision !== 'PENDING_REVIEW' : res.body.status === 'PENDING_REVIEW' && res.body.decision === 'PENDING_REVIEW';
          return [ok, `${res.body.status} / ${res.body.decision}${a.reviewDisposition ? '' : ' (not yet reviewed)'}`];
        }),
        withTx('Original match preserved', tx, (a) => [!!res && res.httpStatus === 200 && res.body.identityMatch === a.match!.status.toUpperCase().replace(/-/g, '_') && a.match?.status === 'no-match', `identityMatch ${res && res.httpStatus === 200 ? res.body.identityMatch : '—'}.`]),
        withTx('Review decision recorded separately', tx, (a) => [!!a.reviewDisposition && a.decision === 'pending-review', a.reviewDisposition ? `Original decision ${a.decision}; reviewed ${a.reviewDisposition.decision}.` : 'Not reviewed yet.']),
        withTx('Unauthorized callers can’t read it', tx, (a) => {
          const anon = getVerificationStatus(s, { transactionId: a.id }); const other = getVerificationStatus(s, { clientId: `client_${ORG_C}`, transactionId: a.id });
          return [anon.httpStatus === 401 && other.httpStatus === 404, `No client: ${anon.httpStatus}; unrelated client: ${other.httpStatus}.`];
        }),
      ];
    },
  },
  {
    id: 'S14', name: 'Custom Integration Configuration',
    description: 'An organization adds, tests and uses a private identity service.',
    purpose: 'Demonstrate reusable, private external identity services.',
    initialData: 'Organization A has no custom integration.', organizationStructure: 'Organization A.', users: [ACCOUNTS.aAdmin],
    activity: 'A new activity using the integration', identitySource: 'The new integration', integration: 'Simulated Identity Service (SIMULATED) — real external services are disabled in this prototype',
    eligibility: 'External source or reference list', controls: ['Activation needs a successful test', 'No secrets in the browser'],
    expectedOutcome: 'A tested, active, simulated integration owned by A, used by an activity and a test verification.',
    expectedTransactionState: 'A completed external transaction through it.', permissionBoundaries: ['Other organizations can’t view it or its credentials.'],
    steps: [
      { title: 'Create the integration', account: ACCOUNTS.aAdmin, route: '/settings?tab=integrations', instructions: 'Add Custom Integration → name, lookup + matching → Simulated Identity Service → finish → Test Connection → Activate.' },
      { title: 'Use it in an activity', account: ACCOUNTS.aAdmin, route: '/verification-activities/new', instructions: 'Choose External Identity Service with the new integration, eligibility External source, keep yourself as verifier, Create & Activate.' },
      { title: 'Test verification', account: ACCOUNTS.aAdmin, route: '/verify', instructions: 'Start it → DEMO-10001 → simulated capture → Passed + Match.' },
    ],
    resetBehavior: 'Reset Demo Data removes the integration, activity and transaction.',
    prerequisites: (s) => (s.data.organizations.some((o) => o.id === ORG_A) ? [] : ['Organization A is missing. Reset the demo data.']),
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const i = d.integrations[0];
      const act = i ? s.data.activityConfigs.find((a) => a.verification?.identitySource.kind === 'external' && a.verification.identitySource.integrationId === i.id) : undefined;
      const tx = i ? d.attempts.find((a) => a.integrationId === i.id) : undefined;
      return [
        i ? pass('Private integration created', `${i.name} in ${i.organizationId}.`, 'data') : untested('Private integration created', 'No new integration yet.', 'data'),
        i ? check('Connection test run', i.tests.length > 0, `${i.tests[0]?.summary ?? ''}`, 'Not tested yet.') : untested('Connection test run', 'No integration yet.'),
        i ? check('Simulated connection labelled as simulated', i.connection.target !== 'simulated' || i.tests.every((t) => t.simulated), 'Tests of the simulated service are marked simulated.', 'A simulated test isn’t marked simulated.') : untested('Simulated connection labelled as simulated', 'No integration yet.'),
        i ? check('Other organizations can’t see it', s.data.organizations.filter((o) => o.id !== i.organizationId).every((o) => !integrationsOf(s, o.id).some((x) => x.id === i.id)), 'Listed only to its owner.', 'Visible to another organization.', 'permission') : untested('Other organizations can’t see it', 'No integration yet.', 'permission'),
        check('No credentials stored in the browser', noSecrets(s), 'Only a credential status is stored.', 'Secret-like fields found.', 'permission'),
        act ? pass('Assigned to an activity', act.name) : untested('Assigned to an activity', 'No activity uses it yet.'),
        withTx('Test verification executed', tx, (a) => [a.status === 'completed', `${txLabel(a)}: ${a.decision}.`]),
      ];
    },
  },
  {
    id: 'S15', name: 'Audit and Reporting',
    description: 'Several verifications, then history, audit trail and reports are compared.',
    purpose: 'Validate operational oversight: reports reflect stored records; history and audit are distinct.',
    initialData: 'Seeded transactions plus those created in the scenario.', organizationStructure: 'Organization C; activity owner B.',
    users: [ACCOUNTS.cVerifier, ACCOUNTS.cAuditor, ACCOUNTS.owner], activity: 'Visitor Check-in', identitySource: 'External (SIMULATED)', integration: 'SIMULATED', eligibility: 'External source',
    controls: [], expectedOutcome: 'Report figures equal a recount of stored transactions; audit events exist for each completed verification.',
    expectedTransactionState: 'At least three new transactions including a mismatch and an unavailable result.', permissionBoundaries: ['Auditor read-only; shared activity reports only for the owner.'],
    steps: [
      { title: 'Complete several verifications', account: ACCOUNTS.cVerifier, route: `/verify/activities/${VISITOR}`, instructions: 'Run three: DEMO-10001 Match; DEMO-10001 No match; DEMO-10001 Service unavailable.' },
      { title: 'History, audit and reports', account: ACCOUNTS.cAuditor, route: '/verification-history', instructions: 'Filter by Decision and Activity, open the Audit Log (filter Verification transactions), then Reports.' },
      { title: 'Shared activity report', account: ACCOUNTS.owner, route: '/reports', instructions: 'Open the Shared activity report tab.' },
    ],
    resetBehavior: 'Reset Demo Data removes the new transactions.',
    prerequisites: (s) => activityExists(s, VISITOR, 'Visitor Check-in'),
    evaluate: (s, b) => {
      const d = sinceBaseline(s, b);
      const mine = d.attempts.filter((a) => a.organizationId === ORG_C);
      const sum = summarize(s, mine);
      const recount = { allow: mine.filter((a) => (a.reviewDisposition?.decision ?? a.decision) === 'allow').length, deny: mine.filter((a) => (a.reviewDisposition?.decision ?? a.decision) === 'deny').length };
      const completedEvents = d.audit.filter((x) => x.action === 'verification.completed' && x.organizationId === ORG_C).length;
      const shared = s.data.activityConfigs.find((x) => x.id === STAFF);
      return [
        mine.length >= 3 ? pass('Several verifications completed', `${mine.length} new transactions.`, 'data') : untested('Several verifications completed', `${mine.length} of 3 new transactions so far.`, 'data'),
        mine.some((a) => a.match?.status === 'no-match') ? pass('Includes a mismatch', 'Recorded.', 'data') : untested('Includes a mismatch', 'Not yet.', 'data'),
        mine.some((a) => a.match?.status === 'unavailable' || a.lookup?.status === 'UNAVAILABLE') ? pass('Includes a service-unavailable result', 'Recorded.', 'data') : untested('Includes a service-unavailable result', 'Not yet.', 'data'),
        mine.length ? check('Report metrics equal the stored records', sum.allowed === recount.allow && sum.denied === recount.deny && sum.attempts === mine.length, `Allow ${sum.allowed}, Deny ${sum.denied}, attempts ${sum.attempts}.`, 'Report figures differ from a recount.') : untested('Report metrics equal the stored records', 'No new transactions.'),
        mine.length ? check('History and audit trail are distinct and consistent', completedEvents === mine.filter((a) => a.status === 'completed').length, `${completedEvents} verification.completed audit events for ${mine.filter((a) => a.status === 'completed').length} completed transactions.`, 'Audit events don’t match transactions.', 'data') : untested('History and audit trail are distinct and consistent', 'No new transactions.', 'data'),
        check('Shared activity report limited to its organizations', !!shared && sharedResults(s, shared).rows.every((r) => r.organizationId === ORG_B || shared.sharing!.participants.some((p) => p.organizationId === r.organizationId)), 'Only the owner and invited organizations appear.', 'Unrelated organizations appear.', 'permission'),
      ];
    },
  },
];

/** Overall status: Passed only if every check passed; Failed if any failed; otherwise Incomplete. */
export function overallStatus(results: CheckResult[]): 'passed' | 'failed' | 'incomplete' {
  if (results.some((r) => r.status === 'failed')) return 'failed';
  return results.length && results.every((r) => r.status === 'passed') ? 'passed' : 'incomplete';
}

/** Integration responses used by transactions created since the baseline (for the run report). */
export function integrationResponses(state: AppState, b: Baseline): string[] {
  return sinceBaseline(state, b).attempts.flatMap((a) => [
    ...(a.lookup ? [`${a.id}: lookup ${a.lookup.status}${a.lookup.simulated ? ' (SIMULATED)' : ''}`] : []),
    ...(a.liveness && a.liveness.status !== 'not-required' ? [`${a.id}: liveness ${a.liveness.status}${a.liveness.simulated ? ' (SIMULATED)' : ''}`] : []),
    ...(a.match ? [`${a.id}: identity match ${a.match.status}${a.match.simulated ? ' (SIMULATED)' : ''}${a.reusedFrom ? ` (reused from ${a.reusedFrom})` : ''}`] : []),
  ]);
}

export { ORG_B2 };
