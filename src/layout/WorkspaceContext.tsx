import { useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuthorization } from '@/auth/authorization';
import { findRole } from '@/domain/roles';
import { parentRelationship } from '@/store/orgOps';
import { useSession, useStore } from '@/store/AppStore';

/**
 * Which organization the administrator is working in, and with which role. The switcher appears only for
 * explicit memberships in several organizations; parent–child relationships never add workspaces.
 */
export function WorkspaceContext() {
  const { organization, organizations, switchOrganization } = useSession();
  const { state } = useStore();
  const { record, previewRole } = useAuthorization();
  const navigate = useNavigate();
  const role = previewRole ?? (record ? findRole(state.data.customRoles ?? [], organization.id, record.roleIds[0] ?? '') : undefined);
  const parent = parentRelationship(state, organization.id);
  const parentName = parent && state.data.organizations.find((o) => o.id === parent.parentOrganizationId)?.name;

  return (
    <div className="flex min-w-0 items-center gap-2.5" role="region" aria-label="Workspace">
      <Building2 className="hidden h-5 w-5 shrink-0 text-slate-400 sm:block" aria-hidden="true" />
      <div className="min-w-0 leading-tight">
        {organizations.length > 1 ? (
          <label className="block">
            <span className="sr-only">Switch organization</span>
            <select value={organization.id} aria-label="Switch organization"
              onChange={(e) => { switchOrganization(e.target.value); navigate('/'); }}
              className="-ml-1 max-w-[14rem] truncate rounded-md border-0 bg-transparent py-0 pl-1 pr-7 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-brand-500 sm:max-w-xs">
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        ) : (
          <p className="truncate text-sm font-semibold text-slate-900">{organization.name}</p>
        )}
        <p className="truncate text-xs text-slate-500">
          {role ? role.name : 'No role'}{parentName ? ` · Sub-organization of ${parentName}` : ''}
        </p>
      </div>
    </div>
  );
}
