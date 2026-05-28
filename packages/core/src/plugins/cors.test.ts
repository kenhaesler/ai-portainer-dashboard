import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { resetConfig, setConfigForTest } from '../config/index.js';
import corsPlugin from './cors.js';

describe('cors plugin', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    resetConfig();
  });

  it('does not send credentials header when request has no Origin', async () => {
    process.env.NODE_ENV = 'development';
    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/ping' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });

  it('sends credentials header for localhost:5273', async () => {
    process.env.NODE_ENV = 'development';
    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'http://localhost:5273' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5273');
    expect(response.headers['access-control-allow-credentials']).toBe('true');

    await app.close();
  });

  it('sends credentials header for localhost:8080', async () => {
    process.env.NODE_ENV = 'development';
    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'http://localhost:8080' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    expect(response.headers['access-control-allow-credentials']).toBe('true');

    await app.close();
  });

  it('sends credentials header for 127.0.0.1:8080 (loopback alias of localhost)', async () => {
    process.env.NODE_ENV = 'development';
    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'http://127.0.0.1:8080' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:8080');
    expect(response.headers['access-control-allow-credentials']).toBe('true');

    await app.close();
  });

  it('sends credentials header for 127.0.0.1:5273 (loopback alias of localhost)', async () => {
    process.env.NODE_ENV = 'development';
    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'http://127.0.0.1:5273' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5273');
    expect(response.headers['access-control-allow-credentials']).toBe('true');

    await app.close();
  });

  it('does not send CORS headers for disallowed origins', async () => {
    process.env.NODE_ENV = 'development';
    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://evil.example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();

    await app.close();
  });

  // ── #1115: CORS_ALLOWED_ORIGINS in production ──────────────────────────
  // Note: setConfigForTest requires NODE_ENV='test' to seed the config; we
  // then flip NODE_ENV to 'production' before registering the plugin so the
  // production code path is exercised. resetConfig() in afterEach clears state.
  it('production with CORS_ALLOWED_ORIGINS unset → no Access-Control-Allow-Origin (legacy default)', async () => {
    process.env.NODE_ENV = 'test';
    setConfigForTest({ CORS_ALLOWED_ORIGINS: undefined });
    process.env.NODE_ENV = 'production';

    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();

    await app.close();
  });

  it('production with CORS_ALLOWED_ORIGINS list → matched origin echoed back', async () => {
    process.env.NODE_ENV = 'test';
    setConfigForTest({
      CORS_ALLOWED_ORIGINS: 'https://example.com,https://other.com',
    });
    process.env.NODE_ENV = 'production';

    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const allowed = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://example.com' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://example.com');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    await app.close();
  });

  it('production with CORS_ALLOWED_ORIGINS list → unlisted origin rejected (no header)', async () => {
    process.env.NODE_ENV = 'test';
    setConfigForTest({
      CORS_ALLOWED_ORIGINS: 'https://example.com,https://other.com',
    });
    process.env.NODE_ENV = 'production';

    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const blocked = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://attacker.com' },
    });
    // @fastify/cors omits the ACAO header when origin is not allowed; the
    // browser then enforces Same-Origin on the response. Either undefined or
    // false (string) indicates rejection — we assert "not echoed back".
    expect(blocked.headers['access-control-allow-origin']).not.toBe('https://attacker.com');

    await app.close();
  });
});
