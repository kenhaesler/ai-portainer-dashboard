import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getHttp2Options } from '../app.js';
import { resetConfig, setConfigForTest } from '@dashboard/core/config/index.js';

/**
 * Regression tests for #1492 — getHttp2Options() must consume the parsed
 * config (getConfig().HTTP2_ENABLED) instead of re-reading process.env.
 * The old raw-env read meant the validated config value was never used
 * (double-parse drift): the schema said one thing, the server did another.
 */
describe('getHttp2Options (#1492)', () => {
  let dir: string;
  let certPath: string;
  let keyPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'http2-options-'));
    certPath = join(dir, 'cert.pem');
    keyPath = join(dir, 'key.pem');
    writeFileSync(certPath, 'dummy-cert');
    writeFileSync(keyPath, 'dummy-key');
  });

  afterEach(() => {
    resetConfig();
    delete process.env.HTTP2_ENABLED;
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty options by default (HTTP2_ENABLED defaults to false)', () => {
    setConfigForTest({ HTTP2_ENABLED: false, TLS_CERT_PATH: certPath, TLS_KEY_PATH: keyPath });
    expect(getHttp2Options()).toEqual({});
  });

  it('returns http2 + TLS options when the parsed config enables HTTP/2', () => {
    setConfigForTest({ HTTP2_ENABLED: true, TLS_CERT_PATH: certPath, TLS_KEY_PATH: keyPath });

    const options = getHttp2Options();
    expect(options).toMatchObject({ http2: true });
    const https = (options as { https: { key: Buffer; cert: Buffer; allowHTTP1: true } }).https;
    expect(https.allowHTTP1).toBe(true);
    expect(https.cert.toString()).toBe('dummy-cert');
    expect(https.key.toString()).toBe('dummy-key');
  });

  it('returns empty options when HTTP/2 is enabled but cert/key paths are missing', () => {
    setConfigForTest({ HTTP2_ENABLED: true, TLS_CERT_PATH: undefined, TLS_KEY_PATH: undefined });
    expect(getHttp2Options()).toEqual({});
  });

  it('honors the config value, not a raw process.env read (double-parse drift)', () => {
    // The old implementation read process.env.HTTP2_ENABLED === 'true'
    // directly. Prove the config path wins in both directions.
    process.env.HTTP2_ENABLED = 'true';
    setConfigForTest({ HTTP2_ENABLED: false, TLS_CERT_PATH: certPath, TLS_KEY_PATH: keyPath });
    expect(getHttp2Options()).toEqual({});

    process.env.HTTP2_ENABLED = 'false';
    setConfigForTest({ HTTP2_ENABLED: true, TLS_CERT_PATH: certPath, TLS_KEY_PATH: keyPath });
    expect(getHttp2Options()).toMatchObject({ http2: true });
  });
});
