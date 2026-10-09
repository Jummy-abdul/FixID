import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, ShieldCheck, ShieldX, UserRound, Wallet } from 'lucide-react';
import { ButtonLink, Card, CardBody, CardHeader, EmptyState } from '@/components/ui';
import { FlippableCredentialCard } from '@/components/credentials/CredentialCard';
import { CredentialStatusBadge, WalletBadge } from '@/components/domain/StatusBadges';
import { issuedLook } from '@/domain/templates';
import type { Credential } from '@/domain/types';
import { formatDate, formatDateTime } from '@/lib/dates';
import { usePortrait } from '@/hooks/usePortrait';
import { useOrgData } from '@/store/AppStore';
import { NotFoundPage } from '../NotFoundPage';

/** Where the administrator came from, so Back returns there. Kept in the URL so it survives refresh. */
export type IssuedFrom = { kind: 'user'; id: string } | { kind: 'config'; id: string };

export function issuedCredentialPath(credentialId: string, from?: IssuedFrom) {
  return `/credentials/${encodeURIComponent(credentialId)}${from ? `?from=${from.kind}:${encodeURIComponent(from.id)}` : ''}`;
}

function parseFrom(v: string | null): IssuedFrom | undefined {
  const m = v?.match(/^(user|config):(.+)$/);
  return m ? { kind: m[1] as IssuedFrom['kind'], id: m[2] } : undefined;
}

/** A short, stable reference for an issued credential, for support conversations. */
export function credentialReference(c: Credential) {
  let h = 2166136261;
  for (const ch of c.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `CR-${h.toString(36).toUpperCase().padStart(7, '0').slice(-7)}`;
}

/**
 * The one Issued Credential Details page. Opened from a configuration's Issued To list and from a
 * user's Credentials tab; always loaded by the issued credential's own id.
 */
export function IssuedCredentialDetailPage() {
  const { credentialId } = useParams();
  const [params] = useSearchParams();
  const { organization, credentialById, memberById, credentialTypeById, identifierConfigById, audit, transactions, activityById } = useOrgData();
  const credential = credentialId ? credentialById.get(credentialId) : undefined;
  const member = credential ? memberById.get(credential.memberId) : undefined;
  const portrait = usePortrait(member);
  if (!credential) return <NotFoundPage entity="credential" backTo="/credentials" />;

  const type = credentialTypeById.get(credential.credentialTypeId);
  const look = issuedLook(credential, type, type?.identifierConfigId ? identifierConfigById.get(type.identifierConfigId)?.name : undefined);
  const holderName = member?.displayName ?? 'Unknown user';
  const from = parseFrom(params.get('from'));
  const back = from?.kind === 'user' && memberById.has(from.id)
    ? { to: `/users/${from.id}?tab=credentials`, label: `Back to ${memberById.get(from.id)!.displayName}` }
    : type ? { to: `/credentials/configurations/${type.id}?tab=issued`, label: `Back to ${type.name}` }
      : { to: '/credentials', label: 'Back to Credentials' };

  // Activity: recorded events for this credential and its verifications. Nothing is inferred.
  const events = [
    ...audit.filter((e) => e.resourceType === 'credential' && e.resourceId === credential.id).map((e) => ({
      id: e.id, at: e.occurredAt, icon: e.action === 'wallet.delivered' || e.action === 'wallet.failed' ? Wallet : BadgeCheck,
      title: ({
        'credential.issued': 'Credential issued', 'credential.renewed': 'Credential renewed', 'credential.suspended': 'Credential suspended',
        'credential.revoked': 'Credential revoked', 'credential.activated': 'Credential activated', 'wallet.delivered': 'Added to Seamfix Wallet',
        'wallet.failed': 'Wallet delivery failed',
      } as Record<string, string>)[e.action] ?? e.summary,
      detail: e.actor,
    })),
    ...transactions.filter((t) => t.credentialId === credential.id).map((t) => ({
      id: t.id, at: t.occurredAt, icon: t.result === 'success' ? ShieldCheck : ShieldX,
      title: t.result === 'success' ? 'Credential verified' : 'Verification unsuccessful',
      detail: activityById.get(t.activityId)?.name ?? 'Verification',
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  // Older sample records may predate the audit trail; the issuance itself is always known.
  if (!events.some((e) => e.title === 'Credential issued')) {
    events.push({ id: 'issued', at: credential.issuedAt, icon: BadgeCheck, title: 'Credential issued', detail: organization.name });
    events.sort((a, b) => b.at.localeCompare(a.at));
  }
  const shown = events.slice(0, 20);

  const info: [string, React.ReactNode][] = [
    ['Credential name', look.credentialName],
    ['Holder', member ? <Link to={`/users/${member.id}`} className="text-brand-700 hover:underline">{holderName}</Link> : holderName],
    [look.identifierLabel, <span className="font-mono">{credential.identifier}</span>],
    ['Date issued', formatDateTime(credential.issuedAt)],
    ['Effective date', formatDate(credential.effectiveFrom)],
    ['Expiration date', credential.expiresAt ? formatDate(credential.expiresAt) : 'No expiry'],
    ['Credential status', <CredentialStatusBadge status={credential.status} />],
    ['Reference number', <span className="font-mono">{credentialReference(credential)}</span>],
    ['Seamfix Wallet', <WalletBadge status={credential.wallet.status} />],
  ];

  return (
    <>
      <Link to={back.to} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {back.label}
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{look.credentialName}</h1>
          <p className="mt-1 text-slate-600">
            {holderName} · <span className="text-slate-500">{look.identifierLabel}</span> <span className="font-mono text-slate-800">{credential.identifier}</span>
          </p>
          <div className="mt-2"><CredentialStatusBadge status={credential.status} /></div>
        </div>
        {member && <ButtonLink to={`/users/${member.id}`} variant="secondary" icon={<UserRound className="h-4 w-4" />}>View User Profile</ButtonLink>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Digital credential" />
          <CardBody className="flex justify-center bg-slate-50/60 py-8">
            <div role="region" aria-label="Digital ID preview">
              <FlippableCredentialCard templateId={look.templateId} organization={organization} label="Credential side"
                content={{
                  credentialName: look.credentialName, holderName, identifierLabel: look.identifierLabel, identifierValue: credential.identifier,
                  expiresAt: credential.expiresAt, issuedAt: credential.issuedAt, photoUrl: portrait?.url,
                }} />
            </div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="Issuance information" />
          <CardBody>
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {info.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-slate-500">{label}</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Activity history" description={events.length > shown.length ? `Latest ${shown.length} of ${events.length}` : undefined} />
        {shown.length === 0 ? (
          <EmptyState title="No activity yet" description="Events for this credential will appear here." />
        ) : (
          <ol className="divide-y divide-slate-100">
            {shown.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-6 py-3.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><e.icon className="h-4 w-4" aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{e.title}</p>
                  <p className="text-xs text-slate-500">{e.detail}</p>
                </div>
                <time className="shrink-0 text-xs text-slate-500" dateTime={e.at}>{formatDateTime(e.at)}</time>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
