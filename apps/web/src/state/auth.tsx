import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiRequest, refreshAccessToken, setAccessToken } from '../api/client.js';
import type { AuthUser, LoginResponse } from '../api/types.js';

interface AuthState {
  user: AuthUser | null;
  /**
   * `restoring` = on first load we are asking the API whether the httpOnly refresh cookie still represents a valid
   * session (so a page reload does not log the user out). The UI shows a spinner, never the login form, meanwhile.
   */
  status: 'restoring' | 'authenticated' | 'unauthenticated';
  /** Throws the `ApiError` (or network error) on failure - the LOGIN form turns it into a message. */
  login: (loginId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * The access token lives only in memory (never localStorage). The refresh token is an httpOnly cookie the browser
 * sends automatically. On mount we try one silent refresh + `GET /auth/me`; if either fails the user sees the login
 * page. See `src/LOGIN/LOGIN.md`.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('restoring');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // refreshAccessToken() de-duplicates concurrent calls, so React StrictMode's double mount costs one request.
        if (!(await refreshAccessToken())) throw new Error('no session');
        const res = await apiRequest<{ user: AuthUser }>('/auth/me', { skipAuthRetry: true });
        if (cancelled) return;
        setUser(res.user);
        setStatus('authenticated');
      } catch {
        setAccessToken(null);
        if (!cancelled) setStatus('unauthenticated');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (loginId: string, password: string) => {
    const res = await apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { loginId, password },
      skipAuthRetry: true,
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST', skipAuthRetry: true });
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo(() => ({ user, status, login, logout }), [user, status, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
