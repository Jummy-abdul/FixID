import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BadgePlus, ChevronRight, ShieldCheck } from 'lucide-react';
import { Avatar, Button, ButtonLink, Card, DataTable, EmptyState, Skeleton, Tabs } from '@/components/ui';
import { CredentialStatusBadge, MemberStatusBadge, ResultBadge } from '@/components/domain/StatusBadges';
import { assignUrl } from '@/components/issuance/assignment';
import { issuedLook } from '@/domain/templates';
import { issuedCredentialPath } from './credentials/IssuedCredentialDetailPage';
import type { CanonicalIdentity, Credential, Member } from '@/domain/types';
import { formatDate, formatDateTime } from '@/lib/dates';
import { usePortrait } from '@/hooks/usePortrait';
import { useQueryState } from '@/hooks/useQueryState';
import { useServices } from '@/services/ServicesProvider';
import { useOrgData } from '@/store/AppStore';
import { NotFoundPage } from './NotFoundPage';
import { useAuthorization } from '@/auth/authorization';
import { MemberGroupsCard } from '@/components/groups/MemberGroupsCard';

type TabId = 'profile' | 'credentials' | 'verifications';

export function PersonDetailPage() {
  const { personId } = useParams();
  const { memberById } = useOrgData();
  const member = personId ? memberById.get(personId) : undefined;
  if (!member) return <NotFoundPage entity="user" backTo="/users" />;
  return <UserDetails key={member.id} member={member} />;
}

function UserDetails({ member }: { member: Member }) {
  const { credentials, transactions } = useOrgData();
  const [tab, setTab] = useQueryState('tab', 'profile');
  const memberCreds = credentials.filter((c) => c.memberId === member.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const memberTx = transactions.filter((t) => t.memberId === member.id);
  const portrait = usePortrait(member);
  const current = (['profile', 'credentials', 'verifications'] as const).includes(tab as TabId) ? (tab as TabId) : 'profile';
  const canViewGroups = useAuthorization().can('groups.view');

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
        <Link to="/users" className="hover:text-slate-800">Users</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-slate-700">{member.displayName}</span>
      </nav>
      <section aria-label="User profile" className="mb-6 flex items-center gap-5">
        <div className="flex flex-col items-center gap-1">
          <Avatar name={member.displayName} photoUrl={portrait?.url} size="xl" className="shadow-card ring-4 ring-white"
            photoAlt={portrait?.isSample ? `Sample portrait for ${member.displayName} (demonstration image)` : `Portrait of ${member.displayName}`} />
          {portrait?.isSample && <span className="text-[10px] uppercase tracking-wide text-slate-400">Sample image</span>}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{member.displayName}</h1>
          <div className="mt-2"><MemberStatusBadge status={member.status} /></div>
        </div>
      </section>

      <Tabs<TabId> value={current} onChange={(v) => setTab(v)} tabs={[
        { value: 'profile', label: 'Profile Details' },
        { value: 'credentials', label: 'Credentials', count: memberCreds.length },
        { value: 'verifications', label: 'Recent Verifications' },
      ]} />
      <div className="mt-6" role="tabpanel" aria-label={current === 'profile' ? 'Profile Details' : current === 'credentials' ? 'Credentials' : 'Recent Verifications'}>
        {current === 'profile' && (
          <>
            <ProfileTab member={member} />
            {canViewGroups && <MemberGroupsCard member={member} />}
          </>
        )}
        {current === 'credentials' && <CredentialsTab member={member} creds={memberCreds} />}
        {current === 'verifications' && <VerificationsTab member={member} rows={memberTx} />}
      </div>
    </>
  );
}

type LoadState = { status: 'loading' } | { status: 'ready'; identity: CanonicalIdentity | null } | { status: 'error' };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

const orDash = (v?: string | null) => (v && v.trim() ? v : '—');

function ProfileTab({ member }: { member: Member }) {
  const { identifierConfigById } = useOrgData();
  const { idSwitch } = useServices();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    idSwitch.getIdentity(member.idSwitchId)
      .then((identity) => { if (!cancelled) setState({ status: 'ready', identity }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [member.idSwitchId, idSwitch, attempt]);

  const [first, ...rest] = member.displayName.split(' ');
  const identity = state.status === 'ready' ? state.identity : null;
  const value = (v: string | undefined) => (state.status === 'loading' ? <Skeleton className="h-4 w-32" /> : orDash(v));

  return (
    <Card>
      <div className="px-6 py-6 sm:px-8">
        {state.status === 'error' && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            Some contact details couldn't be loaded right now.
            <Button size="sm" variant="secondary" onClick={() => setAttempt((a) => a + 1)}>Retry</Button>
          </div>
        )}
        <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First Name">{identity?.givenName ?? first}</Field>
          <Field label="Last Name">{identity?.familyName ?? orDash(rest.join(' '))}</Field>
          <Field label="Email Address">{value(identity?.email)}</Field>
          <Field label="Phone Number">{value(identity?.phone)}</Field>
          <Field label="Gender">{value(identity?.gender)}</Field>
          <Field label="Location">{value([identity?.region, identity?.country].filter(Boolean).join(', ') || identity?.location)}</Field>
          <Field label="Identifier Name">{member.identifier ? orDash(identifierConfigById.get(member.identifier.configId)?.name) : '—'}</Field>
          <Field label="Identifier Value">{member.identifier ? <span className="font-mono">{member.identifier.value}</span> : '—'}</Field>
        </dl>
      </div>
      <div className="rounded-b-xl border-t border-slate-100 bg-slate-50/60 px-6 py-4 sm:px-8">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Record Information</h3>
        <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-2 text-sm">
          <div className="flex gap-2"><dt className="text-slate-500">Date Created</dt><dd className="text-slate-700">{formatDate(member.joinedAt)}</dd></div>
          <div className="flex gap-2"><dt className="text-slate-500">Created By</dt><dd className="text-slate-700">{orDash(member.createdBy)}</dd></div>
        </dl>
      </div>
    </Card>
  );
}

function CredentialsTab({ member, creds }: { member: Member; creds: Credential[] }) {
  const { credentialTypeById } = useOrgData();
  const issueHref = assignUrl({ recipientIds: [member.id], from: 'user' });
  const allowed = useAuthorization().can('credentials.issue');
  const canIssue = member.status === 'active';
  const serial = useMemo(() => new Map(creds.map((c, i) => [c.id, i + 1])), [creds]);
  const issueButton = (variant: 'primary' | 'secondary') => !allowed ? null : canIssue
    ? <ButtonLink to={issueHref} variant={variant} icon={<BadgePlus className="h-4 w-4" />}>Issue Credential</ButtonLink>
    : <Button variant={variant} disabled title="Only active users can be issued credentials">Issue Credential</Button>;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-900">Credentials</h2>
        {creds.length > 0 && issueButton('secondary')}
      </div>
      {creds.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No credentials issued yet"
          description={canIssue ? "You can issue a digital ID to this user whenever you're ready." : 'Activate this user to issue a digital ID.'}
          action={issueButton('primary')} />
      ) : (
        <DataTable
          rows={creds}
          rowKey={(c) => c.id}
          columns={[
            { key: 'sn', header: 'SN', className: 'w-12', cell: (c) => <span className="tabular-nums text-slate-500">{serial.get(c.id)}</span> },
            { key: 'name', header: 'Credential Name', cell: (c) => <span className="font-medium text-slate-900">{issuedLook(c, credentialTypeById.get(c.credentialTypeId)).credentialName}</span> },
            { key: 'identifier', header: 'Identifier', cell: (c) => <span className="font-mono text-xs text-slate-700">{c.identifier}</span> },
            { key: 'issued', header: 'Date Issued', cell: (c) => <span className="text-slate-600">{formatDate(c.issuedAt)}</span> },
            { key: 'expires', header: 'Expiration Date', cell: (c) => <span className="text-slate-600">{c.expiresAt ? formatDate(c.expiresAt) : 'No expiry'}</span> },
            { key: 'status', header: 'Credential Status', cell: (c) => <CredentialStatusBadge status={c.status} /> },
            {
              key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right',
              cell: (c) => (
                <Link to={issuedCredentialPath(c.id, { kind: 'user', id: member.id })} className="whitespace-nowrap text-sm font-medium text-brand-600 hover:text-brand-700">
                  View Details<span className="sr-only"> for {issuedLook(c, credentialTypeById.get(c.credentialTypeId)).credentialName} {c.identifier}</span>
                </Link>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

function VerificationsTab({ member, rows }: { member: Member; rows: ReturnType<typeof useOrgData>['transactions'] }) {
  const { activityById, credentialById, credentialTypeById } = useOrgData();
  const sorted = [...rows].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 25);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-900">Recent Verifications</h2>
        {rows.length > sorted.length && (
          <Link to={`/verification-history?person=${member.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View all {rows.length}</Link>
        )}
      </div>
      {sorted.length === 0 ? (
        <EmptyState title="No verification activity yet" description="Verification activity for this user will appear here." />
      ) : (
        <DataTable
          rows={sorted}
          rowKey={(t) => t.id}
          columns={[
            { key: 'time', header: 'Date and Time', cell: (t) => <span className="tabular-nums text-slate-600">{formatDateTime(t.occurredAt)}</span> },
            { key: 'activity', header: 'Verification Activity', cell: (t) => <span className="text-slate-900">{activityById.get(t.activityId)?.name ?? '—'}</span> },
            {
              key: 'credential', header: 'Credential', cell: (t) => {
                const c = t.credentialId ? credentialById.get(t.credentialId) : undefined;
                return c ? <span>{credentialTypeById.get(c.credentialTypeId)?.name}<span className="block font-mono text-xs text-slate-500">{c.identifier}</span></span> : <span className="text-slate-400">—</span>;
              },
            },
            { key: 'result', header: 'Result', cell: (t) => <ResultBadge result={t.result} /> },
            {
              key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right',
              cell: (t) => <Link to={`/verification-history/${t.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View<span className="sr-only"> verification {formatDateTime(t.occurredAt)}</span></Link>,
            },
          ]}
        />
      )}
    </Card>
  );
}
