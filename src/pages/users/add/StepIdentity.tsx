import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Fingerprint } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { SimulatedBadge } from '@/components/domain/StatusBadges';
import type { CanonicalIdentity, CredentialType } from '@/domain/types';
import { maskEmail, maskPhone } from '@/lib/identifiers';
import type { OrgData } from '@/store/AppStore';
import type { Draft } from './draft';
import { Callout, StepShell } from './parts';

const HOLDING = ['active', 'pending', 'suspended'];

export type IdentityDecision =
  | { canContinue: true; mode: 'reuse' | 'existing-member' | 'create' }
  | { canContinue: false; reason: 'conflict' | 'already-holds' | 'needs-confirmation' | 'missing' };

export function identityDecision(org: OrgData, draft: Draft, type: CredentialType): IdentityDecision {
  const r = draft.resolution;
  if (!r) return { canContinue: false, reason: 'missing' };
  if (r.kind === 'conflict') return { canContinue: false, reason: 'conflict' };
  if (r.kind === 'match') {
    if (draft.existingMemberId) {
      const holds = org.credentials.some((c) => c.memberId === draft.existingMemberId && c.credentialTypeId === type.id && HOLDING.includes(c.status));
      return holds ? { canContinue: false, reason: 'already-holds' } : { canContinue: true, mode: 'existing-member' };
    }
    return { canContinue: true, mode: 'reuse' };
  }
  if (r.kind === 'possible' && !draft.confirmNewIdentity) return { canContinue: false, reason: 'needs-confirmation' };
  return { canContinue: true, mode: 'create' };
}

function IdentityCard({ identity, note }: { identity: CanonicalIdentity; note?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Fingerprint className="h-5 w-5" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-slate-900">{identity.givenName} {identity.familyName}</p>
        <p className="font-mono text-xs text-slate-500">{identity.idSwitchId}</p>
        <p className="mt-1 text-slate-600">{[maskEmail(identity.email), maskPhone(identity.phone)].filter(Boolean).join(' · ')}</p>
        {note}
      </div>
    </div>
  );
}

export function StepIdentity({ org, draft, type, update, footerStart }: {
  org: OrgData; draft: Draft; type: CredentialType; update: (patch: Partial<Draft>) => void; footerStart: React.ReactNode;
}) {
  const r = draft.resolution;
  const decision = identityDecision(org, draft, type);
  const member = draft.existingMemberId ? org.memberById.get(draft.existingMemberId) : undefined;
  const held = member ? org.credentials.find((c) => c.memberId === member.id && c.credentialTypeId === type.id && HOLDING.includes(c.status)) : undefined;
  const edit = <Button size="sm" variant="secondary" onClick={() => update({ step: 'details' })}>Edit details</Button>;

  return (
    <StepShell
      title="Check identity"
      description={<span className="flex flex-wrap items-center gap-2">We checked ID Switch so the same person isn't created twice. <SimulatedBadge /></span>}
      footer={
        <>
          <div className="flex items-center gap-2">
            {footerStart}
            <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => update({ step: 'details' })}>Back</Button>
          </div>
          <Button disabled={!decision.canContinue} onClick={() => update({ step: 'review' })}>Continue to review <ArrowRight className="h-4 w-4" /></Button>
        </>
      }
    >
      <div className="max-w-3xl space-y-4">
        {r?.kind === 'match' && !member && (
          <>
            <Callout tone="success" title="Existing identity found">
              This person already has a Seamfix identity, matched on {r.matchedOn.join(' and ')}. FixID will link it to {org.organization.name} instead of creating a new one.
            </Callout>
            <IdentityCard identity={r.identity} note={r.identity.linkedProducts.length > 0 && (
              <p className="mt-2 flex gap-1.5">{r.identity.linkedProducts.map((p) => <Badge key={p} tone="violet">Also in {p}</Badge>)}</p>
            )} />
          </>
        )}

        {r?.kind === 'match' && member && !held && (
          <>
            <Callout tone="info" title={`${member.displayName} is already in your organization`}>
              They're a {member.relationship.toLowerCase()}. FixID will issue a {type.name} to their existing profile instead of adding them again.
            </Callout>
            <IdentityCard identity={r.identity} />
          </>
        )}

        {r?.kind === 'match' && member && held && (
          <Callout tone="warning" title={`${member.displayName} already has a ${type.name}`}
            action={<div className="flex gap-2"><Link to={`/users/${member.id}`} className="text-sm font-medium text-amber-900 underline">View user</Link></div>}>
            Their {type.name} <span className="font-mono">{held.identifier}</span> is {held.status}. A second one can't be issued.
          </Callout>
        )}

        {r?.kind === 'conflict' && (
          <Callout tone="danger" title="These details belong to someone else" action={edit}>
            The {r.field === 'email-and-phone' ? 'email address and phone number match two different people' : `${r.field === 'email' ? 'email address' : 'phone number'} is already on record for a person with a different name`} in ID Switch.
            To avoid merging two people, FixID won't continue. Check the details with the person.
          </Callout>
        )}

        {r?.kind === 'possible' && (
          <>
            <Callout tone="warning" title="Possible matches found">
              Someone with the same name exists, but a name alone isn't enough to confirm it's the same person. If it is, go back and enter the email or phone number they have on record.
            </Callout>
            <div className="grid gap-3 sm:grid-cols-2">
              {r.candidates.map((c) => <IdentityCard key={c.idSwitchId} identity={c} />)}
            </div>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                checked={draft.confirmNewIdentity} onChange={(e) => update({ confirmNewIdentity: e.target.checked })} />
              <span>I've confirmed this is a different person. <span className="text-slate-500">Create a new identity in ID Switch.</span></span>
            </label>
            <div>{edit}</div>
          </>
        )}

        {r?.kind === 'none' && (
          <Callout tone="info" title="No existing identity found">
            A new identity will be created in ID Switch when you issue the digital ID.
          </Callout>
        )}
      </div>
    </StepShell>
  );
}
