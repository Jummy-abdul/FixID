import { Lock, Plus, Trash2 } from 'lucide-react';
import { Badge, Field, Input, Select } from '@/components/ui';
import type { ActivityCheck, CheckRequirement, VerificationType } from '@/domain/types';
import {
  ATTRIBUTES, CATEGORY_LABEL, CHECKS, CONDITION_ATTRIBUTES, TYPE_INFO, newCheck, type CheckIssue,
} from '@/domain/verification';
import { cn } from '@/lib/cn';
import { useOrgData, useSession } from '@/store/AppStore';
import { ProviderSelect } from './parts';

const NEED_LABEL: Record<string, string> = {
  'resolved-identity': 'a check that identifies the person',
  'authorized-reference': 'Identity Record Lookup',
  'verified-credential': 'Credential Authenticity',
  liveness: 'Liveness Verification',
};

/**
 * Step 3: pick checks from the catalog for the activity's type and configure each one. Only fields
 * relevant to the check are shown. Locked checks come from a mandatory policy.
 */
export function CheckConfigurator({ type, checks, onChange, issues, readOnly }: {
  type: VerificationType; checks: ActivityCheck[]; onChange: (checks: ActivityCheck[]) => void; issues: CheckIssue[]; readOnly?: boolean;
}) {
  const { organization } = useSession();
  const org = useOrgData();
  const add = (t: ActivityCheck['type']) => onChange([...checks, newCheck(t, `chk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, organization)]);
  const update = (id: string, patch: Partial<ActivityCheck>) => onChange(checks.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const params = (c: ActivityCheck, patch: Partial<ActivityCheck['params']>) => update(c.id, { params: { ...c.params, ...patch } });
  const remove = (id: string) => onChange(checks.filter((c) => c.id !== id));
  const alternatives = checks.filter((c) => c.requirement === 'alternative').length;
  const general = issues.filter((i) => !i.checkId);

  return (
    <div className="space-y-7">
      {alternatives > 0 && (
        <p className="rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900 ring-1 ring-inset ring-violet-200">
          Approved alternatives ({alternatives}): at least one of these must pass. Required checks always apply, whatever happens with the alternatives.
        </p>
      )}
      {general.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          {general.map((i) => <li key={i.message}>{i.message}</li>)}
        </ul>
      )}
      {TYPE_INFO[type].categories.map((cat) => (
        <section key={cat} aria-labelledby={`cat-${cat}`}>
          <h3 id={`cat-${cat}`} className="mb-3 text-sm font-semibold text-slate-900">{CATEGORY_LABEL[cat]}</h3>
          <div className="space-y-3">
            {CHECKS.filter((d) => d.category === cat).map((def) => {
              const c = checks.find((x) => x.type === def.id);
              if (!c) {
                return (
                  <div key={def.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-dashed border-slate-300 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">{def.name}</p>
                      <p className="text-sm text-slate-500">{def.description}</p>
                    </div>
                    {!readOnly && (
                      <button type="button" onClick={() => add(def.id)} aria-label={`Add ${def.name}`}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-600 ring-1 ring-inset ring-brand-200 hover:bg-brand-50">
                        <Plus className="h-4 w-4" aria-hidden="true" />Add
                      </button>
                    )}
                  </div>
                );
              }
              const mine = issues.filter((i) => i.checkId === c.id);
              return (
                <div key={def.id} role="group" aria-label={def.name}
                  className={cn('rounded-xl border bg-white px-4 py-4', mine.length ? 'border-amber-300' : 'border-brand-300 ring-1 ring-brand-100')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                        {def.name}
                        {c.locked && <Badge tone="warning"><Lock className="h-3 w-3" aria-hidden="true" />Required by platform policy</Badge>}
                      </p>
                      <p className="text-sm text-slate-500">{def.description}</p>
                      {def.needs && <p className="mt-1 text-xs text-slate-500">Needs {def.needs.map((n) => NEED_LABEL[n]).join(' and ')}.</p>}
                      {def.note && <p className="mt-1 text-xs text-slate-500">{def.note}</p>}
                    </div>
                    {!readOnly && !c.locked && (
                      <button type="button" onClick={() => remove(c.id)} aria-label={`Remove ${def.name}`}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>

                  <fieldset disabled={readOnly} className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <p className="mb-1.5 text-sm font-medium text-slate-700" id={`req-${c.id}`}>Requirement</p>
                      <div role="radiogroup" aria-labelledby={`req-${c.id}`} className="flex flex-wrap gap-2">
                        {(['required', 'optional', 'alternative'] as CheckRequirement[]).map((r) => (
                          <button key={r} type="button" role="radio" aria-checked={c.requirement === r} disabled={readOnly || (c.locked && r !== 'required')}
                            onClick={() => update(c.id, { requirement: r })}
                            className={cn('rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset disabled:cursor-not-allowed disabled:opacity-50',
                              c.requirement === r ? 'bg-brand-50 font-medium text-brand-700 ring-brand-400' : 'text-slate-600 ring-slate-200 hover:bg-slate-50')}>
                            {r === 'required' ? 'Required' : r === 'optional' ? 'Optional' : 'Approved alternative'}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500">
                        {c.requirement === 'required' ? 'Must pass for a Verified outcome. If it fails, the verification fails.'
                          : c.requirement === 'optional' ? 'Recorded as extra evidence. If it fails, the outcome isn’t affected on its own.'
                            : 'One of the approved alternatives. At least one alternative must pass.'}
                      </p>
                    </div>
                    <ProviderSelect label="Verification provider" kind="provider" options={def.providers} value={c.providerId} disabled={readOnly}
                      onChange={(providerId) => update(c.id, { providerId })} />
                    {def.sources && (
                      <ProviderSelect label={def.id === 'face-match' ? 'Authorized reference source' : 'Trusted identity source'} kind="source" options={def.sources} value={c.sourceId} disabled={readOnly}
                        onChange={(sourceId) => update(c.id, { sourceId })} />
                    )}
                    {def.fields?.includes('identifier') && (
                      <Field label="Identifier used to find the record" hint="People are looked up by this identifier.">
                        {(p) => (
                          <Select {...p} value={c.params.identifierConfigId ?? ''} onChange={(e) => params(c, { identifierConfigId: e.target.value || undefined })}>
                            <option value="">Any identifier held in the source</option>
                            {org.identifierConfigs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </Select>
                        )}
                      </Field>
                    )}
                    {def.fields?.includes('attributes') && (
                      <CheckboxList label="Attributes to match" options={ATTRIBUTES.map((a) => ({ id: a, name: a }))} value={c.params.attributes ?? []}
                        onChange={(attributes) => params(c, { attributes })} />
                    )}
                    {def.fields?.includes('credentialTypes') && (
                      <CheckboxList label="Accepted credentials" empty="No active credentials. Create one in Credentials first."
                        options={org.credentialTypes.filter((t) => t.status === 'active').map((t) => ({ id: t.id, name: t.name }))}
                        value={c.params.credentialTypeIds ?? []} onChange={(credentialTypeIds) => params(c, { credentialTypeIds })} />
                    )}
                    {def.fields?.includes('groups') && (
                      <CheckboxList label="Permitted groups" empty="No groups yet. Create one in User Management → Groups."
                        options={org.groups.map((g) => ({ id: g.id, name: g.name }))} value={c.params.groupIds ?? []}
                        onChange={(groupIds) => params(c, { groupIds })} hint="Membership is checked at the time of verification, using current data." />
                    )}
                    {def.fields?.includes('condition') && (
                      <div className="grid grid-cols-3 gap-2 md:col-span-2">
                        <Field label="Attribute">{(p) => (
                          <Select {...p} value={c.params.attribute ?? ''} onChange={(e) => params(c, { attribute: e.target.value || undefined })}>
                            <option value="">Choose…</option>
                            {CONDITION_ATTRIBUTES.map((a) => <option key={a} value={a}>{a}</option>)}
                          </Select>
                        )}</Field>
                        <Field label="Condition">{(p) => (
                          <Select {...p} value={c.params.operator ?? 'is'} onChange={(e) => params(c, { operator: e.target.value as 'is' | 'is-not' })}>
                            <option value="is">is</option><option value="is-not">is not</option>
                          </Select>
                        )}</Field>
                        <Field label="Value">{(p) => <Input {...p} value={c.params.value ?? ''} placeholder="e.g. Active" onChange={(e) => params(c, { value: e.target.value })} />}</Field>
                      </div>
                    )}
                    {def.fields?.includes('previous') && (
                      <div className="grid grid-cols-2 gap-2 md:col-span-2">
                        <Field label="Rule">{(p) => (
                          <Select {...p} value={c.params.mode ?? 'prevent-duplicate'} onChange={(e) => params(c, { mode: e.target.value as 'prevent-duplicate' | 'require-previous' })}>
                            <option value="prevent-duplicate">Prevent repeat verification</option>
                            <option value="require-previous">Require an earlier successful verification</option>
                          </Select>
                        )}</Field>
                        <Field label="Within (days)">{(p) => <Input {...p} type="number" min={1} max={365} value={c.params.windowDays ?? 1}
                          onChange={(e) => params(c, { windowDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} />}</Field>
                      </div>
                    )}
                  </fieldset>
                  {mine.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm text-amber-800">{mine.map((i) => <li key={i.message}>• {i.message}</li>)}</ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function CheckboxList({ label, options, value, onChange, empty, hint }: {
  label: string; options: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void; empty?: string; hint?: string;
}) {
  return (
    <fieldset className="md:col-span-2">
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{label}</legend>
      {options.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => {
            const on = value.includes(o.id);
            return (
              <label key={o.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset', on ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'text-slate-700 ring-slate-200 hover:bg-slate-50')}>
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={on}
                  onChange={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} />
                {o.name}
              </label>
            );
          })}
        </div>
      )}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </fieldset>
  );
}
