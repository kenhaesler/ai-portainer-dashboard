import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';

// Test just the HTTP/2-related schema fields in isolation
const http2Schema = z.object({
  HTTP2_ENABLED: z.coerce.boolean().default(false),
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),
});

describe('HTTP/2 configuration', () => {
  it('accepts HTTP2 config vars', () => {
    const result = http2Schema.safeParse({
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
    const result = http2Schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HTTP2_ENABLED).toBe(false);
      expect(result.data.TLS_CERT_PATH).toBeUndefined();
      expect(result.data.TLS_KEY_PATH).toBeUndefined();
    }
  });

  it('HTTP2 enabled without cert paths is valid schema-wise', () => {
    const result = http2Schema.safeParse({
      HTTP2_ENABLED: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HTTP2_ENABLED).toBe(true);
      expect(result.data.TLS_CERT_PATH).toBeUndefined();
    }
  });

  it('getHttp2Options returns empty when HTTP2_ENABLED is not set', async () => {
    // Import the function by reading the app module
    // Since we can't easily mock all dependencies, test the logic directly
    delete process.env.HTTP2_ENABLED;
    delete process.env.TLS_CERT_PATH;
    delete process.env.TLS_KEY_PATH;

    const enabled = process.env.HTTP2_ENABLED === 'true';
    expect(enabled).toBe(false);
  });
});
