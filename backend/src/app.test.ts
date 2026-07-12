import { describe, it, expect } from 'vitest';
import { envSchema } from '@dashboard/core/config/env.schema.js';

// Required fields with no schema defaults — the schema won't parse without them.
const BASE_ENV = {
  DASHBOARD_USERNAME: 'admin',
  DASHBOARD_PASSWORD: 'replace-with-strong-random-passphrase',
  JWT_SECRET: 'a'.repeat(64),
};

// Tests the real env schema (not a local copy) so HTTP/2 parsing regressions
// are caught here. #1492: HTTP2_ENABLED previously used z.coerce.boolean(),
// which coerced the string 'false' to TRUE; the schema value was also ignored
// by getHttp2Options() in favor of a raw process.env read. Both are fixed —
// the schema is now the single source of truth, so pin its semantics.
// getHttp2Options() itself is covered in packages/server/src/__tests__/http2-options.test.ts.
describe('HTTP/2 configuration', () => {
  it('accepts HTTP2 config vars', () => {
    const result = envSchema.safeParse({
      ...BASE_ENV,
      HTTP2_ENABLED: 'true',
      TLS_CERT_PATH: '/path/to/cert.pem',
      TLS_KEY_PATH: '/path/to/key.pem',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HTTP2_ENABLED).toBe(true);
      expect(result.data.TLS_CERT_PATH).toBe('/path/to/cert.pem');
      expect(result.data.TLS_KEY_PATH).toBe('/path/to/key.pem');
    }
  });

  it('defaults HTTP2_ENABLED to false', () => {
    const result = envSchema.safeParse(BASE_ENV);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HTTP2_ENABLED).toBe(false);
      expect(result.data.TLS_CERT_PATH).toBeUndefined();
      expect(result.data.TLS_KEY_PATH).toBeUndefined();
    }
  });

  it('parses HTTP2_ENABLED=false as false (#1492 — no z.coerce.boolean inversion)', () => {
    const result = envSchema.safeParse({ ...BASE_ENV, HTTP2_ENABLED: 'false' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HTTP2_ENABLED).toBe(false);
    }
  });

  it('HTTP2 enabled without cert paths is valid schema-wise', () => {
    const result = envSchema.safeParse({ ...BASE_ENV, HTTP2_ENABLED: 'true' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HTTP2_ENABLED).toBe(true);
      expect(result.data.TLS_CERT_PATH).toBeUndefined();
    }
  });
});
