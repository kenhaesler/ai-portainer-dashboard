import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '@/shared/lib/api';
import { AUTH_TOKEN_KEY } from '@/shared/lib/auth-constants';
const AUTH_USERNAME_KEY = 'auth_username';
const AUTH_ROLE_KEY = 'auth_role';

export type UserRole = 'viewer' | 'operator' | 'admin';

interface AuthContextType {
  isAuthenticated: boolean;
  username: string | null;
  token: string | null;
  role: UserRole;
  login: (username: string, password: string) => Promise<{ defaultLandingPage: string }>;
  loginWithToken: (token: string, username: string, role?: UserRole) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isTokenValid(token: string | null): token is string {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const exp = payload.exp;
  if (typeof exp !== 'number') return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp > nowSeconds;
}

function getStoredAuth(): { token: string | null; username: string | null; role: UserRole } {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const username = localStorage.getItem(AUTH_USERNAME_KEY);
    const role = (localStorage.getItem(AUTH_ROLE_KEY) as UserRole) || 'viewer';
    if (!isTokenValid(token) || !username) {
      clearStoredAuth();
      return { token: null, username: null, role: 'viewer' };
    }
    return { token, username, role };
  } catch {
    return { token: null, username: null, role: 'viewer' };
  }
}

function storeAuth(token: string, username: string, role: UserRole): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USERNAME_KEY, username);
    localStorage.setItem(AUTH_ROLE_KEY, role);
  } catch {
    // Ignore storage errors (e.g., private browsing)
  }
}

function clearStoredAuth(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USERNAME_KEY);
    localStorage.removeItem(AUTH_ROLE_KEY);
  } catch {
    // Ignore storage errors
  }
}

function parseRoleFromToken(token: string): UserRole {
  const payload = decodeJwtPayload(token);
  if (!payload) return 'viewer';
  const role = payload.role;
  return role === 'admin' || role === 'operator' || role === 'viewer' ? role : 'viewer';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initialAuth] = useState(() => getStoredAuth());
  const [token, setToken] = useState<string | null>(initialAuth.token);
  const [username, setUsername] = useState<string | null>(initialAuth.username);
  const [role, setRole] = useState<UserRole>(initialAuth.role);

  const login = useCallback(async (user: string, password: string) => {
    const data = await api.post<{ token: string; username: string; defaultLandingPage?: string }>(
      '/api/auth/login',
      { username: user, password }
    );
    const userRole = parseRoleFromToken(data.token);
    setToken(data.token);
    setUsername(data.username);
    setRole(userRole);
    storeAuth(data.token, data.username, userRole);
    api.setToken(data.token);
    return { defaultLandingPage: data.defaultLandingPage || '/' };
  }, []);

  const loginWithToken = useCallback((newToken: string, newUsername: string, newRole?: UserRole) => {
    const userRole = newRole || parseRoleFromToken(newToken);
    setToken(newToken);
    setUsername(newUsername);
    setRole(userRole);
    storeAuth(newToken, newUsername, userRole);
    api.setToken(newToken);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Ignore logout errors
    }
    setToken(null);
    setUsername(null);
    setRole('viewer');
    clearStoredAuth();
    api.setToken(null);
  }, []);

  // Listen for auth expired events
  useEffect(() => {
    const handler = () => {
      setToken(null);
      setUsername(null);
      setRole('viewer');
      clearStoredAuth();
    };
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, []);

  // Keep API client auth state synchronized with provider state, including initial load.
  useEffect(() => {
    api.setToken(token);
  }, [token]);

  // Token refresh timer — schedules itself based on the JWT `exp` claim so the
  // refresh cadence tracks the configured `JWT_TOKEN_EXPIRY_MINUTES` server-side
  // without requiring a separate config endpoint. Re-arms after each refresh
  // by recomputing the next firing time from the new token's `exp`.
  useEffect(() => {
    if (!token || !username) return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const computeRefreshDelayMs = (jwt: string): number => {
      const payload = decodeJwtPayload(jwt);
      const expSec = typeof payload?.exp === 'number' ? payload.exp : 0;
      if (!expSec) {
        // Decoding failed or missing exp — fall back to legacy 50-min cadence.
        return 50 * 60_000;
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const remainingMs = (expSec - nowSec) * 1000;
      // Refresh 10 min before expiry, OR at half-life if the lifetime is short
      // enough that exp-10min falls before the half-life mark. Math.max picks
      // whichever target is LATER (i.e., we wait as long as safely possible).
      const earlyMs = remainingMs - 10 * 60_000;
      const halfLifeMs = Math.floor(remainingMs / 2);
      const targetMs = Math.max(earlyMs, halfLifeMs);
      // If we're already past (or within 30s of) the target, refresh immediately.
      if (targetMs < 30_000) return 0;
      return targetMs;
    };

    const scheduleNext = (currentToken: string) => {
      if (cancelled) return;
      const delay = computeRefreshDelayMs(currentToken);
      timerId = setTimeout(async () => {
        if (cancelled) return;
        try {
          const data = await api.post<{ token: string }>('/api/auth/refresh');
          if (cancelled) return;
          const refreshedRole = parseRoleFromToken(data.token);
          setToken(data.token);
          setRole(refreshedRole);
          storeAuth(data.token, username, refreshedRole);
          api.setToken(data.token);
          scheduleNext(data.token);
        } catch {
          if (cancelled) return;
          setToken(null);
          setUsername(null);
          setRole('viewer');
          clearStoredAuth();
          api.setToken(null);
        }
      }, delay);
    };

    scheduleNext(token);

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [token, username]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!token,
        username,
        token,
        role,
        login,
        loginWithToken,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
