/**
 * Security Regression — JWT / Session Configuration
 *
 * Verifies JWT verification hardening + boot-time validation of session
 * lifecycle env vars:
 *   • verifyJwt observable contract — returns null, never throws — for
 *     tampered, wrong-algorithm, expired, sub-less, and operational-failure
 *     tokens (#1109, #1120)
 *   • JWT_TOKEN_EXPIRY_MINUTES schema bounds (#1106)
 *   • MAX_CONCURRENT_SESSIONS_PER_USER schema bounds (#1107)
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1106
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1107
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1109
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1120
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1188 (split)
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';

// Passthrough mock — keeps the real implementations so verifyJwt-hardening
// tests below exercise actual jose behaviour, while still allowing tests
// to spy on / override individual functions.
vi.mock('@dashboard/core/utils/crypto.js', async (importOriginal) => await importOriginal());

// =====================================================================
//  verifyJwt hardening — Issues #1109, #1120 (regression contract tests)
// =====================================================================
//
// Two related security fixes verified together:
//   #1109: bare `catch {}` in verifyJwt swallowed unexpected errors (e.g. key
//          import failure, missing PEM file). These must surface in logs at
//          'error' level so operators can react. Routine "invalid token"
//          failures (jose-class errors) must remain silent — no log spam on
//          every failed login attempt.
//   #1120: jwtVerify was called without explicit `algorithms` and
//          `requiredClaims`. Adds defense-in-depth against algorithm-confusion
//          attacks and tokens missing standard claims (`sub`, `exp`, `iat`).
//
// These regression tests verify the OBSERVABLE contract (verifyJwt returns
// null and never throws) for each failure mode. The "logs error vs. silent"
// assertion is covered alongside the implementation in
// packages/core/src/utils/crypto.test.ts where the logger is directly
// observable.
describe('verifyJwt hardening (#1109, #1120)', () => {
  let realCrypto: typeof import('@dashboard/core/utils/crypto.js');
  let jose: typeof import('jose');
  const JWT_SECRET = 'a'.repeat(64);

  beforeAll(async () => {
    realCrypto = await import('@dashboard/core/utils/crypto.js');
    jose = await import('jose');
  });

  beforeEach(() => {
    realCrypto._resetKeyCache();
    setConfigForTest({
      JWT_ALGORITHM: 'HS256',
      JWT_SECRET,
    });
  });

  afterAll(() => {
    realCrypto._resetKeyCache();
  });

  it('returns null when signature is tampered (#1109)', async () => {
    const validToken = await realCrypto.signJwt({
      sub: 'user-1',
      username: 'admin',
      sessionId: 'sess-1',
    });
    const tampered = validToken.slice(0, -5) + 'XXXXX';

    const result = await realCrypto.verifyJwt(tampered);

    expect(result).toBeNull();
  });

  it('returns null for token signed with wrong algorithm (#1120 — algorithm-confusion defence)', async () => {
    // Sign a token with HS512 while verifyJwt is configured for HS256.
    // Without the explicit `algorithms` option (issue #1120), jose v5 would
    // accept this token because the signature is valid for the same key.
    // With the option, jose throws JOSEAlgNotAllowed — verifyJwt returns null.
    const key = new TextEncoder().encode(JWT_SECRET);
    const wrongAlgToken = await new jose.SignJWT({
      sub: 'user-1',
      username: 'admin',
      sessionId: 'sess-1',
    })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuedAt()
      .setExpirationTime('60m')
      .sign(key);

    const result = await realCrypto.verifyJwt(wrongAlgToken);

    expect(result).toBeNull();
  });

  it('returns null for an expired token (#1109)', async () => {
    const key = new TextEncoder().encode(JWT_SECRET);
    const expiredToken = await new jose.SignJWT({
      sub: 'user-1',
      username: 'admin',
      sessionId: 'sess-1',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // iat 2h ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // exp 1h ago
      .sign(key);

    const result = await realCrypto.verifyJwt(expiredToken);

    expect(result).toBeNull();
  });

  it('returns null for token missing the required `sub` claim (#1120)', async () => {
    // requiredClaims: ['sub', 'exp', 'iat'] — omitting `sub` should trip
    // JWTClaimValidationFailed; verifyJwt swallows and returns null.
    const key = new TextEncoder().encode(JWT_SECRET);
    const tokenNoSub = await new jose.SignJWT({
      username: 'admin',
      sessionId: 'sess-1',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('60m')
      .sign(key);

    const result = await realCrypto.verifyJwt(tokenNoSub);

    expect(result).toBeNull();
  });

  it('returns null without throwing when an unexpected (non-JOSE) error occurs (#1109)', async () => {
    // Force getVerifyKey to throw a non-JOSE error by switching JWT_ALGORITHM
    // to RS256 and pointing at a non-existent public-key file. readFileSync
    // will throw ENOENT (a Node SystemError, NOT a JOSEError). Pre-fix, the
    // bare `catch {}` would still return null but silently — the logger
    // assertion lives in crypto.test.ts. Here we only verify the contract:
    // verifyJwt must NOT throw, and must return null, even on operational
    // failures.
    realCrypto._resetKeyCache();
    setConfigForTest({
      JWT_ALGORITHM: 'RS256',
      JWT_PUBLIC_KEY_PATH: '/nonexistent/path/to/public-key.pem',
    });

    let threw = false;
    let result: unknown = 'not-set';
    try {
      result = await realCrypto.verifyJwt('any-token-value');
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1106 — JWT_TOKEN_EXPIRY_MINUTES env-var boundary regression.
// Confirms the schema rejects out-of-bound values at boot, and that the in-test
// override surface (setConfigForTest) accepts the documented bounds. The
// crypto module is mocked file-wide so the lifetime-propagation assertions
// live in `packages/core/src/utils/crypto.test.ts` and
// `packages/core/src/services/session-store.test.ts`.
//
// NOTE: This describe block calls vi.resetModules() in beforeEach to force
// fresh re-parses of the env schema. Splitting it into its own file (instead
// of leaving it at the END of a monolithic file) means the resetModules()
// here can no longer break sibling describe blocks via cross-file pollution.
// ─────────────────────────────────────────────────────────────────────────────
describe('JWT_TOKEN_EXPIRY_MINUTES boundaries (issue #1106)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PORTAINER_API_KEY = 'test-portainer-api-key';
    process.env.DASHBOARD_USERNAME = 'admin';
    process.env.DASHBOARD_PASSWORD = 'replace-with-strong-random-passphrase';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  it('boots with default 60 when unset', async () => {
    delete process.env.JWT_TOKEN_EXPIRY_MINUTES;

    const { getConfig } = await import('@dashboard/core/config/index.js');
    expect(getConfig().JWT_TOKEN_EXPIRY_MINUTES).toBe(60);
  });

  it('accepts 5 (lower bound)', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '5';

    const { getConfig } = await import('@dashboard/core/config/index.js');
    expect(getConfig().JWT_TOKEN_EXPIRY_MINUTES).toBe(5);
  });

  it('rejects 4 at boot', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '4';

    const { getConfig } = await import('@dashboard/core/config/index.js');
    expect(() => getConfig()).toThrowError(/JWT_TOKEN_EXPIRY_MINUTES/i);
  });

  it('accepts 1440 (upper bound)', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '1440';

    const { getConfig } = await import('@dashboard/core/config/index.js');
    expect(getConfig().JWT_TOKEN_EXPIRY_MINUTES).toBe(1440);
  });

  it('rejects 1441 at boot', async () => {
    process.env.JWT_TOKEN_EXPIRY_MINUTES = '1441';

    const { getConfig } = await import('@dashboard/core/config/index.js');
    expect(() => getConfig()).toThrowError(/JWT_TOKEN_EXPIRY_MINUTES/i);
  });
});

// =====================================================================
//  MAX_CONCURRENT_SESSIONS_PER_USER (#1107)
// =====================================================================
// Boot-time validation of the new env var. The atomic-eviction behaviour
// itself is covered in packages/core/src/services/session-store.test.ts
// and session-store.integration.test.ts (real PostgreSQL).
describe('MAX_CONCURRENT_SESSIONS_PER_USER env validation (#1107)', () => {
  it('accepts the documented default of 5', async () => {
    const { envSchema } = await import('@dashboard/core/config/env.schema.js');
    const result = envSchema.safeParse({
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'this-is-a-strong-password-1234',
      JWT_SECRET: 'a'.repeat(32),
      MAX_CONCURRENT_SESSIONS_PER_USER: '5',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MAX_CONCURRENT_SESSIONS_PER_USER).toBe(5);
    }
  });

  it('falls back to default when env var is unset', async () => {
    const { envSchema } = await import('@dashboard/core/config/env.schema.js');
    const result = envSchema.safeParse({
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'this-is-a-strong-password-1234',
      JWT_SECRET: 'a'.repeat(32),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MAX_CONCURRENT_SESSIONS_PER_USER).toBe(5);
    }
  });

  it('rejects negative values at boot', async () => {
    const { envSchema } = await import('@dashboard/core/config/env.schema.js');
    const result = envSchema.safeParse({
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'this-is-a-strong-password-1234',
      JWT_SECRET: 'a'.repeat(32),
      MAX_CONCURRENT_SESSIONS_PER_USER: '-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('MAX_CONCURRENT_SESSIONS_PER_USER');
    }
  });

  it('rejects zero (must be at least 1)', async () => {
    const { envSchema } = await import('@dashboard/core/config/env.schema.js');
    const result = envSchema.safeParse({
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'this-is-a-strong-password-1234',
      JWT_SECRET: 'a'.repeat(32),
      MAX_CONCURRENT_SESSIONS_PER_USER: '0',
    });
    expect(result.success).toBe(false);
  });

  it('rejects values above the upper bound (101)', async () => {
    const { envSchema } = await import('@dashboard/core/config/env.schema.js');
    const result = envSchema.safeParse({
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'this-is-a-strong-password-1234',
      JWT_SECRET: 'a'.repeat(32),
      MAX_CONCURRENT_SESSIONS_PER_USER: '101',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer values', async () => {
    const { envSchema } = await import('@dashboard/core/config/env.schema.js');
    const result = envSchema.safeParse({
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'this-is-a-strong-password-1234',
      JWT_SECRET: 'a'.repeat(32),
      MAX_CONCURRENT_SESSIONS_PER_USER: '3.5',
    });
    expect(result.success).toBe(false);
  });
});
