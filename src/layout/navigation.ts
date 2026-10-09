import {
  Activity, BadgeCheck, History, LayoutDashboard, Layers, ScrollText, Settings, Users, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string; to: string; icon: LucideIcon; description: string;
  /** Other route prefixes that belong to this item (e.g. Templates is reached from Credentials). */
  alsoActiveOn?: string[];
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
      { label: 'Users', to: '/users', icon: Users, description: 'Identities and their organization-specific information' },
      { label: 'Groups', to: '/groups', icon: Layers, description: 'Collections of users' },
    ],
  },
  {
    label: 'Credential Management',
    items: [
      { label: 'Credentials', to: '/credentials', icon: BadgeCheck, description: 'Issued credentials and their management', alsoActiveOn: ['/templates'] },
    ],
  },
  {
    label: 'Verification',
    items: [
      { label: 'Verification Events', to: '/activities', icon: Activity, description: 'Where and how credentials are verified' },
      { label: 'Verification History', to: '/verification-history', icon: History, description: 'Verification attempts and decisions' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Audit Log', to: '/audit', icon: ScrollText, description: 'Administrative and security activity' },
      { label: 'Settings', to: '/settings', icon: Settings, description: 'Organization, integrations and demo data' },
    ],
  },
];
