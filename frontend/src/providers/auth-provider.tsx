import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '@/shared/lib/api';

const AUTH_TOKEN_KEY = 'auth_token';
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

function isTokenValid(token: string | null): token is string {
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

  // Token refresh timer
  useEffect(() => {
    if (!token || !username) return;
    // Refresh at 50 minutes of 60 minute expiry
    const timer = setInterval(async () => {
      try {
        const data = await api.post<{ token: string }>('/api/auth/refresh');
        const refreshedRole = parseRoleFromToken(data.token);
        setToken(data.token);
        setRole(refreshedRole);
        storeAuth(data.token, username, refreshedRole);
        api.setToken(data.token);
      } catch {
        setToken(null);
        setUsername(null);
        setRole('viewer');
        clearStoredAuth();
        api.setToken(null);
      }
    }, 50 * 60 * 1000);

    return () => clearInterval(timer);
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
