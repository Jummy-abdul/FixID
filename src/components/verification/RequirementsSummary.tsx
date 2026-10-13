import type { VerificationSettings } from '@/domain/activitySettings';
import type { CustomIntegration } from '@/domain/integrations';

/** The identity source in words, with only safe metadata about an external source. */
export function sourceLabel(source: VerificationSettings['identitySource'], integration?: Pick<CustomIntegration, 'name' | 'status'>, ownerName?: string): string {
  if (source.kind === 'local') return 'FixID records';
  return `${integration?.name ?? 'Connected identity source'}${ownerName ? ` (provided by ${ownerName})` : ''}${integration && integration.status !== 'active' ? ` — ${integration.status}` : ''}`;
}

/** The checks an activity requires, in plain words. */
export function checksLabel(s: Pick<VerificationSettings, 'method' | 'liveness'>): string {
  return ['Identifier', ...(s.method === 'face' ? ['face match', ...(s.liveness === 'required' ? ['liveness'] : s.liveness === 'optional' ? ['liveness (optional)'] : [])] : ['stated details'])].join(', ');
}

/** Who can be checked, in plain words (eligibility isn't configured as such). */
function whoLabel(s: VerificationSettings): string {
  switch (s.eligibility.approach) {
    case 'local-population': return 'Only the people or groups chosen for this activity';
    case 'reference-list': return `Only listed references (${s.eligibility.referenceList?.length ?? 0})`;
    case 'external-source': return 'People whose record is active in the identity source';
    default: return s.identitySource.kind === 'local' ? 'Anyone registered in FixID records' : 'Anyone found in the identity source';
  }
}

/** An activity's settings, read-only. */
export function ActivitySettingsSummary({ settings: s, integration, ownerName }: { settings: VerificationSettings; integration?: CustomIntegration; ownerName?: string }) {
  const rows = [
    { label: 'Identity source', value: sourceLabel(s.identitySource, integration, ownerName) },
    { label: 'Required checks', value: checksLabel(s) },
    { label: 'When a check fails', value: s.exceptions === 'unsuccessful' ? 'Marked as not verified' : 'Sent for review' },
    { label: 'Who can be checked', value: whoLabel(s) },
    ...(s.reverification.mode === 'reuse-within' ? [{ label: 'Repeat visits', value: `An earlier successful check is accepted for ${s.reverification.days} ${s.reverification.days === 1 ? 'day' : 'days'}` }] : []),
  ];
  return (
    <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Verification settings">
      {rows.map((r) => <div key={r.label}><dt className="text-slate-500">{r.label}</dt><dd className="text-slate-900">{r.value}</dd></div>)}
    </dl>
  );
}
