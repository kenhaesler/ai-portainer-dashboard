import { describe, it, expect, afterEach } from 'vitest';
import { readProductVersion, resolveProductVersion } from '../app.js';

describe('resolveProductVersion (pure cascade)', () => {
  it('prefers the APP_VERSION env override above all', () => {
    expect(
      resolveProductVersion({ env: '3.1.4', bakedFile: '2.0.0', cwdPackageVersion: '1.0.0' }),
    ).toBe('3.1.4');
  });

  it('uses the build-baked version file when no env override is set', () => {
    // The runtime Docker image ships @dashboard/server's package.json (1.0.0) as
    // /app/package.json, so the product version must come from the baked file.
    expect(
      resolveProductVersion({ bakedFile: '2.0.0', cwdPackageVersion: '1.0.0' }),
    ).toBe('2.0.0');
  });

  it('falls back to the working-dir package.json (dev) when nothing is baked', () => {
    expect(resolveProductVersion({ cwdPackageVersion: '2.0.0' })).toBe('2.0.0');
  });

  it('returns "unknown" when no source is available', () => {
    expect(resolveProductVersion({})).toBe('unknown');
  });

  it('ignores blank/whitespace sources and continues the cascade', () => {
    expect(
      resolveProductVersion({ env: '   ', bakedFile: '', cwdPackageVersion: '2.0.0' }),
    ).toBe('2.0.0');
  });
});

describe('readProductVersion', () => {
  const original = process.env.APP_VERSION;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = original;
  });

  it('honors the APP_VERSION env override', () => {
    process.env.APP_VERSION = '9.9.9-from-env';
    expect(readProductVersion()).toBe('9.9.9-from-env');
  });

  it('returns a non-empty semver string from the filesystem when env is unset', () => {
    delete process.env.APP_VERSION;
    const version = readProductVersion();
    expect(typeof version).toBe('string');
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
