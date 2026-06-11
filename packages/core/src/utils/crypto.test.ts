import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { signJwt, verifyJwt, hashPassword, comparePassword, constantTimeEqual, _resetKeyCache } from './crypto.js';
import { setConfigForTest, resetConfig } from '../config/index.js';

// Mock the relative logger module so that crypto.ts's `createChildLogger('crypto')`
// returns a vi.fn-backed object whose `error` calls are captured for assertion.
// vi.hoisted() ensures the captured child loggers map exists BEFORE the mock
// factory runs (vi.mock is hoisted above ordinary const declarations).
const { __cryptoLoggerHandle } = vi.hoisted(() => {
  const handle: { current: { error: ReturnType<typeof vi.fn> } | null } = { current: null };
  return { __cryptoLoggerHandle: handle };
});
vi.mock('./logger.js', () => {
  const make = () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => make()),
  });
  return {
    logger: make(),
    createChildLogger: vi.fn((name: string) => {
      const child = make();
      if (name === 'crypto') {
        __cryptoLoggerHandle.current = child;
      }
      return child;
    }),
  };
});

describe('crypto', () => {
  beforeEach(() => {
    _resetKeyCache();
  });

  afterEach(() => {
    resetConfig();
  });

  describe('JWT operations', () => {
    describe('signJwt', () => {
      it('should create a valid JWT token', async () => {
        const payload = {
          sub: 'user-123',
          username: 'admin',
          sessionId: 'session-456',
        };

        const token = await signJwt(payload);

        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
      });

      it('should create different tokens for different payloads', async () => {
        const token1 = await signJwt({ sub: 'user-1', username: 'admin1', sessionId: 'sess-1' });
        const token2 = await signJwt({ sub: 'user-2', username: 'admin2', sessionId: 'sess-2' });

        expect(token1).not.toBe(token2);
      });

      it('should use HS256 algorithm by default', async () => {
        const token = await signJwt({ sub: 'user-1', username: 'admin', sessionId: 'sess-1' });
        // Decode header to verify algorithm
        const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
        expect(header.alg).toBe('HS256');
      });
    });

    describe('verifyJwt', () => {
      it('should verify a valid token and return payload', async () => {
        const payload = {
          sub: 'user-123',
          username: 'testuser',
          sessionId: 'session-456',
        };

        const token = await signJwt(payload);
        const verified = await verifyJwt(token);

        expect(verified).not.toBeNull();
        expect(verified?.sub).toBe(payload.sub);
        expect(verified?.username).toBe(payload.username);
        expect(verified?.sessionId).toBe(payload.sessionId);
      });

      it('should return expiration time in payload', async () => {
        const payload = {
          sub: 'user-123',
          username: 'testuser',
          sessionId: 'session-456',
        };

        const token = await signJwt(payload);
        const verified = await verifyJwt(token);

        expect(verified?.exp).toBeDefined();
        expect(verified?.iat).toBeDefined();
        // Default lifetime is 60 min — exp - iat must equal that, regardless of clock skew.
        expect(verified!.exp - verified!.iat).toBe(60 * 60);
        expect(verified?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      });

      it('should sign with configured JWT_TOKEN_EXPIRY_MINUTES (issue #1106)', async () => {
        // Override config to a non-default lifetime and verify it propagates.
        setConfigForTest({ JWT_TOKEN_EXPIRY_MINUTES: 15 });

        const token = await signJwt({
          sub: 'user-1',
          username: 'admin',
          sessionId: 'sess-1',
        });
        const verified = await verifyJwt(token);

        expect(verified).not.toBeNull();
        // exp - iat should equal exactly 15 * 60 seconds (jose computes from iat).
        expect(verified!.exp - verified!.iat).toBe(15 * 60);
      });

      it('should sign with a 5-minute lifetime (issue #1106 lower bound)', async () => {
        setConfigForTest({ JWT_TOKEN_EXPIRY_MINUTES: 5 });

        const token = await signJwt({
          sub: 'user-1',
          username: 'admin',
          sessionId: 'sess-1',
        });
        const verified = await verifyJwt(token);

        expect(verified!.exp - verified!.iat).toBe(5 * 60);
      });

      it('should sign with a 1440-minute lifetime (issue #1106 upper bound)', async () => {
        setConfigForTest({ JWT_TOKEN_EXPIRY_MINUTES: 1440 });

        const token = await signJwt({
          sub: 'user-1',
          username: 'admin',
          sessionId: 'sess-1',
        });
        const verified = await verifyJwt(token);

        expect(verified!.exp - verified!.iat).toBe(1440 * 60);
      });

      it('should return null for invalid token', async () => {
        const result = await verifyJwt('invalid-token');
        expect(result).toBeNull();
      });

      it('should return null for tampered token', async () => {
        const payload = {
          sub: 'user-123',
          username: 'testuser',
          sessionId: 'session-456',
        };

        const token = await signJwt(payload);
        const tamperedToken = token.slice(0, -5) + 'xxxxx';
        const result = await verifyJwt(tamperedToken);

        expect(result).toBeNull();
      });

      it('should return null for empty token', async () => {
        const result = await verifyJwt('');
        expect(result).toBeNull();
      });

      it('should return null for malformed JWT', async () => {
        const result = await verifyJwt('not.a.valid.jwt');
        expect(result).toBeNull();
      });
    });

    // ─────────────────────────────────────────────────────────────────────
    // verifyJwt hardening — Issues #1109 (error discrimination) and
    // #1120 (explicit algorithms + requiredClaims). Unit-level coverage of
    // the new behaviour, including the "log.error on unexpected failure"
    // branch that issue #1109 introduces. The matching contract test in
    // backend/src/routes/security-regression.test.ts covers the same
    // failure modes from a black-box perspective; this block adds the
    // logger-introspection assertion that requires direct access to the
    // crypto module's logger.
    // ─────────────────────────────────────────────────────────────────────
    describe('verifyJwt hardening (#1109, #1120)', () => {
      const JWT_SECRET = 'a'.repeat(64);

      beforeEach(() => {
        _resetKeyCache();
        setConfigForTest({
          JWT_ALGORITHM: 'HS256',
          JWT_SECRET,
        });
      });

      afterAll(() => {
        _resetKeyCache();
        resetConfig();
      });

      it('returns null when signature is tampered (#1109)', async () => {
        const token = await signJwt({ sub: 'u', username: 'a', sessionId: 's' });
        const tampered = token.slice(0, -5) + 'XXXXX';
        expect(await verifyJwt(tampered)).toBeNull();
      });

      it('rejects token signed with wrong algorithm (#1120 — algorithm-confusion defence)', async () => {
        // jose v5 with explicit `algorithms: ['HS256']` rejects HS512-signed
        // tokens even though the secret matches. Without #1120's option, the
        // token would have been accepted (jose's default behaviour permits
        // any algorithm matching the key type).
        const key = new TextEncoder().encode(JWT_SECRET);
        const wrongAlgToken = await new SignJWT({ sub: 'u', username: 'a', sessionId: 's' })
          .setProtectedHeader({ alg: 'HS512' })
          .setIssuedAt()
          .setExpirationTime('60m')
          .sign(key);

        expect(await verifyJwt(wrongAlgToken)).toBeNull();
      });

      it('rejects an expired token silently (#1109)', async () => {
        const key = new TextEncoder().encode(JWT_SECRET);
        const expiredToken = await new SignJWT({ sub: 'u', username: 'a', sessionId: 's' })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
          .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
          .sign(key);

        expect(await verifyJwt(expiredToken)).toBeNull();
      });

      it('rejects token missing required `sub` claim (#1120)', async () => {
        const key = new TextEncoder().encode(JWT_SECRET);
        const tokenNoSub = await new SignJWT({ username: 'a', sessionId: 's' })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('60m')
          .sign(key);

        expect(await verifyJwt(tokenNoSub)).toBeNull();
      });

      it('rejects token missing required `exp` claim (#1120)', async () => {
        const key = new TextEncoder().encode(JWT_SECRET);
        const tokenNoExp = await new SignJWT({ sub: 'u', username: 'a', sessionId: 's' })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          // intentionally no setExpirationTime
          .sign(key);

        expect(await verifyJwt(tokenNoExp)).toBeNull();
      });

      it('returns null AND logs at error level for unexpected (non-JOSE) failures (#1109)', async () => {
        // Force getVerifyKey to throw a non-JOSE error: switch to RS256 with
        // a non-existent public-key file. readFileSync will throw ENOENT, a
        // Node SystemError that is NOT a JOSEError — exactly the failure
        // mode #1109 surfaces in operator logs.
        const cryptoLog = __cryptoLoggerHandle.current;
        if (!cryptoLog) {
          throw new Error('crypto child logger was not captured by the logger mock — setup bug');
        }
        cryptoLog.error.mockClear();

        _resetKeyCache();
        setConfigForTest({
          JWT_ALGORITHM: 'RS256',
          JWT_PUBLIC_KEY_PATH: '/nonexistent/path/to/public-key.pem',
        });

        let threw = false;
        let result: unknown = 'not-set';
        try {
          result = await verifyJwt('any-token');
        } catch {
          threw = true;
        }

        expect(threw).toBe(false);
        expect(result).toBeNull();
        expect(cryptoLog.error).toHaveBeenCalledTimes(1);
        const [logObj, msg] = cryptoLog.error.mock.calls[0] as [{ err: unknown }, string];
        expect(logObj).toHaveProperty('err');
        expect(logObj.err).toBeInstanceOf(Error);
        expect((logObj.err as NodeJS.ErrnoException).code).toBe('ENOENT');
        expect(msg).toMatch(/unexpected/i);
      });

      it('does NOT log at error level for expected jose errors (#1109)', async () => {
        // Routine failures (tampered, expired, wrong-alg, missing-claim,
        // malformed) all produce JOSEError subclasses. These must remain
        // silent — no log spam on every failed login attempt.
        const cryptoLog = __cryptoLoggerHandle.current;
        if (!cryptoLog) {
          throw new Error('crypto child logger was not captured by the logger mock — setup bug');
        }
        cryptoLog.error.mockClear();

        // Tampered signature → JWSSignatureVerificationFailed
        const validToken = await signJwt({ sub: 'u', username: 'a', sessionId: 's' });
        await verifyJwt(validToken.slice(0, -5) + 'XXXXX');

        // Wrong algorithm → JOSEAlgNotAllowed
        const key = new TextEncoder().encode(JWT_SECRET);
        const wrongAlgToken = await new SignJWT({ sub: 'u', username: 'a', sessionId: 's' })
          .setProtectedHeader({ alg: 'HS512' })
          .setIssuedAt()
          .setExpirationTime('60m')
          .sign(key);
        await verifyJwt(wrongAlgToken);

        // Malformed → JWSInvalid / JWTInvalid
        await verifyJwt('not.a.valid.jwt');

        expect(cryptoLog.error).not.toHaveBeenCalled();
      });
    });

    describe('signJwt and verifyJwt round-trip', () => {
      it('should handle special characters in username', async () => {
        const payload = {
          sub: 'user-123',
          username: 'user@example.com',
          sessionId: 'session-456',
        };

        const token = await signJwt(payload);
        const verified = await verifyJwt(token);

        expect(verified?.username).toBe('user@example.com');
      });

      it('should handle unicode in username', async () => {
        const payload = {
          sub: 'user-123',
          username: 'user-日本語',
          sessionId: 'session-456',
        };

        const token = await signJwt(payload);
        const verified = await verifyJwt(token);

        expect(verified?.username).toBe('user-日本語');
      });
    });

    describe('key caching', () => {
      it('should cache keys across multiple sign operations', async () => {
        const payload = { sub: 'user-1', username: 'admin', sessionId: 'sess-1' };

        // Sign twice — second call should use cached key
        const token1 = await signJwt(payload);
        const token2 = await signJwt(payload);

        // Both should be valid (different iat but same key)
        const v1 = await verifyJwt(token1);
        const v2 = await verifyJwt(token2);
        expect(v1?.sub).toBe('user-1');
        expect(v2?.sub).toBe('user-1');
      });

      it('should clear cache when _resetKeyCache is called', async () => {
        const payload = { sub: 'user-1', username: 'admin', sessionId: 'sess-1' };
        const token = await signJwt(payload);

        _resetKeyCache();

        // Should still work after cache reset (key regenerated from config)
        const verified = await verifyJwt(token);
        expect(verified?.sub).toBe('user-1');
      });
    });
  });

  describe('constantTimeEqual', () => {
    it('returns true only for identical strings', () => {
      expect(constantTimeEqual('s3cret-token', 's3cret-token')).toBe(true);
      expect(constantTimeEqual('s3cret-token', 's3cret-tokeX')).toBe(false);
      expect(constantTimeEqual('short', 'a-much-longer-value')).toBe(false);
    });

    it('fails closed for empty / nullish inputs (an unset secret never matches)', () => {
      expect(constantTimeEqual('', '')).toBe(false);
      expect(constantTimeEqual('value', '')).toBe(false);
      expect(constantTimeEqual('', 'value')).toBe(false);
      expect(constantTimeEqual(undefined, 'value')).toBe(false);
      expect(constantTimeEqual('value', null)).toBe(false);
    });
  });

  describe('Password operations', () => {
    describe('hashPassword', () => {
      it('should hash a password', async () => {
        const password = 'mySecretPassword123';
        const hash = await hashPassword(password);

        expect(hash).toBeDefined();
        expect(typeof hash).toBe('string');
        expect(hash).not.toBe(password);
        expect(hash.startsWith('$2')).toBe(true); // bcrypt hash prefix
      });

      it('should generate different hashes for same password', async () => {
        const password = 'samePassword';
        const hash1 = await hashPassword(password);
        const hash2 = await hashPassword(password);

        expect(hash1).not.toBe(hash2); // Different salt each time
      });

      it('should handle empty password', async () => {
        const hash = await hashPassword('');
        expect(hash).toBeDefined();
        expect(hash.startsWith('$2')).toBe(true);
      });

      it('should handle long passwords', async () => {
        const longPassword = 'a'.repeat(100);
        const hash = await hashPassword(longPassword);
        expect(hash).toBeDefined();
        expect(hash.startsWith('$2')).toBe(true);
      });

      it('should handle special characters', async () => {
        const password = 'P@$$w0rd!#$%^&*(){}[]';
        const hash = await hashPassword(password);
        expect(hash).toBeDefined();
        expect(hash.startsWith('$2')).toBe(true);
      });
    });

    describe('comparePassword', () => {
      it('should return true for matching password', async () => {
        const password = 'correctPassword';
        const hash = await hashPassword(password);
        const isMatch = await comparePassword(password, hash);

        expect(isMatch).toBe(true);
      });

      it('should return false for non-matching password', async () => {
        const password = 'correctPassword';
        const hash = await hashPassword(password);
        const isMatch = await comparePassword('wrongPassword', hash);

        expect(isMatch).toBe(false);
      });

      it('should return false for similar but different passwords', async () => {
        const password = 'Password123';
        const hash = await hashPassword(password);

        expect(await comparePassword('password123', hash)).toBe(false); // lowercase
        expect(await comparePassword('Password1234', hash)).toBe(false); // extra char
        expect(await comparePassword('Password12', hash)).toBe(false); // missing char
      });

      it('should handle empty password comparison', async () => {
        const hash = await hashPassword('');
        expect(await comparePassword('', hash)).toBe(true);
        expect(await comparePassword('something', hash)).toBe(false);
      });

      it('should handle special characters in password comparison', async () => {
        const password = '!@#$%^&*()_+-=[]{}|;:,.<>?';
        const hash = await hashPassword(password);

        expect(await comparePassword(password, hash)).toBe(true);
        expect(await comparePassword('!@#$%^&*()_+-=[]{}|;:,.<>/', hash)).toBe(false);
      });
    });

    describe('hashPassword and comparePassword round-trip', () => {
      it('should verify hashed password correctly', { timeout: 30_000 }, async () => {
        const testCases = [
          'simplePassword',
          'WithNumbers123',
          'special!@#chars',
          'very-long-password-that-exceeds-normal-length-requirements',
          '日本語パスワード',
          ' spacesAtStart',
          'spacesAtEnd ',
          '  spacesAroundSpaces  ',
        ];

        for (const password of testCases) {
          const hash = await hashPassword(password);
          const isMatch = await comparePassword(password, hash);
          expect(isMatch).toBe(true);
        }
      });
    });
  });
});
