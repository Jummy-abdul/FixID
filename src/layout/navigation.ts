import type { Permission } from '@/domain/roles';
import {
  BadgeCheck, BarChart3, Building2, ClipboardCheck, History, LayoutDashboard, Layers, ListChecks, ScanFace, ScrollText, Settings, ShieldAlert, Users, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string; to: string; icon: LucideIcon; description: string;
  /** Other route prefixes that belong to this item (e.g. Templates is reached from Credentials). */
  alsoActiveOn?: string[];
  /** Hidden from administrators without this permission (or without all of these, given a list: shown with any one). */
  permission?: Permission | Permission[];
  /** Hidden when the administrator has this permission: the organization-wide item covers it (no duplicate navigation). */
  hiddenWith?: Permission;
}
/** A group without a label renders its items directly under the branding (e.g. Dashboard). */
export interface NavGroup { label: string | null; items: NavItem[] }

export const NAVIGATION: NavGroup[] = [
  {
    label: null,
    items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard, description: 'Organization overview' }],
  },
  {
    label: 'User Management',
    items: [
      { label: 'Users', to: '/users', icon: Users, description: 'Identities and their organization-specific information', permission: 'users.view' },
      { label: 'Groups', to: '/groups', icon: Layers, description: 'Collections of users', permission: 'groups.view' },
    ],
  },
  {
    label: 'Credential Management',
    items: [
      { label: 'Credentials', to: '/credentials', icon: BadgeCheck, description: 'Issued credentials and their management', alsoActiveOn: ['/templates'], permission: 'credentials.view' },
    ],
  },
  {
    label: 'Verification',
    items: [
      { label: 'Verification Activities', to: '/verification-activities', icon: ListChecks, description: 'Your activities and shared activities you take part in', alsoActiveOn: ['/activities'], permission: 'verification.activities.view' },
      { label: 'My Verification Activities', to: '/verify', icon: ScanFace, description: 'Activities you’re assigned to verify', permission: 'verification.execute', hiddenWith: 'verification.activities.view', alsoActiveOn: ['/verify/activities', '/verify/attempts'] },
      { label: 'Verification History', to: '/verification-history', icon: History, description: 'Verification attempts and decisions', permission: 'verification.results.view' },
      { label: 'Exceptions', to: '/exceptions', icon: ShieldAlert, description: 'Verifications that need authorized review', permission: ['exceptions.view', 'exceptions.review'] },
      { label: 'Reports', to: '/reports', icon: BarChart3, description: 'Verification, shared activity and exception reports', permission: 'reports.view' },
      { label: 'My Verification History', to: '/verify/history', icon: ClipboardCheck, description: 'Verifications you performed', permission: 'verification.execute', hiddenWith: 'verification.results.view' },
    ],
  },
  {
    label: 'Organizations',
    items: [
      { label: 'Organizations', to: '/organizations', icon: Building2, description: 'Sub-organizations and organization relationships', permission: 'organizations.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Audit Logs', to: '/audit', icon: ScrollText, description: 'Administrative and security activity', permission: 'audit.view' },
      { label: 'Settings', to: '/settings', icon: Settings, description: 'Organization profile, administrators and roles, integrations, security', permission: ['settings.manage', 'organization.view', 'administrators.view', 'sso.manage', 'integrations.view'] },
    ],
  },
];
