import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Layers3, Plus } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, FilterSelect, OverflowMenu, PageHeader, SearchInput, Skeleton } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { PARTICIPATION_LABEL, PROGRAMME_STATUS_LABEL, type ParticipationStatus, type ProgrammeStatus, type VerificationProgramme } from '@/domain/programmes';
import { formatDate } from '@/lib/dates';
import { integrationFor } from '@/store/integrationOps';
import { participation, programmesVisibleTo } from '@/store/programmeOps';
import { useSession, useStore } from '@/store/AppStore';
import type { AppState } from '@/store/state';
import { ProgrammeWizard } from './ProgrammeWizard';

const TONE: Record<ProgrammeStatus, 'neutral' | 'success' | 'warning' | 'info'> = { draft: 'neutral', active: 'success', suspended: 'warning', completed: 'info', archived: 'neutral' };
export const ProgrammeStatusBadge = ({ status }: { status: ProgrammeStatus }) => <Badge tone={TONE[status]} dot>{PROGRAMME_STATUS_LABEL[status]}</Badge>;
const PART_TONE: Record<ParticipationStatus, 'info' | 'success' | 'warning' | 'neutral'> = { invited: 'info', active: 'success', suspended: 'warning', removed: 'neutral' };
export const ParticipationBadge = ({ status }: { status: ParticipationStatus }) => <Badge tone={PART_TONE[status]}>{PARTICIPATION_LABEL[status]}</Badge>;

/** Verification source in a list: the service name only (safe metadata), or local records. */
export function programmeSource(state: AppState, p: VerificationProgramme): string {
  const s = p.requirements.identitySource;
  return s.kind === 'local' ? 'FixID Local Records' : integrationFor(state, p.ownerOrganizationId, s.integrationId)?.name ?? 'External identity service';
}

/**
 * Verification Programmes: the current organization's own programmes, and those it takes part in.
 * Programmes are optional; independent activities never need one.
 */
export function ProgrammesPage() {
  const { organization } = useSession();
  const { state } = useStore();
  const { can } = useAuthorization();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 200); return () => clearTimeout(t); }, []);
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const all = programmesVisibleTo(state, organization.id);
  const rows = useMemo(() => all
    .filter((p) => status === 'all' || p.status === status)
    .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [all, q, status]);
  const canManage = can('programmes.manage');

  return (
    <>
      <PageHeader title="Verification Programmes" description={`Shared verification requirements that ${organization.name} sets for itself or its sub-organizations. Activities don’t need a programme.`}
        actions={canManage ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Create Programme</Button> : undefined} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search programmes" className="sm:w-72" label="Search programmes" />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, ...(Object.keys(PROGRAMME_STATUS_LABEL) as ProgrammeStatus[]).map((s) => ({ value: s, label: PROGRAMME_STATUS_LABEL[s] }))]} />
        </div>
        {loading ? <div className="space-y-3 p-5" aria-label="Loading programmes">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div> : (
          <DataTable
            rows={rows}
            rowKey={(p) => p.id}
            empty={all.length === 0
              ? <EmptyState icon={<Layers3 className="h-5 w-5" />} title="No verification programmes"
                  description="Create a programme when several activities, or your sub-organizations, should follow the same verification requirements. Independent activities don’t need one."
                  action={canManage ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Create Programme</Button> : undefined} />
              : <EmptyState title="No matching programmes" description="Try a different search or filter." />}
            columns={[
              {
                key: 'name', header: 'Programme Name', cell: (p) => {
                  const r = participation(p, organization.id);
                  return (
                    <span className="block">
                      <Link to={`/programmes/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.name}</Link>
                      {r !== 'owner' && r && <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">Your participation: <ParticipationBadge status={r} /></span>}
                    </span>
                  );
                },
              },
              { key: 'owner', header: 'Owning Organization', cell: (p) => orgName(p.ownerOrganizationId) },
              { key: 'parts', header: 'Participating Organizations', cell: (p) => (p.scope === 'own' ? <span className="text-slate-600">Own organization only</span> : <span className="text-slate-600">{p.participants.filter((x) => x.status !== 'removed').map((x) => orgName(x.organizationId)).join(', ')}</span>) },
              { key: 'src', header: 'Verification Source', cell: (p) => <span className="text-slate-600">{programmeSource(state, p)}</span> },
              { key: 'status', header: 'Status', cell: (p) => <ProgrammeStatusBadge status={p.status} /> },
              { key: 'created', header: 'Date Created', cell: (p) => formatDate(p.createdAt) },
              { key: 'actions', header: 'Actions', className: 'w-24 text-right', cell: (p) => <OverflowMenu label={`Actions for ${p.name}`} items={[{ key: 'view', label: 'View details', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(`/programmes/${p.id}`) }]} /> },
            ]}
          />
        )}
      </Card>
      {creating && <ProgrammeWizard programme={null} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); navigate(`/programmes/${id}`); }} />}
    </>
  );
}
