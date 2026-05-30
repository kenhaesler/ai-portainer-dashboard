import { describe, it, expect } from 'vitest';
import { sanitize } from './log-sanitizer.js';

describe('log-sanitizer', () => {
  describe('sanitize', () => {
    it('should return primitives unchanged', () => {
      expect(sanitize('hello')).toBe('hello');
      expect(sanitize(123)).toBe(123);
      expect(sanitize(true)).toBe(true);
      expect(sanitize(null)).toBe(null);
      expect(sanitize(undefined)).toBe(undefined);
    });

    it('should redact password fields', () => {
      const input = { username: 'admin', password: 'secret123' };
      const result = sanitize(input);
      expect(result).toEqual({ username: 'admin', password: '[REDACTED]' });
    });

    it('should redact token fields', () => {
      const input = { user: 'test', token: 'jwt-token-here' };
      const result = sanitize(input);
      expect(result).toEqual({ user: 'test', token: '[REDACTED]' });
    });

    it('should redact secret fields', () => {
      const input = { name: 'app', secret: 'my-secret-value' };
      const result = sanitize(input);
      expect(result).toEqual({ name: 'app', secret: '[REDACTED]' });
    });

    it('should redact apikey fields', () => {
      const input = { service: 'portainer', apikey: 'key123' };
      const result = sanitize(input);
      expect(result).toEqual({ service: 'portainer', apikey: '[REDACTED]' });
    });

    it('should redact api_key fields', () => {
      const input = { service: 'portainer', api_key: 'key123' };
      const result = sanitize(input);
      expect(result).toEqual({ service: 'portainer', api_key: '[REDACTED]' });
    });

    it('should redact authorization headers', () => {
      const input = { headers: { authorization: 'Bearer xyz', 'content-type': 'application/json' } };
      const result = sanitize(input) as { headers: Record<string, string> };
      expect(result.headers.authorization).toBe('[REDACTED]');
      expect(result.headers['content-type']).toBe('application/json');
    });

    it('should redact x-api-key headers', () => {
      const input = { headers: { 'x-api-key': 'secret-key' } };
      const result = sanitize(input) as { headers: Record<string, string> };
      expect(result.headers['x-api-key']).toBe('[REDACTED]');
    });

    it('should handle case-insensitive key matching', () => {
      const input = { PASSWORD: 'secret', Token: 'jwt', API_KEY: 'key' };
      const result = sanitize(input);
      expect(result).toEqual({
        PASSWORD: '[REDACTED]',
        Token: '[REDACTED]',
        API_KEY: '[REDACTED]',
      });
    });

    it('should handle nested objects', () => {
      const input = {
        user: {
          name: 'admin',
          credentials: {
            password: 'secret',
            token: 'jwt',
          },
        },
      };
      const result = sanitize(input);
      expect(result).toEqual({
        user: {
          name: 'admin',
          credentials: {
            password: '[REDACTED]',
            token: '[REDACTED]',
          },
        },
      });
    });

    it('should handle arrays', () => {
      const input = [
        { username: 'user1', password: 'pass1' },
        { username: 'user2', password: 'pass2' },
      ];
      const result = sanitize(input);
      expect(result).toEqual([
        { username: 'user1', password: '[REDACTED]' },
        { username: 'user2', password: '[REDACTED]' },
      ]);
    });

    it('should handle arrays in objects', () => {
      const input = {
        users: [
          { name: 'admin', apikey: 'key1' },
          { name: 'user', apikey: 'key2' },
        ],
      };
      const result = sanitize(input);
      expect(result).toEqual({
        users: [
          { name: 'admin', apikey: '[REDACTED]' },
          { name: 'user', apikey: '[REDACTED]' },
        ],
      });
    });

    it('should handle empty objects', () => {
      expect(sanitize({})).toEqual({});
    });

    it('should handle empty arrays', () => {
      expect(sanitize([])).toEqual([]);
    });

    it('should handle keys containing sensitive words', () => {
      const input = {
        userPassword: 'secret',
        authToken: 'jwt',
        clientSecret: 'value',
      };
      const result = sanitize(input);
      expect(result).toEqual({
        userPassword: '[REDACTED]',
        authToken: '[REDACTED]',
        clientSecret: '[REDACTED]',
      });
    });

    it('should not modify the original object', () => {
      const input = { password: 'secret' };
      sanitize(input);
      expect(input.password).toBe('secret');
    });
  });
});
