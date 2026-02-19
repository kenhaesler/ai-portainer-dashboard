import { describe, it, expect, vi } from 'vitest';

import { scrubPii, scrubPiiDeep } from './pii-scrubber.js';

describe('pii-scrubber', () => {
  // ── True Positives: should mask ──────────────────────────────────────

  describe('true positives', () => {
    it('masks email addresses', () => {
      expect(scrubPii('Contact admin@example.com for help')).toBe('Contact [MASKED] for help');
    });

    it('masks GitHub personal access tokens', () => {
      expect(scrubPii('token: ghp_1234567890abcdefghij1234567890')).toContain('[MASKED]');
    });

    it('masks GitLab personal access tokens', () => {
      expect(scrubPii('auth: glpat-1234567890abcdefghij')).toContain('[MASKED]');
    });

    it('masks JWTs', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
      expect(scrubPii(`Bearer ${jwt}`)).toBe('Bearer [MASKED]');
    });

    it('masks password assignments', () => {
      expect(scrubPii('password=SuperSecret123!')).toBe('password=[MASKED]');
    });

    it('masks secret assignments in JSON', () => {
      expect(scrubPii('{"api_secret": "my-very-long-secret-value"}')).toContain('[MASKED]');
    });

    it('masks credential assignments', () => {
      expect(scrubPii('credential=abcdefgh12345678')).toBe('credential=[MASKED]');
    });

    it('masks private_key assignments', () => {
      expect(scrubPii('private_key: "-----BEGIN RSA PRIVATE KEY-----"')).toContain('[MASKED]');
    });
  });

  // ── True Negatives: should NOT mask (infrastructure data) ────────────

  describe('true negatives — infrastructure data preserved', () => {
    it('preserves Docker container IDs (64-char hex)', () => {
      const containerId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      expect(scrubPii(containerId)).toBe(containerId);
    });

    it('preserves Docker short container IDs (12-char hex)', () => {
      const shortId = 'a1b2c3d4e5f6';
      expect(scrubPii(shortId)).toBe(shortId);
    });

    it('preserves UUIDs (container IDs, trace IDs)', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(scrubPii(`container ${uuid} is running`)).toBe(`container ${uuid} is running`);
    });

    it('preserves IPv4 Docker network addresses', () => {
      expect(scrubPii('Container IP: 172.17.0.2')).toBe('Container IP: 172.17.0.2');
    });

    it('preserves private network IPs', () => {
      expect(scrubPii('Gateway: 10.0.0.1')).toBe('Gateway: 10.0.0.1');
    });

    it('preserves timestamps', () => {
      expect(scrubPii('2026-02-15T10:30:00.000Z')).toBe('2026-02-15T10:30:00.000Z');
    });

    it('preserves port numbers', () => {
      expect(scrubPii('Listening on 0.0.0.0:3000')).toBe('Listening on 0.0.0.0:3000');
    });

    it('preserves PIDs', () => {
      expect(scrubPii('Process 12345 started')).toBe('Process 12345 started');
    });

    it('preserves metric values', () => {
      expect(scrubPii('CPU: 85.3%, Memory: 1024MB')).toBe('CPU: 85.3%, Memory: 1024MB');
    });

    it('preserves "key" and "token" in infrastructure contexts', () => {
      // These common words should not trigger masking
      expect(scrubPii('cache key expired')).toBe('cache key expired');
      expect(scrubPii('token refresh interval: 30s')).toBe('token refresh interval: 30s');
    });
  });

  // ── scrubPiiDeep ─────────────────────────────────────────────────────

  describe('scrubPiiDeep', () => {
    it('scrubs values in nested objects', () => {
      const input = {
        name: 'web-server',
        config: {
          password: 'password=SuperSecret123!',
          host: '172.17.0.2',
        },
      };
      const result = scrubPiiDeep(input);
      expect(result.config.password).toContain('[MASKED]');
      expect(result.config.host).toBe('172.17.0.2');
    });

    it('preserves object keys without scrubbing them', () => {
      const input = { 'admin@example.com': 'some value', normalKey: 'normalValue' };
      const result = scrubPiiDeep(input);
      // Key should be preserved as-is (not masked)
      expect(Object.keys(result)).toContain('admin@example.com');
    });

    it('scrubs strings in arrays', () => {
      const input = ['normal', 'admin@example.com', 'also normal'];
      const result = scrubPiiDeep(input);
      expect(result[0]).toBe('normal');
      expect(result[1]).toBe('[MASKED]');
      expect(result[2]).toBe('also normal');
    });

    it('passes through non-string/non-object values', () => {
      expect(scrubPiiDeep(42)).toBe(42);
      expect(scrubPiiDeep(null)).toBeNull();
      expect(scrubPiiDeep(true)).toBe(true);
    });
  });

  // ── Options ──────────────────────────────────────────────────────────

  describe('options', () => {
    it('uses custom replacement string', () => {
      expect(scrubPii('admin@test.com', { replacement: '***' })).toBe('***');
    });

    it('handles empty strings', () => {
      expect(scrubPii('')).toBe('');
    });

    it('applies additional custom patterns', () => {
      const customPattern = /SSN-\d{3}-\d{2}-\d{4}/g;
      expect(scrubPii('My SSN-123-45-6789', { additionalPatterns: [customPattern] })).toBe('My [MASKED]');
    });
  });
});
