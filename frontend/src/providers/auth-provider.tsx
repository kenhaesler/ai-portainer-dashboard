import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api';

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USERNAME_KEY = 'auth_username';

interface AuthContextType {
  isAuthenticated: boolean;
  username: string | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  loginWithToken: (token: string, username: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getStoredAuth(): { token: string | null; username: string | null } {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const username = localStorage.getItem(AUTH_USERNAME_KEY);
    return { token, username };
  } catch {
    return { token: null, username: null };
  }
}

function storeAuth(token: string, username: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USERNAME_KEY, username);
  } catch {
    // Ignore storage errors (e.g., private browsing)
  }
}

function clearStoredAuth(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USERNAME_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredAuth().token);
  const [username, setUsername] = useState<string | null>(() => getStoredAuth().username);

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
    setToken(data.token);
    setUsername(data.username);
    storeAuth(data.token, data.username);
    api.setToken(data.token);
  }, []);

  const loginWithToken = useCallback((newToken: string, newUsername: string) => {
    setToken(newToken);
    setUsername(newUsername);
    storeAuth(newToken, newUsername);
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
        setToken(data.token);
        storeAuth(data.token, username);
        api.setToken(data.token);
      } catch {
        setToken(null);
        setUsername(null);
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
