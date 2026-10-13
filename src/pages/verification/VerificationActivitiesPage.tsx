import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Copy, Eye, Pencil, Plus, Power, PowerOff, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, ConfirmDialog, Tabs, DataTable, EmptyState, FilterSelect, OverflowMenu, PageHeader, Pagination, SearchInput, Skeleton, usePageSlice, useToast,
  type OverflowMenuItem,
} from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { ActivityStatusBadge } from '@/components/verification/parts';
import type { ActivityConfig } from '@/domain/types';
import { currentVersion, requirementTags } from '@/domain/verification';
import { PARTICIPATION_LABEL } from '@/domain/activitySettings';
import { participation, sharedWith } from '@/store/sharingOps';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { activationProblems } from '@/store/activityOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { activityPath } from './paths';

const PAGE_SIZE = 15;
type Pending = { kind: 'activate' | 'deactivate' | 'remove'; activity: ActivityConfig } | null;

export function VerificationActivitiesPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [page, setPage] = usePageParam();
  const [pending, setPending] = useState<Pending>(null);
  const [view, setView] = useQueryState('view', '');
  const invitedCount = sharedWith(state, organization.id).length;
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 200); return () => clearTimeout(t); }, []);

  const canCreate = can('verification.activities.create');
  const canManage = can('verification.activities.activate');
  const canEdit = can('verification.activities.edit');

  const rows = useMemo(() => state.data.activityConfigs
    .filter((a) => a.organizationId === organization.id)
    .map((a) => {
      const version = currentVersion(state.data, a);
      return { activity: a, version, taking: (a.sharing?.participants ?? []).filter((p) => p.status === 'active').length };
    })
    .sort((a, b) => b.activity.updatedAt.localeCompare(a.activity.updatedAt)), [state.data, organization.id]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows
      .filter((r) => status === 'all' || r.activity.status === status)
      .filter((r) => !query || r.activity.name.toLowerCase().includes(query) || r.activity.description.toLowerCase().includes(query));
  }, [rows, q, status]);
  const { pageRows, pageCount, current } = usePageSlice(filtered, page, PAGE_SIZE);

  const runPending = () => {
    if (!pending) return;
    const { kind, activity } = pending;
    setPending(null);
    if (kind === 'activate' && activationProblems(state, organization.id, activity).blockers.length) {
      navigate(`${activityPath(activity.id)}/edit?step=review`);
      return;
    }
    const r = kind === 'activate' ? actions.activateActivity(organization.id, activity.id)
      : kind === 'deactivate' ? actions.deactivateActivity(organization.id, activity.id) : actions.removeDraftActivity(organization.id, activity.id);
    if (!r.ok) return toast({ tone: 'error', title: kind === 'activate' ? 'Can’t activate yet' : 'Nothing was changed', description: r.problems?.join(' ') ?? r.error });
    toast({ tone: 'success', title: { activate: 'Activity activated', deactivate: 'Activity deactivated', remove: 'Draft removed' }[kind], description: activity.name });
  };

  const duplicate = (a: ActivityConfig) => {
    const r = actions.duplicateActivity(organization.id, a.id);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: 'Activity duplicated', description: 'The copy is a draft.' });
    navigate(activityPath((r as { activityId: string }).activityId));
  };

  const menu = (a: ActivityConfig): OverflowMenuItem[] => [
    { key: 'view', label: 'View Activity', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(activityPath(a.id)) },
    ...(canEdit ? [{ key: 'edit', label: a.status === 'draft' ? 'Continue Editing' : 'Edit Activity', icon: <Pencil className="h-4 w-4" />, onSelect: () => navigate(`${activityPath(a.id)}/edit`) }] : []),
    ...(canManage && a.status !== 'active' ? [{ key: 'activate', label: 'Activate', icon: <Power className="h-4 w-4" />, onSelect: () => setPending({ kind: 'activate', activity: a }) }] : []),
    ...(canManage && a.status === 'active' ? [{ key: 'deactivate', label: 'Deactivate', icon: <PowerOff className="h-4 w-4" />, onSelect: () => setPending({ kind: 'deactivate', activity: a }) }] : []),
    ...(canCreate ? [{ key: 'duplicate', label: 'Duplicate Activity', icon: <Copy className="h-4 w-4" />, onSelect: () => duplicate(a) }] : []),
    ...(canEdit && a.status === 'draft' && !a.activeVersionId ? [{ key: 'remove', label: 'Remove Draft Activity', tone: 'danger' as const, icon: <Trash2 className="h-4 w-4" />, onSelect: () => setPending({ kind: 'remove', activity: a }) }] : []),
  ];

  const create = canCreate ? <ButtonLink to="/verification-activities/new" variant="primary" icon={<Plus className="h-4 w-4" />}>Create Activity</ButtonLink> : undefined;
  const headerActions = (
    <>
      {create}
    </>
  );
  const confirm = pending && {
    activate: (() => {
      const p = activationProblems(state, organization.id, pending.activity);
      return p.blockers.length
        ? { title: 'This activity can’t be activated yet', body: <><span className="block">Resolve these first:</span><ul className="mt-2 list-disc pl-5">{p.blockers.map((b) => <li key={b}>{b}</li>)}</ul></>, cta: 'Review configuration', tone: 'primary' as const }
        : {
          title: `Activate ${pending.activity.name}?`, cta: 'Activate', tone: 'primary' as const,
          body: <><span className="block">Its assigned verifiers will be able to use it straight away.</span>{p.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-amber-800">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}</>,
        };
    })(),
    deactivate: { title: `Deactivate ${pending.activity.name}?`, body: 'No new verifications can start. Earlier verification records and the configuration are kept, and you can activate it again later.', cta: 'Deactivate', tone: 'danger' as const },
    remove: { title: `Remove ${pending.activity.name}?`, body: 'This draft was never activated. It will be removed. This can’t be undone.', cta: 'Remove Draft', tone: 'danger' as const },
  }[pending.kind];

  return (
    <>
      <PageHeader title="Verification Activities" actions={headerActions} />
      <div className="mb-4"><Tabs<'mine' | 'invited'> value={view === 'invited' ? 'invited' : 'mine'} onChange={(v) => setView(v === 'mine' ? '' : v)}
        tabs={[{ value: 'mine', label: 'My Activities', count: rows.length }, { value: 'invited', label: 'Invited Activities', count: invitedCount }]} /></div>
      {view === 'invited' ? <InvitedActivities /> : (
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search activities" label="Search activities by name" className="sm:w-72" />
          <FilterSelect label="Status" value={status} onChange={setStatus}
            options={[{ value: 'all', label: 'All statuses' }, { value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        </div>
        {loading ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading activities">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <DataTable
            rows={pageRows}
            rowKey={(r) => r.activity.id}
            empty={rows.length === 0
              ? <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No verification activities yet" description="Create one to start verifying people." action={create} />
              : <EmptyState title="No matching activities" description="Try a different search or status." />}
            columns={[
              { key: 'name', header: 'Activity Name', cell: (r) => <Link to={activityPath(r.activity.id)} className="font-medium text-slate-900 hover:text-brand-700">{r.activity.name}</Link> },
              { key: 'requirements', header: 'Requirements', cell: (r) => <span className="whitespace-nowrap text-slate-700">{r.version ? requirementTags(r.version).join(' · ') || '—' : '—'}</span> },
              { key: 'for', header: 'For', cell: (r) => <span className="whitespace-nowrap text-slate-700">{r.activity.sharing ? <>Other organizations <span className="text-slate-500">· {r.taking} taking part</span></> : 'My organization'}</span> },
              {
                key: 'status', header: 'Status', cell: (r) => (
                  <span className="flex flex-wrap items-center gap-1.5"><ActivityStatusBadge status={r.activity.status} />
                    {r.activity.status !== 'draft' && r.activity.draftVersionId && <span className="text-xs text-slate-500">Changes pending</span>}</span>
                ),
              },
              { key: 'updated', header: 'Last Updated', cell: (r) => <span className="whitespace-nowrap text-slate-500">{formatDate(r.activity.updatedAt)}</span> },
              { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (r) => (
                <span className="inline-flex items-center justify-end gap-2">
                  {/* A draft opens where it was left, with everything entered so far. */}
                  {canEdit && r.activity.status === 'draft' && (
                    <Link to={`${activityPath(r.activity.id)}/edit`} className="whitespace-nowrap text-sm font-semibold text-brand-600 hover:text-brand-700">
                      Continue Editing<span className="sr-only"> {r.activity.name}</span>
                    </Link>
                  )}
                  <OverflowMenu label={`Actions for ${r.activity.name}`} items={menu(r.activity)} />
                </span>
              ) },
            ]}
          />
        )}
        <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>
      )}
      {pending && confirm && (
        <ConfirmDialog open title={confirm.title} description={confirm.body} confirmLabel={confirm.cta} tone={confirm.tone} onCancel={() => setPending(null)} onConfirm={runPending} />
      )}
    </>
  );
}


/** Shared activities other organizations invited this organization to. Accepting needs permission to edit activities. */
function InvitedActivities() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const { respondToInvitation } = useActions();
  const toast = useToast();
  const list = sharedWith(state, organization.id);
  const ownerName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? 'Another organization';
  const respond = (id: string, name: string, accept: boolean) => {
    const r = respondToInvitation(organization.id, id, accept);
    if (!r.ok) return toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
    toast({ tone: 'success', title: accept ? 'Invitation accepted' : 'Invitation declined', description: name });
  };
  return (
    <Card>
      <DataTable
        rows={list}
        rowKey={(a) => a.id}
        empty={<EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No invitations" description="Activities other organizations share with you appear here." />}
        columns={[
          { key: 'name', header: 'Activity', cell: (a) => <Link to={activityPath(a.id)} className="font-medium text-slate-900 hover:text-brand-700">{a.name}</Link> },
          { key: 'owner', header: 'From', cell: (a) => <span className="text-slate-700">{ownerName(a.organizationId)}</span> },
          { key: 'status', header: 'Status', cell: (a) => { const st = participation(a, organization.id) as 'invited' | 'active' | 'suspended'; return <Badge tone={st === 'active' ? 'success' : st === 'invited' ? 'info' : 'warning'}>{PARTICIPATION_LABEL[st]}</Badge>; } },
          {
            key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (a) => {
              const st = participation(a, organization.id);
              if (st === 'invited' && can('verification.activities.edit')) {
                return (
                  <span className="inline-flex gap-2">
                    <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => respond(a.id, a.name, true)}>Accept<span className="sr-only"> {a.name}</span></Button>
                    <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => respond(a.id, a.name, false)}>Decline<span className="sr-only"> {a.name}</span></Button>
                  </span>
                );
              }
              return st === 'active' ? <Link to={activityPath(a.id)} className="text-sm font-semibold text-brand-600 hover:text-brand-700">Assign verifiers<span className="sr-only"> for {a.name}</span></Link> : null;
            },
          },
        ]}
      />
    </Card>
  );
}
