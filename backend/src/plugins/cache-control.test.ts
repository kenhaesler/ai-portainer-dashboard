import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cacheControlPlugin from './cache-control.js';

async function buildTestApp() {
  const app = Fastify();
  await app.register(cacheControlPlugin);

  // Register test routes
  app.get('/api/endpoints', async () => ({ ok: true }));
  app.get('/api/containers', async () => ({ ok: true }));
  app.get('/api/images', async () => ({ ok: true }));
  app.get('/api/networks', async () => ({ ok: true }));
  app.get('/api/stacks', async () => ({ ok: true }));
  app.get('/api/dashboard/summary', async () => ({ ok: true }));
  app.get('/api/auth/session', async () => ({ ok: true }));
  app.get('/api/admin/cache/stats', async () => ({ ok: true }));
  app.get('/api/llm/models', async () => ({ ok: true }));
  app.get('/api/health', async () => ({ ok: true }));
  app.post('/api/containers/restart', async () => ({ ok: true }));

  await app.ready();
  return app;
}

describe('cache-control plugin', () => {
  it('sets private max-age for cacheable GET routes', async () => {
    const app = await buildTestApp();

    const cases = [
      { url: '/api/endpoints', expected: 'private, max-age=60' },
      { url: '/api/containers', expected: 'private, max-age=30' },
      { url: '/api/images', expected: 'private, max-age=120' },
      { url: '/api/networks', expected: 'private, max-age=120' },
      { url: '/api/stacks', expected: 'private, max-age=60' },
      { url: '/api/dashboard/summary', expected: 'private, max-age=30' },
    ];

    for (const { url, expected } of cases) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['cache-control']).toBe(expected);
    }

    await app.close();
  });

  it('sets no-store for sensitive routes', async () => {
    const app = await buildTestApp();

    const sensitiveRoutes = [
      '/api/auth/session',
      '/api/admin/cache/stats',
      '/api/llm/models',
    ];

    for (const url of sensitiveRoutes) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['cache-control']).toBe('no-store');
    }

    await app.close();
  });

  it('does not set Cache-Control for non-GET requests', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'POST', url: '/api/containers/restart' });
    expect(res.headers['cache-control']).toBeUndefined();

    await app.close();
  });

  it('does not set Cache-Control for unmatched routes', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['cache-control']).toBeUndefined();

    await app.close();
  });
});
