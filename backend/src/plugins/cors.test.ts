import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import corsPlugin from './cors.js';

describe('cors plugin', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
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

  it('sends credentials header only for allowed origins', async () => {
    process.env.NODE_ENV = 'development';
    const app = Fastify();
    await app.register(corsPlugin);
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
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
});
