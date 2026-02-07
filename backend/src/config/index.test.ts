import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('config validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PORTAINER_API_KEY = 'test-portainer-api-key';
    process.env.DASHBOARD_USERNAME = 'admin';
    process.env.DASHBOARD_PASSWORD = 'replace-with-strong-random-passphrase';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
    vi.resetModules();
  });

  it('rejects missing JWT_SECRET', async () => {
    delete process.env.JWT_SECRET;

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/JWT_SECRET/i);
  });

  it('rejects known weak JWT secret values', async () => {
    process.env.JWT_SECRET = 'dev-secret-change-in-production-must-be-at-least-32-chars';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/insecure JWT secret/i);
  });

  it('rejects missing dashboard credentials', async () => {
    delete process.env.DASHBOARD_USERNAME;
    delete process.env.DASHBOARD_PASSWORD;

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/DASHBOARD_USERNAME|DASHBOARD_PASSWORD/i);
  });

  it('rejects weak dashboard passwords', async () => {
    process.env.DASHBOARD_USERNAME = 'operator';
    process.env.DASHBOARD_PASSWORD = 'password12345';

    const { getConfig } = await import('./index.js');
    expect(() => getConfig()).toThrowError(/weak dashboard password/i);
  });

  it('accepts secure auth secrets and credentials', async () => {
    process.env.DASHBOARD_USERNAME = 'admin';
    process.env.DASHBOARD_PASSWORD = 'replace-with-strong-random-passphrase';
    process.env.JWT_SECRET = 'this-is-a-very-strong-jwt-secret-with-32-plus-chars';

    const { getConfig } = await import('./index.js');
    const config = getConfig();
    expect(config.DASHBOARD_USERNAME).toBe('admin');
    expect(config.DASHBOARD_PASSWORD).toBe('replace-with-strong-random-passphrase');
    expect(config.JWT_SECRET).toBe(process.env.JWT_SECRET);
  });

  describe('JWT_ALGORITHM validation', () => {
    it('defaults to HS256 when JWT_ALGORITHM is not set', async () => {
      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.JWT_ALGORITHM).toBe('HS256');
    });

    it('accepts HS256 explicitly', async () => {
      process.env.JWT_ALGORITHM = 'HS256';

      const { getConfig } = await import('./index.js');
      const config = getConfig();
      expect(config.JWT_ALGORITHM).toBe('HS256');
    });

    it('rejects invalid JWT_ALGORITHM values', async () => {
      process.env.JWT_ALGORITHM = 'HS384';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/JWT_ALGORITHM/i);
    });

    it('rejects RS256 without key paths', async () => {
      process.env.JWT_ALGORITHM = 'RS256';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/JWT_PRIVATE_KEY_PATH.*JWT_PUBLIC_KEY_PATH/i);
    });

    it('rejects ES256 without key paths', async () => {
      process.env.JWT_ALGORITHM = 'ES256';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/JWT_PRIVATE_KEY_PATH.*JWT_PUBLIC_KEY_PATH/i);
    });

    it('rejects RS256 with missing private key file', async () => {
      process.env.JWT_ALGORITHM = 'RS256';
      process.env.JWT_PRIVATE_KEY_PATH = '/nonexistent/private.pem';
      process.env.JWT_PUBLIC_KEY_PATH = '/nonexistent/public.pem';

      const { getConfig } = await import('./index.js');
      expect(() => getConfig()).toThrowError(/JWT_PRIVATE_KEY_PATH.*file not found/i);
    });
  });
});
