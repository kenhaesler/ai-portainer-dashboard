import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { AUTH_TOKEN_KEY } from '@/shared/lib/auth-constants';
import { AuthProvider, useAuth } from './auth-provider';

const mockPost = vi.fn();
const mockSetToken = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
    setToken: (...args: unknown[]) => mockSetToken(...args),
    getToken: () => null,
  },
}));

const AUTH_USERNAME_KEY = 'auth_username';
const AUTH_ROLE_KEY = 'auth_role';

/**
 * Build a JWT-shaped token (`header.payload.signature`) whose payload has the
 * given role and an `exp` claim 1 hour in the future. The auth provider only
 * inspects the payload via base64-decoding the second segment, so a real
 * signature is unnecessary.
 */
function makeJwt(role: 'admin' | 'operator' | 'viewer'): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const payload = btoa(
    JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600 }),
  )
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${payload}.signature`;
}

/**
 * Test consumer that exposes the auth context state through DOM attributes so
 * tests can assert on it without re-implementing the provider's hook plumbing.
 */
function AuthConsumer() {
  const { role, token, isAuthenticated, login, loginWithToken, logout } = useAuth();
  return (
    <div
      data-testid="auth-state"
      data-role={role}
      data-token={token ?? ''}
      data-authenticated={isAuthenticated ? 'true' : 'false'}
    >
      <button
        data-testid="login-with-token"
        onClick={() => loginWithToken(makeJwt('admin'), 'alice', 'admin')}
      >
        login-with-token
      </button>
      <button
        data-testid="login"
        onClick={() => {
          void login('alice', 'pw');
        }}
      >
        login
      </button>
      <button
        data-testid="logout"
        onClick={() => {
          void logout();
        }}
      >
        logout
      </button>
    </div>
  );
}

describe('AuthProvider — logout (regression for #957)', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockSetToken.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('resets role to "viewer", clears token, and wipes localStorage after logout from admin', async () => {
    // Logout posts to /api/auth/logout — make it succeed so we exercise the
    // happy path, but the test should also pass if it errors (see next test).
    mockPost.mockResolvedValue(undefined);

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    // Establish an authenticated admin session.
    await act(async () => {
      getByTestId('login-with-token').click();
    });

    const stateAfterLogin = getByTestId('auth-state');
    expect(stateAfterLogin.dataset.role).toBe('admin');
    expect(stateAfterLogin.dataset.authenticated).toBe('true');
    expect(stateAfterLogin.dataset.token).not.toBe('');
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(AUTH_USERNAME_KEY)).toBe('alice');
    expect(window.localStorage.getItem(AUTH_ROLE_KEY)).toBe('admin');

    // Now log out and verify the post-logout state matches the regression
    // contract: role MUST reset to 'viewer' (#957), token cleared, no auth.
    await act(async () => {
      getByTestId('logout').click();
    });

    const stateAfterLogout = getByTestId('auth-state');
    expect(stateAfterLogout.dataset.role).toBe('viewer');
    expect(stateAfterLogout.dataset.token).toBe('');
    expect(stateAfterLogout.dataset.authenticated).toBe('false');

    // Critic recommendation E2: assert localStorage is wiped so this test also
    // catches regressions in the auth:expired handler (which shares state).
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(window.localStorage.getItem(AUTH_USERNAME_KEY)).toBeNull();
    expect(window.localStorage.getItem(AUTH_ROLE_KEY)).toBeNull();

    // The API client should have been told to drop the token too.
    expect(mockSetToken).toHaveBeenCalledWith(null);
    // /api/auth/logout was attempted (best-effort fire-and-forget).
    expect(mockPost).toHaveBeenCalledWith('/api/auth/logout');
  });

  it('still resets state to "viewer" when /api/auth/logout fails (best-effort)', async () => {
    // The provider intentionally swallows logout HTTP errors so that a failing
    // backend cannot strand the user in an admin session client-side.
    mockPost.mockRejectedValue(new Error('network down'));

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      getByTestId('login-with-token').click();
    });
    expect(getByTestId('auth-state').dataset.role).toBe('admin');

    await act(async () => {
      getByTestId('logout').click();
    });

    const state = getByTestId('auth-state');
    expect(state.dataset.role).toBe('viewer');
    expect(state.dataset.token).toBe('');
    expect(state.dataset.authenticated).toBe('false');
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });
});
