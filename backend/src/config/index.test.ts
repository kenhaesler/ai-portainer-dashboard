import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('config validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PORTAINER_API_KEY = 'test-portainer-api-key';
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

  it('accepts strong JWT secrets', async () => {
    process.env.JWT_SECRET = 'this-is-a-very-strong-jwt-secret-with-32-plus-chars';

    const { getConfig } = await import('./index.js');
    expect(getConfig().JWT_SECRET).toBe(process.env.JWT_SECRET);
  });
});
