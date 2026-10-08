import {
  Activity, BadgeCheck, History, LayoutDashboard, LayoutTemplate, Layers, ScrollText, Settings, Users, type LucideIcon,
} from 'lucide-react';

export interface NavItem { label: string; to: string; icon: LucideIcon; description: string }
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
      { label: 'Credentials', to: '/credentials', icon: BadgeCheck, description: 'Issued credentials and their management' },
      { label: 'Templates', to: '/templates', icon: LayoutTemplate, description: 'Card designs and credential type configuration' },
    ],
  },
  {
    label: 'Verification',
    items: [
      { label: 'Activities', to: '/activities', icon: Activity, description: 'Verification use cases' },
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
