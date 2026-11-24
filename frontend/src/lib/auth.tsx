import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { get, post, setToken, getToken, askOtherTabsForToken, setUnauthorizedHandler } from './api';

export interface User { permissions?: string[]; credentialSet?: boolean; id: string; email: string; phone: string | null; fullName: string; role: 'customer' | 'owner' | 'admin' | 'staff'; adminRole: string | null; emailVerified: boolean; phoneVerified: boolean }
interface AuthCtx {
  user: User | null; loading: boolean;
  login(email: string, password: string, remember?: boolean): Promise<User>;
  googleLogin(credential: string, opts?: { create?: boolean; role?: 'customer' | 'owner'; businessName?: string; expect?: 'customer' | 'owner' }): Promise<User>;
  register(input: Record<string, unknown>): Promise<User>;
  logout(): void; refresh(): Promise<void>; setUser(u: User): void;
}
const Ctx = createContext<AuthCtx>(null as never);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const qc = useQueryClient();

  const logout = useCallback(() => { setToken(null); setUser(null); qc.clear(); }, [qc]);
  const refresh = useCallback(async () => { const r = await get<{ user: User }>('/auth/me'); setUser(r.user); }, []);

  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);
  useEffect(() => {
    let live = true;
    (async () => {
      if (!getToken()) { // a new tab of the same open browser: an open tab shares its login
        if (!(await askOtherTabsForToken()) || !live) return;
        setLoading(true);
      }
      // only a rejected session signs out; a slow network, a busy server or "too many requests" keeps the login
      for (let i = 0; i < 3 && live; i++) { // a busy server or a weak network: try again a moment later before giving up
        try { await refresh(); break; }
        catch (e: any) { if (e?.response?.status === 401 || e?.response?.status === 403) { setToken(null); break; } await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
      }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [refresh]);

  const value = useMemo<AuthCtx>(() => ({
    user, loading, logout, refresh, setUser,
    async login(email, password, remember = true) {
      const r = await post<{ token: string; user: User }>('/auth/login', { email, password, remember });
      setToken(r.token, remember); setUser(r.user); return r.user;
    },
    async googleLogin(credential, opts = {}) {
      const r = await post<{ token: string; user: User }>('/auth/google', { credential, ...opts });
      setToken(r.token); setUser(r.user); return r.user;
    },
    async register(input) {
      const r = await post<{ token: string; user: User }>('/auth/register', input);
      setToken(r.token); setUser(r.user); return r.user;
    },
  }), [user, loading, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const homeFor = (u: User) => (u.role === 'admin' ? '/admin' : u.role === 'owner' ? '/owner' : u.role === 'staff' ? '/staff' : '/');

/** Customers who joined with Google have no mobile number yet; they finish that step before anything else. */
export const needsMobile = (u: User) => u.role === 'customer' && !u.phone;

/** A customer must confirm their email with a code before using the customer pages. */
export const needsEmailVerification = (u: User) => u.role === 'customer' && !u.emailVerified;
/** Where to send someone right after they sign in: finish the profile, verify the email, or carry on to where they were going. */
export function landing(u: User, from?: string): { to: string; state?: { from: string } } {
  const state = from ? { from } : undefined;
  if (needsMobile(u)) return { to: '/complete-profile', state };
  if (needsEmailVerification(u)) return { to: '/verify-account', state };
  return { to: from ?? homeFor(u) };
}
