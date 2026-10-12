import { deriveShortName } from '@/domain/organization';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { countryByCode } from '@/data/countries';
import { DEMO_ADMIN, NEW_ORGANIZATION_ID } from '@/data/seed';
import type { AdminUser, CardDesign, Organization } from '@/domain/types';
import { useStore } from '@/store/AppStore';
import { acceptProblem, invitationByToken } from '@/store/adminOps';
import {
  DEMO_ACCOUNT, DEMO_AUTH_ENABLED, builtInAccounts, RESET_LINK_MINUTES, SESSION_EXPIRED_FLAG, SIGNED_OUT_FLAG, SIGN_IN_LOCKOUT, clearFailedSignIns, hashPassword, loadAuth,
  lockedMinutes, newSession, normalizeEmail, passwordIsStrong, passwordMatches, randomToken, recordFailedSignIn, saveAuth, saveSignup, sessionProblem, sha256Hex,
  type Account, type AuthSession, type AuthStore,
} from './authCore';
import { deliverDemoMail } from './demoMailbox';
import { identityProblem, linkedAdministrator, type ExternalIdentity } from '@/store/ssoOps';

interface AuthContextValue {
  account: Account | null;
  isDemo: boolean;
  accountExists: (email: string) => boolean;
  signIn: (email: string, password: string) => Promise<{ ok: true; account: Account } | { ok: false; error: string }>;
  signOut: () => void;
  /** Creates the account after email verification and signs it in. */
  createAccount: (email: string, password: string) => Promise<Account>;
  savePersonal: (firstName: string, lastName: string) => void;
  createOrganization: (input: { name: string; countryCode: string; region: string }) => string;
  /** Joins the organization that invited this email (instead of creating one). */
  acceptInvitation: (adminId: string, organizationId: string, firstName: string, lastName: string) => void;
  /**
   * Accepts an invitation from its link: sets up the invited person's account (the link proves the email
   * address), activates their administrator record and signs them in. Refused for an expired, used or
   * replaced link, or when an account already exists for the email.
   */
  acceptInvitationLink: (token: string, fullName: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** The current session (how and when it started). */
  session: AuthSession | null;
  /**
   * Signs in an identity authenticated by an organization's SSO provider. Only an identity explicitly linked
   * to an active administrator of that organization gets a session; nothing is created or provisioned.
   */
  signInWithSso: (organizationId: string, identity: ExternalIdentity, providerName: string) => { ok: true; account: Account } | { ok: false; error: string };
  /** Starts a password reset. Always succeeds the same way, whether or not the email has an eligible account. */
  requestPasswordReset: (email: string) => Promise<void>;
  checkResetLink: (token: string) => Promise<'valid' | 'invalid' | 'used' | 'expired'>;
  /** Sets a new password from a reset link, then revokes every existing session of the account. */
  resetPassword: (token: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const displayName = (a: Pick<Account, 'firstName' | 'lastName' | 'email'>) =>
  [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || a.email;

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** Where an account belongs next: an onboarding step or the app. */
export function homeFor(account: Account): string {
  if (account.platformRole) return '/platform';
  if (account.onboarding === 'personal') return '/onboarding/personal';
  if (account.onboarding === 'organization') return '/onboarding/organization';
  return '/';
}

export function AuthProvider({ children, initialSession }: { children: ReactNode; initialSession?: AuthSession | null }) {
  const { state, dispatch, getState } = useStore();
  const [store, setStore] = useState<AuthStore>(() => {
    const loaded = loadAuth();
    return initialSession === undefined ? loaded : { ...loaded, session: initialSession };
  });
  const storeRef = useRef(store);
  storeRef.current = store;
  const ssoApplied = useRef(false);
  useEffect(() => { saveAuth(store); }, [store]);

  const findAccount = useCallback((email: string): Account | undefined => {
    const e = normalizeEmail(email);
    return builtInAccounts().find((a) => a.email === e) ?? storeRef.current.accounts.find((a) => a.email === e);
  }, []);

  const account = useMemo(() => {
    const id = store.session?.accountId;
    if (!id) return null;
    return builtInAccounts().find((a) => a.id === id) ?? store.accounts.find((a) => a.id === id) ?? null;
  }, [store]);
  const isDemo = account?.id === DEMO_ACCOUNT.id;

  // Keep the workspace (signed-in administrator and organization) in step with the account.
  const orgs = state.data.organizations;
  const records = state.data.administrators;
  useEffect(() => {
    // Platform Administrators have no organization workspace.
    if (!account || account.onboarding !== 'complete' || account.platformRole) return;
    let admin: AdminUser;
    let organizationId: string;
    // Workspaces come only from explicit memberships (administrator records), never from organization
    // relationships: a parent organization's administrators aren't members of its sub-organizations.
    const membershipsOf = (userId: string) => orgs.filter((o) => records.some((r) => r.organizationId === o.id && r.userId === userId && r.status !== 'invited')).map((o) => o.id);
    if (isDemo) {
      const demoOrgIds = membershipsOf(DEMO_ADMIN.id);
      admin = { ...DEMO_ADMIN, organizationIds: demoOrgIds };
      // An SSO sign-in opens the organization signed in to; otherwise the last one used.
      const ssoOrg = store.session?.method === 'sso' ? store.session.organizationId : undefined;
      organizationId = ssoOrg && demoOrgIds.includes(ssoOrg) && !ssoApplied.current ? ssoOrg : demoOrgIds.includes(state.session.currentOrganizationId) ? state.session.currentOrganizationId : NEW_ORGANIZATION_ID;
      if (ssoOrg) ssoApplied.current = true;
    } else {
      if (!account.organizationId || !orgs.some((o) => o.id === account.organizationId)) return;
      const name = displayName(account);
      const memberships = [...new Set([account.organizationId, ...membershipsOf(account.id)])];
      admin = { id: account.id, name, initials: initialsOf(name), email: account.email, role: 'Owner', organizationIds: memberships };
      // Stay in the workspace in use when it's one of this account's own; otherwise open the home organization.
      organizationId = state.data.admin.id === account.id && memberships.includes(state.session.currentOrganizationId) ? state.session.currentOrganizationId : account.organizationId;
    }
    if (JSON.stringify(admin) !== JSON.stringify(state.data.admin) || organizationId !== state.session.currentOrganizationId) {
      dispatch({ type: 'session/signIn', admin, organizationId });
    }
  }, [account, isDemo, orgs, records, state.data.admin, state.session.currentOrganizationId, dispatch, store.session]);

  // Session lifetime: activity keeps a session alive up to its maximum; idle, expired or revoked sessions end.
  const issuedAt = store.session?.issuedAt;
  useEffect(() => { ssoApplied.current = false; }, [issuedAt]);
  useEffect(() => {
    if (!store.session?.lastActiveAt) return;
    let last = Date.now();
    const touch = () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      setStore((s) => (s.session ? { ...s, session: { ...s.session, lastActiveAt: new Date().toISOString() } } : s));
    };
    const check = () => {
      const s = storeRef.current;
      if (!s.session) return;
      if (sessionProblem(s.session, s.accounts.find((a) => a.id === s.session!.accountId))) {
        try { window.sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1'); } catch { /* ignore */ }
        dispatch({ type: 'preview/stop' });
        setStore((x) => ({ ...x, session: null }));
      }
    };
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 30_000);
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); document.removeEventListener('visibilitychange', check); window.clearInterval(timer); };
  }, [issuedAt, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateAccount = useCallback((id: string, patch: Partial<Account>) => {
    setStore((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    account,
    isDemo,
    accountExists: (email) => !!findAccount(email),
    signIn: async (email, password) => {
      const locked = lockedMinutes(email);
      const lockMessage = (m: number) => `Too many unsuccessful sign-in attempts. Try again in ${m} ${m === 1 ? 'minute' : 'minutes'}, or reset your password.`;
      if (locked) return { ok: false, error: lockMessage(locked) };
      const found = findAccount(email);
      // Same message whether or not the account exists; failures count the same way too.
      if (!found || !(await passwordMatches(found, password))) {
        return recordFailedSignIn(email) ? { ok: false, error: lockMessage(SIGN_IN_LOCKOUT.lockMinutes) } : { ok: false, error: 'Incorrect email or password.' };
      }
      // An inactive administrator can't start a session (the demo account opens several sample organizations).
      if (found.id !== DEMO_ACCOUNT.id && found.organizationId) {
        const rec = getState().data.administrators.find((a) => a.organizationId === found.organizationId && a.userId === found.id);
        if (rec?.status === 'deactivated') return { ok: false, error: 'This administrator account is inactive. Contact your Organization Admin.' };
      }
      clearFailedSignIns(email);
      setStore((s) => ({ ...s, session: newSession(found.id) }));
      return { ok: true, account: found };
    },
    signOut: () => {
      saveSignup(null);
      dispatch({ type: 'preview/stop' });
      // Ends the FixID session only. An SSO provider's own session is separate; Sign in says so.
      try { window.sessionStorage.setItem(SIGNED_OUT_FLAG, JSON.stringify({ provider: storeRef.current.session?.method === 'sso' ? storeRef.current.session.providerName ?? 'your identity provider' : null })); } catch { /* ignore */ }
      setStore((s) => ({ ...s, session: null }));
    },
    session: store.session,
    signInWithSso: (organizationId, identity, providerName) => {
      const state = getState();
      const problem = identityProblem(state, organizationId, identity);
      if (problem) return { ok: false, error: problem };
      const admin = linkedAdministrator(state, organizationId, identity.issuer, identity.subject);
      if (!admin) return { ok: false, error: 'This identity isn’t linked to a FixID administrator account in this organization. Sign in with your email and password, then link SSO from My Profile.' };
      if (admin.status !== 'active') return { ok: false, error: 'This administrator account is inactive. Contact your Organization Admin.' };
      const target = DEMO_AUTH_ENABLED && admin.userId === DEMO_ADMIN.id ? DEMO_ACCOUNT : builtInAccounts().find((a) => a.id === admin.userId) ?? storeRef.current.accounts.find((a) => a.id === admin.userId);
      if (!target || (target.id !== DEMO_ACCOUNT.id && target.organizationId !== organizationId)) return { ok: false, error: 'This identity isn’t linked to a FixID administrator account in this organization.' };
      saveSignup(null);
      dispatch({ type: 'preview/stop' });
      setStore((s) => ({ ...s, session: newSession(target.id, new Date(), { method: 'sso', organizationId, providerName }) }));
      return { ok: true, account: target };
    },
    requestPasswordReset: async (email) => {
      const e = normalizeEmail(email);
      // Only stored accounts with a FixID password are eligible; the demo account's password is fixed.
      const account = storeRef.current.accounts.find((a) => a.email === e);
      if (!account) return;
      const token = randomToken(32);
      const now = new Date();
      const reset = { tokenHash: await sha256Hex(token), accountId: account.id, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + RESET_LINK_MINUTES * 60_000).toISOString() };
      // A new link replaces any earlier unused one.
      setStore((s) => ({ ...s, resets: [...(s.resets ?? []).map((r) => (r.accountId === account.id && !r.usedAt ? { ...r, usedAt: now.toISOString() } : r)), reset] }));
      deliverDemoMail({
        to: account.email, subject: 'Reset your FixID password', link: `/reset-password?token=${token}`,
        body: `Someone asked to reset the password for your FixID account. The link works once and expires in ${RESET_LINK_MINUTES} minutes. If it wasn’t you, ignore this email.`,
      });
    },
    checkResetLink: async (token) => {
      if (!/^[0-9a-f]{64}$/.test(token)) return 'invalid';
      const hash = await sha256Hex(token);
      const r = (storeRef.current.resets ?? []).find((x) => x.tokenHash === hash);
      if (!r || !storeRef.current.accounts.some((a) => a.id === r.accountId)) return 'invalid';
      if (r.usedAt) return 'used';
      return new Date(r.expiresAt) <= new Date() ? 'expired' : 'valid';
    },
    resetPassword: async (token, password) => {
      if (!passwordIsStrong(password)) return { ok: false, error: "This password doesn't meet the requirements." };
      const hash = /^[0-9a-f]{64}$/.test(token) ? await sha256Hex(token) : '';
      const r = (storeRef.current.resets ?? []).find((x) => x.tokenHash === hash);
      const now = new Date();
      if (!r) return { ok: false, error: 'This reset link isn’t valid. Request a new one.' };
      if (r.usedAt) return { ok: false, error: 'This reset link has already been used. Request a new one if you still need to reset your password.' };
      if (new Date(r.expiresAt) <= now) return { ok: false, error: 'This reset link has expired. Request a new one.' };
      const account = storeRef.current.accounts.find((a) => a.id === r.accountId);
      if (!account) return { ok: false, error: 'This reset link isn’t valid. Request a new one.' };
      const salt = randomToken(16);
      const next = { ...account, password: { hash: await hashPassword(password, salt), salt, iterations: 100_000 }, sessionsValidAfter: now.toISOString() };
      setStore((s) => ({
        accounts: s.accounts.map((a) => (a.id === account.id ? next : a)),
        resets: (s.resets ?? []).map((x) => (x.tokenHash === r.tokenHash ? { ...x, usedAt: now.toISOString() } : x)),
        // Every existing session of the account ends, including this browser's.
        session: s.session?.accountId === account.id ? null : s.session,
      }));
      clearFailedSignIns(account.email);
      return { ok: true };
    },
    createAccount: async (email, password) => {
      const e = normalizeEmail(email);
      const existing = findAccount(e);
      if (existing) throw new Error('An account already exists with this email.');
      const salt = randomToken(16);
      const created: Account = {
        id: `acct_${randomToken(8)}`, email: e, password: { hash: await hashPassword(password, salt), salt, iterations: 100_000 },
        emailVerified: true, onboarding: 'personal', createdAt: new Date().toISOString(),
      };
      setStore((s) => ({ ...s, accounts: [...s.accounts, created], session: newSession(created.id) }));
      saveSignup(null);
      return created;
    },
    savePersonal: (firstName, lastName) => {
      if (!account || isDemo) return;
      updateAccount(account.id, { firstName: firstName.trim(), lastName: lastName.trim(), onboarding: account.onboarding === 'complete' ? 'complete' : 'organization' });
    },
    acceptInvitation: (adminId, organizationId, firstName, lastName) => {
      if (!account || isDemo) return;
      const name = `${firstName.trim()} ${lastName.trim()}`;
      dispatch({ type: 'admins/accept', adminId, userId: account.id, name, at: new Date().toISOString() });
      updateAccount(account.id, { firstName: firstName.trim(), lastName: lastName.trim(), organizationId, onboarding: 'complete' });
    },
    acceptInvitationLink: async (token, fullName, password) => {
      const before = getState();
      const target = invitationByToken(before, token);
      const at = new Date().toISOString();
      const problem = acceptProblem(target, at);
      if (problem || !target) return { ok: false, error: problem! };
      // One account per email: an existing account signs in instead of creating a duplicate.
      if (findAccount(target.email)) return { ok: false, error: `An account already exists for ${target.email}. Sign in with it instead.` };
      const name = fullName.trim().replace(/\s+/g, ' ');
      const [firstName, ...rest] = name.split(' ');
      const salt = randomToken(16);
      const created: Account = {
        id: `acct_${randomToken(8)}`, email: normalizeEmail(target.email), password: { hash: await hashPassword(password, salt), salt, iterations: 100_000 },
        emailVerified: true, firstName, lastName: rest.join(' '), organizationId: target.organizationId, onboarding: 'complete', createdAt: at,
      };
      // A role view left over in this browser would block joining; the new administrator starts in their own role.
      dispatch({ type: 'preview/stop' });
      dispatch({ type: 'admins/accept', adminId: target.id, userId: created.id, name, at, token });
      // Only a completed acceptance creates the account and signs in.
      const joined = getState().data.administrators.find((a) => a.id === target.id);
      if (joined?.status !== 'active' || joined.userId !== created.id) return { ok: false, error: 'The invitation couldn’t be accepted. Nothing was created; please try again.' };
      saveSignup(null);
      setStore((s) => ({ ...s, accounts: [...s.accounts, created], session: newSession(created.id) }));
      return { ok: true };
    },
    createOrganization: ({ name, countryCode, region }) => {
      if (!account || isDemo) throw new Error('Sign in to create an organization.');
      if (account.organizationId) return account.organizationId;
      const country = countryByCode(countryCode);
      const id = `org_${randomToken(6)}`;
      const at = new Date().toISOString();
      const clean = name.trim().replace(/\s+/g, ' ');
      const shortName = deriveShortName(clean);
      const organization: Organization = {
        id, name: clean, shortName, industry: 'other', country: country?.name ?? countryCode, region: region.trim() || undefined,
        timezone: country?.timezone ?? 'UTC', contactEmail: account.email, memberLabel: 'Member', defaultCardDesignId: `${id}_design_default`,
        integrations: {
          idSwitch: { connected: true, tenantRef: `ids-tenant-${id}` },
          seamfixWallet: { connected: true, issuerDid: `did:sfx:issuer:${id}` },
          fixiam: { connected: false },
        },
        createdAt: at, ownerAccountId: account.id,
      };
      const cardDesign: CardDesign = {
        id: `${id}_design_default`, organizationId: id, name: 'Default digital ID', isDefault: true,
        primaryColor: '#1d2d8b', accentColor: '#f5b301', textColor: '#ffffff', layout: 'horizontal',
        showPhoto: true, showQr: true, fields: ['name', 'identifier', 'relationship', 'expiry'],
      };
      dispatch({ type: 'organization/create', organization, cardDesign, at, actor: displayName(account), owner: { userId: account.id, email: account.email } });
      // Registration only counts once the workspace and its first Organization Administrator exist.
      // Otherwise nothing is marked ready and the person sees an error, never a success.
      const after = getState();
      const created = after.data.organizations.some((o) => o.id === id)
        && after.data.administrators.some((a) => a.organizationId === id && a.userId === account.id && a.status === 'active' && a.roleIds.includes('organization-admin'));
      if (!created) throw new Error('Your organization couldn’t be registered. Nothing was created; please try again.');
      updateAccount(account.id, { organizationId: id, onboarding: 'complete' });
      return id;
    },
  }), [account, isDemo, findAccount, updateAccount, dispatch, getState, store.session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
