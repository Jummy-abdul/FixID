import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock, LogOut, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui';
import { hasPortalAccess, permissionsFor, type Permission } from '@/domain/roles';
import { actorRecord } from '@/store/adminOps';
import { useStore } from '@/store/AppStore';

/**
 * The signed-in administrator's effective permissions in the current organization, derived from their
 * administrator record on every render, so role changes and deactivation apply immediately.
 * Client-side only: production must enforce the same checks on the server.
 */
export function useAuthorization() {
  const { state } = useStore();
  const record = actorRecord(state, state.session.currentOrganizationId);
  const active = record?.status === 'active';
  const permissions: Set<Permission> = active ? permissionsFor(record.roleIds) : new Set();
  return {
    record,
    permissions,
    can: (p: Permission) => permissions.has(p),
    portalAccess: active && hasPortalAccess(record.roleIds),
  };
}

/** Shown in place of a screen the current administrator isn't allowed to use. */
export function NoAccess({ title = "You don't have access to this page", description = 'Ask an Organization Admin if you need this access.' }: { title?: string; description?: string }) {
  return (
    <section className="mx-auto mt-10 flex max-w-lg flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-card">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><Lock className="h-6 w-6" aria-hidden="true" /></span>
      <h1 className="mt-5 text-xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-slate-500">{description}</p>
      <Link to="/" className="mt-6 text-sm font-semibold text-brand-600 hover:text-brand-700">Go to dashboard</Link>
    </section>
  );
}

/** Route wrapper: renders children only with the permission. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuthorization();
  return can(permission) ? <>{children}</> : <NoAccess />;
}

/** Full-screen message for administrators who can't use the portal (deactivated, or verifier-only roles). */
export function PortalBlocked({ reason, onSignOut }: { reason: 'deactivated' | 'no-portal' | 'no-membership'; onSignOut: () => void }) {
  const copy = {
    deactivated: { title: 'Your access has been removed', body: 'An administrator has deactivated your access to this organization. Contact them if you think this is a mistake.' },
    'no-portal': { title: 'This portal isn\'t part of your role', body: 'Your role lets you perform verifications through an approved verifier app. Contact an administrator if you also need portal access.' },
    'no-membership': { title: "You're not an administrator here", body: 'Your account doesn\'t have administrative access to this organization.' },
  }[reason];
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-card">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><ShieldOff className="h-6 w-6" aria-hidden="true" /></span>
        <h1 className="mt-5 text-xl font-semibold text-slate-900">{copy.title}</h1>
        <p className="mt-2 text-slate-500">{copy.body}</p>
        <Button variant="secondary" className="mt-6" icon={<LogOut className="h-4 w-4" />} onClick={onSignOut}>Sign out</Button>
      </section>
    </div>
  );
}
