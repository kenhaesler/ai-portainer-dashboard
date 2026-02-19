import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setConfigForTest, resetConfig } from '../config/index.js';
import rateLimitPlugin, { shouldBypassGlobalRateLimit } from './rate-limit.js';

describe('rate-limit plugin', () => {
  beforeEach(() => {
    setConfigForTest({ API_RATE_LIMIT: 3 });
  });

  afterEach(() => {
    resetConfig();
  });

  it('bypasses global limits for observer read routes', async () => {
    const app = Fastify();
    await app.register(rateLimitPlugin);
    app.get('/api/metrics/1/abc', async () => ({ ok: true }));
    await app.ready();

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => app.inject({ method: 'GET', url: '/api/metrics/1/abc' })),
    );

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    await app.close();
  });

  it('still enforces global limits for non-observer routes', async () => {
    const app = Fastify();
    await app.register(rateLimitPlugin);
    app.get('/api/custom', async () => ({ ok: true }));
    await app.ready();

    const responses = [];
    for (let i = 0; i < 4; i += 1) {
      responses.push(await app.inject({ method: 'GET', url: '/api/custom' }));
    }

    expect(responses.slice(0, 3).every((response) => response.statusCode === 200)).toBe(true);
    expect(responses[3]?.statusCode).toBe(429);
    await app.close();
  });
});

describe('shouldBypassGlobalRateLimit', () => {
  it('returns true for known observer endpoints', () => {
    expect(shouldBypassGlobalRateLimit('GET', '/api/llm/stats?hours=24')).toBe(true);
    expect(shouldBypassGlobalRateLimit('GET', '/api/traces/summary')).toBe(true);
  });

  it('returns false for non-get routes and unknown paths', () => {
    expect(shouldBypassGlobalRateLimit('POST', '/api/metrics/1/abc')).toBe(false);
    expect(shouldBypassGlobalRateLimit('GET', '/api/auth/login')).toBe(false);
  });
});
