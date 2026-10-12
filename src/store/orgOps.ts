import { EMAIL, deriveShortName, timezoneOptions } from '@/domain/organization';
import type { AuditEvent, CardDesign, Industry, OrgAdministrator, Organization, OrganizationRelationship } from '@/domain/types';
import { actorPermissions, invitationExpiry, inviteProblems } from './adminOps';
import type { AppState } from './state';

/**
 * Organization structure. Phase 1: an organization may create sub-organizations (one level; each has one
 * parent). A sub-organization is its own workspace with its own administrators and data; the relationship
 * gives the parent relationship and onboarding information only, never its records, administrators or
 * secrets. Client-side stand-in for server-side checks.
 */

type Result = { ok: true; state: AppState } | { ok: false; error: string };

const live = (r: OrganizationRelationship) => r.status !== 'ended';

/** The organization's parent relationship, if it is a sub-organization. */
export const parentRelationship = (state: AppState, organizationId: string) =>
  (state.data.organizationRelationships ?? []).find((r) => r.childOrganizationId === organizationId && live(r));

/** Relationships to this organization's sub-organizations. */
export const subRelationships = (state: AppState, organizationId: string) =>
  (state.data.organizationRelationships ?? []).filter((r) => r.parentOrganizationId === organizationId && live(r));

/** Phase 1 allows one level: a sub-organization can't have sub-organizations of its own. */
export const canHaveSubOrganizations = (state: AppState, organizationId: string) => !parentRelationship(state, organizationId);

/** A sub-organization of `parentId`, or undefined. The only way a parent can look up another organization. */
export function subOrganization(state: AppState, parentId: string, childId: string): { organization: Organization; relationship: OrganizationRelationship } | undefined {
  const relationship = subRelationships(state, parentId).find((r) => r.childOrganizationId === childId);
  const organization = relationship && state.data.organizations.find((o) => o.id === childId);
  return organization && relationship ? { organization, relationship } : undefined;
}

/** The initial administrator invitation of a sub-organization (onboarding information the parent may see). */
export function initialAdministrator(state: AppState, relationship: OrganizationRelationship): OrgAdministrator | undefined {
  return state.data.administrators.find((a) => a.id === relationship.initialAdministratorId && a.organizationId === relationship.childOrganizationId);
}

export interface SubOrganizationValues {
  name: string; shortName: string; industry: Industry | ''; contactEmail: string; phone: string;
  adminEmail: string; memberLabel: string; timezone: string;
}
export type SubOrganizationErrors = Partial<Record<keyof SubOrganizationValues, string>>;

export function subOrganizationProblems(state: AppState, parentId: string, v: SubOrganizationValues, now = new Date()): SubOrganizationErrors {
  const e: SubOrganizationErrors = {};
  const name = v.name.trim();
  if (!name) e.name = 'Enter the organization name.';
  else if (name.length < 2 || name.length > 80) e.name = 'Use between 2 and 80 characters.';
  else if (subRelationships(state, parentId).some((r) => state.data.organizations.find((o) => o.id === r.childOrganizationId)?.name.toLowerCase() === name.toLowerCase())) {
    e.name = 'You already have a sub-organization with this name.';
  }
  if (v.shortName.trim() && !/^[A-Z0-9]{2,5}$/.test(v.shortName.trim().toUpperCase())) e.shortName = 'Use 2–5 letters or numbers.';
  if (v.contactEmail.trim() && !EMAIL.test(v.contactEmail.trim())) e.contactEmail = 'Enter a valid email address.';
  if (v.phone.trim() && !/^\+?[\d\s()-]{7,20}$/.test(v.phone.trim())) e.phone = 'Enter a valid phone number.';
  const label = v.memberLabel.trim();
  if (!label) e.memberLabel = 'Enter a label, such as Member.';
  else if (label.length < 2 || label.length > 30) e.memberLabel = 'Use between 2 and 30 characters.';
  if (!timezoneOptions(state.data.organizations.find((o) => o.id === parentId)?.timezone).includes(v.timezone)) e.timezone = 'Choose a time zone.';
  // The initial administrator is invited like any administrator: one organization per account, no duplicates.
  const invite = inviteProblems(state, { organizationId: '__new__', name: 'Initial administrator', email: v.adminEmail, roleIds: ['organization-admin'] }, now);
  if (invite.email) e.adminEmail = invite.email;
  return e;
}

export interface CreateSubOrganizationInput {
  parentOrganizationId: string;
  ids: { organizationId: string; administratorId: string; relationshipId: string };
  token: string;
  values: SubOrganizationValues;
  at: string;
}

function audit(state: AppState, events: Omit<AuditEvent, 'id'>[]): AuditEvent[] {
  let max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  return [...events.map((e) => ({ ...e, id: `AUD-${String(++max).padStart(5, '0')}` })).reverse(), ...state.data.audit];
}

/**
 * Creates a sub-organization: its own workspace (organization, default card design), the parent
 * relationship, and an invitation for its initial Organization Admin (72-hour single-use link, accepted
 * through the usual invitation page). Nobody becomes an active administrator without accepting, and the
 * creator gets no membership or access in the new workspace.
 */
export function applyCreateSubOrganization(state: AppState, input: CreateSubOrganizationInput): Result {
  const parent = state.data.organizations.find((o) => o.id === input.parentOrganizationId);
  if (!parent) return { ok: false, error: 'This organization doesn’t exist.' };
  if (!actorPermissions(state, parent.id).has('organizations.manage')) return { ok: false, error: "You don't have permission to create sub-organizations." };
  if (!canHaveSubOrganizations(state, parent.id)) return { ok: false, error: 'A sub-organization can’t have sub-organizations of its own.' };
  const { ids } = input;
  if (state.data.organizations.some((o) => o.id === ids.organizationId)) return { ok: false, error: 'The organization couldn’t be created. Try again.' };
  const errors = subOrganizationProblems(state, parent.id, input.values, new Date(input.at));
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]! };
  const v = input.values;
  const name = v.name.trim().replace(/\s+/g, ' ');
  const actor = state.data.admin.name;
  const organization: Organization = {
    id: ids.organizationId, name, shortName: (v.shortName.trim() || deriveShortName(name)).toUpperCase(), industry: v.industry || 'other',
    // Country is inherited from the parent rather than asked again.
    country: parent.country, timezone: v.timezone, contactEmail: v.contactEmail.trim().toLowerCase(), memberLabel: v.memberLabel.trim(),
    ...(v.phone.trim() ? { phone: v.phone.trim() } : {}),
    defaultCardDesignId: `${ids.organizationId}_design_default`,
    integrations: { idSwitch: { connected: true, tenantRef: `ids-tenant-${ids.organizationId}` }, seamfixWallet: { connected: true, issuerDid: `did:sfx:issuer:${ids.organizationId}` }, fixiam: { connected: false } },
    createdAt: input.at, status: 'active', onboarding: 'awaiting-administrator',
  };
  const cardDesign: CardDesign = {
    id: organization.defaultCardDesignId, organizationId: organization.id, name: 'Default digital ID', isDefault: true,
    primaryColor: '#1d2d8b', accentColor: '#f5b301', textColor: '#ffffff', layout: 'horizontal', showPhoto: true, showQr: true, fields: ['name', 'identifier', 'relationship', 'expiry'],
  };
  const email = v.adminEmail.trim().toLowerCase();
  const administrator: OrgAdministrator = {
    id: ids.administratorId, organizationId: organization.id, email, roleIds: ['organization-admin'], status: 'invited', createdAt: input.at,
    invitation: { sentAt: input.at, expiresAt: invitationExpiry(input.at), sendCount: 1, invitedBy: `${actor} (${parent.name})`, token: input.token },
  };
  const relationship: OrganizationRelationship = {
    id: ids.relationshipId, parentOrganizationId: parent.id, childOrganizationId: organization.id, type: 'sub-organization',
    origin: 'created-by-parent', status: 'active', initialAdministratorId: administrator.id, createdAt: input.at, createdBy: actor,
  };
  const common = { actor, actorType: 'admin' as const, result: 'success' as const, occurredAt: input.at };
  return {
    ok: true,
    state: {
      ...state,
      data: {
        ...state.data,
        organizations: [...state.data.organizations, organization],
        cardDesigns: [...state.data.cardDesigns, cardDesign],
        administrators: [...state.data.administrators, administrator],
        organizationRelationships: [...(state.data.organizationRelationships ?? []), relationship],
        audit: audit(state, [
          { ...common, organizationId: parent.id, action: 'organization.sub-created', resourceType: 'organization', resourceId: organization.id, subject: { id: organization.id, name },
            summary: `${actor} created the sub-organization ${name} and invited ${email} as its Organization Admin.`, href: `/organizations/${organization.id}` },
          { ...common, organizationId: organization.id, action: 'organization.created', resourceType: 'organization', resourceId: organization.id,
            summary: `${name} was created as a sub-organization of ${parent.name}. ${email} was invited as Organization Admin.`, href: '/settings' },
        ]),
      },
    },
  };
}

/** Resends a sub-organization's initial administrator invitation (new 72-hour link; the old one stops working). */
export function applyResendSubOrganizationInvite(state: AppState, input: { organizationId: string; childOrganizationId: string; token: string; at: string }): Result {
  if (!actorPermissions(state, input.organizationId).has('organizations.manage')) return { ok: false, error: "You don't have permission to manage sub-organizations." };
  const sub = subOrganization(state, input.organizationId, input.childOrganizationId);
  const admin = sub && initialAdministrator(state, sub.relationship);
  if (!sub || !admin || admin.status !== 'invited') return { ok: false, error: 'There is no pending invitation to resend.' };
  if (!input.token || state.data.administrators.some((a) => a.invitation?.token === input.token)) return { ok: false, error: 'The invitation couldn’t be resent. Try again.' };
  const actor = state.data.admin.name;
  const parentName = state.data.organizations.find((o) => o.id === input.organizationId)?.name ?? '';
  const next = { ...admin, invitation: { sentAt: input.at, expiresAt: invitationExpiry(input.at), sendCount: (admin.invitation?.sendCount ?? 0) + 1, invitedBy: `${actor} (${parentName})`, token: input.token } };
  return {
    ok: true,
    state: {
      ...state,
      data: {
        ...state.data,
        administrators: state.data.administrators.map((a) => (a.id === admin.id ? next : a)),
        audit: audit(state, [{
          organizationId: input.organizationId, action: 'organization.sub-invitation-resent', actor, actorType: 'admin', result: 'success', occurredAt: input.at,
          resourceType: 'organization', resourceId: sub.organization.id, subject: { id: sub.organization.id, name: sub.organization.name },
          summary: `${actor} resent the Organization Admin invitation for ${sub.organization.name} to ${admin.email}. The previous link no longer works.`, href: `/organizations/${sub.organization.id}`,
        }]),
      },
    },
  };
}

/** Status shown for an organization: onboarding first, then its own status. */
export function organizationStatus(o: Organization): 'awaiting-administrator' | 'active' | 'inactive' {
  if (o.onboarding === 'awaiting-administrator') return 'awaiting-administrator';
  return (o.status ?? 'active') === 'active' ? 'active' : 'inactive';
}
