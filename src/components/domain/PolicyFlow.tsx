import { ArrowRight, CornerDownRight } from 'lucide-react';
import { ASSURANCE_LABEL, METHOD_LABEL } from '@/domain/labels';
import { METHOD_ASSURANCE, invalidFallbacks } from '@/domain/rules';
import type { VerificationActivity } from '@/domain/types';
import { useOrgData } from '@/store/AppStore';

/** Visual summary of an activity's trust policy: method → fallback → eligibility → outcome. */
export function PolicyFlow({ activity }: { activity: VerificationActivity }) {
  const { credentialTypeById } = useOrgData();
  const blocked = invalidFallbacks(activity.fallback.methods, activity.assuranceLevel);
  const eligibility = [
    activity.eligibility.credentialTypeIds.map((id) => credentialTypeById.get(id)?.name).filter(Boolean).join(' or '),
    activity.eligibility.rosterMemberIds ? `on roster (${activity.eligibility.rosterMemberIds.length})` : null,
    activity.eligibility.requireActiveMember ? 'active relationship' : null,
  ].filter(Boolean).join(' · ');
  const steps = [
    { label: 'Verify with', value: METHOD_LABEL[activity.primaryMethod], sub: `${ASSURANCE_LABEL[METHOD_ASSURANCE[activity.primaryMethod]]} assurance` },
    {
      label: 'Fallback', value: activity.fallback.permitted && activity.fallback.methods.length ? activity.fallback.methods.map((m) => METHOD_LABEL[m]).join(', ') : 'Not permitted',
      sub: blocked.length ? `${blocked.map((m) => METHOD_LABEL[m]).join(', ')} blocked by assurance` : activity.fallback.permitted ? 'Respects required assurance' : 'Fail securely',
    },
    { label: 'Eligible if', value: eligibility || 'Any credential', sub: activity.eligibility.relationships.join(', ') },
    { label: 'Then', value: activity.outcome, sub: `Requires ${ASSURANCE_LABEL[activity.assuranceLevel].toLowerCase()} assurance` },
  ];
  return (
    <ol className="grid grid-cols-1 gap-2 md:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.label} className="relative rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {i === 1 && <CornerDownRight className="h-3 w-3" />}{s.label}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900">{s.value}</p>
          <p className="mt-0.5 text-xs text-slate-500">{s.sub}</p>
          {i < steps.length - 1 && <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-white text-slate-400 md:block" />}
        </li>
      ))}
    </ol>
  );
}
