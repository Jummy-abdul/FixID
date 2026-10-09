import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, MailCheck } from 'lucide-react';
import { Button, Field, Input, useToast } from '@/components/ui';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { PortalBlocked, useAuthorization } from '@/auth/authorization';
import { SESSION_EXPIRED_FLAG, checkCode, emailError, issueCode, loadSignup, normalizeEmail, passwordIsStrong, saveSignup } from '@/auth/authCore';
import { DEMO_ADMIN } from '@/data/seed';
import { useStore } from '@/store/AppStore';
import { AuthHeading, AuthLayout, FormError } from './AuthLayout';
import { OtpInput, PasswordField, PasswordRules } from './fields';

const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const linkCls = 'font-semibold text-brand-600 hover:text-brand-700';

/* ------------------------------------------------------------------ */
/* Route guards (prototype navigation only; not a security boundary)   */
/* ------------------------------------------------------------------ */

/** Sign-in and sign-up screens: signed-in administrators go where they belong. */
export function PublicOnly() {
  const { account } = useAuth();
  if (account) return <Navigate to={homeFor(account)} replace />;
  return <Outlet />;
}

/** Onboarding screens: only for signed-in administrators who haven't finished setup. */
export function RequireOnboarding() {
  const { account, isDemo } = useAuth();
  if (!account) return <Navigate to="/signin" replace />;
  if (isDemo || account.onboarding === 'complete') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** The application: signed in, onboarding complete, and the workspace switched to this account. */
export function RequireApp() {
  const { account, isDemo, signOut } = useAuth();
  const { record, portalAccess } = useAuthorization();
  const { state } = useStore();
  const location = useLocation();
  if (!account) return <Navigate to="/signin" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (account.onboarding !== 'complete') return <Navigate to={homeFor(account)} replace />;
  // Never render another organization's data while the workspace is being switched.
  if (state.data.admin.id !== (isDemo ? DEMO_ADMIN.id : account.id)) return null;
  // Access follows the administrator record: deactivated or verifier-only administrators can't use the portal.
  if (!record) return <PortalBlocked reason="no-membership" onSignOut={signOut} />;
  if (record.status === 'deactivated') return <PortalBlocked reason="deactivated" onSignOut={signOut} />;
  if (!portalAccess) return <PortalBlocked reason="no-portal" onSignOut={signOut} />;
  return <Outlet />;
}

/* ------------------------------------------------------------------ */
/* Sign up                                                             */
/* ------------------------------------------------------------------ */

export function SignUpPage() {
  const { accountExists } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState<string>(() => (location.state as { email?: string } | null)?.email ?? loadSignup()?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = emailError(email);
    setError(err);
    setExists(false);
    if (err) return;
    setBusy(true);
    await pause();
    setBusy(false);
    if (accountExists(email)) return setExists(true);
    const prior = loadSignup();
    const normalized = normalizeEmail(email);
    // A new address always gets a new code; the same address keeps its progress.
    saveSignup(prior && prior.email === normalized ? prior : { email: normalized, code: issueCode(), verified: false });
    navigate('/verify-email');
  };

  return (
    <AuthLayout footer={<>Already have an account? <Link to="/signin" state={{ email }} className={linkCls}>Sign in</Link></>}>
      <AuthHeading title="Create your FixID account" description="Enter your work email to get started." />
      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label="Email address" error={error ?? undefined}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus className="h-11" value={email} onChange={(e) => { setEmail(e.target.value); setExists(false); }} />}
        </Field>
        {exists && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            An account already exists with this email. Sign in to continue.
            <Link to="/signin" state={{ email }} className="font-semibold text-amber-900 underline">Sign in</Link>
          </div>
        )}
        <Button type="submit" className="h-11 w-full" loading={busy}>Continue</Button>
      </form>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Verify email                                                        */
/* ------------------------------------------------------------------ */

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState(loadSignup);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  if (!draft) return <Navigate to="/signup" replace />;
  if (draft.verified) return <Navigate to="/create-password" replace />;

  const verify = async (value = code) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    await pause();
    setBusy(false);
    inFlight.current = false;
    const r = checkCode(draft, value);
    if (r.ok) {
      const next = { ...draft, verified: true };
      saveSignup(next);
      navigate('/create-password', { replace: true });
      return;
    }
    setError(r.error);
    if (r.code) {
      const next = { ...draft, code: r.code };
      saveSignup(next);
      setDraft(next);
    }
  };

  const resend = () => {
    const next = { ...draft, code: issueCode() };
    saveSignup(next);
    setDraft(next);
    setCode('');
    setError(null);
    toast({ tone: 'success', title: 'New code sent', description: `We've sent a new code to ${draft.email}.` });
  };

  return (
    <AuthLayout footer={<>Wrong email? <Link to="/signup" state={{ email: draft.email }} className={linkCls}>Change email</Link></>}>
      <AuthHeading title="Check your inbox"
        eyebrow={<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><MailCheck className="h-6 w-6" aria-hidden="true" /></span>}
        description={<>We've sent a 6-digit verification code to <span className="font-semibold text-slate-900">{draft.email}</span>.</>} />
      <form onSubmit={(e) => { e.preventDefault(); void verify(); }} noValidate className="space-y-5">
        <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} invalid={!!error} disabled={busy}
          onComplete={(v) => { void verify(v); }} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="h-11 w-full" loading={busy} disabled={code.length !== 6}>Verify email</Button>
      </form>
      <p className="mt-6 text-sm text-slate-500">
        Didn't get a code? <button type="button" onClick={resend} className={linkCls}>Resend code</button>
      </p>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Create password                                                     */
/* ------------------------------------------------------------------ */

export function CreatePasswordPage() {
  const { createAccount, accountExists } = useAuth();
  const navigate = useNavigate();
  const [draft] = useState(loadSignup);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  if (!draft) return <Navigate to="/signup" replace />;
  if (!draft.verified) return <Navigate to="/verify-email" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!password) next.password = 'Create a password.';
    else if (!passwordIsStrong(password)) next.password = "This password doesn't meet the requirements below.";
    if (!confirm) next.confirm = 'Confirm your password.';
    else if (password && confirm !== password) next.confirm = "Passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;
    if (accountExists(draft.email)) return setErrors({ form: 'An account already exists with this email. Sign in to continue.' });
    setBusy(true);
    try {
      await createAccount(draft.email, password);
      navigate('/onboarding/personal', { replace: true });
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <AuthHeading title="Secure your account" description="Create a password to protect your FixID account." />
      <form onSubmit={submit} noValidate className="space-y-5">
        {errors.form && <FormError>{errors.form} <Link to="/signin" className="font-semibold underline">Sign in</Link></FormError>}
        <PasswordField label="New password" value={password} onChange={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: undefined })); }}
          error={errors.password} autoComplete="new-password" autoFocus describedBy="password-rules" />
        <PasswordRules password={password} id="password-rules" />
        <PasswordField label="Confirm password" value={confirm} onChange={(v) => { setConfirm(v); setErrors((x) => ({ ...x, confirm: undefined })); }}
          error={errors.confirm} autoComplete="new-password" />
        <Button type="submit" className="h-11 w-full" loading={busy}>Create password</Button>
      </form>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Sign in                                                             */
/* ------------------------------------------------------------------ */

export function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const carried = location.state as { email?: string; from?: string } | null;
  const [email, setEmail] = useState(carried?.email ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [expired] = useState(() => {
    try {
      const flag = window.sessionStorage.getItem(SESSION_EXPIRED_FLAG);
      window.sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
      return !!flag;
    } catch { return false; }
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    const emailErr = emailError(email);
    if (emailErr) next.email = emailErr;
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    await pause();
    const r = await signIn(email, password);
    setBusy(false);
    if (!r.ok) return setErrors({ form: r.error });
    const target = r.account.onboarding === 'complete' && carried?.from ? carried.from : homeFor(r.account);
    navigate(target, { replace: true });
  };

  return (
    <AuthLayout footer={<>Don't have an account? <Link to="/signup" className={linkCls}>Sign up</Link></>}>
      <AuthHeading title="Welcome back" description="Sign in to your FixID account." />
      <form onSubmit={submit} noValidate className="space-y-5">
        {expired && !errors.form && <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">Your session has expired. Sign in again to continue.</p>}
        {errors.form && <FormError>{errors.form}</FormError>}
        <Field label="Email address" error={errors.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus={!email} className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <div>
          <PasswordField label="Password" value={password} onChange={setPassword} error={errors.password} autoComplete="current-password" autoFocus={!!email} />
          <div className="mt-2 text-right">
            <Link to="/forgot-password" state={{ email }} className="text-sm font-medium text-brand-600 hover:text-brand-700">Forgot password?</Link>
          </div>
        </div>
        <Button type="submit" className="h-11 w-full" loading={busy}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Forgot password                                                     */
/* ------------------------------------------------------------------ */

export function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = emailError(email);
    setError(err);
    if (err) return;
    setBusy(true);
    // Recovery requests are accepted the same way whether or not the email is registered.
    await pause(500);
    setBusy(false);
    setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout>
        <AuthHeading title="Check your inbox"
          eyebrow={<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><MailCheck className="h-6 w-6" aria-hidden="true" /></span>}
          description="If an account exists for this email, you'll receive a password reset link shortly." />
        <Link to="/signin" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeading title="Forgot your password?" description="Enter your email address and we'll send you a password reset link." />
      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label="Email address" error={error ?? undefined}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Button type="submit" className="h-11 w-full" loading={busy}>Send reset link <ArrowRight className="h-4 w-4" /></Button>
      </form>
      <Link to="/signin" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
      </Link>
    </AuthLayout>
  );
}
