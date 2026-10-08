import { useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui';
import { EFFECTIVE_DATE_LABEL, validityLabel } from '@/domain/labels';
import type { CredentialType } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { newId } from '@/lib/identifiers';
import { computeValidity, previewIdentifier } from '@/services/issuance';
import { useServices } from '@/services/ServicesProvider';
import { IdSwitchUnavailableError } from '@/services/types';
import { useActions, type OrgData } from '@/store/AppStore';
import type { Draft, StepId } from './draft';
import { identityDecision } from './StepIdentity';
import { Callout, StepShell } from './parts';

function Section({ title, onEdit, children }: { title: string; onEdit?: () => void; children: ReactNode }) {
  return (
    <div className="border-t border-slate-100 py-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {onEdit && <button type="button" onClick={onEdit} className="text-sm font-medium text-brand-600 hover:text-brand-700">Edit<span className="sr-only"> {title.toLowerCase()}</span></button>}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export function StepReview({ org, draft, type, userTypeName, update, footerStart, onIssued }: {
  org: OrgData; draft: Draft; type: CredentialType; userTypeName: string;
  update: (patch: Partial<Draft>) => void; footerStart: ReactNode;
  onIssued: (result: { credentialId: string; memberId: string }) => void;
}) {
  const { idSwitch, wallet } = useServices();
  const { issueDigitalId, updateWalletStatus } = useActions();
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<{ message: string; step?: StepId } | null>(null);
  const inFlight = useRef(false);
  const p = draft.person;
  const decision = identityDecision(org, draft, type);
  const design = org.cardDesignById.get(type.cardDesignId);
  const effectiveInput = type.effectiveDate === 'custom-date' && p.effectiveDate ? new Date(`${p.effectiveDate}T00:00:00`) : undefined;
  const validity = computeValidity(type, new Date(), effectiveInput);
  const member = draft.existingMemberId ? org.memberById.get(draft.existingMemberId) : undefined;
  const go = (step: StepId) => update({ step });

  const issue = async () => {
    if (inFlight.current || !decision.canContinue) return;
    inFlight.current = true;
    setIssuing(true);
    setError(null);
    try {
      // 1. Identity: reuse, existing member, or request a new canonical identity (once).
      let identity: { idSwitchId: string; resolution: 'linked-existing' | 'created-new' };
      let created = draft.createdIdentity;
      if (decision.mode === 'existing-member') {
        identity = { idSwitchId: member!.idSwitchId, resolution: member!.resolution };
      } else if (decision.mode === 'reuse' && draft.resolution?.kind === 'match') {
        identity = { idSwitchId: draft.resolution.identity.idSwitchId, resolution: 'linked-existing' };
      } else {
        if (!created) {
          created = await idSwitch.createIdentity({ givenName: p.givenName, familyName: p.familyName, email: p.email, phone: p.phone });
          update({ createdIdentity: created });
        }
        identity = { idSwitchId: created.idSwitchId, resolution: 'created-new' };
      }

      // 2. Issue atomically. Validation failures change nothing.
      await new Promise((r) => setTimeout(r, 300));
      const result = issueDigitalId({
        requestId: draft.requestId,
        organizationId: org.organization.id,
        at: new Date().toISOString(),
        userTypeId: (draft.userType as { id: string }).id,
        credentialTypeId: type.id,
        person: { givenName: p.givenName, familyName: p.familyName, photoDataUrl: p.photoDataUrl },
        identity,
        existingMemberId: decision.mode === 'existing-member' ? member!.id : undefined,
        identifierValue: p.identifier,
        effectiveDate: effectiveInput?.toISOString(),
        ids: { memberId: newId('mem'), credentialId: newId('cr') },
      });
      if (!result.ok) {
        const [field, message] = Object.entries(result.errors)[0] ?? ['form', 'The digital ID could not be issued.'];
        setError({ message, step: field === 'identifier' ? 'details' : undefined });
        return;
      }
      onIssued({ credentialId: result.credentialId, memberId: result.memberId });

      // 3. Wallet delivery is separate from issuance and happens afterwards (simulated).
      const issued = result.state.data.credentials.find((c) => c.id === result.credentialId)!;
      if (issued.wallet.status === 'pending') {
        void wallet.deliver(org.organization, issued).then((status) => updateWalletStatus(issued.id, status)).catch(() => updateWalletStatus(issued.id, 'failed'));
      }
    } catch (err) {
      setError({
        message: err instanceof IdSwitchUnavailableError
          ? "ID Switch is unavailable, so the identity couldn't be created. Nothing was issued. Try again shortly."
          : (err as Error).message || 'Something went wrong. Nothing was issued.',
      });
    } finally {
      inFlight.current = false;
      setIssuing(false);
    }
  };

  const identitySummary = decision.canContinue
    ? decision.mode === 'existing-member' ? `Existing user in ${org.organization.name}`
      : decision.mode === 'reuse' ? `Existing ID Switch identity (${draft.resolution?.kind === 'match' ? draft.resolution.identity.idSwitchId : ''})`
      : 'New identity in ID Switch'
    : 'Not confirmed';

  return (
    <StepShell
      title="Review and issue"
      description="Check everything looks right. You can go back and change anything."
      footer={
        <>
          <div className="flex items-center gap-2">
            {footerStart}
            <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => go('identity')} disabled={issuing}>Back</Button>
          </div>
          <Button onClick={issue} loading={issuing} disabled={!decision.canContinue} icon={issuing ? undefined : <BadgeCheck className="h-4 w-4" />}>
            {issuing ? 'Issuing…' : 'Issue digital ID'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-6">
          <Callout tone="danger" title="The digital ID wasn't issued"
            action={error.step ? <Button size="sm" variant="secondary" onClick={() => go(error.step!)}>Fix details</Button> : undefined}>
            {error.message}
          </Callout>
        </div>
      )}
      {!decision.canContinue && (
        <div className="mb-6"><Callout tone="warning" title="Identity check needed">Go back to the identity step and resolve it before issuing.</Callout></div>
      )}
      <Section title="Person" onEdit={() => go('details')}>
        <Item label="Name">{p.givenName} {p.familyName}</Item>
        <Item label="User type">{userTypeName}</Item>
        <Item label="Email">{p.email || '—'}</Item>
        <Item label="Phone">{p.phone || '—'}</Item>
        <Item label="Identity">{identitySummary}</Item>
        <Item label="Photo">{p.photoDataUrl ? 'Added' : 'None'}</Item>
      </Section>
      <Section title="Digital ID" onEdit={draft.reusedCredential ? undefined : () => go('credential')}>
        <Item label="Credential">{type.name}</Item>
        <Item label={type.identifier.label}>
          <span className="font-mono">{type.identifier.mode === 'manual' ? p.identifier : previewIdentifier(type)}</span>
          {type.identifier.mode === 'generated' && <span className="ml-1 text-xs text-slate-500">(assigned on issue)</span>}
        </Item>
        <Item label="Effective from">
          {type.effectiveDate === 'on-issue' ? 'When issued' : formatDate(validity.effectiveFrom.toISOString())}
          <span className="block text-xs text-slate-500">{EFFECTIVE_DATE_LABEL[type.effectiveDate]}</span>
        </Item>
        <Item label="Expires">
          {validity.expiresAt ? formatDate(validity.expiresAt.toISOString()) : 'Never'}
          <span className="block text-xs text-slate-500">{validityLabel(type.validity)}</span>
        </Item>
        <Item label="Renewal">{type.renewal.allowed ? `Opens ${type.renewal.windowDays} days before expiry` : 'Not renewable'}</Item>
        <Item label="Template">{design?.name ?? '—'}</Item>
      </Section>
      <p className="mt-2 text-xs text-slate-500">
        After issuing, FixID makes the digital ID available to Seamfix Wallet. Wallet delivery is tracked separately (simulated in this prototype).
      </p>
    </StepShell>
  );
}
