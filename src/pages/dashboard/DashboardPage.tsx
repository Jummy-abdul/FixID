import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { getSetupProgress } from '@/domain/setupProgress';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { selectOrgData, useOrgData, useSession, useStore } from '@/store/AppStore';
import { ActiveDashboard } from './ActiveDashboard';
import { FirstTimeDashboard } from './FirstTimeDashboard';
import { PREVIEW_OPTIONS, previewData, useDashboardPreview, type DashboardPreview } from './preview';

function PreviewControl({ value, onChange }: { value: DashboardPreview; onChange: (v: DashboardPreview) => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs text-slate-400 transition-colors focus-within:text-slate-600 hover:text-slate-600">
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      <span aria-hidden="true">Preview</span>
      <select aria-label="Dashboard preview" value={value} onChange={(e) => onChange(e.target.value as DashboardPreview)}
        className="h-7 cursor-pointer rounded-md border border-transparent bg-transparent pl-1 pr-6 text-xs font-medium text-slate-500 hover:border-slate-200 hover:bg-white focus:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20">
        {PREVIEW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/**
 * Dashboard container. In production the state follows setup progress ("automatic");
 * the prototype preview can force either state without touching organization data.
 */
export function DashboardPage() {
  const { admin } = useSession();
  const org = useOrgData();
  const { state } = useStore();
  const [preview, setPreview] = useDashboardPreview();
  const control = <PreviewControl value={preview} onChange={setPreview} />;

  const firstTimeData = useMemo(() => {
    if (preview === 'first-time-new' || preview === 'first-time-issued') return previewData(preview, org);
    if (preview === 'automatic' && !getSetupProgress(org).isComplete) return org;
    return null;
  }, [preview, org]);

  // The "active" preview shows an established sample organization, read-only.
  if (preview === 'active') return <ActiveDashboard headerActions={control} data={selectOrgData(state, SAMPLE_ORGANIZATION_ID)} />;
  if (!firstTimeData) return <ActiveDashboard headerActions={control} />;
  return <FirstTimeDashboard data={firstTimeData} adminName={admin.name} headerActions={control} />;
}
