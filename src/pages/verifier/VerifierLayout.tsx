import { Link, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, ScanFace } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { RolePreviewBanner, useAuthorization } from '@/auth/authorization';
import { Badge } from '@/components/ui';
import type { VerificationAttempt, VerificationOutcome } from '@/domain/types';
import { OUTCOME_LABEL } from '@/domain/verification';
import { useSession } from '@/store/AppStore';

/** A focused shell for performing verifications: no administration navigation. */
export function VerifierLayout() {
  const { admin, organization, organizations, switchOrganization } = useSession();
  const { portalAccess, record } = useAuthorization();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-50">
      <RolePreviewBanner />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/verify" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white"><ScanFace className="h-4 w-4" aria-hidden="true" /></span>
            FixID Verifier
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <span className="text-right">
              <span className="block font-medium text-slate-900">{record?.name ?? admin.name}</span>
              {organizations.length > 1 ? (
                <label className="block text-xs text-slate-500">
                  <span className="sr-only">Organization</span>
                  <select value={organization.id} onChange={(e) => { switchOrganization(e.target.value); navigate('/verify'); }}
                    className="rounded border-0 bg-transparent p-0 pr-6 text-xs text-slate-500 focus:ring-2 focus:ring-brand-500">
                    {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
              ) : <span className="block text-xs text-slate-500">{organization.name}</span>}
            </span>
            {portalAccess && (
              <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />Administration
              </Link>
            )}
            <button type="button" onClick={() => { signOut(); navigate('/signin', { replace: true }); }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">
              <LogOut className="h-4 w-4" aria-hidden="true" />Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8"><Outlet /></main>
    </div>
  );
}

const OUTCOME_TONE: Record<VerificationOutcome, 'success' | 'danger' | 'warning' | 'violet'> = {
  verified: 'success', 'not-verified': 'danger', 'unable-to-verify': 'warning', 'pending-review': 'violet',
};

export function AttemptBadge({ attempt }: { attempt: Pick<VerificationAttempt, 'status' | 'outcome'> }) {
  if (attempt.status === 'completed' && attempt.outcome) return <Badge tone={OUTCOME_TONE[attempt.outcome]} dot>{OUTCOME_LABEL[attempt.outcome]}</Badge>;
  const map = { 'in-progress': ['info', 'In progress'], cancelled: ['neutral', 'Cancelled'], expired: ['neutral', 'Interrupted'], error: ['danger', 'System error'], completed: ['neutral', 'Completed'] } as const;
  const [tone, label] = map[attempt.status];
  return <Badge tone={tone} dot>{label}</Badge>;
}
