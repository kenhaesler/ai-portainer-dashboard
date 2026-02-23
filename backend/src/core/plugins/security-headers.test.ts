import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import securityHeadersPlugin from './security-headers.js';

describe('security headers plugin', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('adds standard security headers to responses', async () => {
    const app = Fastify();
    await app.register(securityHeadersPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/ping' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('geolocation=()');
    // X-Frame-Options and CSP are handled by nginx, not the backend
    expect(response.headers['x-frame-options']).toBeUndefined();
    expect(response.headers['content-security-policy']).toBeUndefined();
    expect(response.headers['strict-transport-security']).toBeUndefined();

    await app.close();
  });

  it('adds hsts header when request is https behind proxy', async () => {
    const app = Fastify();
    await app.register(securityHeadersPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-forwarded-proto': 'https' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains'
    );

    await app.close();
  });
});
