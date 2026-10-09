import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Lock, LogOut, ShieldOff, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { ROLES, hasPortalAccess, roleById, type Permission, type RoleId } from '@/domain/roles';
import { actorRecord } from '@/store/adminOps';
import { useActions, useStore } from '@/store/AppStore';
import { canPreviewRoles, effectivePermissions } from '@/store/state';

/**
 * The signed-in administrator's effective permissions in the current organization, derived from their
 * administrator record on every render, so role changes and deactivation apply immediately. During
 * Role Preview they are narrowed to the previewed role (never widened) and the workspace is read-only.
 * Client-side only: production must enforce the same checks on the server.
 */
export function useAuthorization() {
  const { state } = useStore();
  const record = actorRecord(state, state.session.currentOrganizationId);
  const active = record?.status === 'active';
  const previewRole = state.session.previewRoleId ? roleById(state.session.previewRoleId) : undefined;
  const permissions: Set<Permission> = effectivePermissions(state);
  return {
    record,
    permissions,
    can: (p: Permission) => permissions.has(p),
    portalAccess: active && (previewRole ? previewRole.portalAccess : hasPortalAccess(record.roleIds)),
    /** The role being previewed, if any. */
    previewRole,
    canPreview: canPreviewRoles(state),
  };
}

const PREVIEWABLE = ROLES.filter((r) => r.id !== 'organization-admin');

/** Visible whenever Role Preview is on: says what's happening, switches role, and exits. */
export function RolePreviewBanner() {
  const { previewRole } = useAuthorization();
  const { startRolePreview, stopRolePreview } = useActions();
  if (!previewRole) return null;
  return (
    <div role="region" aria-label="Role preview" className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Eye className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Role preview: {previewRole.name}.</span>{' '}
          <span className="hidden sm:inline">You're seeing what this role can see. Changes are disabled and your own role is unchanged.</span>
          <span className="sm:hidden">Read-only. Your role is unchanged.</span>
        </p>
        <label className="sr-only" htmlFor="preview-role">Preview role</label>
        <select id="preview-role" value={previewRole.id} onChange={(e) => startRolePreview(e.target.value as RoleId)}
          className="h-8 rounded-lg border-amber-300 bg-white py-0 pl-2.5 pr-8 text-sm text-slate-800 focus:border-amber-500 focus:ring-amber-500">
          {PREVIEWABLE.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button type="button" onClick={stopRolePreview}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-900 px-3 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
          <X className="h-4 w-4" aria-hidden="true" /> Exit preview
        </button>
      </div>
    </div>
  );
}

export { PREVIEWABLE as PREVIEWABLE_ROLES };

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
export function PortalBlocked({ reason, onSignOut }: { reason: 'deactivated' | 'no-portal' | 'no-membership' | 'preview-no-portal'; onSignOut: () => void }) {
  const { stopRolePreview } = useActions();
  const copy = {
    'preview-no-portal': { title: 'This role has no portal access', body: 'People with only this role perform verifications through an approved verifier application, so they would see this screen if they signed in here.' },
    deactivated: { title: 'Your access has been removed', body: 'An administrator has deactivated your access to this organization. Contact them if you think this is a mistake.' },
    'no-portal': { title: 'This portal isn\'t part of your role', body: 'Your role lets you perform verifications through an approved verifier app. Contact an administrator if you also need portal access.' },
    'no-membership': { title: "You're not an administrator here", body: 'Your account doesn\'t have administrative access to this organization.' },
  }[reason];
  return (
    <div className="min-h-screen bg-slate-50">
      {reason === 'preview-no-portal' && <RolePreviewBanner />}
      <div className="flex min-h-[80vh] items-center justify-center px-5">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-card">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><ShieldOff className="h-6 w-6" aria-hidden="true" /></span>
          <h1 className="mt-5 text-xl font-semibold text-slate-900">{copy.title}</h1>
          <p className="mt-2 text-slate-500">{copy.body}</p>
          {reason === 'preview-no-portal'
            ? <Button variant="secondary" className="mt-6" icon={<X className="h-4 w-4" />} onClick={stopRolePreview}>Exit preview</Button>
            : <Button variant="secondary" className="mt-6" icon={<LogOut className="h-4 w-4" />} onClick={onSignOut}>Sign out</Button>}
        </section>
      </div>
    </div>
  );
}
