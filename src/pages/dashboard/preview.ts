import { useCallback, useState } from 'react';
import { isIssued } from '@/domain/setupProgress';
import type { OrgData } from '@/store/AppStore';

/**
 * Prototype-only dashboard preview. Stored under its own key, separate from the
 * organization data in the app store, and never written back to it.
 */
export type DashboardPreview = 'first-time-new' | 'first-time-issued' | 'active' | 'automatic';

export const PREVIEW_OPTIONS: { value: DashboardPreview; label: string }[] = [
  { value: 'first-time-new', label: 'First-time · New organization' },
  { value: 'first-time-issued', label: 'First-time · First ID issued' },
  { value: 'active', label: 'Active dashboard' },
  { value: 'automatic', label: 'Automatic (from setup data)' },
];

export const PREVIEW_STORAGE_KEY = 'fixid.prototype.dashboardPreview';
const DEFAULT_PREVIEW: DashboardPreview = 'first-time-new';

function read(): DashboardPreview {
  try {
    const v = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
    return PREVIEW_OPTIONS.some((o) => o.value === v) ? (v as DashboardPreview) : DEFAULT_PREVIEW;
  } catch {
    return DEFAULT_PREVIEW;
  }
}

export function useDashboardPreview(): [DashboardPreview, (v: DashboardPreview) => void] {
  const [value, setValue] = useState<DashboardPreview>(read);
  const update = useCallback((v: DashboardPreview) => {
    setValue(v);
    try {
      window.localStorage.setItem(PREVIEW_STORAGE_KEY, v);
    } catch {
      /* storage unavailable: preview still works for this session */
    }
  }, []);
  return [value, update];
}

/** The slice of organization data the first-time dashboard reads. */
export type DashboardData = Pick<OrgData, 'members' | 'credentials' | 'activities' | 'transactions' | 'audit'>;

/**
 * Read-only view of the organization for a preview stage. Nothing here is persisted.
 * - `first-time-new`: an organization that has just started (no records).
 * - `first-time-issued`: only the organization's earliest successfully issued credential and its holder,
 *   i.e. a real subset of the data as it stood after the first ID was issued.
 */
export function previewData(stage: 'first-time-new' | 'first-time-issued', org: DashboardData): DashboardData {
  const empty: DashboardData = { members: [], credentials: [], activities: [], transactions: [], audit: [] };
  if (stage === 'first-time-new') return empty;
  const first = [...org.credentials].filter(isIssued).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))[0];
  if (!first) return empty;
  const member = org.members.find((m) => m.id === first.memberId);
  return {
    ...empty,
    members: member ? [member] : [],
    credentials: [first],
    audit: org.audit.filter((e) => e.resourceId === first.id || e.resourceId === first.memberId),
  };
}
