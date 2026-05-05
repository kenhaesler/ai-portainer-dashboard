import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock so the spy is in scope when secrets.ts is imported.
const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: readFileSyncMock,
  };
});

// Imported AFTER the mock is registered.
const { readSecret } = await import('./secrets.js');

describe('readSecret', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    readFileSyncMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns file contents from /run/secrets/<name> when the file exists', () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === '/run/secrets/jwt_secret') {
        return 'super-secret-value-from-docker';
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const value = readSecret('jwt_secret', 'JWT_SECRET');

    expect(value).toBe('super-secret-value-from-docker');
    expect(readFileSyncMock).toHaveBeenCalledWith('/run/secrets/jwt_secret', 'utf-8');
  });

  it('falls back to the named env var when the secret file is missing', () => {
    readFileSyncMock.mockImplementation(() => {
      const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    process.env.JWT_SECRET = 'env-fallback-value';

    const value = readSecret('jwt_secret', 'JWT_SECRET');

    expect(value).toBe('env-fallback-value');
  });

  it('returns undefined when neither the file nor the env var is set', () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    delete process.env.JWT_SECRET;

    const value = readSecret('jwt_secret', 'JWT_SECRET');

    expect(value).toBeUndefined();
  });

  it('trims trailing whitespace and newlines from the secret file contents', () => {
    // Shell redirects (`echo X > secret`) and `openssl rand -hex 32` both
    // produce a trailing newline; the helper must strip these so callers
    // can compare against length / regex requirements (e.g. JWT 32+ chars).
    readFileSyncMock.mockReturnValue('hex-secret-value\n');

    expect(readSecret('jwt_secret', 'JWT_SECRET')).toBe('hex-secret-value');
  });

  it('trims whitespace on both sides for robustness', () => {
    readFileSyncMock.mockReturnValue('  padded-secret  \n\n');

    expect(readSecret('jwt_secret', 'JWT_SECRET')).toBe('padded-secret');
  });

  it('prefers the secret file over the env var when both are set', () => {
    readFileSyncMock.mockReturnValue('docker-wins');
    process.env.JWT_SECRET = 'env-loses';

    expect(readSecret('jwt_secret', 'JWT_SECRET')).toBe('docker-wins');
  });

  it('falls back when the secret path resolves to a directory (EISDIR)', () => {
    readFileSyncMock.mockImplementation(() => {
      const err = new Error('EISDIR: illegal operation on a directory') as NodeJS.ErrnoException;
      err.code = 'EISDIR';
      throw err;
    });
    process.env.REDIS_PASSWORD = 'env-redis-pass';

    expect(readSecret('redis_password', 'REDIS_PASSWORD')).toBe('env-redis-pass');
  });
});
