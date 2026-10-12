import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layers3, Lock, Pencil, Plus } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, OverflowMenu, PageHeader, useToast } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { ActivityStatusBadge } from '@/components/verification/parts';
import { ProgrammeRequirementsSummary } from '@/components/verification/RequirementsSummary';
import type { ParticipationStatus } from '@/domain/programmes';
import { formatDate } from '@/lib/dates';
import { integrationFor } from '@/store/integrationOps';
import { canRunUnder, participation, programmeActivities, programmeFor } from '@/store/programmeOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { activityPath } from '../verification/paths';
import { ParticipationBadge, ProgrammeStatusBadge } from './ProgrammesPage';
import { ProgrammeWizard } from './ProgrammeWizard';

type Transition = 'activate' | 'suspend' | 'resume' | 'complete' | 'archive';
const TRANSITION_COPY: Record<Transition, { label: string; body: string; tone?: 'danger' }> = {
  activate: { label: 'Activate', body: 'Participating organizations can then create activities under it and its requirements apply.' },
  suspend: { label: 'Suspend', body: 'No new programme-linked verification can start until it’s resumed. Activities and history are kept.', tone: 'danger' },
  resume: { label: 'Resume', body: 'Programme-linked activities can start new verifications again.' },
  complete: { label: 'Complete', body: 'No new verification can start under it. It stays available for history and reporting.', tone: 'danger' },
  archive: { label: 'Archive', body: 'It stays available for permitted audit purposes only.' },
};
const NEXT: Record<string, Transition[]> = { draft: ['activate'], active: ['suspend', 'complete'], suspended: ['resume', 'complete'], completed: ['archive'], archived: [] };

/**
 * One programme, as the current organization may see it. The owner sees requirements, participants and
 * every programme-linked activity (programme-level status only). A participant sees the requirements
 * and its own programme activities, never other participants’ activities or the owner’s configuration.
 */
export function ProgrammeDetailPage() {
  const { programmeId = '' } = useParams();
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const actions = useActions();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Transition | null>(null);
  const p = programmeFor(state, organization.id, programmeId);
  if (!p) {
    return (
      <Card className="px-6 py-10 text-center">
        <Layers3 className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Programme not available</h1>
        <p className="mt-1 text-slate-500">{organization.name} doesn’t own or take part in it, or it doesn’t exist.</p>
        <Link to="/programmes" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to Verification Programmes</Link>
      </Card>
    );
  }
  const role = participation(p, organization.id);
  const owner = role === 'owner';
  const canManage = owner && can('programmes.manage');
  const ownerName = state.data.organizations.find((o) => o.id === p.ownerOrganizationId)?.name ?? '';
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const src = p.requirements.identitySource;
  const integration = src.kind === 'external' ? integrationFor(state, p.ownerOrganizationId, src.integrationId) : undefined;
  const activities = programmeActivities(state, organization.id, p);
  const canCreateActivity = canRunUnder(p, organization.id) === null && can('verification.activities.create');
  const act = (r: { ok: true } | { ok: false; error: string }, title: string) => toast(r.ok ? { tone: 'success', title } : { tone: 'error', title: 'Nothing was changed', description: r.error });
  const setParticipant = (id: string, status: 'active' | 'suspended' | 'removed') => act(actions.setProgrammeParticipant(organization.id, p.id, id, status), `Participation updated for ${orgName(id)}`);

  return (
    <>
      <PageHeader title={p.name} breadcrumbs={[{ label: 'Verification Programmes', to: '/programmes' }, { label: p.name }]} meta={<ProgrammeStatusBadge status={p.status} />}
        description={p.description || p.purpose || 'Verification programme.'}
        actions={(
          <div className="flex flex-wrap gap-2">
            {canCreateActivity && <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate(`/verification-activities/new?programme=${p.id}`)}>Create activity under this programme</Button>}
            {canManage && p.status !== 'completed' && p.status !== 'archived' && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit programme</Button>}
            {canManage && NEXT[p.status].map((t) => <Button key={t} variant={t === 'activate' || t === 'resume' ? 'primary' : 'secondary'} onClick={() => setPending(t)}>{TRANSITION_COPY[t].label}</Button>)}
          </div>
        )} />

      {!owner && (
        <p className="mb-6 flex gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {ownerName} sets this programme’s requirements. Your activities under it inherit them and can make them stricter, not weaker.
          {role && role !== 'active' && <> Your participation is <ParticipationBadge status={role as ParticipationStatus} />.</>}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Verification requirements" description={owner ? 'Mandatory for every activity under this programme.' : 'Mandatory, set by the programme owner. Read-only.'} />
          <CardBody><ProgrammeRequirementsSummary requirements={p.requirements} integration={integration} ownerName={owner ? undefined : ownerName} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Programme" />
          <CardBody>
            <dl className="space-y-3 text-sm" aria-label="Programme details">
              <div><dt className="text-slate-500">Owning organization</dt><dd className="text-slate-900">{ownerName}</dd></div>
              <div><dt className="text-slate-500">Purpose</dt><dd className="text-slate-900">{p.purpose || '—'}</dd></div>
              <div><dt className="text-slate-500">Created</dt><dd className="text-slate-900">{formatDate(p.createdAt)} by {p.createdBy}</dd></div>
              {owner && <div><dt className="text-slate-500">Activities under the programme</dt><dd className="text-slate-900">{activities.length} ({activities.filter((a) => a.status === 'active').length} active)</dd></div>}
            </dl>
          </CardBody>
        </Card>
      </div>

      {owner && (
        <Card className="mt-6">
          <CardHeader title="Participating organizations" description={p.scope === 'own' ? `This programme applies to ${ownerName} only.` : 'Programme-level status only: their other records stay private.'} />
          {p.scope === 'own' ? null : (
            <DataTable
              rows={p.participants}
              rowKey={(x) => x.organizationId}
              columns={[
                { key: 'org', header: 'Organization', cell: (x) => <span className="font-medium text-slate-900">{orgName(x.organizationId)}</span> },
                { key: 'status', header: 'Enrollment', cell: (x) => <ParticipationBadge status={x.status} /> },
                { key: 'acts', header: 'Programme activities', cell: (x) => { const list = activities.filter((a) => a.organizationId === x.organizationId); return `${list.length} (${list.filter((a) => a.status === 'active').length} active)`; } },
                {
                  // Programme-level counts only: no people, references or results of individual transactions.
                  key: 'tx', header: 'Verification transactions', cell: (x) => {
                    const tx = state.data.verificationAttempts.filter((a) => a.programmeId === p.id && a.organizationId === x.organizationId && a.status !== 'in-progress');
                    const n = (d: string) => tx.filter((a) => a.decision === d).length;
                    return tx.length ? `${tx.length} (${n('allow')} allowed, ${n('pending-review')} pending review)` : 'None yet';
                  },
                },
                { key: 'since', header: 'Added', cell: (x) => formatDate(x.addedAt) },
                {
                  key: 'actions', header: 'Actions', className: 'w-24 text-right', cell: (x) => canManage && x.status !== 'removed' ? (
                    <OverflowMenu label={`Participation actions for ${orgName(x.organizationId)}`} items={[
                      ...(x.status === 'active' ? [{ key: 'suspend', label: 'Suspend participation', onSelect: () => setParticipant(x.organizationId, 'suspended') }] : []),
                      ...(x.status === 'suspended' ? [{ key: 'resume', label: 'Reactivate participation', onSelect: () => setParticipant(x.organizationId, 'active') }] : []),
                      { key: 'remove', label: 'Remove from programme', tone: 'danger' as const, onSelect: () => setParticipant(x.organizationId, 'removed') },
                    ]} />
                  ) : null,
                },
              ]}
            />
          )}
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title={owner ? 'Programme activities' : 'Your activities under this programme'} />
        <DataTable
          rows={activities}
          rowKey={(a) => a.id}
          empty={<p className="px-5 py-6 text-sm text-slate-500">No activities yet.{canCreateActivity ? ' Create one to start verifying people under this programme.' : ''}</p>}
          columns={[
            { key: 'name', header: 'Activity', cell: (a) => (a.organizationId === organization.id ? <Link to={activityPath(a.id)} className="font-medium text-slate-900 hover:text-brand-700">{a.name}</Link> : <span className="font-medium text-slate-900">{a.name}</span>) },
            { key: 'org', header: 'Organization', cell: (a) => orgName(a.organizationId) },
            { key: 'status', header: 'Status', cell: (a) => <ActivityStatusBadge status={a.status} /> },
          ]}
        />
      </Card>

      {editing && <ProgrammeWizard programme={p} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {pending && (
        <ConfirmDialog open title={`${TRANSITION_COPY[pending].label} ${p.name}?`} description={TRANSITION_COPY[pending].body} confirmLabel={TRANSITION_COPY[pending].label} tone={TRANSITION_COPY[pending].tone}
          onCancel={() => setPending(null)} onConfirm={() => { const t = pending; setPending(null); act(actions.programmeTransition(organization.id, p.id, t), `${p.name}: ${TRANSITION_COPY[t].label.toLowerCase()}d`); }} />
      )}
    </>
  );
}
