import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { dashboardRoutes } from './dashboard.js';

const mockGetKpiHistory = vi.fn();
const mockGetEndpoints = vi.fn();
const mockGetContainers = vi.fn();
const mockGetSecurityAudit = vi.fn();

vi.mock('../services/kpi-store.js', () => ({
  getKpiHistory: (...args: unknown[]) => mockGetKpiHistory(...args),
}));

vi.mock('../services/portainer-client.js', () => ({
  getEndpoints: (...args: unknown[]) => mockGetEndpoints(...args),
  getContainers: (...args: unknown[]) => mockGetContainers(...args),
}));

vi.mock('../services/portainer-cache.js', () => ({
  cachedFetchSWR: (_key: string, _ttl: number, fn: () => unknown) => fn(),
  getCacheKey: (...parts: string[]) => parts.join(':'),
  TTL: { ENDPOINTS: 30, CONTAINERS: 30 },
}));

vi.mock('../services/portainer-normalizers.js', async () => {
  return {
    normalizeEndpoint: (ep: Record<string, unknown>) => ep,
    normalizeContainer: (c: Record<string, unknown>, endpointId: number, endpointName: string) => ({
      ...c,
      endpointId,
      endpointName,
    }),
  };
});

vi.mock('../services/security-audit.js', () => ({
  getSecurityAudit: (...args: unknown[]) => mockGetSecurityAudit(...args),
  buildSecurityAuditSummary: () => ({ totalAudited: 0, flagged: 0, ignored: 0 }),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function makeEndpoint(id: number, name: string, status: 'up' | 'down' = 'up') {
  return {
    id,
    name,
    status,
    containersRunning: 1,
    containersStopped: 0,
    containersHealthy: 1,
    containersUnhealthy: 0,
    totalContainers: 1,
    stackCount: 0,
  };
}

function makeContainer(id: string, created: number) {
  return { Id: id, Names: [`/${id}`], State: 'running', Status: 'Up', Image: 'nginx', created };
}

async function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  await app.register(dashboardRoutes);
  await app.ready();
  return app;
}

describe('Dashboard Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecurityAudit.mockResolvedValue([]);
  });

  describe('GET /api/dashboard/summary', () => {
    it('fetches containers from ALL up endpoints (no 5-endpoint cap)', async () => {
      // Create 8 endpoints — all should be queried
      const endpoints = Array.from({ length: 8 }, (_, i) =>
        makeEndpoint(i + 1, `ep-${i + 1}`),
      );
      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue([makeContainer(`c-1`, Date.now())]);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });

      expect(res.statusCode).toBe(200);
      // getContainers should have been called once per endpoint (8 times, not 5)
      expect(mockGetContainers).toHaveBeenCalledTimes(8);
      for (let i = 1; i <= 8; i++) {
        expect(mockGetContainers).toHaveBeenCalledWith(i);
      }

      await app.close();
    });

    it('defaults recentLimit to 20', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      mockGetEndpoints.mockResolvedValue(endpoints);
      // Return 30 containers
      const containers = Array.from({ length: 30 }, (_, i) =>
        makeContainer(`c-${i}`, 1000 + i),
      );
      mockGetContainers.mockResolvedValue(containers);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });

      expect(res.statusCode).toBe(200);
      expect(res.json().recentContainers).toHaveLength(20);

      await app.close();
    });

    it('respects recentLimit query parameter', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      mockGetEndpoints.mockResolvedValue(endpoints);
      const containers = Array.from({ length: 30 }, (_, i) =>
        makeContainer(`c-${i}`, 1000 + i),
      );
      mockGetContainers.mockResolvedValue(containers);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary?recentLimit=5' });

      expect(res.statusCode).toBe(200);
      expect(res.json().recentContainers).toHaveLength(5);

      await app.close();
    });

    it('caps recentLimit at 50', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      mockGetEndpoints.mockResolvedValue(endpoints);
      const containers = Array.from({ length: 60 }, (_, i) =>
        makeContainer(`c-${i}`, 1000 + i),
      );
      mockGetContainers.mockResolvedValue(containers);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary?recentLimit=100' });

      // Zod max(50) should reject values > 50 with a 400
      expect(res.statusCode).toBe(400);

      await app.close();
    });

    it('skips down endpoints when fetching containers', async () => {
      const endpoints = [
        makeEndpoint(1, 'ep-up', 'up'),
        makeEndpoint(2, 'ep-down', 'down'),
      ];
      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue([makeContainer('c-1', Date.now())]);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });

      expect(res.statusCode).toBe(200);
      // Only the 'up' endpoint should have been queried
      expect(mockGetContainers).toHaveBeenCalledTimes(1);
      expect(mockGetContainers).toHaveBeenCalledWith(1);

      await app.close();
    });
  });

  describe('GET /api/dashboard/kpi-history', () => {
    it('returns snapshots', async () => {
      const app = await buildApp();

      mockGetKpiHistory.mockReturnValue([
        {
          endpoints: 1,
          endpoints_up: 1,
          endpoints_down: 0,
          running: 2,
          stopped: 1,
          healthy: 2,
          unhealthy: 1,
          total: 3,
          stacks: 1,
          timestamp: '2026-02-07 12:00:00',
        },
      ]);

      const res = await app.inject({ method: 'GET', url: '/api/dashboard/kpi-history?hours=24' });
      expect(res.statusCode).toBe(200);
      expect(res.json().snapshots).toHaveLength(1);
      expect(mockGetKpiHistory).toHaveBeenCalledWith(24);

      await app.close();
    });

    it('falls back to empty snapshots on store error', async () => {
      const app = await buildApp();

      mockGetKpiHistory.mockImplementation(() => {
        throw new Error('no such table: kpi_snapshots');
      });

      const res = await app.inject({ method: 'GET', url: '/api/dashboard/kpi-history?hours=24' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ snapshots: [] });

      await app.close();
    });
  });
});
