import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { healthRoutes } from './health.js';

vi.mock('../db/sqlite.js', () => ({ isDbHealthy: vi.fn() }));
vi.mock('../db/timescale.js', () => ({ isMetricsDbHealthy: vi.fn(), isMetricsDbReady: vi.fn() }));
vi.mock('../db/postgres.js', () => ({ isAppDbHealthy: vi.fn(), isAppDbReady: vi.fn() }));
vi.mock('../config/index.js', () => ({ getConfig: () => ({ PORTAINER_API_URL: 'http://localhost:9000', PORTAINER_API_KEY: 'test-api-key', OLLAMA_BASE_URL: 'http://localhost:11434' }) }));
vi.mock('../services/portainer-cache.js', () => ({
  cache: {
    getBackoffState: vi.fn(),
    ping: vi.fn(),
  },
}));

import { isDbHealthy } from '../db/sqlite.js';
import { isMetricsDbHealthy, isMetricsDbReady } from '../db/timescale.js';
import { isAppDbHealthy, isAppDbReady } from '../db/postgres.js';
import { cache } from '../services/portainer-cache.js';
const mockIsDbHealthy = vi.mocked(isDbHealthy);
const mockIsMetricsDbHealthy = vi.mocked(isMetricsDbHealthy);
const mockIsMetricsDbReady = vi.mocked(isMetricsDbReady);
const mockIsAppDbHealthy = vi.mocked(isAppDbHealthy);
const mockIsAppDbReady = vi.mocked(isAppDbReady);
const mockCache = vi.mocked(cache);
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Health Routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(healthRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: migrations applied, Redis not configured
    mockIsAppDbHealthy.mockResolvedValue(true);
    mockIsAppDbReady.mockReturnValue(true);
    mockIsMetricsDbReady.mockReturnValue(true);
    mockCache.getBackoffState.mockReturnValue({ failureCount: 0, disabledUntil: 0, configured: false });
    mockCache.ping.mockResolvedValue(false);
  });

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const r = await app.inject({ method: 'GET', url: '/health' });
      expect(r.statusCode).toBe(200);
      const b = JSON.parse(r.body);
      expect(b.status).toBe('ok');
      expect(b.timestamp).toBeDefined();
    });
    it('should return valid ISO timestamp', async () => {
      const r = await app.inject({ method: 'GET', url: '/health' });
      const b = JSON.parse(r.body);
      expect(new Date(b.timestamp).toISOString()).toBe(b.timestamp);
    });
  });

  describe('GET /health/ready (public, redacted)', () => {
    it('should return healthy when all checks pass', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(r.statusCode).toBe(200);
      const b = JSON.parse(r.body);
      expect(b.status).toBe('healthy');
      expect(b.checks.database.status).toBe('healthy');
      expect(b.checks.metricsDb.status).toBe('healthy');
      expect(b.checks.portainer.status).toBe('healthy');
      expect(b.checks.ollama.status).toBe('healthy');
    });
    it('should NOT include URLs in redacted response', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.checks.portainer.url).toBeUndefined();
      expect(b.checks.ollama.url).toBeUndefined();
    });
    it('should NOT include error details in redacted response', async () => {
      mockIsDbHealthy.mockReturnValue(false);
      mockIsMetricsDbHealthy.mockResolvedValue(false);
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.checks.database.error).toBeUndefined();
      expect(b.checks.metricsDb.error).toBeUndefined();
      expect(b.checks.portainer.error).toBeUndefined();
      expect(b.checks.ollama.error).toBeUndefined();
    });
    it('should return unhealthy when database fails', async () => {
      mockIsDbHealthy.mockReturnValue(false);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.database.status).toBe('unhealthy');
    });
    it('should return degraded when Portainer returns non-ok', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('degraded');
      expect(b.checks.portainer.status).toBe('degraded');
    });
    it('should return unhealthy when Portainer connection fails', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockRejectedValueOnce(new Error('Connection refused')).mockResolvedValueOnce({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.portainer.status).toBe('unhealthy');
    });
    it('should return unhealthy when Ollama connection fails', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('Ollama not running'));
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.ollama.status).toBe('unhealthy');
    });
    it('should include timestamp', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.timestamp).toBeDefined();
      expect(new Date(b.timestamp).toISOString()).toBe(b.timestamp);
    });
    it('should return degraded metricsDb when connected but migrations not applied', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockIsMetricsDbReady.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('degraded');
      expect(b.checks.metricsDb.status).toBe('degraded');
    });
    it('should handle all services unhealthy', async () => {
      mockIsDbHealthy.mockReturnValue(false);
      mockIsMetricsDbHealthy.mockResolvedValue(false);
      mockFetch.mockRejectedValue(new Error('Network error'));
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.database.status).toBe('unhealthy');
      expect(b.checks.metricsDb.status).toBe('unhealthy');
      expect(b.checks.portainer.status).toBe('unhealthy');
      expect(b.checks.ollama.status).toBe('unhealthy');
    });
    it('should only contain status field per check', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      for (const check of Object.values(b.checks) as Record<string, unknown>[]) {
        expect(Object.keys(check)).toEqual(['status']);
      }
    });
    it('should include Redis as healthy when configured and ping succeeds', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCache.getBackoffState.mockReturnValue({ failureCount: 0, disabledUntil: 0, configured: true });
      mockCache.ping.mockResolvedValue(true);
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('healthy');
      expect(b.checks.redis).toBeDefined();
      expect(b.checks.redis.status).toBe('healthy');
    });
    it('should include Redis as degraded when configured and ping fails', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCache.getBackoffState.mockReturnValue({ failureCount: 3, disabledUntil: Date.now() + 10000, configured: true });
      mockCache.ping.mockResolvedValue(false);
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('degraded');
      expect(b.checks.redis.status).toBe('degraded');
    });
    it('should not include Redis when not configured', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCache.getBackoffState.mockReturnValue({ failureCount: 0, disabledUntil: 0, configured: false });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.checks.redis).toBeUndefined();
    });
  });

  describe('GET /health/ready/detail (authenticated)', () => {
    it('should return full diagnostic info including URLs', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      expect(r.statusCode).toBe(200);
      const b = JSON.parse(r.body);
      expect(b.status).toBe('healthy');
      expect(b.checks.portainer.url).toBe('http://localhost:9000');
      expect(b.checks.ollama.url).toBe('http://localhost:11434');
    });
    it('should return error details when services fail', async () => {
      mockIsDbHealthy.mockReturnValue(false);
      mockIsMetricsDbHealthy.mockResolvedValue(false);
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.database.error).toBe('Database query failed');
      expect(b.checks.metricsDb.error).toBe('TimescaleDB query failed');
      expect(b.checks.portainer.error).toBe('Connection refused');
      expect(b.checks.portainer.url).toBe('http://localhost:9000');
      expect(b.checks.ollama.error).toBe('Connection refused');
      expect(b.checks.ollama.url).toBe('http://localhost:11434');
    });
    it('should include all dependency checks', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.checks).toHaveProperty('database');
      expect(b.checks).toHaveProperty('appDb');
      expect(b.checks).toHaveProperty('metricsDb');
      expect(b.checks).toHaveProperty('portainer');
      expect(b.checks).toHaveProperty('ollama');
      expect(b.timestamp).toBeDefined();
    });
    it('should return degraded status when a service is degraded', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('degraded');
      expect(b.checks.portainer.status).toBe('degraded');
    });
    it('should include Redis detail when configured and healthy', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCache.getBackoffState.mockReturnValue({ failureCount: 0, disabledUntil: 0, configured: true });
      mockCache.ping.mockResolvedValue(true);
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.checks.redis).toBeDefined();
      expect(b.checks.redis.status).toBe('healthy');
    });
    it('should include Redis error detail when ping fails', async () => {
      mockIsDbHealthy.mockReturnValue(true);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCache.getBackoffState.mockReturnValue({ failureCount: 2, disabledUntil: Date.now() + 5000, configured: true });
      mockCache.ping.mockResolvedValue(false);
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.checks.redis.status).toBe('degraded');
      expect(b.checks.redis.error).toBe('Redis ping failed (L1 fallback active)');
    });
  });
});
