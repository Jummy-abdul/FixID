import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, MailX } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { displayName, useAuth } from '@/auth/AuthProvider';
import { passwordIsStrong } from '@/auth/authCore';
import { findRole } from '@/domain/roles';
import { acceptProblem, invitationByToken } from '@/store/adminOps';
import { useStore } from '@/store/AppStore';
import { AuthHeading, AuthLayout, FormError } from './AuthLayout';
import { PasswordField, PasswordRules } from './fields';

const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

/**
 * Administrator invitation link (/invite/:token). Shows the inviting organization and role, then the
 * invited person sets up their account and enters the workspace with that role. The link works once and
 * only until it expires (72 hours) or is replaced by a resent invitation.
 */
export function AcceptInvitationPage() {
  const { token = '' } = useParams();
  const { state } = useStore();
  const { account, signOut, acceptInvitationLink } = useAuth();
  const navigate = useNavigate();
  // Read once: after accepting, the token is cleared and this page navigates away.
  const [invitation] = useState(() => invitationByToken(state, token));
  const problem = acceptProblem(invitation, new Date().toISOString());
  const organization = invitation ? state.data.organizations.find((o) => o.id === invitation.organizationId) : undefined;
  const role = invitation ? findRole(state.data.customRoles ?? [], invitation.organizationId, invitation.roleIds[0] ?? '') : undefined;
  const [name, setName] = useState(invitation?.name ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ name?: string; password?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  if (problem || !invitation || !organization) {
    const expired = !!invitation && invitation.status === 'invited';
    return (
      <AuthLayout>
        <div className="text-center sm:text-left">
          <MailX className="mb-4 h-10 w-10 text-slate-400" aria-hidden="true" />
          <AuthHeading title={expired ? 'This invitation has expired' : 'This invitation link isn’t valid'}
            description={expired
              ? 'Invitation links expire after 72 hours. Ask an Organization Admin to resend your invitation; you’ll get a new link.'
              : 'It may have been used already, revoked, or replaced by a newer invitation. Use the most recent link you were sent, or ask an Organization Admin to resend it.'} />
          <Link to="/signin" className="text-sm font-semibold text-brand-600 hover:text-brand-700">Go to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  if (account) {
    return (
      <AuthLayout>
        <AuthHeading title={`Join ${organization.name}`} description={`You’re signed in as ${displayName(account)} (${account.email}). Sign out to accept this invitation for ${invitation.email}.`} />
        <Button className="h-11 w-full" onClick={signOut}>Sign out and continue</Button>
      </AuthLayout>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    const n = name.trim();
    if (!n) next.name = 'Enter your full name.';
    else if (n.length < 2 || n.length > 80) next.name = 'Use between 2 and 80 characters.';
    else if (!NAME.test(n)) next.name = 'Use letters only.';
    if (!password) next.password = 'Create a password.';
    else if (!passwordIsStrong(password)) next.password = "This password doesn't meet the requirements below.";
    if (!confirm) next.confirm = 'Confirm your password.';
    else if (password && confirm !== password) next.confirm = "Passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    const r = await acceptInvitationLink(token, n, password);
    setBusy(false);
    if (!r.ok) return setErrors({ form: r.error });
    navigate('/', { replace: true });
  };

  return (
    <AuthLayout>
      <AuthHeading title={`Join ${organization.name}`} description="You’ve been invited to help run FixID for this organization. Set up your account to accept." />
      <dl className="mb-6 grid gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-inset ring-slate-200 sm:grid-cols-2" aria-label="Invitation">
        <div><dt className="text-slate-500">Organization</dt><dd className="font-medium text-slate-900">{organization.name}</dd></div>
        <div><dt className="text-slate-500">Your role</dt><dd className="font-medium text-slate-900">{role?.name ?? 'Unknown role'}</dd></div>
      </dl>
      <form onSubmit={submit} noValidate className="space-y-5">
        {errors.form && <FormError>{errors.form}{errors.form.includes('Sign in') && <> <Link to="/signin" className="font-semibold underline">Sign in</Link></>}</FormError>}
        <Field label="Full name" required error={errors.name}>
          {(p) => <Input {...p} autoComplete="name" autoFocus className="h-11" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} />}
        </Field>
        <Field label="Email address">
          {(p) => (
            <div className="relative">
              <Input {...p} readOnly value={invitation.email} className="h-11 bg-slate-50 pr-28 text-slate-600" />
              <span className="absolute inset-y-0 right-3 flex items-center gap-1 text-xs font-medium text-emerald-700"><BadgeCheck className="h-4 w-4" aria-hidden="true" /> Invited</span>
            </div>
          )}
        </Field>
        <PasswordField label="Create password" value={password} onChange={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: undefined })); }}
          error={errors.password} autoComplete="new-password" describedBy="invite-password-rules" />
        <PasswordRules password={password} id="invite-password-rules" />
        <PasswordField label="Confirm password" value={confirm} onChange={(v) => { setConfirm(v); setErrors((x) => ({ ...x, confirm: undefined })); }}
          error={errors.confirm} autoComplete="new-password" />
        <Button type="submit" className="h-11 w-full" loading={busy}>Accept invitation</Button>
      </form>
    </AuthLayout>
  );
}
