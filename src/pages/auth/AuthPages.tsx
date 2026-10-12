import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, KeyRound, MailCheck } from 'lucide-react';
import { Button, Field, Input, Modal, useToast } from '@/components/ui';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { PortalBlocked, useAuthorization } from '@/auth/authorization';
import { DEMO_AUTH_ENABLED, DEMO_PASSWORD, RESET_LINK_MINUTES, SESSION_EXPIRED_FLAG, SIGNED_OUT_FLAG, checkCode, emailError, issueCode, loadSignup, normalizeEmail, passwordIsStrong, saveSignup } from '@/auth/authCore';
import { DEMO_ADMIN } from '@/data/seed';
import { useStore } from '@/store/AppStore';
import { loadMailbox } from '@/auth/demoMailbox';
import { DEMO_PERSONAS, personaName } from '@/data/demoPersonas';
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
  const { record, portalAccess, previewRole } = useAuthorization();
  const { state } = useStore();
  const location = useLocation();
  if (!account) return <Navigate to="/signin" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (account.onboarding !== 'complete' || account.platformRole) return <Navigate to={homeFor(account)} replace />;
  // Never render another organization's data while the workspace is being switched.
  if (state.data.admin.id !== (isDemo ? DEMO_ADMIN.id : account.id)) return null;
  // Access follows the administrator record: deactivated administrators, or roles without any permission, can't enter.
  if (!record) return <PortalBlocked reason="no-membership" onSignOut={signOut} />;
  if (record.status === 'deactivated') return <PortalBlocked reason="deactivated" onSignOut={signOut} />;
  if (!portalAccess) return <PortalBlocked reason={previewRole ? 'preview-no-portal' : 'no-portal'} onSignOut={signOut} />;
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
  const carried = location.state as { email?: string; from?: string; passwordReset?: boolean } | null;
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
  // Shown once after Sign out. Signing out of FixID doesn't sign anyone out of their identity provider.
  const [signedOut] = useState<{ provider: string | null } | null>(() => {
    try {
      const raw = window.sessionStorage.getItem(SIGNED_OUT_FLAG);
      window.sessionStorage.removeItem(SIGNED_OUT_FLAG);
      return raw ? JSON.parse(raw) as { provider: string | null } : null;
    } catch { return null; }
  });
  const reset = carried && 'passwordReset' in carried;

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
        {reset && !errors.form && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">Your password has been reset and you’ve been signed out everywhere. Sign in with your new password.</p>}
        {signedOut && !expired && !reset && !errors.form && (
          <p role="status" className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
            You’ve signed out of FixID.{signedOut.provider && ` You may still be signed in to ${signedOut.provider}; sign out there too if you’re using a shared device.`}
          </p>
        )}
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
      <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
      <Link to="/signin/sso" className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50">
        <KeyRound className="h-4 w-4" aria-hidden="true" /> Sign in with SSO
      </Link>
      {DEMO_AUTH_ENABLED && <DemoAccounts onUse={(e) => { setEmail(e); setPassword(DEMO_PASSWORD); setErrors({}); }} />}
    </AuthLayout>
  );
}


/**
 * Demo builds only: fictional accounts for each kind of user, in a dialog opened from a secondary link so
 * the sign-in form stays uncluttered. Choosing one fills in the form; signing in still goes through the
 * normal password check. Not rendered when demo mode is off (VITE_DEMO_AUTH=off).
 */
function DemoAccounts({ onUse }: { onUse: (email: string) => void }) {
  const accounts = [
    { email: 'demo@fixid.app', persona: 'Multi-workspace Organization Admin', name: 'Tobyson TE', description: 'Belongs to several sample organizations and can switch between them.' },
    ...DEMO_PERSONAS.map((p) => ({ email: p.email, persona: p.persona, name: personaName(p), description: p.description })),
  ];
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 text-center">
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className="text-sm font-medium text-slate-500 underline-offset-2 hover:text-brand-700 hover:underline">
        View demo accounts
      </button>
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Demo accounts"
        description="Fictional accounts for exploring FixID’s different roles and workspaces.">
        <div className="space-y-3 text-sm">
          {/* The shared password is shown only here, with a prototype-only warning. */}
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-inset ring-amber-200">
            Prototype only, not available in production builds. All demo accounts use the password <span className="font-mono">{DEMO_PASSWORD}</span>. Choose <span className="font-semibold">Use</span> to fill in the sign-in form.
          </p>
          <ul className="space-y-1.5" aria-label="Demonstration accounts">
            {accounts.map((a) => (
              <li key={a.email} className="flex items-start justify-between gap-3 rounded-lg px-3 py-2 ring-1 ring-slate-200">
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900">{a.persona}</span>
                  <span className="block text-xs text-slate-500 [overflow-wrap:anywhere]">{a.name} · {a.email}</span>
                  <span className="block text-xs text-slate-500">{a.description}</span>
                </span>
                <button type="button" onClick={() => { onUse(a.email); setOpen(false); }} aria-label={`Use ${a.persona} account`}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 hover:text-brand-700">Use</button>
              </li>
            ))}
          </ul>
          <p className="text-slate-500">Guided test scenarios, account switching and demo data reset are in the <Link to="/demo" className="font-medium text-brand-600 hover:text-brand-700">Demo Control Centre</Link>.</p>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forgot password                                                     */
/* ------------------------------------------------------------------ */

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
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
    // Recovery requests are answered the same way whether or not the email is registered.
    await Promise.all([requestPasswordReset(email), pause(500)]);
    setBusy(false);
    setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout>
        <AuthHeading title="Check your inbox"
          eyebrow={<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><MailCheck className="h-6 w-6" aria-hidden="true" /></span>}
          description={`If an account exists for this email, you'll receive a password reset link shortly. The link works once and expires in ${RESET_LINK_MINUTES} minutes.`} />
        {DEMO_AUTH_ENABLED && (
          <p role="note" className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            Prototype: no email is sent. Messages FixID would send appear in the <Link to="/demo-mailbox" className="font-semibold underline">demonstration mailbox</Link>.
          </p>
        )}
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
      <p className="mt-5 text-sm text-slate-500">This resets your FixID password. If you sign in with SSO, reset your identity provider password with that provider.</p>
      <Link to="/signin" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
      </Link>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Reset password (from the emailed link)                              */
/* ------------------------------------------------------------------ */

export function ResetPasswordPage() {
  const { checkResetLink, resetPassword } = useAuth();
  const navigate = useNavigate();
  const token = new URLSearchParams(useLocation().search).get('token') ?? '';
  const [link, setLink] = useState<'checking' | 'valid' | 'invalid' | 'used' | 'expired'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { void checkResetLink(token).then(setLink); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (link === 'checking') return <AuthLayout><p role="status" className="text-slate-500">Checking your link…</p></AuthLayout>;
  if (link !== 'valid') {
    const copy = { invalid: 'This reset link isn’t valid.', used: 'This reset link has already been used.', expired: 'This reset link has expired.' }[link];
    return (
      <AuthLayout>
        <AuthHeading title={copy} description="Request a new link to reset your password." />
        <div className="flex flex-col gap-3 text-sm">
          <Link to="/forgot-password" className={linkCls}>Request a new link</Link>
          <Link to="/signin" className={linkCls}>Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!password) next.password = 'Create a password.';
    else if (!passwordIsStrong(password)) next.password = "This password doesn't meet the requirements below.";
    if (!confirm) next.confirm = 'Confirm your password.';
    else if (password && confirm !== password) next.confirm = "Passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    const r = await resetPassword(token, password);
    setBusy(false);
    if (!r.ok) return setErrors({ form: r.error });
    navigate('/signin', { replace: true, state: { passwordReset: true } });
  };

  return (
    <AuthLayout>
      <AuthHeading title="Set a new password" description="Choose a new password for your FixID account. You’ll be signed out everywhere and can then sign in with it." />
      <form onSubmit={submit} noValidate className="space-y-5">
        {errors.form && <FormError>{errors.form}</FormError>}
        <PasswordField label="New password" value={password} onChange={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: undefined })); }}
          error={errors.password} autoComplete="new-password" autoFocus describedBy="reset-password-rules" />
        <PasswordRules password={password} id="reset-password-rules" />
        <PasswordField label="Confirm password" value={confirm} onChange={(v) => { setConfirm(v); setErrors((x) => ({ ...x, confirm: undefined })); }}
          error={errors.confirm} autoComplete="new-password" />
        <Button type="submit" className="h-11 w-full" loading={busy}>Reset password</Button>
      </form>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Demonstration mailbox (prototype only)                              */
/* ------------------------------------------------------------------ */

export function DemoMailboxPage() {
  const [mail] = useState(loadMailbox);
  if (!DEMO_AUTH_ENABLED) return <Navigate to="/signin" replace />;
  return (
    <AuthLayout wide>
      <AuthHeading title="Demonstration mailbox" description="Simulated email delivery. No email service is connected to this prototype, so messages FixID would email appear here. This page isn’t part of FixID." />
      {mail.length === 0 ? <p className="text-slate-500">No messages yet.</p> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {mail.map((m) => (
            <li key={m.id} className="space-y-1 px-4 py-3 text-sm">
              <p className="font-semibold text-slate-900">{m.subject}</p>
              <p className="text-slate-500">To {m.to} · {new Date(m.sentAt).toLocaleString()}</p>
              <p className="text-slate-600">{m.body}</p>
              <Link to={m.link} className={linkCls}>Open link</Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/signin" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in</Link>
    </AuthLayout>
  );
}
