import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Copy, History, Pencil, Power, PowerOff, Trash2, Undo2, UserMinus, UserPlus } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, ConfirmDialog, DataTable, EmptyState, FilterSelect, Modal, OverflowMenu, SearchInput, Tabs, useToast,
  type OverflowMenuItem,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { ResultBadgeFor } from '@/pages/AuditPage';
import { ActivityStatusBadge, ChecksSummary, IssuesList, RulesList, VerifierPicker, typeName } from '@/components/verification/parts';
import { roleById } from '@/domain/roles';
import type { ActivityConfig, ActivityVersion } from '@/domain/types';
import { PLATFORM_POLICIES, activeAssignments, authorizeVerifier, validateConfiguration } from '@/domain/verification';
import { useQueryState } from '@/hooks/useQueryState';
import { formatDate, formatDateTime } from '@/lib/dates';
import { activationProblems, validationContext } from '@/store/activityOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { NotFoundPage } from '../NotFoundPage';
import { activityPath } from './paths';

type TabId = 'overview' | 'checks' | 'verifiers' | 'history';

export function ActivityDetailsPage() {
  const { activityId } = useParams();
  const { state } = useStore();
  const { organization } = useSession();
  const activity = state.data.activityConfigs.find((a) => a.id === activityId && a.organizationId === organization.id);
  if (!activity) return <NotFoundPage entity="verification activity" backTo="/verification-activities" />;
  return <Details key={activity.id} activity={activity} />;
}

function Details({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useQueryState('tab', 'overview');
  const [pending, setPending] = useState<'activate' | 'deactivate' | 'remove' | 'discard' | null>(null);

  const versions = state.data.activityVersions.filter((v) => v.activityId === activity.id).sort((a, b) => b.number - a.number);
  const active = versions.find((v) => v.id === activity.activeVersionId);
  const draft = versions.find((v) => v.id === activity.draftVersionId);
  const current = draft ?? active;
  const problems = activationProblems(state, organization.id, activity);
  const canManage = can('verification.activities.manage');
  const canEdit = canManage || can('verification.rules.manage') || can('verification.verifiers.assign');
  const tabs = [
    { value: 'overview' as const, label: 'Overview' },
    { value: 'checks' as const, label: 'Checks & Rules', count: current?.checks.length },
    { value: 'verifiers' as const, label: 'Verifiers', count: activeAssignments(state.data, organization.id, activity.id).length },
    ...(can('audit.view') ? [{ value: 'history' as const, label: 'Activity History' }] : []),
  ];
  const selected: TabId = tabs.some((t) => t.value === tab) ? (tab as TabId) : 'overview';

  const run = () => {
    const kind = pending;
    setPending(null);
    if (!kind) return;
    const r = kind === 'activate' ? actions.activateActivity(organization.id, activity.id)
      : kind === 'deactivate' ? actions.deactivateActivity(organization.id, activity.id)
        : kind === 'discard' ? actions.discardActivityDraft(organization.id, activity.id) : actions.removeDraftActivity(organization.id, activity.id);
    if (!r.ok) return toast({ tone: 'error', title: kind === 'activate' ? 'Can’t activate yet' : 'Nothing was changed', description: r.problems?.join(' ') ?? r.error });
    if (kind === 'remove') { toast({ tone: 'success', title: 'Draft removed', description: activity.name }); navigate('/verification-activities', { replace: true }); return; }
    toast({ tone: 'success', title: { activate: draft && active ? 'Changes activated' : 'Activity activated', deactivate: 'Activity deactivated', discard: 'Draft changes discarded' }[kind] });
  };

  const menu: OverflowMenuItem[] = [
    ...(can('verification.activities.create') ? [{
      key: 'dup', label: 'Duplicate Activity', icon: <Copy className="h-4 w-4" />, onSelect: () => {
        const r = actions.duplicateActivity(organization.id, activity.id);
        if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
        toast({ tone: 'success', title: 'Activity duplicated', description: 'The copy is a draft. Verifiers weren’t copied.' });
        navigate(activityPath((r as { activityId: string }).activityId));
      },
    }] : []),
    ...(can('verification.rules.manage') && draft && active ? [{ key: 'discard', label: 'Discard Draft Changes', icon: <Undo2 className="h-4 w-4" />, onSelect: () => setPending('discard') }] : []),
    ...(canManage && activity.status === 'draft' && !active ? [{ key: 'remove', label: 'Remove Draft Activity', tone: 'danger' as const, icon: <Trash2 className="h-4 w-4" />, onSelect: () => setPending('remove') }] : []),
  ];
  const needsActivation = activity.status !== 'active' || !!draft;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/verification-activities" className="hover:text-slate-800">Verification Activities</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="truncate text-slate-700">{activity.name}</span>
      </nav>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            {activity.name}<ActivityStatusBadge status={activity.status} />
          </h1>
          <p className="mt-1 max-w-2xl text-slate-500">{activity.description || 'No description.'}</p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
            {current && <div className="flex gap-1.5"><dt className="text-slate-500">Type</dt><dd className="font-medium text-slate-800">{typeName(current.type)}</dd></div>}
            {active && <div className="flex gap-1.5"><dt className="text-slate-500">In use</dt><dd className="text-slate-800">Version {active.number}</dd></div>}
            <div className="flex gap-1.5"><dt className="text-slate-500">Last updated</dt><dd className="text-slate-800">{formatDate(activity.updatedAt)} by {activity.updatedBy}</dd></div>
          </dl>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canEdit && <ButtonLink to={`${activityPath(activity.id)}/edit`} variant="secondary" icon={<Pencil className="h-4 w-4" />}>Edit</ButtonLink>}
          {canManage && activity.status === 'active' && <Button variant="secondary" icon={<PowerOff className="h-4 w-4" />} onClick={() => setPending('deactivate')}>Deactivate</Button>}
          {canManage && needsActivation && (
            <Button icon={<Power className="h-4 w-4" />} disabled={problems.blockers.length > 0} title={problems.blockers.length ? 'Resolve the listed items first' : undefined}
              onClick={() => setPending('activate')}>{activity.status === 'active' ? 'Activate changes' : 'Activate'}</Button>
          )}
          {menu.length > 0 && <OverflowMenu label="More actions" items={menu} />}
        </div>
      </header>

      {draft && active && (
        <p className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          Draft version {draft.number} has changes that aren’t in use yet. Version {active.number} {activity.status === 'active' ? 'is used for verifications' : 'is the last activated version'} until you activate the changes.
        </p>
      )}
      {canManage && needsActivation && problems.blockers.length > 0 && (
        <div className="mb-4"><IssuesList blockers={problems.blockers} warnings={[]} title={activity.status === 'active' ? 'Resolve before activating the changes' : 'Resolve before activating'} /></div>
      )}

      <Tabs<TabId> value={selected} onChange={(v) => setTab(v)} tabs={tabs} />
      <div className="mt-6" role="tabpanel" aria-label={tabs.find((t) => t.value === selected)?.label}>
        {selected === 'overview' && <Overview activity={activity} versions={versions} current={current} warnings={problems.warnings} />}
        {selected === 'checks' && <ChecksTab active={active} draft={draft} />}
        {selected === 'verifiers' && <VerifiersTab activity={activity} />}
        {selected === 'history' && <HistoryTab activity={activity} />}
      </div>

      {pending && (
        <ConfirmDialog open onCancel={() => setPending(null)} onConfirm={run}
          tone={pending === 'activate' ? 'primary' : 'danger'}
          title={{ activate: draft && active ? `Activate version ${draft.number}?` : `Activate ${activity.name}?`, deactivate: `Deactivate ${activity.name}?`, remove: `Remove ${activity.name}?`, discard: 'Discard draft changes?' }[pending]}
          confirmLabel={{ activate: 'Activate', deactivate: 'Deactivate', remove: 'Remove Draft', discard: 'Discard changes' }[pending]}
          description={{
            activate: draft && active ? `New verifications will use version ${draft.number}. Earlier verifications keep the version they used.` : 'Assigned verifiers will be able to use it straight away.',
            deactivate: 'No new verifications can start. Earlier verification records and the configuration are kept, and you can activate it again later.',
            remove: 'This draft was never activated. It and its verifier assignments will be removed. This can’t be undone.',
            discard: `Draft version ${draft?.number} will be deleted. Version ${active?.number} stays as it is.`,
          }[pending]} />
      )}
    </>
  );
}

function Overview({ activity, versions, current, warnings }: { activity: ActivityConfig; versions: ActivityVersion[]; current?: ActivityVersion; warnings: string[] }) {
  const { state } = useStore();
  const { organization } = useSession();
  const verifiers = activeAssignments(state.data, organization.id, activity.id).length;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="space-y-6 px-6 py-5">
          <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2"><dt className="text-slate-500">Purpose</dt><dd className="mt-0.5 text-slate-900">{activity.purpose || '—'}</dd></div>
            <div><dt className="text-slate-500">Verification type</dt><dd className="mt-0.5 font-medium text-slate-900">{current ? typeName(current.type) : '—'}</dd></div>
            <div><dt className="text-slate-500">Status</dt><dd className="mt-0.5"><ActivityStatusBadge status={activity.status} /></dd></div>
            <div><dt className="text-slate-500">Checks</dt><dd className="mt-0.5 text-slate-900">
              {current ? `${current.checks.filter((c) => c.requirement === 'required').length} required · ${current.checks.filter((c) => c.requirement === 'optional').length} optional · ${current.checks.filter((c) => c.requirement === 'alternative').length} alternatives` : '—'}
            </dd></div>
            <div><dt className="text-slate-500">Assigned verifiers</dt><dd className="mt-0.5 text-slate-900">{verifiers}</dd></div>
            <div><dt className="text-slate-500">Created</dt><dd className="mt-0.5 text-slate-900">{formatDate(activity.createdAt)} by {activity.createdBy}</dd></div>
          </dl>
          {current && <section><h2 className="mb-2 text-sm font-semibold text-slate-900">How this activity decides</h2><RulesList version={current} /></section>}
          {warnings.length > 0 && <IssuesList blockers={[]} warnings={warnings} />}
        </div>
      </Card>
      <Card>
        <div className="px-6 py-5">
          <h2 className="text-sm font-semibold text-slate-900">Configuration versions</h2>
          <p className="mt-0.5 text-xs text-slate-500">Each verification will record the version it used, so changes never rewrite earlier results.</p>
          <ul className="mt-3 divide-y divide-slate-100" aria-label="Configuration versions">
            {versions.map((v) => (
              <li key={v.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <span>
                  <span className="font-medium text-slate-900">Version {v.number}</span>
                  <span className="block text-xs text-slate-500">
                    {v.status === 'draft' ? `Draft, last saved ${formatDateTime(v.updatedAt)}` : `Activated ${v.activatedAt ? formatDateTime(v.activatedAt) : ''}${v.activatedBy ? ` by ${v.activatedBy}` : ''}`}
                  </span>
                </span>
                <Badge tone={v.status === 'active' ? 'success' : v.status === 'draft' ? 'info' : 'neutral'}>{v.status === 'active' ? 'In use' : v.status === 'draft' ? 'Draft' : 'Superseded'}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

function ChecksTab({ active, draft }: { active?: ActivityVersion; draft?: ActivityVersion }) {
  const { state } = useStore();
  const { organization } = useSession();
  const [which, setWhich] = useState<'draft' | 'active'>(draft ? 'draft' : 'active');
  const version = (which === 'draft' ? draft : active) ?? draft ?? active;
  if (!version) return <Card><EmptyState title="No configuration yet" /></Card>;
  const v = validateConfiguration(version, validationContext(state, organization.id));
  return (
    <Card>
      <div className="space-y-7 px-6 py-5">
        {draft && active && (
          <div role="radiogroup" aria-label="Version" className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm font-medium">
            {([['draft', `Draft changes (version ${draft.number})`], ['active', `In use (version ${active.number})`]] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={which === k} onClick={() => setWhich(k)}
                className={which === k ? 'rounded-md bg-white px-3 py-1.5 text-slate-900 shadow-sm' : 'rounded-md px-3 py-1.5 text-slate-500 hover:text-slate-800'}>{label}</button>
            ))}
          </div>
        )}
        <section><h2 className="mb-3 text-sm font-semibold text-slate-900">Checks, providers and sources — {typeName(version.type)}</h2><ChecksSummary version={version} issues={v.blockers} /></section>
        <section><h2 className="mb-2 text-sm font-semibold text-slate-900">Outcome rules</h2><RulesList version={version} /></section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Mandatory policies</h2>
          <p className="mb-2 text-sm text-slate-500">These come from FixID and can’t be changed by an organization. Checks they require are marked “Platform policy”.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">{PLATFORM_POLICIES.map((p) => <li key={p.id}>{p.text}</li>)}</ul>
        </section>
      </div>
    </Card>
  );
}

function VerifiersTab({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const { organization } = useSession();
  const { can } = useAuthorization();
  const { saveActivity } = useActions();
  const toast = useToast();
  const canAssign = can('verification.verifiers.assign');
  const assignments = activeAssignments(state.data, organization.id, activity.id);
  const [editing, setEditing] = useState<string[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const version = state.data.activityVersions.find((v) => v.id === (activity.draftVersionId ?? activity.activeVersionId));

  const save = (ids: string[]) => {
    if (!version) return;
    // Only the assignments change; details and rules are passed through unchanged.
    const r = saveActivity(organization.id, activity.id, {
      name: activity.name, description: activity.description, purpose: activity.purpose, type: version.type, checks: version.checks, outcome: version.outcome, verifierIds: ids,
    });
    setEditing(null);
    setRemoving(null);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: 'Verifiers updated', description: `${ids.length} ${ids.length === 1 ? 'verifier is' : 'verifiers are'} assigned to ${activity.name}.` });
  };
  const name = (id: string) => state.data.administrators.find((a) => a.id === id);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Assigned verifiers</h2>
          <p className="text-sm text-slate-500">They can perform this activity when it’s active, through an authorized verifier application. Assignment gives no other access.</p>
        </div>
        {canAssign && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setEditing(assignments.map((a) => a.administratorId))}>Assign Verifiers</Button>}
      </div>
      <DataTable
        rows={assignments}
        rowKey={(a) => a.administratorId}
        empty={<EmptyState title="No verifiers assigned" description="Assign administrators with the Verifier role so they can perform this activity." />}
        columns={[
          { key: 'name', header: 'Name', cell: (a) => <span className="font-medium text-slate-900">{name(a.administratorId)?.name ?? name(a.administratorId)?.email ?? 'Removed administrator'}</span> },
          { key: 'role', header: 'Role', cell: (a) => <span className="text-slate-600">{name(a.administratorId)?.roleIds.map((r) => roleById(r)?.name).join(', ') ?? '—'}</span> },
          {
            key: 'can', header: 'Can perform now', cell: (a) => {
              const r = authorizeVerifier(state.data, { organizationId: organization.id, activityId: activity.id, administratorId: a.administratorId });
              return r.authorized ? <Badge tone="success" dot>Yes</Badge> : <span className="text-sm text-slate-500">No — {r.reason}</span>;
            },
          },
          { key: 'assigned', header: 'Assigned', cell: (a) => <span className="whitespace-nowrap text-slate-500">{formatDate(a.assignedAt)} by {a.assignedBy}</span> },
          ...(canAssign ? [{
            key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right',
            cell: (a: { administratorId: string }) => (
              <button type="button" onClick={() => setRemoving(a.administratorId)} aria-label={`Remove ${name(a.administratorId)?.name ?? 'verifier'}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700"><UserMinus className="h-4 w-4" aria-hidden="true" />Remove</button>
            ),
          }] : []),
        ]}
      />
      {editing && (
        <Modal open onClose={() => setEditing(null)} title="Assign verifiers" description={`Choose who can perform ${activity.name}.`}
          footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => save(editing)}>Save assignments</Button></>}>
          <VerifierPicker value={editing} onChange={setEditing} />
        </Modal>
      )}
      <ConfirmDialog open={!!removing} tone="danger" title={`Remove ${removing ? name(removing)?.name ?? 'verifier' : ''}?`} confirmLabel="Remove"
        description="They won’t be able to perform this activity from now on. Their role and other access don’t change."
        onCancel={() => setRemoving(null)} onConfirm={() => save(assignments.map((a) => a.administratorId).filter((id) => id !== removing))} />
    </Card>
  );
}

const HISTORY_TYPES = [
  { value: 'lifecycle', label: 'Lifecycle', match: ['created', 'activated', 'deactivated', 'duplicated', 'removed', 'draft-discarded'] },
  { value: 'configuration', label: 'Configuration', match: ['updated', 'checks-changed', 'rules-changed', 'providers-changed'] },
  { value: 'verifiers', label: 'Verifiers', match: ['verifier-assigned', 'verifier-removed'] },
];

function HistoryTab({ activity }: { activity: ActivityConfig }) {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const events = useMemo(() => state.data.audit
    .filter((e) => e.resourceType === 'verification-activity' && e.resourceId === activity.id)
    .filter((e) => type === 'all' || HISTORY_TYPES.find((t) => t.value === type)!.match.some((m) => e.action.endsWith(m)))
    .filter((e) => !q.trim() || e.summary.toLowerCase().includes(q.trim().toLowerCase()) || e.actor.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [state.data.audit, activity.id, q, type]);
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search history" label="Search activity history" className="sm:w-72" />
        <FilterSelect label="Change type" value={type} onChange={setType} options={[{ value: 'all', label: 'All changes' }, ...HISTORY_TYPES.map((t) => ({ value: t.value, label: t.label }))]} />
        <span className="text-xs text-slate-500 sm:ml-auto">Configuration and lifecycle changes. Verification attempts appear in Verification History.</span>
      </div>
      <DataTable
        rows={events}
        rowKey={(e) => e.id}
        empty={<EmptyState icon={<History className="h-5 w-5" />} title="No history yet" description="Changes to this activity will appear here." />}
        columns={[
          { key: 'time', header: 'Date and Time', cell: (e) => <span className="whitespace-nowrap tabular-nums text-slate-600">{formatDateTime(e.occurredAt)}</span> },
          {
            key: 'summary', header: 'Change', className: 'max-w-xl', cell: (e) => (
              <span className="block text-slate-800">{e.summary}
                {e.changes?.map((c) => <span key={c.field} className="block text-xs text-slate-500">{c.field}: {c.from} → {c.to}</span>)}
              </span>
            ),
          },
          { key: 'actor', header: 'Actor', cell: (e) => <span className="whitespace-nowrap text-slate-700">{e.actor}</span> },
          { key: 'outcome', header: 'Outcome', cell: (e) => <ResultBadgeFor result={e.result} /> },
        ]}
      />
    </Card>
  );
}
