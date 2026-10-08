import {
  Activity, BadgeCheck, CreditCard, FileClock, LayoutDashboard, Palette, ScrollText, Settings, Users, type LucideIcon,
} from 'lucide-react';

export interface NavItem { label: string; to: string; icon: LucideIcon; description: string }
export interface NavGroup { label: string; items: NavItem[] }

export const NAVIGATION: NavGroup[] = [
  {
    label: 'Operate',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard, description: 'Organization overview' },
      { label: 'People', to: '/people', icon: Users, description: 'Identities linked to your organization' },
      { label: 'Credentials', to: '/credentials', icon: BadgeCheck, description: 'Issued credentials and wallet delivery' },
      { label: 'Verification', to: '/activities', icon: Activity, description: 'Verification activities' },
      { label: 'Transactions', to: '/transactions', icon: FileClock, description: 'Verification attempts and decisions' },
    ],
  },
  {
    label: 'Configure',
    items: [
      { label: 'Credential Types', to: '/credential-types', icon: CreditCard, description: 'Identifier, validity and lifecycle rules' },
      { label: 'Card Designs', to: '/card-designs', icon: Palette, description: 'Digital ID card appearance' },
    ],
  },
  {
    label: 'Govern',
    items: [
      { label: 'Audit Log', to: '/audit', icon: ScrollText, description: 'Administrative and security activity' },
      { label: 'Settings', to: '/settings', icon: Settings, description: 'Organization, integrations and demo data' },
    ],
  },
];
