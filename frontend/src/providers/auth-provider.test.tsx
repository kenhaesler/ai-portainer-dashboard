import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { AUTH_TOKEN_KEY } from '@/shared/lib/auth-constants';
import { AuthProvider, useAuth, isTokenValid } from './auth-provider';

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
 * Builds an unsigned, base64url-encoded JWT-shaped string. The auth provider
 * decodes the payload via `atob` only — no signature verification — so any
 * three-part token with valid base64url JSON in segment 2 is accepted.
 */
function makeFakeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode(payload);
  return `${header}.${body}.fakesig`;
}

function buildToken({
  lifetimeSec,
  role = 'admin',
  issuedAtSec,
}: {
  lifetimeSec: number;
  role?: string;
  issuedAtSec?: number;
}): string {
  const iat = issuedAtSec ?? Math.floor(Date.now() / 1000);
  return makeFakeJwt({
    sub: 'user-123',
    username: 'testuser',
    sessionId: 'sess-1',
    role,
    iat,
    exp: iat + lifetimeSec,
  });
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

function ConsumeAuth() {
  const { isAuthenticated, role, username } = useAuth();
  return (
    <div>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="role">{role}</span>
      <span data-testid="username">{username ?? ''}</span>
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

describe('AuthProvider — refresh timer (issue #1106)', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockSetToken.mockReset();
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('schedules refresh ~10 min before expiry for a 60-min token', async () => {
    // For a 60-min token: target = max(exp - 10min, lifetime/2) = max(50min, 30min) = 50min.
    const baseSec = Math.floor(Date.now() / 1000);
    const initialToken = buildToken({ lifetimeSec: 60 * 60, issuedAtSec: baseSec });
    window.localStorage.setItem(AUTH_TOKEN_KEY, initialToken);
    window.localStorage.setItem(AUTH_USERNAME_KEY, 'testuser');
    window.localStorage.setItem(AUTH_ROLE_KEY, 'admin');

    const refreshToken = buildToken({
      lifetimeSec: 60 * 60,
      issuedAtSec: baseSec + 50 * 60,
    });
    mockPost.mockResolvedValue({ token: refreshToken });

    render(
      <AuthProvider>
        <ConsumeAuth />
      </AuthProvider>
    );

    // Just before the 50-min mark — no refresh fired yet.
    await act(async () => {
      vi.advanceTimersByTime(49 * 60 * 1000);
    });
    expect(mockPost).not.toHaveBeenCalled();

    // Past the 50-min mark — refresh fires.
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/auth/refresh');
  });

  it('schedules refresh at exp-10min for a 30-min token', async () => {
    const baseSec = Math.floor(Date.now() / 1000);
    const initialToken = buildToken({ lifetimeSec: 30 * 60, issuedAtSec: baseSec });
    window.localStorage.setItem(AUTH_TOKEN_KEY, initialToken);
    window.localStorage.setItem(AUTH_USERNAME_KEY, 'testuser');
    window.localStorage.setItem(AUTH_ROLE_KEY, 'admin');

    const refreshToken = buildToken({
      lifetimeSec: 30 * 60,
      issuedAtSec: baseSec + 20 * 60,
    });
    mockPost.mockResolvedValue({ token: refreshToken });

    render(
      <AuthProvider>
        <ConsumeAuth />
      </AuthProvider>
    );

    // 30-min token: target = max(exp-10min, lifetime/2) = max(20min, 15min) = 20min.
    // Just before 20 min — no fire.
    await act(async () => {
      vi.advanceTimersByTime(19 * 60 * 1000);
    });
    expect(mockPost).not.toHaveBeenCalled();

    // Past the 20-min mark — refresh fires.
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('refreshes near-immediately for very short tokens (5-min lifetime)', async () => {
    // For a 5-min token: target = max(exp-10min, lifetime/2) = max(-5min, 2.5min) = 2.5min.
    // Falls under the 30s-clamp once we're past 2min into the lifetime — but from
    // t=0 the timer is set for ~2.5min. The user-facing guarantee is that it
    // fires well within the token's lifetime (i.e., before the 5-min exp).
    const baseSec = Math.floor(Date.now() / 1000);
    const initialToken = buildToken({ lifetimeSec: 5 * 60, issuedAtSec: baseSec });
    window.localStorage.setItem(AUTH_TOKEN_KEY, initialToken);
    window.localStorage.setItem(AUTH_USERNAME_KEY, 'testuser');
    window.localStorage.setItem(AUTH_ROLE_KEY, 'admin');

    const refreshToken = buildToken({ lifetimeSec: 60 * 60, issuedAtSec: baseSec });
    mockPost.mockResolvedValue({ token: refreshToken });

    render(
      <AuthProvider>
        <ConsumeAuth />
      </AuthProvider>
    );

    // Should not fire before the half-life mark (2.5 min).
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(mockPost).not.toHaveBeenCalled();

    // Past the half-life — refresh fires (well before the 5-min expiry).
    await act(async () => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('refreshes immediately for tokens whose target is in the past (45s remaining)', async () => {
    // Hand-craft a token whose half-life and exp-10min targets are BOTH in
    // the past — remaining = 45s, half-life target = ~22s, exp-10min = ~-9.25min.
    // max(...) = 22.5s < 30s clamp → fire immediately.
    const nowSec = Math.floor(Date.now() / 1000);
    const initialToken = buildToken({
      lifetimeSec: 5 * 60,
      issuedAtSec: nowSec - (5 * 60 - 45),
    });
    window.localStorage.setItem(AUTH_TOKEN_KEY, initialToken);
    window.localStorage.setItem(AUTH_USERNAME_KEY, 'testuser');
    window.localStorage.setItem(AUTH_ROLE_KEY, 'admin');

    const refreshToken = buildToken({ lifetimeSec: 60 * 60, issuedAtSec: nowSec });
    mockPost.mockResolvedValue({ token: refreshToken });

    render(
      <AuthProvider>
        <ConsumeAuth />
      </AuthProvider>
    );

    // Drain the zero-delay setTimeout the effect just queued.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('re-arms the timer using the freshly-refreshed token exp', async () => {
    const baseSec = Math.floor(Date.now() / 1000);
    const initialToken = buildToken({ lifetimeSec: 60 * 60, issuedAtSec: baseSec });
    window.localStorage.setItem(AUTH_TOKEN_KEY, initialToken);
    window.localStorage.setItem(AUTH_USERNAME_KEY, 'testuser');
    window.localStorage.setItem(AUTH_ROLE_KEY, 'admin');

    const refreshTokenA = buildToken({
      lifetimeSec: 60 * 60,
      issuedAtSec: baseSec + 50 * 60,
    });
    const refreshTokenB = buildToken({
      lifetimeSec: 60 * 60,
      issuedAtSec: baseSec + 100 * 60,
    });

    mockPost
      .mockResolvedValueOnce({ token: refreshTokenA })
      .mockResolvedValueOnce({ token: refreshTokenB });

    render(
      <AuthProvider>
        <ConsumeAuth />
      </AuthProvider>
    );

    // First refresh fires ~50 min in.
    await act(async () => {
      vi.advanceTimersByTime(51 * 60 * 1000);
    });
    expect(mockPost).toHaveBeenCalledTimes(1);

    // Second refresh should fire ~50 min after the first (i.e., at total ~100 min).
    // Just before — only 1 call so far.
    await act(async () => {
      vi.advanceTimersByTime(48 * 60 * 1000);
    });
    expect(mockPost).toHaveBeenCalledTimes(1);

    // Past the second refresh window — second call fires.
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000);
    });
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('falls back to 50-min cadence when a refreshed token has no exp claim', async () => {
    // This test exercises the legacy-cadence safety net at
    // auth-provider.tsx:`return 50 * 60_000`. Reaching it requires
    // `decodeJwtPayload(jwt)` to yield a payload with no numeric `exp` AT THE
    // SCHEDULING SITE — but `getStoredAuth()` would reject a stored malformed
    // token via `isTokenValid()`, so we cannot hydrate the provider with one.
    //
    // The realistic path: hydrate with a valid token, let the first refresh
    // fire on schedule, and have the server return a malformed token (no
    // `exp`). The refresh handler calls `setToken(data.token)` without
    // re-validating, so the effect re-runs against the malformed token and
    // hits the fallback. We then advance another 50 min and assert a second
    // refresh fires — proving the fallback cadence is in effect (and not, for
    // example, an immediate refresh due to `targetMs < 30s`).
    const baseSec = Math.floor(Date.now() / 1000);
    const initialToken = buildToken({ lifetimeSec: 60 * 60, issuedAtSec: baseSec });
    window.localStorage.setItem(AUTH_TOKEN_KEY, initialToken);
    window.localStorage.setItem(AUTH_USERNAME_KEY, 'testuser');
    window.localStorage.setItem(AUTH_ROLE_KEY, 'admin');

    // First refresh response: a token with NO `exp` claim. `decodeJwtPayload`
    // will succeed (valid base64url JSON) but `payload.exp` is undefined, so
    // `computeRefreshDelayMs` falls through to `return 50 * 60_000`.
    const malformedToken = makeFakeJwt({
      sub: 'user-123',
      username: 'testuser',
      sessionId: 'sess-1',
      role: 'admin',
      // exp omitted on purpose
    });
    // Second refresh response: a fresh valid token (just so the effect doesn't
    // crash if it re-arms again — we only assert the *count* of refresh calls).
    const validRefreshToken = buildToken({
      lifetimeSec: 60 * 60,
      issuedAtSec: baseSec + 100 * 60,
    });

    mockPost
      .mockResolvedValueOnce({ token: malformedToken })
      .mockResolvedValueOnce({ token: validRefreshToken });

    render(
      <AuthProvider>
        <ConsumeAuth />
      </AuthProvider>
    );

    // First refresh fires at the 50-min mark for the initial 60-min token.
    await act(async () => {
      vi.advanceTimersByTime(51 * 60 * 1000);
    });
    // Drain the awaited promise so setToken(malformedToken) commits and the
    // effect re-runs with the fallback delay.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockPost).toHaveBeenCalledTimes(1);

    // The malformed token has no exp → fallback is exactly 50 * 60_000 ms.
    // Advance 49 min — fallback timer must NOT have fired yet.
    await act(async () => {
      vi.advanceTimersByTime(49 * 60 * 1000);
    });
    expect(mockPost).toHaveBeenCalledTimes(1);

    // Advance past the 50-min fallback mark — second refresh must fire,
    // proving the legacy 50-min cadence was scheduled (not an immediate
    // refresh, not "never fires", not a different cadence).
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('logs out when the refresh request fails', async () => {
    const baseSec = Math.floor(Date.now() / 1000);
    const initialToken = buildToken({ lifetimeSec: 60 * 60, issuedAtSec: baseSec });
    window.localStorage.setItem(AUTH_TOKEN_KEY, initialToken);
    window.localStorage.setItem(AUTH_USERNAME_KEY, 'testuser');
    window.localStorage.setItem(AUTH_ROLE_KEY, 'admin');

    mockPost.mockRejectedValue(new Error('refresh failed'));

    const { getByTestId } = render(
      <AuthProvider>
        <ConsumeAuth />
      </AuthProvider>
    );

    expect(getByTestId('authed').textContent).toBe('true');

    await act(async () => {
      vi.advanceTimersByTime(51 * 60 * 1000);
    });
    // Drain the rejected promise's then chain.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockPost).toHaveBeenCalled();
    expect(getByTestId('authed').textContent).toBe('false');
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(mockSetToken).toHaveBeenCalledWith(null);
  });
});

describe('isTokenValid (#1106 dependency)', () => {
  it('returns false for a null token', () => {
    expect(isTokenValid(null)).toBe(false);
  });

  it('returns true for a non-expired token', () => {
    const token = buildToken({ lifetimeSec: 60 * 60 });
    expect(isTokenValid(token)).toBe(true);
  });

  it('returns false for an expired token', () => {
    const baseSec = Math.floor(Date.now() / 1000) - 10 * 60 * 60;
    const token = buildToken({ lifetimeSec: 60 * 60, issuedAtSec: baseSec });
    expect(isTokenValid(token)).toBe(false);
  });
});
