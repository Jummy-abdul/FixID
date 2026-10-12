import { Lock } from 'lucide-react';
import {
  ASSURANCE_NOT_DEFINED, ELIGIBILITY_LABEL, EXCEPTION_LABEL, LIVENESS_LABEL, METHOD_LABEL, reverificationLabel,
  type ProgrammeRequirements, type VerificationSettings,
} from '@/domain/programmes';
import type { CustomIntegration } from '@/domain/integrations';

/** The identity source in words, with only safe metadata about an external service. */
export function sourceLabel(source: VerificationSettings['identitySource'], integration?: Pick<CustomIntegration, 'name' | 'status'>, ownerName?: string): string {
  if (source.kind === 'local') return 'FixID Local Records';
  return `${integration?.name ?? 'External identity service'}${ownerName ? ` (owned by ${ownerName})` : ''}${integration && integration.status !== 'active' ? ` — ${integration.status}` : ''}`;
}

interface Row { label: string; value: string; locked?: boolean }

function Rows({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label={label}>
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="flex items-center gap-1 text-slate-500">{r.label}{r.locked && <Lock className="h-3 w-3 text-slate-400" aria-label="set by the programme" />}</dt>
          <dd className="text-slate-900">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A programme's mandatory requirements. */
export function ProgrammeRequirementsSummary({ requirements: r, integration, ownerName }: { requirements: ProgrammeRequirements; integration?: CustomIntegration; ownerName?: string }) {
  return (
    <Rows label="Programme requirements" rows={[
      { label: 'Identity source', value: sourceLabel(r.identitySource, integration, ownerName) },
      { label: 'Verification method', value: METHOD_LABEL[r.method] },
      { label: 'Liveness', value: LIVENESS_LABEL[r.liveness] },
      { label: 'Reverification', value: reverificationLabel(r.reverification) },
      { label: 'Exception handling', value: `${EXCEPTION_LABEL[r.exceptions]}${r.escalateToProgramme ? ', escalated to a programme reviewer' : ''}` },
      { label: 'Eligibility', value: `${r.eligibilityRequired ? 'Required' : 'Optional'} · ${r.allowedEligibility.map((a) => ELIGIBILITY_LABEL[a]).join(', ')}` },
      { label: 'Assurance', value: ASSURANCE_NOT_DEFINED },
    ]} />
  );
}

/** An activity's effective settings, marking those set by its programme. */
export function ActivitySettingsSummary({ settings: s, inherited, integration, ownerName }: { settings: VerificationSettings; inherited?: boolean; integration?: CustomIntegration; ownerName?: string }) {
  return (
    <Rows label="Verification settings" rows={[
      { label: 'Identity source', value: sourceLabel(s.identitySource, integration, ownerName), locked: inherited },
      { label: 'Verification method', value: METHOD_LABEL[s.method], locked: inherited },
      { label: 'Liveness', value: LIVENESS_LABEL[s.liveness], locked: inherited },
      { label: 'Reverification', value: reverificationLabel(s.reverification), locked: inherited },
      { label: 'Exception handling', value: EXCEPTION_LABEL[s.exceptions], locked: inherited },
      { label: 'Eligibility', value: `${ELIGIBILITY_LABEL[s.eligibility.approach]}${s.eligibility.approach === 'reference-list' ? ` (${s.eligibility.referenceList?.length ?? 0} references)` : ''}${s.eligibility.approach === 'external-source' ? ` (${s.eligibility.attribute ?? 'recordStatus'} is ${(s.eligibility.allowedValues?.length ? s.eligibility.allowedValues : ['ACTIVE']).join(' or ')})` : ''}` },
      { label: 'Local enrollment', value: s.identitySource.kind === 'local' ? 'Required: people must be registered and enrolled in FixID' : 'Not required: externally referenced identities are supported' },
      { label: 'Assurance', value: ASSURANCE_NOT_DEFINED },
    ]} />
  );
}
