import { CheckCircle2, LayoutDashboard, UserPlus, UserRound } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui';
import { DigitalIdCard } from '@/components/domain/DigitalIdCard';
import { CredentialStatusBadge, SimulatedBadge, WalletBadge } from '@/components/domain/StatusBadges';
import { formatDateTime, formatDate } from '@/lib/dates';
import type { OrgData } from '@/store/AppStore';

export function IssuedSuccess({ org, credentialId, memberId, onAddAnother }: { org: OrgData; credentialId: string; memberId: string; onAddAnother: () => void }) {
  const credential = org.credentialById.get(credentialId);
  const member = org.memberById.get(memberId);
  if (!credential || !member) return null;
  const type = org.credentialTypeById.get(credential.credentialTypeId)!;
  const design = org.cardDesignById.get(type.cardDesignId) ?? org.cardDesignById.get(org.organization.defaultCardDesignId)!;

  return (
    <section aria-labelledby="issued-title" className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-emerald-50/60 shadow-card">
      <div className="grid items-center gap-10 px-6 py-10 sm:px-10 lg:grid-cols-2 lg:px-14 lg:py-14">
        <div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white"><CheckCircle2 className="h-6 w-6" aria-hidden="true" /></span>
          <h2 id="issued-title" className="mt-6 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Digital ID issued successfully</h2>
          <p className="mt-3 text-lg text-slate-600">{member.displayName} now has a {type.name}.</p>

          <dl className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div><dt className="text-slate-500">{type.identifier.label}</dt><dd className="mt-0.5 font-mono font-medium text-slate-900">{credential.identifier}</dd></div>
            <div><dt className="text-slate-500">Status</dt><dd className="mt-0.5"><CredentialStatusBadge status={credential.status} /></dd></div>
            <div><dt className="text-slate-500">Issued</dt><dd className="mt-0.5 text-slate-900">{formatDateTime(credential.issuedAt)}</dd></div>
            <div><dt className="text-slate-500">Expires</dt><dd className="mt-0.5 text-slate-900">{credential.expiresAt ? formatDate(credential.expiresAt) : 'Never'}</dd></div>
            <div className="col-span-2">
              <dt className="flex items-center gap-2 text-slate-500">Seamfix Wallet <SimulatedBadge /></dt>
              <dd className="mt-1 flex items-center gap-2" aria-live="polite">
                <WalletBadge status={credential.wallet.status} />
                <span className="text-xs text-slate-500">
                  {credential.wallet.status === 'pending' ? 'Making it available to the holder…'
                    : credential.wallet.status === 'delivered' ? 'Available to the holder.'
                    : credential.wallet.status === 'not-sent' ? 'Not sent to a wallet.' : 'Delivery failed. The digital ID is still issued.'}
                </span>
              </dd>
            </div>
          </dl>

          <div className="mt-10 flex flex-wrap gap-3">
            <ButtonLink to={`/users/${member.id}`} variant="primary" icon={<UserRound className="h-4 w-4" />}>View user</ButtonLink>
            <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={onAddAnother}>Add another user</Button>
            <ButtonLink to="/" variant="ghost" icon={<LayoutDashboard className="h-4 w-4" />}>Return to dashboard</ButtonLink>
          </div>
        </div>
        <div className="flex justify-center">
          <DigitalIdCard design={design} organization={org.organization} className="scale-100 sm:scale-110" content={{
            name: member.displayName, identifier: credential.identifier, credentialTypeName: type.name, relationship: member.relationship,
            identifierLabel: type.identifier.label, unit: member.unit, expiresAt: credential.expiresAt, issuedAt: credential.issuedAt, photoUrl: member.photoDataUrl,
          }} />
        </div>
      </div>
    </section>
  );
}
