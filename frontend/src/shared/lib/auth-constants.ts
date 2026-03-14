import { api } from './api';

export const AUTH_TOKEN_KEY = 'auth_token';

/**
 * Checks whether a valid auth token is currently held — first checks the in-memory
 * API client token, then falls back to localStorage. Preserves the two-step pattern
 * used across the dashboard hooks.
 */
export function hasAuthToken(): boolean {
  const apiToken = typeof (api as { getToken?: () => string | null }).getToken === 'function'
    ? api.getToken()
    : null;
  if (apiToken) return true;
  try {
    return !!window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return false;
  }
}
