import { useMemo, useState } from 'react';
import { CheckCircle2, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { clearJustRegistered, justRegistered } from './registration';
import { Button, Modal } from '@/components/ui';
import { getSetupProgress } from '@/domain/setupProgress';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import { useAuth } from '@/auth/AuthProvider';
import { useAuthorization } from '@/auth/authorization';
import type { Permission } from '@/domain/roles';
import { VerifierDashboard } from '../verifier/VerifierHome';
import { WorkspaceHome } from './WorkspaceHome';
import { selectOrgData, useOrgData, useSession, useStore } from '@/store/AppStore';
import { ActiveDashboard } from './ActiveDashboard';
import { FirstTimeDashboard } from './FirstTimeDashboard';
import { VerificationOperations } from './VerificationOperations';
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

/** Permissions that come with an organization overview. Without any, the dashboard is role-focused. */
const OVERVIEW: Permission[] = ['users.view', 'groups.view', 'credentials.view', 'verification.activities.view', 'verification.results.view', 'audit.view'];

/** Chooses the dashboard from what the administrator may see, so a new custom role never needs its own. */
export function DashboardPage() {
  const { can } = useAuthorization();
  const dashboard = !OVERVIEW.some(can) ? (can('verification.execute') ? <VerifierDashboard /> : <WorkspaceHome />) : <OrganizationDashboard />;
  return <>{dashboard}<RegistrationConfirmation /></>;
}

/**
 * Shown once, when a newly registered organization's workspace first opens: confirms the registration,
 * that the person registering is its first Organization Administrator, and how to get back in.
 */
function RegistrationConfirmation() {
  const [shownFor, setShownFor] = useState(justRegistered);
  const { organization, admin } = useSession();
  const { account } = useAuth();
  const { record } = useAuthorization();
  const navigate = useNavigate();
  if (!account || shownFor !== organization.id || organization.ownerAccountId !== account.id) return null;
  const close = () => { clearJustRegistered(); setShownFor(null); };
  return (
    <Modal open onClose={close} size="sm"
      title={<span className="flex flex-col gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500 text-white"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /></span>Your organization is registered</span>}
      description={`${organization.name} now has its own FixID workspace.`}
      footer={<>
        <Button variant="secondary" onClick={() => { close(); navigate('/settings?tab=organization'); }}>View organization profile</Button>
        <Button onClick={close} data-autofocus>Go to workspace</Button>
      </>}>
      <dl className="space-y-3 rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-inset ring-slate-200">
        <div><dt className="text-slate-500">Organization ID</dt><dd className="font-mono text-xs text-slate-900">{organization.id}</dd></div>
        <div><dt className="text-slate-500">Your role</dt><dd className="text-slate-900">{record?.roleIds.includes('organization-admin') ? 'Organization Administrator' : 'Administrator'}</dd></div>
        <div><dt className="text-slate-500">Signed in as</dt><dd className="text-slate-900">{admin.name} · {account.email}</dd></div>
      </dl>
      <p className="mt-3 text-sm text-slate-600">To return to this workspace, sign in to FixID with <span className="font-medium text-slate-900">{account.email}</span>. You can complete your organization’s details, such as its address, in Settings → Organization at any time.</p>
    </Modal>
  );
}

/**
 * Organization dashboard container. In production the state follows setup progress ("automatic");
 * the prototype preview can force either state without touching organization data.
 */
function OrganizationDashboard() {
  const { admin } = useSession();
  const org = useOrgData();
  const { state } = useStore();
  const { isDemo } = useAuth();
  const [storedPreview, setPreview] = useDashboardPreview();
  // The preview (which can show sample organizations) is available to the demo account only.
  const preview: DashboardPreview = isDemo ? storedPreview : 'automatic';
  const control = isDemo ? <PreviewControl value={preview} onChange={setPreview} /> : undefined;

  const firstTimeData = useMemo(() => {
    if (preview === 'first-time-new' || preview === 'first-time-issued') return previewData(preview, org);
    if (preview === 'automatic' && !getSetupProgress(org).isComplete) return org;
    return null;
  }, [preview, org]);

  // The "active" preview shows an established sample organization, read-only.
  if (preview === 'active') return <ActiveDashboard headerActions={control} data={selectOrgData(state, SAMPLE_ORGANIZATION_ID)} />;
  // Verification operations always describe the signed-in workspace's own records.
  if (!firstTimeData) return <ActiveDashboard headerActions={control} verification={<VerificationOperations />} />;
  return <><FirstTimeDashboard data={firstTimeData} adminName={admin.name} headerActions={control} />{preview === 'automatic' && <VerificationOperations />}</>;
}
