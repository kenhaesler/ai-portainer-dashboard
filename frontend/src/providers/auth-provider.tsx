import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api';

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USERNAME_KEY = 'auth_username';
const AUTH_ROLE_KEY = 'auth_role';

export type UserRole = 'viewer' | 'operator' | 'admin';

interface AuthContextType {
  isAuthenticated: boolean;
  username: string | null;
  token: string | null;
  role: UserRole;
  login: (username: string, password: string) => Promise<void>;
  loginWithToken: (token: string, username: string, role?: UserRole) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getStoredAuth(): { token: string | null; username: string | null; role: UserRole } {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const username = localStorage.getItem(AUTH_USERNAME_KEY);
    const role = (localStorage.getItem(AUTH_ROLE_KEY) as UserRole) || 'viewer';
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
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.role || 'viewer';
  } catch {
    return 'viewer';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredAuth().token);
  const [username, setUsername] = useState<string | null>(() => getStoredAuth().username);
  const [role, setRole] = useState<UserRole>(() => getStoredAuth().role);

  // Initialize API client with stored token on mount
  useEffect(() => {
    if (token) {
      api.setToken(token);
    }
  }, []);

  const login = useCallback(async (user: string, password: string) => {
    const data = await api.post<{ token: string; username: string }>(
      '/api/auth/login',
      { username: user, password }
    );
    const userRole = parseRoleFromToken(data.token);
    setToken(data.token);
    setUsername(data.username);
    setRole(userRole);
    storeAuth(data.token, data.username, userRole);
    api.setToken(data.token);
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
