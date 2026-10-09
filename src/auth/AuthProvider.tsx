import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { countryByCode } from '@/data/countries';
import { DEMO_ADMIN, NEW_ORGANIZATION_ID } from '@/data/seed';
import type { AdminUser, CardDesign, Organization } from '@/domain/types';
import { useStore } from '@/store/AppStore';
import {
  DEMO_ACCOUNT, DEMO_AUTH_ENABLED, hashPassword, loadAuth, newSession, normalizeEmail, passwordMatches, randomToken, saveAuth, saveSignup,
  type Account, type AuthSession, type AuthStore,
} from './authCore';

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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const displayName = (a: Pick<Account, 'firstName' | 'lastName' | 'email'>) =>
  [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || a.email;

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** Where an account belongs next: an onboarding step or the app. */
export function homeFor(account: Account): string {
  if (account.onboarding === 'personal') return '/onboarding/personal';
  if (account.onboarding === 'organization') return '/onboarding/organization';
  return '/';
}

export function AuthProvider({ children, initialSession }: { children: ReactNode; initialSession?: AuthSession | null }) {
  const { state, dispatch } = useStore();
  const [store, setStore] = useState<AuthStore>(() => {
    const loaded = loadAuth();
    return initialSession === undefined ? loaded : { ...loaded, session: initialSession };
  });
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => { saveAuth(store); }, [store]);

  const findAccount = useCallback((email: string): Account | undefined => {
    const e = normalizeEmail(email);
    if (DEMO_AUTH_ENABLED && e === DEMO_ACCOUNT.email) return DEMO_ACCOUNT;
    return storeRef.current.accounts.find((a) => a.email === e);
  }, []);

  const account = useMemo(() => {
    const id = store.session?.accountId;
    if (!id) return null;
    if (DEMO_AUTH_ENABLED && id === DEMO_ACCOUNT.id) return DEMO_ACCOUNT;
    return store.accounts.find((a) => a.id === id) ?? null;
  }, [store]);
  const isDemo = account?.id === DEMO_ACCOUNT.id;

  // Keep the workspace (signed-in administrator and organization) in step with the account.
  const orgs = state.data.organizations;
  useEffect(() => {
    if (!account || account.onboarding !== 'complete') return;
    let admin: AdminUser;
    let organizationId: string;
    if (isDemo) {
      const demoOrgIds = orgs.filter((o) => !o.ownerAccountId).map((o) => o.id);
      admin = { ...DEMO_ADMIN, organizationIds: demoOrgIds };
      organizationId = demoOrgIds.includes(state.session.currentOrganizationId) ? state.session.currentOrganizationId : NEW_ORGANIZATION_ID;
    } else {
      if (!account.organizationId || !orgs.some((o) => o.id === account.organizationId)) return;
      const name = displayName(account);
      admin = { id: account.id, name, initials: initialsOf(name), email: account.email, role: 'Owner', organizationIds: [account.organizationId] };
      organizationId = account.organizationId;
    }
    if (JSON.stringify(admin) !== JSON.stringify(state.data.admin) || organizationId !== state.session.currentOrganizationId) {
      dispatch({ type: 'session/signIn', admin, organizationId });
    }
  }, [account, isDemo, orgs, state.data.admin, state.session.currentOrganizationId, dispatch]);

  const updateAccount = useCallback((id: string, patch: Partial<Account>) => {
    setStore((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    account,
    isDemo,
    accountExists: (email) => !!findAccount(email),
    signIn: async (email, password) => {
      const found = findAccount(email);
      // Same message whether or not the account exists.
      if (!found || !(await passwordMatches(found, password))) return { ok: false, error: 'Incorrect email or password.' };
      setStore((s) => ({ ...s, session: newSession(found.id) }));
      return { ok: true, account: found };
    },
    signOut: () => {
      saveSignup(null);
      dispatch({ type: 'preview/stop' });
      setStore((s) => ({ ...s, session: null }));
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
      setStore((s) => ({ accounts: [...s.accounts, created], session: newSession(created.id) }));
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
    createOrganization: ({ name, countryCode, region }) => {
      if (!account || isDemo) throw new Error('Sign in to create an organization.');
      if (account.organizationId) return account.organizationId;
      const country = countryByCode(countryCode);
      const id = `org_${randomToken(6)}`;
      const at = new Date().toISOString();
      const clean = name.trim().replace(/\s+/g, ' ');
      const shortName = clean.split(' ').filter((w) => /[A-Za-z0-9]/.test(w[0] ?? '')).slice(0, 3).map((w) => w[0]!.toUpperCase()).join('') || clean.slice(0, 3).toUpperCase();
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
      updateAccount(account.id, { organizationId: id, onboarding: 'complete' });
      return id;
    },
  }), [account, isDemo, findAccount, updateAccount, dispatch]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
