import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, BadgeCheck, CalendarClock, Clock3, ShieldCheck, Users, Wallet, XCircle,
} from 'lucide-react';
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard } from '@/components/ui';
import { DecisionChart } from '@/components/domain/DecisionChart';
import { ActivityStatusBadge } from '@/components/domain/StatusBadges';
import { allowRate, dailyDecisions, formatPercent, isExpiringWithin, transactionsSince } from '@/domain/metrics';
import { PURPOSE_LABEL } from '@/domain/labels';
import { addDays, formatRelative, startOfDay } from '@/lib/dates';
import { useAuthorization } from '@/auth/authorization';
import type { Permission } from '@/domain/roles';
import { useOrgData, useSession, type OrgData } from '@/store/AppStore';

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** The operational dashboard for an organization that is using FixID. */
export function ActiveDashboard({ headerActions, data }: { headerActions?: ReactNode; data?: OrgData }) {
  const { admin } = useSession();
  // Sections follow the administrator's permissions, so nothing links to a page they can't open.
  const { can } = useAuthorization();
  const live = useOrgData();
  const { organization, members, credentials, credentialTypes, activities, transactions, audit } = data ?? live;
  const now = useMemo(() => new Date(), []);

  const m = useMemo(() => {
    const today = startOfDay(now);
    const activeMembers = members.filter((x) => x.status === 'active').length;
    const reused = members.filter((x) => x.resolution === 'linked-existing').length;
    const activeCreds = credentials.filter((c) => c.status === 'active').length;
    const expiring = credentials.filter((c) => isExpiringWithin(c, 30, now)).length;
    const pendingCreds = credentials.filter((c) => c.status === 'pending').length;
    const todayTx = transactionsSince(transactions, today);
    const weekTx = transactionsSince(transactions, addDays(today, -6));
    const deniedToday = todayTx.filter((t) => t.decision !== 'allow').length;
    const walletEligible = credentials.filter((c) => c.wallet.status !== 'not-sent');
    const delivered = walletEligible.filter((c) => c.wallet.status === 'delivered').length;
    const walletFailed = credentials.filter((c) => c.wallet.status === 'failed').length;
    const pendingMembers = members.filter((x) => x.status === 'pending').length;
    return {
      activeMembers, reused, activeCreds, expiring, pendingCreds, todayTx, weekTx, deniedToday,
      deliveryRate: walletEligible.length ? delivered / walletEligible.length : null, walletFailed, pendingMembers,
      chart: dailyDecisions(transactions, 14, now),
    };
  }, [members, credentials, transactions, now]);

  const walletConnected = organization.integrations.seamfixWallet.connected;

  const attention = ([
    { label: 'Credentials awaiting approval', count: m.pendingCreds, to: '/credentials/issued?status=pending', icon: Clock3, needs: 'credentials.view' },
    { label: 'Credentials expiring in 30 days', count: m.expiring, to: '/credentials/issued?expiring=30', icon: CalendarClock, needs: 'credentials.view' },
    { label: 'Wallet deliveries failed', count: m.walletFailed, to: '/credentials/issued?wallet=failed', icon: Wallet, needs: 'credentials.view' },
    { label: 'Denied or indeterminate today', count: m.deniedToday, to: '/transactions?decision=not-allowed&range=today', icon: XCircle, needs: 'verification.results.view' },
    { label: 'People with pending onboarding', count: m.pendingMembers, to: '/people?status=pending', icon: Users, needs: 'users.view' },
  ] as { label: string; count: number; to: string; icon: typeof Users; needs: Permission }[]).filter((a) => a.count > 0 && can(a.needs));
  const showResults = can('verification.results.view');
  const showActivities = can('verification.activities.view');
  const showCredentials = can('credentials.view');

  const typeCounts = credentialTypes
    .map((t) => ({ type: t, count: credentials.filter((c) => c.credentialTypeId === t.id && c.status === 'active').length }))
    .sort((a, b) => b.count - a.count);
  const maxType = Math.max(1, ...typeCounts.map((t) => t.count));

  const liveActivities = activities.filter((a) => a.status === 'active');

  return (
    <>
      <PageHeader
        title={`${greeting(now)}, ${admin.name.split(' ')[0]}`}
        description={`Here's what's happening across ${organization.name} today.`}
        actions={headerActions}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {can('users.view') && <StatCard label="People" value={members.length.toLocaleString()} icon={<Users className="h-4 w-4" />} to="/people"
          hint={`${m.activeMembers} active`} />}
        {showCredentials && <StatCard label="Active credentials" value={m.activeCreds.toLocaleString()} icon={<BadgeCheck className="h-4 w-4" />} to="/credentials/issued?status=active" tone="emerald"
          hint={`${m.expiring} expiring in the next 30 days`} />}
        {showResults && <StatCard label="Verifications today" value={m.todayTx.length.toLocaleString()} icon={<ShieldCheck className="h-4 w-4" />} to="/transactions?range=today" tone="violet"
          hint={`${formatPercent(allowRate(m.weekTx))} allowed over 7 days`} />}
        {showCredentials && <StatCard label="Wallet delivery" value={walletConnected ? formatPercent(m.deliveryRate) : 'Not connected'} icon={<Wallet className="h-4 w-4" />} tone="amber"
          to={walletConnected ? '/credentials/issued?wallet=failed' : '/settings?tab=integrations'}
          hint={walletConnected ? `${m.walletFailed} failed ${m.walletFailed === 1 ? 'delivery' : 'deliveries'} to Seamfix Wallet` : 'Connect Seamfix Wallet in Settings'} />}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        {showResults && <Card className="xl:col-span-2">
          <CardHeader title="Verification decisions" description="All activities, last 14 days"
            action={<Link to="/transactions?range=30d" className="text-sm font-medium text-brand-600 hover:text-brand-700">View transactions</Link>} />
          <CardBody>
            {transactions.length === 0
              ? <EmptyState title="No verifications yet" description="Decisions will appear here once people present credentials at a verification activity." />
              : <DecisionChart data={m.chart} />}
          </CardBody>
        </Card>}

        <Card className={showResults ? undefined : 'xl:col-span-3'}>
          <CardHeader title="Needs attention" description="Items that may require action" />
          {attention.length === 0 ? (
            <EmptyState title="All clear" description="Nothing needs your attention right now." icon={<ShieldCheck className="h-5 w-5" />} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((a) => (
                <li key={a.label}>
                  <Link to={a.to} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><a.icon className="h-4 w-4" /></span>
                    <span className="flex-1 text-sm text-slate-700">{a.label}</span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{a.count}</span>
                    <ArrowRight className="h-4 w-4 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        {showActivities && <Card className="xl:col-span-2">
          <CardHeader title="Live verification activities" description="Today's volume and allow rate by activity"
            action={<Link to="/activities" className="text-sm font-medium text-brand-600 hover:text-brand-700">All activities</Link>} />
          {liveActivities.length === 0 ? (
            <EmptyState title="No active verification activities" description="Activities define why, where and how people are verified." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {liveActivities.map((a) => {
                const tx = m.todayTx.filter((t) => t.activityId === a.id);
                const week = m.weekTx.filter((t) => t.activityId === a.id);
                return (
                  <li key={a.id}>
                    <Link to={`/activities/${a.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{a.name}</p>
                        <p className="truncate text-xs text-slate-500">{PURPOSE_LABEL[a.purpose]} · {a.location}</p>
                      </div>
                      <ActivityStatusBadge status={a.status} />
                      <div className="w-20 text-right">
                        <p className="text-sm font-semibold tabular-nums text-slate-900">{tx.length}</p>
                        <p className="text-[11px] text-slate-500">today</p>
                      </div>
                      <div className="w-20 text-right">
                        <p className="text-sm font-semibold tabular-nums text-slate-900">{formatPercent(allowRate(week))}</p>
                        <p className="text-[11px] text-slate-500">allowed 7d</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>}

        {showCredentials && <Card className={showActivities ? undefined : 'xl:col-span-3'}>
          <CardHeader title="Active credentials by type"
            action={<Link to="/credentials" className="text-sm font-medium text-brand-600 hover:text-brand-700">Manage</Link>} />
          <CardBody className="space-y-3">
            {typeCounts.map(({ type, count }) => (
              <Link key={type.id} to={`/credentials/configurations/${type.id}?tab=issued`} className="group block">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 group-hover:text-slate-900">{type.name}{type.status === 'draft' && <span className="ml-1.5 text-xs text-slate-400">(draft)</span>}</span>
                  <span className="font-medium tabular-nums text-slate-900">{count}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-brand-500 transition-all group-hover:bg-brand-600" style={{ width: `${(count / maxType) * 100}%` }} />
                </div>
              </Link>
            ))}
          </CardBody>
        </Card>}
      </div>

      {can('audit.view') && <Card className="mt-6">
        <CardHeader title="Recent activity" description="Administrative and integration events"
          action={<Link to="/audit" className="text-sm font-medium text-brand-600 hover:text-brand-700">Audit log</Link>} />
        {audit.length === 0 ? <EmptyState title="No activity yet" /> : (
          <ul className="divide-y divide-slate-100">
            {audit.slice(0, 7).map((e) => {
              const body = (
                <>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.result === 'failure' ? 'bg-red-500' : e.actorType === 'integration' ? 'bg-sky-500' : 'bg-brand-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800">{e.summary}</span>
                    <span className="block text-xs text-slate-500">{e.actor}</span>
                  </span>
                  {e.result !== 'success' && <AlertTriangle className={`h-4 w-4 ${e.result === 'failure' ? 'text-red-500' : 'text-amber-500'}`} />}
                  <span className="shrink-0 text-xs text-slate-500">{formatRelative(e.occurredAt, now)}</span>
                </>
              );
              return (
                <li key={e.id}>
                  {e.href
                    ? <Link to={e.href} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">{body}</Link>
                    : <div className="flex items-start gap-3 px-5 py-3">{body}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>}
    </>
  );
}
