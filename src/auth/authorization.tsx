import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Lock, LogOut, ShieldOff, X } from 'lucide-react';
import { Button } from '@/components/ui';
import type { Permission, Role } from '@/domain/roles';
import { actorRecord } from '@/store/adminOps';
import { useActions, useStore } from '@/store/AppStore';
import { canPreviewRoles, effectivePermissions, isAuthorizedView, previewedRole, switchableRoles } from '@/store/state';

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
  const previewRole = previewedRole(state);
  const permissions: Set<Permission> = effectivePermissions(state);
  return {
    record,
    permissions,
    can: (p: Permission) => permissions.has(p),
    /** Any permission opens the workspace; navigation and pages then follow the permissions. */
    portalAccess: active && permissions.size > 0,
    /** The role being previewed or switched to, if any. */
    previewRole,
    /** A role view the administrator holds entirely (e.g. Verifier): it works, within that role's permissions. */
    roleView: !!previewRole && isAuthorizedView(state),
    /** True only for a read-only preview of a role the administrator doesn't hold. */
    readOnly: !!previewRole && !isAuthorizedView(state),
    canPreview: canPreviewRoles(state),
  };
}

/** Roles an Organization Admin can switch to: in demo builds every role (read-only unless held entirely), otherwise roles they hold entirely. */
export function usePreviewableRoles(): Role[] {
  const { state } = useStore();
  return switchableRoles(state);
}

/** Visible whenever Role Preview is on: says what's happening, switches role, and exits. */
export function RolePreviewBanner() {
  const { previewRole, roleView } = useAuthorization();
  const roles = usePreviewableRoles();
  const { startRolePreview, stopRolePreview } = useActions();
  if (!previewRole) return null;
  if (roleView) {
    return (
      <div role="region" aria-label="Role view" className="sticky top-0 z-30 border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-950 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Eye className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
          <p className="min-w-0 flex-1"><span className="font-semibold">{previewRole.name} view.</span> <span className="hidden sm:inline">You’re working with this role’s access only. Your own roles are unchanged.</span></p>
          <label className="sr-only" htmlFor="role-view">Role view</label>
          <select id="role-view" value={previewRole.id} onChange={(e) => startRolePreview(e.target.value)}
            className="h-8 rounded-lg border-brand-300 bg-white py-0 pl-2.5 pr-8 text-sm text-slate-800 focus:border-brand-500 focus:ring-brand-500">
            {roles.map((r) => <option key={r.id} value={r.id}>{r.id === 'organization-admin' ? `${r.name} (full access)` : r.name}{r.system ? '' : ' (custom)'}</option>)}
          </select>
          <button type="button" onClick={stopRolePreview}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
            <X className="h-4 w-4" aria-hidden="true" /> Switch back
          </button>
        </div>
      </div>
    );
  }
  return (
    <div role="region" aria-label="Role preview" className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Eye className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Role preview: {previewRole.name}.</span>{' '}
          <span className="hidden sm:inline">You're seeing what this role would see. Nothing can be changed while previewing, and your own roles and permissions are unchanged.</span>
          <span className="sm:hidden">Read-only. Your role is unchanged.</span>
        </p>
        <label className="sr-only" htmlFor="preview-role">Preview role</label>
        <select id="preview-role" value={previewRole.id} onChange={(e) => startRolePreview(e.target.value)}
          className="h-8 rounded-lg border-amber-300 bg-white py-0 pl-2.5 pr-8 text-sm text-slate-800 focus:border-amber-500 focus:ring-amber-500">
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.system ? '' : ' (custom)'}</option>)}
        </select>
        <button type="button" onClick={stopRolePreview}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-900 px-3 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
          <X className="h-4 w-4" aria-hidden="true" /> Exit preview
        </button>
      </div>
    </div>
  );
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

/** Route wrapper: renders children only with the permission (or any of several). Direct links are refused the same way. */
export function RequirePermission({ permission, children }: { permission: Permission | Permission[]; children: ReactNode }) {
  const { can } = useAuthorization();
  return (Array.isArray(permission) ? permission.some(can) : can(permission)) ? <>{children}</> : <NoAccess />;
}

/** Full-screen message for administrators who can't use the portal (deactivated, or verifier-only roles). */
export function PortalBlocked({ reason, onSignOut }: { reason: 'deactivated' | 'no-portal' | 'no-membership' | 'preview-no-portal'; onSignOut: () => void }) {
  const { stopRolePreview } = useActions();
  const copy = {
    'preview-no-portal': { title: 'This role has no permissions', body: 'Someone with only this role would see this screen: it doesn’t give access to anything yet.' },
    deactivated: { title: 'Your access has been removed', body: 'An administrator has deactivated your access to this organization. Contact them if you think this is a mistake.' },
    'no-portal': { title: 'Your roles don’t give you access to anything yet', body: 'Ask an Organization Admin to give you a role with the access you need.' },
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
