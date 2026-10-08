import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, CircleDashed, CircleHelp, XCircle } from 'lucide-react';
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui';
import { AssuranceBadge, DecisionBadge, ResultBadge } from '@/components/domain/StatusBadges';
import { ASSURANCE_LABEL, METHOD_LABEL } from '@/domain/labels';
import type { Transaction } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useStore, useOrgData } from '@/store/AppStore';
import { NotFoundPage } from './NotFoundPage';

type StepState = 'pass' | 'fail' | 'skipped' | 'unknown';

function pipeline(t: Transaction, primaryLabel: string): { label: string; state: StepState; detail: string }[] {
  const credFail = t.result === 'rejected';
  const matchFail = t.result === 'failed';
  return [
    { label: 'Credential validation', state: credFail ? 'fail' : 'pass', detail: credFail ? t.reason : 'Credential recognised, active and in date' },
    {
      label: 'Identity match', state: credFail ? 'skipped' : matchFail ? 'fail' : 'pass',
      detail: credFail ? 'Not attempted' : matchFail ? t.reason : t.fallbackUsed ? `Primary ${primaryLabel} failed; matched with ${METHOD_LABEL[t.method]} (permitted fallback)` : `Matched with ${METHOD_LABEL[t.method]}`,
    },
    {
      label: 'Authorization', state: t.result !== 'success' ? 'skipped' : t.decision === 'allow' ? 'pass' : t.decision === 'indeterminate' ? 'unknown' : 'fail',
      detail: t.result !== 'success' ? 'Not evaluated' : t.decision === 'allow' ? 'Eligibility rules satisfied' : t.reason,
    },
    {
      label: 'Decision', state: t.decision === 'allow' ? 'pass' : t.decision === 'indeterminate' ? 'unknown' : 'fail',
      detail: t.decision === 'allow' ? t.reason : t.decision === 'indeterminate' ? 'Unable to evaluate. Access not granted (fail secure).' : 'Access denied',
    },
  ];
}

const icon = {
  pass: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
  fail: <XCircle className="h-5 w-5 text-red-500" />,
  unknown: <CircleHelp className="h-5 w-5 text-amber-500" />,
  skipped: <CircleDashed className="h-5 w-5 text-slate-300" />,
};

export function TransactionDetailPage() {
  const { transactionId } = useParams();
  const { state } = useStore();
  const { organization, activityById, memberById, credentialById, credentialTypeById } = useOrgData();
  const t = state.data.transactions.find((x) => x.id === transactionId && x.organizationId === organization.id);
  if (!t) return <NotFoundPage entity="transaction" backTo="/transactions" />;

  const activity = activityById.get(t.activityId)!;
  const member = t.memberId ? memberById.get(t.memberId) : undefined;
  const credential = t.credentialId ? credentialById.get(t.credentialId) : undefined;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Transactions', to: '/transactions' }, { label: t.id }]}
        title={<span className="font-mono">{t.id}</span>}
        description={`${activity.name} · ${formatDateTime(t.occurredAt)}`}
        meta={<><ResultBadge result={t.result} /><DecisionBadge decision={t.decision} /></>}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="How this decision was reached" description="Verification and authorization are evaluated separately." />
          <CardBody>
            <ol className="relative space-y-5">
              {pipeline(t, METHOD_LABEL[activity.primaryMethod]).map((s, i, all) => (
                <li key={s.label} className="relative flex gap-3">
                  {i < all.length - 1 && <span className="absolute left-[9px] top-6 h-full w-px bg-slate-200" />}
                  <span className="relative bg-white">{icon[s.state]}</span>
                  <div>
                    <p className={cn('text-sm font-medium', s.state === 'skipped' ? 'text-slate-400' : 'text-slate-900')}>{s.label}</p>
                    <p className="text-sm text-slate-500">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Record" />
          <CardBody>
            <DescriptionList items={[
              { label: 'Activity', value: <Link to={`/activities/${activity.id}`} className="text-brand-700 hover:underline">{activity.name}</Link> },
              { label: 'Person', value: member ? <Link to={`/people/${member.id}`} className="text-brand-700 hover:underline">{member.displayName}</Link> : 'Not identified' },
              { label: 'Credential', value: credential ? <Link to={`/credentials/${credential.id}`} className="font-mono text-xs text-brand-700 hover:underline">{credential.identifier}</Link> : '—', hint: credential ? credentialTypeById.get(credential.credentialTypeId)?.name : undefined },
              { label: 'Method', value: METHOD_LABEL[t.method] },
              { label: 'Fallback used', value: t.fallbackUsed ? 'Yes' : 'No' },
              { label: 'Assurance', value: t.assuranceAchieved ? <AssuranceBadge level={t.assuranceAchieved} /> : '—', hint: `Required: ${ASSURANCE_LABEL[activity.assuranceLevel]}` },
              { label: 'Verifier', value: t.verifier },
              { label: 'Organization', value: organization.name },
            ]} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
