import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signJwt, verifyJwt, hashPassword, comparePassword, _resetKeyCache } from './crypto.js';

// Mock the config module — default HS256
vi.mock('../config/index.js', () => ({
  getConfig: vi.fn(() => ({
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_ALGORITHM: 'HS256',
  })),
}));

describe('crypto', () => {
  beforeEach(() => {
    _resetKeyCache();
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
        // Expiration should be ~60 minutes from now
        const expectedExp = Math.floor(Date.now() / 1000) + 60 * 60;
        expect(verified?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
        expect(verified?.exp).toBeLessThanOrEqual(expectedExp + 5); // Allow 5 second tolerance
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
      it('should verify hashed password correctly', async () => {
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
