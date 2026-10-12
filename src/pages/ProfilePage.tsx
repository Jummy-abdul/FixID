import { useAuthorization } from '@/auth/authorization';
import { findRole } from '@/domain/roles';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { KeyRound, Pencil } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, PageHeader, useToast } from '@/components/ui';
import { providerName } from '@/domain/sso';
import { formatDateTime } from '@/lib/dates';
import { ssoFor } from '@/store/ssoOps';
import { startSso, useGoToProvider, type SsoNotice } from './auth/SsoPages';
import { PLANNED, PlannedButton } from '@/components/domain/PlannedFeature';
import { useActions, useSession, useStore } from '@/store/AppStore';

export function ProfilePage() {
  const { admin, organization } = useSession();
  const { state } = useStore();
  const { record } = useAuthorization();
  return (
    <>
      <PageHeader
        title="My Profile"
        description="Your administrator details."
        actions={<PlannedButton icon={<Pencil className="h-4 w-4" />} info={PLANNED.profile}>Edit profile</PlannedButton>}
      />
      <Card className="max-w-3xl">
        <CardHeader
          title={<span className="flex items-center gap-3"><Avatar name={admin.name} initials={admin.initials} />{admin.name}</span>}
        />
        <CardBody>
          <DescriptionList items={[
            { label: 'Name', value: admin.name },
            { label: 'Email', value: admin.email },
            { label: 'Role', value: record ? <span className="flex flex-wrap gap-1">{record.roleIds.map((id) => <Badge key={id} tone="brand">{findRole(state.data.customRoles ?? [], organization.id, id)?.name ?? 'Unknown role'}</Badge>)}</span> : '—' },
            { label: 'Organization', value: organization.name },
          ]} />
        </CardBody>
      </Card>
      <SignInMethods />
    </>
  );
}

/**
 * How this administrator can sign in. Email and password always works. SSO works once they link their own
 * identity at the organization's active provider: FixID stores the provider's issuer and stable subject ID,
 * never matches by email, and keeps their role, status and organization unchanged.
 */
function SignInMethods() {
  const { organization } = useSession();
  const { state } = useStore();
  const { record, readOnly } = useAuthorization();
  const { unlinkSsoIdentity } = useActions();
  const toast = useToast();
  const go = useGoToProvider();
  const notice = (useLocation().state as { ssoNotice?: SsoNotice } | null)?.ssoNotice;
  const [confirm, setConfirm] = useState(false);
  const c = ssoFor(state, organization.id);
  const active = !!c?.enabled && !!c.current;
  const link = record?.ssoIdentity;
  const current = !!link && active && link.issuer === c!.current!.issuer;

  return (
    <Card className="mt-6 max-w-3xl">
      <CardHeader title="Sign-in methods" description={`How you sign in to FixID for ${organization.name}.`} />
      <CardBody className="space-y-4 text-sm">
        {notice && (
          <p role="status" className={notice.ok ? 'rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900 ring-1 ring-inset ring-emerald-200' : 'rounded-xl bg-red-50 px-4 py-3 text-red-800 ring-1 ring-inset ring-red-200'}>{notice.message}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-medium text-slate-900">Email and password</p><p className="text-slate-500">Always available, including when SSO is active or unavailable.</p></div>
          <Badge tone="success" dot>Available</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <div className="min-w-0">
            <p className="font-medium text-slate-900">Single sign-on{active ? ` (${providerName(c!.current!.provider)})` : ''}</p>
            {!active ? <p className="text-slate-500">Your organization hasn’t activated SSO.</p>
              : current ? (
                <p className="text-slate-500">
                  Linked {formatDateTime(link!.linkedAt)}{link!.email ? ` as ${link!.email}` : ''}.{' '}
                  {link!.mode === 'demonstration' && <span className="text-amber-700">Demonstration link: made with the simulated provider, not a verified identity.</span>}
                </p>
              ) : <p className="text-slate-500">{link ? 'Your link is for a different provider configuration. Link again to use SSO.' : 'Link your identity to sign in with SSO. You’ll sign in at your identity provider once to confirm it.'}</p>}
          </div>
          {active && record?.status === 'active' && !readOnly && (current
            ? <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Unlink</Button>
            : <Button size="sm" icon={<KeyRound className="h-4 w-4" />} onClick={() => go(startSso('link', c!))}>Link SSO identity</Button>)}
        </div>
      </CardBody>
      <ConfirmDialog open={confirm} title="Unlink your SSO identity?" confirmLabel="Unlink" tone="danger"
        description="You won’t be able to sign in with SSO until you link it again. Email and password sign-in isn’t affected."
        onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); const r = unlinkSsoIdentity(organization.id); toast(r.ok ? { tone: 'success', title: 'SSO identity unlinked' } : { tone: 'error', title: 'Nothing was changed', description: r.error }); }} />
    </Card>
  );
}
