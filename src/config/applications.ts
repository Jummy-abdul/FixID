import { Building2, Fingerprint, ShieldCheck, type LucideIcon } from 'lucide-react';

export interface SeamfixApplication {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon tile. */
  tone: string;
  /** In-app route for the current application. */
  route?: string;
  /** External destination. Left undefined until configured; never guessed. */
  url?: string;
}

/** The application this prototype is. */
export const CURRENT_APPLICATION_ID = 'fixid';

const env = import.meta.env as Record<string, string | undefined>;

/**
 * Seamfix applications shown in the App Launcher. Add entries here to extend it.
 * External destinations come from configuration (VITE_FIXIAM_URL, VITE_ADMIN_URL).
 */
export const APPLICATIONS: SeamfixApplication[] = [
  { id: 'fixid', name: 'FixID', description: 'Identity & credentials', icon: Fingerprint, tone: 'bg-brand-600 text-white', route: '/' },
  { id: 'fixiam', name: 'Fixiam', description: 'Workforce IAM', icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700', url: env.VITE_FIXIAM_URL || undefined },
  { id: 'admin', name: 'Admin', description: 'Platform administration', icon: Building2, tone: 'bg-slate-100 text-slate-700', url: env.VITE_ADMIN_URL || undefined },
];
