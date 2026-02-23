import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTest, resetConfig } from '../config/index.js';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { healthRoutes } from './health.js';

// Kept: timescale mock — no TimescaleDB in CI
vi.mock('../db/timescale.js', () => ({ isMetricsDbHealthy: vi.fn(), isMetricsDbReady: vi.fn() }));
// Kept: postgres mock — no PostgreSQL in CI
vi.mock('../db/postgres.js', () => ({ isAppDbHealthy: vi.fn(), isAppDbReady: vi.fn() }));
// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('../services/portainer-client.js', async (importOriginal) => await importOriginal());
vi.mock('../services/portainer-cache.js', async (importOriginal) => await importOriginal());

import { isMetricsDbHealthy, isMetricsDbReady } from '../db/timescale.js';
import { isAppDbHealthy, isAppDbReady } from '../db/postgres.js';
import * as portainerCache from '../services/portainer-cache.js';
import * as portainerClient from '../services/portainer-client.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';
const { cache, waitForInFlight } = portainerCache;
const mockIsMetricsDbHealthy = vi.mocked(isMetricsDbHealthy);
const mockIsMetricsDbReady = vi.mocked(isMetricsDbReady);
const mockIsAppDbHealthy = vi.mocked(isAppDbHealthy);
const mockIsAppDbReady = vi.mocked(isAppDbReady);
let mockCachedFetch: any;
let mockCheckPortainer: any;
let mockCacheGetBackoffState: any;
let mockCachePing: any;
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
  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });
  afterEach(async () => {
    resetConfig();
    await waitForInFlight();
  });
  beforeEach(async () => {
    await cache.clear();
    await flushTestCache();
    vi.clearAllMocks();
    mockCachedFetch = vi.spyOn(portainerCache, 'cachedFetch');
    mockCheckPortainer = vi.spyOn(portainerClient, 'checkPortainerReachable');
    mockCacheGetBackoffState = vi.spyOn(cache, 'getBackoffState');
    mockCachePing = vi.spyOn(cache, 'ping');
    setConfigForTest({ OLLAMA_BASE_URL: 'http://localhost:11434' });
    // Default: migrations applied, Redis not configured
    mockIsAppDbHealthy.mockResolvedValue(true);
    mockIsAppDbReady.mockReturnValue(true);
    mockIsMetricsDbReady.mockReturnValue(true);
    mockCacheGetBackoffState.mockReturnValue({ failureCount: 0, disabledUntil: 0, configured: false });
    mockCachePing.mockResolvedValue(false);
    // Default: Portainer reachable and ok
    mockCheckPortainer.mockResolvedValue({ reachable: true, ok: true });
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
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(r.statusCode).toBe(200);
      const b = JSON.parse(r.body);
      expect(b.status).toBe('healthy');
      expect(b.checks.appDb.status).toBe('healthy');
      expect(b.checks.metricsDb.status).toBe('healthy');
      expect(b.checks.portainer.status).toBe('healthy');
      expect(b.checks.ollama.status).toBe('healthy');
    });
    it('should NOT include URLs in redacted response', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.checks.portainer.url).toBeUndefined();
      expect(b.checks.ollama.url).toBeUndefined();
    });
    it('should NOT include error details in redacted response', async () => {
      mockIsAppDbHealthy.mockResolvedValue(false);
      mockIsMetricsDbHealthy.mockResolvedValue(false);
      mockCheckPortainer.mockResolvedValue({ reachable: false, ok: false });
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.checks.appDb.error).toBeUndefined();
      expect(b.checks.metricsDb.error).toBeUndefined();
      expect(b.checks.portainer.error).toBeUndefined();
      expect(b.checks.ollama.error).toBeUndefined();
    });
    it('should return unhealthy when appDb fails', async () => {
      mockIsAppDbHealthy.mockResolvedValue(false);
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.appDb.status).toBe('unhealthy');
    });
    it('should return degraded when Portainer returns non-ok', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockCheckPortainer.mockResolvedValue({ reachable: true, ok: false });
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('degraded');
      expect(b.checks.portainer.status).toBe('degraded');
    });
    it('should return unhealthy when Portainer connection fails', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockCheckPortainer.mockResolvedValue({ reachable: false, ok: false });
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.portainer.status).toBe('unhealthy');
    });
    it('should return unhealthy when Ollama connection fails', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockRejectedValue(new Error('Ollama not running'));
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.ollama.status).toBe('unhealthy');
    });
    it('should include timestamp', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.timestamp).toBeDefined();
      expect(new Date(b.timestamp).toISOString()).toBe(b.timestamp);
    });
    it('should return degraded metricsDb when connected but migrations not applied', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockIsMetricsDbReady.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('degraded');
      expect(b.checks.metricsDb.status).toBe('degraded');
    });
    it('should handle all services unhealthy', async () => {
      mockIsAppDbHealthy.mockResolvedValue(false);
      mockIsMetricsDbHealthy.mockResolvedValue(false);
      mockCheckPortainer.mockResolvedValue({ reachable: false, ok: false });
      mockFetch.mockRejectedValue(new Error('Network error'));
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.appDb.status).toBe('unhealthy');
      expect(b.checks.metricsDb.status).toBe('unhealthy');
      expect(b.checks.portainer.status).toBe('unhealthy');
      expect(b.checks.ollama.status).toBe('unhealthy');
    });
    it('should only contain status field per check', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      for (const check of Object.values(b.checks) as Record<string, unknown>[]) {
        expect(Object.keys(check)).toEqual(['status']);
      }
    });
    it('should include Redis as healthy when configured and ping succeeds', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCacheGetBackoffState.mockReturnValue({ failureCount: 0, disabledUntil: 0, configured: true });
      mockCachePing.mockResolvedValue(true);
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('healthy');
      expect(b.checks.redis).toBeDefined();
      expect(b.checks.redis.status).toBe('healthy');
    });
    it('should include Redis as degraded when configured and ping fails', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCacheGetBackoffState.mockReturnValue({ failureCount: 3, disabledUntil: Date.now() + 10000, configured: true });
      mockCachePing.mockResolvedValue(false);
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('degraded');
      expect(b.checks.redis.status).toBe('degraded');
    });
    it('should not include Redis when not configured', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCacheGetBackoffState.mockReturnValue({ failureCount: 0, disabledUntil: 0, configured: false });
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      const b = JSON.parse(r.body);
      expect(b.checks.redis).toBeUndefined();
    });
    it('should use cachedFetch for Portainer and Ollama checks with 30s TTL', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      await app.inject({ method: 'GET', url: '/health/ready' });
      expect(mockCachedFetch).toHaveBeenCalledWith('health:portainer', 30, expect.any(Function));
      expect(mockCachedFetch).toHaveBeenCalledWith('health:ollama', 30, expect.any(Function));
    });
    it('should use checkPortainerReachable instead of raw fetch for Portainer', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      await app.inject({ method: 'GET', url: '/health/ready' });
      expect(mockCheckPortainer).toHaveBeenCalledOnce();
    });
  });

  describe('GET /health/ready/detail (authenticated)', () => {
    it('should return full diagnostic info including URLs', async () => {
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
      mockIsAppDbHealthy.mockResolvedValue(false);
      mockIsMetricsDbHealthy.mockResolvedValue(false);
      mockCheckPortainer.mockResolvedValue({ reachable: false, ok: false });
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('unhealthy');
      expect(b.checks.appDb.error).toBe('App PostgreSQL query failed');
      expect(b.checks.metricsDb.error).toBe('TimescaleDB query failed');
      expect(b.checks.portainer.error).toBe('Connection failed');
      expect(b.checks.portainer.url).toBe('http://localhost:9000');
      expect(b.checks.ollama.error).toBe('Connection refused');
      expect(b.checks.ollama.url).toBe('http://localhost:11434');
    });
    it('should include all dependency checks', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.checks).toHaveProperty('appDb');
      expect(b.checks).toHaveProperty('metricsDb');
      expect(b.checks).toHaveProperty('portainer');
      expect(b.checks).toHaveProperty('ollama');
      expect(b.checks).not.toHaveProperty('database');
      expect(b.timestamp).toBeDefined();
    });
    it('should return degraded status when Portainer is reachable but non-ok', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockCheckPortainer.mockResolvedValue({ reachable: true, ok: false });
      mockFetch.mockResolvedValue({ ok: true });
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.status).toBe('degraded');
      expect(b.checks.portainer.status).toBe('degraded');
    });
    it('should include Redis detail when configured and healthy', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCacheGetBackoffState.mockReturnValue({ failureCount: 0, disabledUntil: 0, configured: true });
      mockCachePing.mockResolvedValue(true);
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.checks.redis).toBeDefined();
      expect(b.checks.redis.status).toBe('healthy');
    });
    it('should include Redis error detail when ping fails', async () => {
      mockIsMetricsDbHealthy.mockResolvedValue(true);
      mockFetch.mockResolvedValue({ ok: true });
      mockCacheGetBackoffState.mockReturnValue({ failureCount: 2, disabledUntil: Date.now() + 5000, configured: true });
      mockCachePing.mockResolvedValue(false);
      const r = await app.inject({ method: 'GET', url: '/health/ready/detail' });
      const b = JSON.parse(r.body);
      expect(b.checks.redis.status).toBe('degraded');
      expect(b.checks.redis.error).toBe('Redis ping failed (L1 fallback active)');
    });
  });
});
