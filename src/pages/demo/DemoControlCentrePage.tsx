import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, CircleDashed, LogIn, Play, RotateCcw, Search, Upload, XCircle } from 'lucide-react';
import { DEMO_ACCOUNT, DEMO_AUTH_ENABLED, DEMO_PASSWORD, normalizeEmail } from '@/auth/authCore';
import { displayName, homeFor, useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, useToast } from '@/components/ui';
import { DEMO_PERSONAS, personaName } from '@/data/demoPersonas';
import { DEMO_ADMIN } from '@/data/seed';
import { findRole } from '@/domain/roles';
import { readinessChecklist } from '@/demo/readiness';
import { loadScenarioRuns, saveScenarioRuns, type ScenarioRun } from '@/demo/runs';
import { SCENARIOS, integrationResponses, overallStatus, sinceBaseline, takeBaseline, type CheckResult, type ScenarioDefinition } from '@/demo/scenarios';
import { RESET_EXPLANATION, useDemoReset } from '@/demo/useDemoReset';
import { formatDateTime } from '@/lib/dates';
import { exceptionsOf } from '@/store/exceptionOps';
import { useStore } from '@/store/AppStore';
import type { AppState } from '@/store/state';

/**
 * Demo Control Centre (demonstration builds only; the route doesn't exist otherwise). Scenarios are loaded,
 * run through the real screens as the real demonstration accounts (signing in with the normal password
 * check), evaluated against stored records, and reset. Nothing here bypasses sign-in or permissions.
 */
export function DemoControlCentrePage() {
  if (!DEMO_AUTH_ENABLED) {
    return (
      <Shell>
        <Card><CardBody><p className="text-sm text-slate-700">The Demo Control Centre isn’t available in this build.</p></CardBody></Card>
      </Shell>
    );
  }
  return <ControlCentre />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900">Demo Control Centre</h1>
              <Badge tone="warning">Demonstration build only</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Guided test scenarios with fictional data and simulated identity services. Accounts sign in through the normal sign-in;
              scenario results are checked against what the application actually stored. Not a production feature.
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

type View = 'scenarios' | 'accounts' | 'readiness';

interface DemoAccountRow { email: string; name: string; persona: string; accountId: string; organizationId?: string; platform?: boolean }

const ACCOUNT_ROWS: DemoAccountRow[] = [
  { email: DEMO_ACCOUNT.email, name: displayName(DEMO_ACCOUNT), persona: 'Administrator — second approver and demo operator', accountId: DEMO_ACCOUNT.id },
  ...DEMO_PERSONAS.map((p) => ({ email: p.email, name: personaName(p), persona: p.persona, accountId: p.accountId, organizationId: p.organizationId, platform: p.platform })),
];

function ControlCentre() {
  const { state } = useStore();
  const { account, signIn, signOut, isDemo } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { canReset, problem: resetProblem, reset } = useDemoReset();
  const [view, setView] = useState<View>('scenarios');
  const [selectedId, setSelectedId] = useState(SCENARIOS[0].id);
  const [runs, setRuns] = useState<Record<string, ScenarioRun>>(() => loadScenarioRuns());
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, setPending] = useState<{ email: string; route?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { saveScenarioRuns(runs); }, [runs]);

  // Navigate once the new sign-in has opened its workspace (the auth provider syncs it after sign-in).
  const workspaceReady = !!account && (account.platformRole === 'platform-admin' || state.data.admin.id === (isDemo ? DEMO_ADMIN.id : account.id));
  useEffect(() => {
    if (!pending || !account || account.email !== normalizeEmail(pending.email) || !workspaceReady) return;
    const to = pending.route ?? homeFor(account);
    setPending(null);
    navigate(to);
  }, [pending, account, workspaceReady, navigate]);

  const signInAs = async (email: string, route?: string) => {
    setError(null);
    if (account?.email === normalizeEmail(email)) {
      navigate(route ?? homeFor(account));
      return;
    }
    // Signing out ends only the sign-in session; application data stays as it is.
    signOut();
    const r = await signIn(email, DEMO_PASSWORD);
    if (!r.ok) { setError(r.error); return; }
    setPending({ email, route });
  };

  const scenario = SCENARIOS.find((s) => s.id === selectedId)!;
  const run = runs[scenario.id];

  return (
    <Shell>
      <SessionCard state={state} onSignOut={() => { signOut(); toast({ tone: 'info', title: 'Signed out', description: 'Demonstration data was kept.' }); }} />
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <div role="tablist" aria-label="Control centre sections" className="flex gap-2 border-b border-slate-200">
        {([['scenarios', 'Scenarios'], ['accounts', 'Demo accounts'], ['readiness', 'Readiness checklist']] as const).map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${view === v ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>
        ))}
      </div>

      {view === 'accounts' && <AccountsTable state={state} currentEmail={account?.email} onSignIn={(email) => signInAs(email)} />}
      {view === 'readiness' && <ReadinessView state={state} />}
      {view === 'scenarios' && (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Scenarios" className="space-y-1">
            {SCENARIOS.map((s) => {
              const r = runs[s.id];
              const status = r ? overallStatus(s.evaluate(state, r.baseline)) : undefined;
              return (
                <button key={s.id} type="button" onClick={() => setSelectedId(s.id)} aria-current={s.id === selectedId ? 'true' : undefined}
                  className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${s.id === selectedId ? 'bg-white shadow-card ring-1 ring-slate-200' : 'hover:bg-white'}`}>
                  <span><span className="font-mono text-xs text-slate-400">{s.id}</span> <span className="font-medium text-slate-800">{s.name}</span></span>
                  {status && <StatusBadge status={status} />}
                </button>
              );
            })}
          </nav>
          <ScenarioDetail
            key={scenario.id} scenario={scenario} run={run} state={state} currentEmail={account?.email}
            onLoad={() => {
              const missing = scenario.prerequisites(state);
              if (missing.length) { toast({ tone: 'error', title: 'Scenario can’t be loaded', description: missing.join(' ') }); return; }
              setRuns((r) => ({ ...r, [scenario.id]: { scenarioId: scenario.id, baseline: takeBaseline(state), loadedBy: account?.email ?? 'not signed in' } }));
              toast({ tone: 'success', title: `${scenario.id} loaded`, description: 'Only records created from now on count toward its results.' });
            }}
            onRun={() => setRuns((r) => (r[scenario.id] ? { ...r, [scenario.id]: { ...r[scenario.id], startedAt: new Date().toISOString() } } : r))}
            onStep={(email, route) => signInAs(email, route)}
            onReset={() => setConfirmReset(true)} canReset={canReset} resetProblem={resetProblem}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmReset} tone="danger" title="Reset demonstration data?" confirmLabel="Reset demonstration data"
        description={(
          <span className="block space-y-2 text-sm">
            <span className="block font-medium text-slate-800">This restores:</span>
            {RESET_EXPLANATION.restores.map((x) => <span key={x} className="block pl-3">• {x}</span>)}
            <span className="block font-medium text-slate-800">This keeps:</span>
            {RESET_EXPLANATION.keeps.map((x) => <span key={x} className="block pl-3">• {x}</span>)}
            <span className="block">It can’t be undone.</span>
          </span>
        )}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          const r = reset();
          setConfirmReset(false);
          if (!r.ok) { toast({ tone: 'error', title: 'Nothing was changed', description: r.error }); return; }
          setRuns({});
          toast({ tone: 'success', title: 'Demonstration data reset', description: 'Seeded data restored; registered organizations kept.' });
        }}
      />
    </Shell>
  );
}

function SessionCard({ state, onSignOut }: { state: AppState; onSignOut: () => void }) {
  const { account } = useAuth();
  const org = state.data.organizations.find((o) => o.id === state.session.currentOrganizationId);
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm">
          <p className="text-slate-500">Current session</p>
          {account ? (
            <p className="font-medium text-slate-900">
              {displayName(account)} · {account.email}
              <span className="text-slate-500"> · {account.platformRole ? 'Platform console (no workspace)' : `Workspace: ${org?.name ?? '—'}`}</span>
            </p>
          ) : <p className="font-medium text-slate-900">Not signed in</p>}
        </div>
        <div className="flex gap-2">
          {account ? (
            <>
              <Link to={homeFor(account)} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Open workspace</Link>
              <Button size="sm" variant="ghost" onClick={onSignOut}>Sign out</Button>
            </>
          ) : <Link to="/signin" className="inline-flex h-8 items-center rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">Sign in</Link>}
        </div>
      </CardBody>
    </Card>
  );
}

function AccountsTable({ state, currentEmail, onSignIn }: { state: AppState; currentEmail?: string; onSignIn: (email: string) => void }) {
  const d = state.data;
  const orgName = (id?: string) => d.organizations.find((o) => o.id === id)?.name ?? '—';
  return (
    <Card>
      <CardHeader title="Demo accounts" description="Fictional accounts (demonstration builds only). “Sign in as” signs out the current account and signs in through the normal password check; application data is kept." />
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2">Account</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Workspaces</th><th className="px-4 py-2">Assigned activities</th><th className="px-4 py-2">Shared activities</th><th className="px-4 py-2"><span className="sr-only">Action</span></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ACCOUNT_ROWS.map((a) => {
              const userId = a.accountId === DEMO_ACCOUNT.id ? DEMO_ADMIN.id : a.accountId;
              const records = d.administrators.filter((r) => r.userId === userId && r.status === 'active');
              const roles = [...new Set(records.flatMap((r) => r.roleIds.map((id) => findRole(d.customRoles ?? [], r.organizationId, id)?.name ?? id)))];
              const assigned = d.verifierAssignments.filter((v) => v.status === 'active' && records.some((r) => r.id === v.administratorId)).map((v) => d.activityConfigs.find((x) => x.id === v.activityId)?.name).filter(Boolean);
              const shared = d.activityConfigs.filter((x) => x.sharing && x.status !== 'draft' && records.some((r) => r.organizationId === x.organizationId || x.sharing!.participants.some((p) => p.organizationId === r.organizationId && (p.status === 'active' || p.status === 'invited')))).map((x) => x.name);
              return (
                <tr key={a.email}>
                  <td className="px-4 py-2"><span className="block font-medium text-slate-900">{a.name}</span><span className="text-xs text-slate-500">{a.email}</span></td>
                  <td className="px-4 py-2 text-slate-700">{a.platform ? 'Platform Administrator' : roles.join(', ') || '—'}<span className="block text-xs text-slate-500">{a.persona}</span></td>
                  <td className="px-4 py-2 text-slate-700">{a.platform ? 'Platform console' : [...new Set(records.map((r) => orgName(r.organizationId)))].join(', ') || orgName(a.organizationId)}</td>
                  <td className="px-4 py-2 text-slate-700">{assigned.length ? assigned.join(', ') : '—'}</td>
                  <td className="px-4 py-2 text-slate-700">{shared.length ? [...new Set(shared)].join(', ') : '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {currentEmail === a.email ? <Badge tone="success">Signed in</Badge>
                      : <Button size="sm" variant="secondary" icon={<LogIn className="h-4 w-4" />} onClick={() => onSignIn(a.email)} aria-label={`Sign in as ${a.name} (${a.email})`}>Sign in as</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const STATUS_TONE = { passed: 'success', failed: 'danger', 'not-tested': 'neutral', incomplete: 'warning' } as const;
const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', 'not-tested': 'Not Tested', incomplete: 'Incomplete' } as const;
function StatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

function CheckList({ results, label }: { results: CheckResult[]; label: string }) {
  if (!results.length) return <p className="text-sm text-slate-500">None.</p>;
  return (
    <ul className="divide-y divide-slate-100" aria-label={label}>
      {results.map((r) => (
        <li key={r.label} className="flex items-start gap-3 py-2 text-sm">
          {r.status === 'passed' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : r.status === 'failed' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
          <span className="min-w-0 flex-1"><span className="font-medium text-slate-800">{r.label}</span><span className="block text-slate-500">{r.detail}</span></span>
          <StatusBadge status={r.status} />
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-0.5 text-sm text-slate-800">{children}</dd></div>;
}

function ScenarioDetail({ scenario: s, run, state, currentEmail, onLoad, onRun, onStep, onReset, canReset, resetProblem }: {
  scenario: ScenarioDefinition; run?: ScenarioRun; state: AppState; currentEmail?: string;
  onLoad: () => void; onRun: () => void; onStep: (email: string, route?: string) => void; onReset: () => void; canReset: boolean; resetProblem: string | null;
}) {
  const [evaluated, setEvaluated] = useState(false);
  const missing = s.prerequisites(state);
  const results = useMemo(() => (run && evaluated ? s.evaluate(state, run.baseline) : []), [s, state, run, evaluated]);
  const created = run ? sinceBaseline(state, run.baseline) : undefined;
  const nameOf = (email?: string) => ACCOUNT_ROWS.find((a) => a.email === email)?.name ?? email;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={<span><span className="font-mono text-sm text-slate-400">{s.id}</span> {s.name}</span>} description={s.description} />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Purpose">{s.purpose}</Field>
            <Field label="Initial data">{s.initialData}</Field>
            <Field label="Organization structure">{s.organizationStructure}</Field>
            <Field label="Users">{s.users.map(nameOf).join(', ')}</Field>
            {s.sharedActivity && <Field label="Shared activity">{s.sharedActivity}</Field>}
            <Field label="Activity">{s.activity}</Field>
            <Field label="Identity source">{s.identitySource}</Field>
            <Field label="Integration">{s.integration}</Field>
            <Field label="Eligibility">{s.eligibility}</Field>
            <Field label="Mandatory controls">{s.controls.length ? s.controls.join('; ') : '—'}</Field>
            <Field label="Expected outcome">{s.expectedOutcome}</Field>
            <Field label="Expected transaction state">{s.expectedTransactionState}</Field>
            {s.expectedExceptionState && <Field label="Expected exception state">{s.expectedExceptionState}</Field>}
            <Field label="Permission boundaries">{s.permissionBoundaries.length ? s.permissionBoundaries.join(' ') : '—'}</Field>
            <Field label="Reset behaviour">{s.resetBehavior}</Field>
          </dl>
        </CardBody>
      </Card>

      {/* Before: load */}
      <Card>
        <CardHeader title="1. Load (before)" description="Checks prerequisites and records what exists now. Loading doesn’t change any data." action={<Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={onLoad}>{run ? 'Reload scenario' : 'Load scenario'}</Button>} />
        <CardBody className="space-y-2 text-sm">
          {missing.length ? <p className="text-red-700">Missing prerequisites: {missing.join(' ')}</p> : <p className="text-slate-600">Prerequisites met.</p>}
          {run ? (
            <p className="text-slate-600">Loaded {formatDateTime(run.baseline.at)} by {run.loadedBy}. Baseline: {run.baseline.attemptIds.length} transactions, {run.baseline.exceptionIds.length} exceptions, {run.baseline.auditIds.length} audit events.</p>
          ) : <p className="text-slate-500">Not loaded.</p>}
        </CardBody>
      </Card>

      {/* During: run */}
      <Card>
        <CardHeader title="2. Run (during)" description="Perform each step in the real screens, signed in as the account shown." action={<Button icon={<Play className="h-4 w-4" />} disabled={!run} onClick={onRun}>{run?.startedAt ? 'Restart run' : 'Start run'}</Button>} />
        <CardBody>
          {!run && <p className="text-sm text-slate-500">Load the scenario first.</p>}
          {run && !run.startedAt && <p className="text-sm text-slate-500">Start the run to see the steps.</p>}
          {run?.startedAt && (
            <ol className="space-y-3">
              {s.steps.map((step, i) => {
                const route = typeof step.route === 'function' ? step.route(state) : step.route;
                return (
                  <li key={step.title} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{i + 1}. {step.title}</p>
                        {step.account && <p className="text-xs text-slate-500">As {nameOf(step.account)} ({step.account}){route ? ` · ${route}` : ''}</p>}
                        <p className="mt-1 text-slate-700">{step.instructions}</p>
                      </div>
                      {step.account && (
                        <Button size="sm" variant="secondary" icon={<LogIn className="h-4 w-4" />} onClick={() => onStep(step.account!, route)}>
                          {currentEmail === step.account ? 'Open' : `Sign in as ${nameOf(step.account)}`}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardBody>
      </Card>

      {/* After: evaluate */}
      <Card>
        <CardHeader title="3. Evaluate (after)" description="Compares the expected results with what the application stored since the scenario was loaded. Visiting screens doesn’t count; anything that can’t be checked from stored records is Not Tested." action={<Button variant="secondary" icon={<Search className="h-4 w-4" />} disabled={!run} onClick={() => setEvaluated(true)}>Evaluate</Button>} />
        <CardBody className="space-y-5">
          {!run && <p className="text-sm text-slate-500">Load the scenario first.</p>}
          {run && !evaluated && <p className="text-sm text-slate-500">Not evaluated yet.</p>}
          {run && evaluated && created && (
            <>
              <div className="flex items-center gap-2 text-sm"><span className="font-medium text-slate-800">Result:</span><StatusBadge status={overallStatus(results)} /></div>
              <section><h3 className="mb-1 text-sm font-semibold text-slate-900">Expected vs. actual</h3><CheckList label="Outcome checks" results={results.filter((r) => r.kind !== 'permission')} /></section>
              <section><h3 className="mb-1 text-sm font-semibold text-slate-900">Permission checks</h3><CheckList label="Permission checks" results={results.filter((r) => r.kind === 'permission')} /></section>
              <section>
                <h3 className="mb-1 text-sm font-semibold text-slate-900">Transactions created ({created.attempts.length})</h3>
                {created.attempts.length ? <ul className="space-y-1 text-sm">{created.attempts.map((a) => (
                  <li key={a.id}><span className="font-mono">{a.id}</span> · {a.activityName} · decision {a.reviewDisposition ? `${a.decision} → reviewed ${a.reviewDisposition.decision}` : a.decision ?? a.status}{a.simulated ? ' · SIMULATED' : ''}</li>
                ))}</ul> : <p className="text-sm text-slate-500">None.</p>}
              </section>
              <section>
                <h3 className="mb-1 text-sm font-semibold text-slate-900">Exceptions created or changed ({created.exceptions.length + created.changedExceptions.length})</h3>
                {created.exceptions.length + created.changedExceptions.length ? <ul className="space-y-1 text-sm">{[...created.exceptions, ...created.changedExceptions].map((e) => (
                  <li key={e.id}><span className="font-mono">{e.id}</span> · {e.reason} · {e.status} · {e.route} review{e.resolution ? ` · ${e.resolution.outcome}` : ''}</li>
                ))}</ul> : <p className="text-sm text-slate-500">None.</p>}
              </section>
              <section>
                <h3 className="mb-1 text-sm font-semibold text-slate-900">Integration responses used</h3>
                {integrationResponses(state, run.baseline).length ? <ul className="space-y-1 text-sm">{integrationResponses(state, run.baseline).map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm text-slate-500">None.</p>}
              </section>
              <section>
                <h3 className="mb-1 text-sm font-semibold text-slate-900">Audit events ({created.audit.length})</h3>
                {created.audit.length ? <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">{created.audit.slice(-40).map((x) => (
                  <li key={x.id}><span className="font-mono text-xs">{x.id}</span> · {x.action} · {x.actor}{x.resourceId ? ` · ${x.resourceId}` : ''}</li>
                ))}</ul> : <p className="text-sm text-slate-500">None.</p>}
              </section>
              <p className="text-xs text-slate-500">Exceptions in the system: {exceptionsOf(state).length}. Results update as records change; evaluate again after each step.</p>
            </>
          )}
        </CardBody>
      </Card>

      {/* Reset */}
      <Card className="border-red-200">
        <CardHeader title="Reset demonstration data" description="Separate from loading: restores all seeded demonstration data for every scenario. Demo operators only." action={<Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} disabled={!canReset} onClick={onReset}>Reset Demo Data</Button>} />
        {resetProblem && <CardBody><p className="text-sm text-red-700">{resetProblem}</p></CardBody>}
      </Card>
    </div>
  );
}

function ReadinessView({ state }: { state: AppState }) {
  const items = readinessChecklist(state, DEMO_AUTH_ENABLED);
  return (
    <Card>
      <CardHeader title="Demonstration readiness checklist" description="Automatic checks of stored data, plus items a presenter confirms (Not Tested until confirmed outside the app)." />
      <CardBody><CheckList label="Readiness checklist" results={items} /></CardBody>
    </Card>
  );
}
