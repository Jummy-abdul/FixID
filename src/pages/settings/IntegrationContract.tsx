import { CAPABILITY_LABEL, CONTRACT_EXAMPLES, CONTRACT_VERSION, LOOKUP_OUTCOMES, MATCH_OUTCOMES, type IntegrationCapability } from '@/domain/integrations';

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

/** The FixID external identity verification contract (illustrative requests and responses, outcomes and rules). */
export function ContractReference({ capabilities }: { capabilities: IntegrationCapability[] }) {
  return (
    <div className="space-y-5" aria-label={`API contract ${CONTRACT_VERSION}`}>
      {capabilities.includes('lookup') && (
        <section className="space-y-2 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Operation A — {CAPABILITY_LABEL.lookup}</h3>
          <p className="text-sm text-slate-600">Retrieve an identity record using an authorized external identifier.</p>
          <div className="grid gap-3 lg:grid-cols-2"><Json label="Request" value={CONTRACT_EXAMPLES.lookupRequest} /><Json label="Response" value={CONTRACT_EXAMPLES.lookupResponse} /></div>
          <p className="text-xs text-slate-500">Outcomes: {LOOKUP_OUTCOMES.join(', ')}. Returned fields are limited to the permitted attributes; FixID doesn’t assume a photograph, full name, date of birth or any particular identifier.</p>
        </section>
      )}
      {capabilities.includes('matching') && (
        <section className="space-y-2 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Operation B — {CAPABILITY_LABEL.matching}</h3>
          <p className="text-sm text-slate-600">Request biometric matching against a reference held by the external service.</p>
          <div className="grid gap-3 lg:grid-cols-2"><Json label="Request" value={CONTRACT_EXAMPLES.matchRequest} /><Json label="Response" value={CONTRACT_EXAMPLES.matchResponse} /></div>
          <p className="text-xs text-slate-500">Outcomes: {MATCH_OUTCOMES.join(', ')}. Scores keep the provider’s own scale, threshold and meaning; they aren’t comparable across engines and FixID doesn’t convert them into an assurance level.</p>
          <p className="text-xs text-slate-500">The capture and liveness references are conceptual. A real integration must also agree an authorized, secure transfer method and the supported biometric payload format: a reference string alone can’t be matched.</p>
        </section>
      )}
    </div>
  );
}
