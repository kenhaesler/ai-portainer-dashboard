import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api';

interface AuthContextType {
  isAuthenticated: boolean;
  username: string | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const login = useCallback(async (user: string, password: string) => {
    const data = await api.post<{ token: string; username: string }>(
      '/api/auth/login',
      { username: user, password }
    );
    setToken(data.token);
    setUsername(data.username);
    api.setToken(data.token);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Ignore logout errors
    }
    setToken(null);
    setUsername(null);
    api.setToken(null);
  }, []);

  // Listen for auth expired events
  useEffect(() => {
    const handler = () => {
      setToken(null);
      setUsername(null);
    };
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, []);

  // Token refresh timer
  useEffect(() => {
    if (!token) return;
    // Refresh at 50 minutes of 60 minute expiry
    const timer = setInterval(async () => {
      try {
        const data = await api.post<{ token: string }>('/api/auth/refresh');
        setToken(data.token);
        api.setToken(data.token);
      } catch {
        setToken(null);
        setUsername(null);
        api.setToken(null);
      }
    }, 50 * 60 * 1000);

    return () => clearInterval(timer);
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!token,
        username,
        token,
        login,
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
