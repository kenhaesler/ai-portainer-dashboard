import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { dashboardRoutes } from './dashboard.js';

const mockGetKpiHistory = vi.fn();
const mockGetEndpoints = vi.fn();
const mockGetContainers = vi.fn();
const mockGetSecurityAudit = vi.fn();
const mockCollectMetrics = vi.fn();

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
    normalizeContainer: (c: any, endpointId: number, endpointName: string) => ({
      id: c.Id,
      name: c.Names?.[0]?.replace('/', '') || c.Id,
      image: c.Image || 'unknown',
      state: c.State.toLowerCase(),
      status: c.Status || '',
      created: c.created || 0,
      endpointId,
      endpointName,
      ports: [],
      networks: [],
      networkIPs: {},
      labels: c.labels || {},
      healthStatus: undefined,
    }),
  };
});

vi.mock('../services/security-audit.js', () => ({
  getSecurityAudit: (...args: unknown[]) => mockGetSecurityAudit(...args),
  buildSecurityAuditSummary: () => ({ totalAudited: 0, flagged: 0, ignored: 0 }),
}));

vi.mock('../services/metrics-collector.js', () => ({
  collectMetrics: (...args: unknown[]) => mockCollectMetrics(...args),
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

function makeContainer(id: string, created: number, state = 'running', labels: Record<string, string> = {}) {
  return {
    Id: id,
    Names: [`/${id}`],
    State: state,
    Status: state === 'running' ? 'Up' : 'Exited',
    Image: 'nginx',
    created,
    labels,
  };
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

  describe('GET /api/dashboard/resources', () => {
    beforeEach(() => {
      mockCollectMetrics.mockResolvedValue({
        cpu: 45.5,
        memory: 62.3,
        memoryBytes: 1024 * 1024 * 500, // 500 MB
        networkRxBytes: 1000,
        networkTxBytes: 2000,
      });
    });

    it('aggregates fleet-wide CPU and memory usage', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      const containers = [
        makeContainer('c-1', 1000, 'running', { 'com.docker.compose.project': 'web' }),
        makeContainer('c-2', 1001, 'running', { 'com.docker.compose.project': 'api' }),
      ];

      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue(containers);
      mockCollectMetrics
        .mockResolvedValueOnce({ cpu: 40.0, memory: 50.0, memoryBytes: 1024 * 1024 * 400 })
        .mockResolvedValueOnce({ cpu: 60.0, memory: 70.0, memoryBytes: 1024 * 1024 * 600 });

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      // Average of 40 and 60 = 50
      expect(data.fleetCpuPercent).toBe(50);
      // Average of 50 and 70 = 60
      expect(data.fleetMemoryPercent).toBe(60);

      await app.close();
    });

    it('groups containers by stack name', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      const containers = [
        makeContainer('c-1', 1000, 'running', { 'com.docker.compose.project': 'web' }),
        makeContainer('c-2', 1001, 'running', { 'com.docker.compose.project': 'web' }),
        makeContainer('c-3', 1002, 'running', { 'com.docker.compose.project': 'api' }),
      ];

      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue(containers);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      expect(data.topStacks).toHaveLength(2);

      const webStack = data.topStacks.find((s: any) => s.name === 'web');
      expect(webStack).toBeDefined();
      expect(webStack.containerCount).toBe(2);
      expect(webStack.runningCount).toBe(2);

      const apiStack = data.topStacks.find((s: any) => s.name === 'api');
      expect(apiStack).toBeDefined();
      expect(apiStack.containerCount).toBe(1);
      expect(apiStack.runningCount).toBe(1);

      await app.close();
    });

    it('handles containers without stack label as "No Stack"', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      const containers = [
        makeContainer('c-1', 1000, 'running', {}), // No stack label
        makeContainer('c-2', 1001, 'running', { 'com.docker.compose.project': 'web' }),
      ];

      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue(containers);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      const noStack = data.topStacks.find((s: any) => s.name === 'No Stack');
      expect(noStack).toBeDefined();
      expect(noStack.containerCount).toBe(1);

      await app.close();
    });

    it('sorts stacks by combined CPU and memory usage', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      const containers = [
        makeContainer('c-1', 1000, 'running', { 'com.docker.compose.project': 'low' }),
        makeContainer('c-2', 1001, 'running', { 'com.docker.compose.project': 'high' }),
      ];

      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue(containers);
      mockCollectMetrics
        .mockResolvedValueOnce({ cpu: 10.0, memory: 10.0, memoryBytes: 1024 * 1024 * 100 }) // low stack
        .mockResolvedValueOnce({ cpu: 80.0, memory: 90.0, memoryBytes: 1024 * 1024 * 800 }); // high stack

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      // Should be sorted by total (CPU + Memory), so 'high' first
      expect(data.topStacks[0].name).toBe('high');
      expect(data.topStacks[1].name).toBe('low');

      await app.close();
    });

    it('respects topN query parameter', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      const containers = Array.from({ length: 15 }, (_, i) =>
        makeContainer(`c-${i}`, 1000 + i, 'running', { 'com.docker.compose.project': `stack-${i}` }),
      );

      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue(containers);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources?topN=5' });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      expect(data.topStacks).toHaveLength(5);

      await app.close();
    });

    it('caps topN at 20', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue([]);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources?topN=100' });

      // Zod max(20) should reject values > 20 with a 400
      expect(res.statusCode).toBe(400);

      await app.close();
    });

    it('returns 0% usage when no running containers', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      const containers = [
        makeContainer('c-1', 1000, 'stopped', { 'com.docker.compose.project': 'web' }),
      ];

      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue(containers);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      expect(data.fleetCpuPercent).toBe(0);
      expect(data.fleetMemoryPercent).toBe(0);
      expect(data.topStacks).toHaveLength(1);
      expect(data.topStacks[0].name).toBe('web');
      expect(data.topStacks[0].runningCount).toBe(0);
      expect(data.topStacks[0].stoppedCount).toBe(1);

      await app.close();
    });

    it('handles stats collection failures gracefully', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      const containers = [
        makeContainer('c-1', 1000, 'running', { 'com.docker.compose.project': 'web' }),
        makeContainer('c-2', 1001, 'running', { 'com.docker.compose.project': 'api' }),
      ];

      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue(containers);
      mockCollectMetrics
        .mockResolvedValueOnce({ cpu: 40.0, memory: 50.0, memoryBytes: 1024 * 1024 * 400 })
        .mockRejectedValueOnce(new Error('Stats not available'));

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      // Should still work with partial data (only c-1 has stats)
      expect(data.fleetCpuPercent).toBe(40);
      expect(data.fleetMemoryPercent).toBe(50);

      // Both stacks should still appear, but only 'web' has resource data
      expect(data.topStacks).toHaveLength(2);

      await app.close();
    });

    it('skips down endpoints when fetching containers', async () => {
      const endpoints = [
        makeEndpoint(1, 'ep-up', 'up'),
        makeEndpoint(2, 'ep-down', 'down'),
      ];
      const containers = [
        makeContainer('c-1', 1000, 'running', { 'com.docker.compose.project': 'web' }),
      ];

      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue(containers);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });

      expect(res.statusCode).toBe(200);
      // Only the 'up' endpoint should have been queried
      expect(mockGetContainers).toHaveBeenCalledTimes(1);
      expect(mockGetContainers).toHaveBeenCalledWith(1);

      await app.close();
    });

    it('returns 502 when Portainer is unreachable', async () => {
      mockGetEndpoints.mockRejectedValue(new Error('Connection refused'));

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({
        error: 'Unable to connect to Portainer',
      });

      await app.close();
    });

    it('includes running and stopped counts per stack', async () => {
      const endpoints = [makeEndpoint(1, 'ep-1')];
      const containers = [
        makeContainer('c-1', 1000, 'running', { 'com.docker.compose.project': 'web' }),
        makeContainer('c-2', 1001, 'running', { 'com.docker.compose.project': 'web' }),
        makeContainer('c-3', 1002, 'stopped', { 'com.docker.compose.project': 'web' }),
      ];

      mockGetEndpoints.mockResolvedValue(endpoints);
      mockGetContainers.mockResolvedValue(containers);

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      const webStack = data.topStacks[0];
      expect(webStack.name).toBe('web');
      expect(webStack.containerCount).toBe(3);
      expect(webStack.runningCount).toBe(2);
      expect(webStack.stoppedCount).toBe(1);

      await app.close();
    });
  });
});
