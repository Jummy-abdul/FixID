import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { NAVIGATION } from '@/layout/navigation';
import { useSession } from '@/store/AppStore';

/**
 * Home for roles without an organization overview (for example a custom role that only invites
 * administrators or manages settings): the areas the role can use, generated from its permissions.
 */
export function WorkspaceHome() {
  const { admin, organization } = useSession();
  const { can } = useAuthorization();
  const items = NAVIGATION.flatMap((g) => g.items)
    .filter((i) => i.to !== '/' && i.permission && (Array.isArray(i.permission) ? i.permission.some(can) : can(i.permission)) && !(i.hiddenWith && can(i.hiddenWith)));
  return (
    <>
      <PageHeader title="Dashboard" description={`Welcome, ${admin.name.split(' ')[0]}. What you can do in ${organization.name}.`} />
      {items.length === 0 ? (
        <p className="text-slate-500">Your roles don’t include any areas yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your areas">
          {items.map((i) => (
            <li key={i.to}>
              <Link to={i.to} className="flex h-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-card hover:border-brand-300">
                <i.icon className="mt-0.5 h-5 w-5 text-brand-600" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{i.label}</span><span className="block text-sm text-slate-500">{i.description}</span></span>
                <ArrowRight className="mt-1 h-4 w-4 text-slate-400" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
