import { NEW_ORGANIZATION_ID } from '@/data/seed';
import { LEGACY_ROLE_TEMPLATES } from '@/domain/roles';
import type { AppState } from '@/store/state';

/**
 * Test fixture: Credential Manager and Verification Manager created as custom roles in each established
 * sample organization, held by Adaora Nwosu and Kwame Mensah, as if an Organization Admin had set them up.
 * The default sample data has no custom roles.
 */
export function withExampleCustomRoles(s: AppState): AppState {
  const at = new Date().toISOString();
  const orgs = s.data.organizations.filter((o) => o.id !== NEW_ORGANIZATION_ID).map((o) => o.id);
  const customRoles = orgs.flatMap((organizationId) => LEGACY_ROLE_TEMPLATES.map((t) => ({ ...t, system: false as const, organizationId, createdAt: at, createdBy: 'Tobyson TE', updatedAt: at, updatedBy: 'Tobyson TE' })));
  const holder: Record<string, string> = { _adm_2: 'credential-manager', _adm_3: 'verification-manager' };
  const administrators = s.data.administrators.map((a) => {
    const role = holder[a.id.slice(a.organizationId.length)];
    return role && orgs.includes(a.organizationId) ? { ...a, roleIds: [role] } : a;
  });
  return { ...s, data: { ...s.data, customRoles: [...s.data.customRoles, ...customRoles], administrators } };
}
