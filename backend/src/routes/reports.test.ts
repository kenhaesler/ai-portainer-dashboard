import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { reportsRoutes } from './reports.js';

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('../db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: (...args: unknown[]) => mockQuery(...args) }),
}));

vi.mock('../services/metrics-rollup-selector.js', () => ({
  selectRollupTable: vi.fn().mockReturnValue({
    table: 'metrics',
    timestampCol: 'timestamp',
    valueCol: 'value',
    isRollup: false,
  }),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Reports routes', () => {
  const app = Fastify({ logger: false });

  beforeAll(async () => {
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(reportsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('GET /api/reports/utilization', () => {
    it('returns empty report when no metrics exist', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=24h',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.timeRange).toBe('24h');
      expect(body.containers).toEqual([]);
      expect(body.fleetSummary.totalContainers).toBe(0);
      expect(body.recommendations).toEqual([]);
    });

    it('returns aggregated data for containers', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'c1',
              container_name: 'web',
              endpoint_id: 1,
              metric_type: 'cpu',
              avg_value: 45.5,
              min_value: 10,
              max_value: 92,
              sample_count: 100,
            },
            {
              container_id: 'c1',
              container_name: 'web',
              endpoint_id: 1,
              metric_type: 'memory',
              avg_value: 60.2,
              min_value: 30,
              max_value: 88,
              sample_count: 100,
            },
          ],
        })
        // Percentile queries
        .mockResolvedValueOnce({
          rows: [{ p50: 50, p95: 95, p99: 99 }],
        })
        .mockResolvedValueOnce({
          rows: [{ p50: 55, p95: 85, p99: 90 }],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=7d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.timeRange).toBe('7d');
      expect(body.containers).toHaveLength(1);
      expect(body.containers[0].container_name).toBe('web');
      expect(body.containers[0].cpu).toBeTruthy();
      expect(body.containers[0].memory).toBeTruthy();
      expect(body.fleetSummary.totalContainers).toBe(1);
    });

    it('accepts optional endpointId filter', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=24h&endpointId=1',
      });

      expect(res.statusCode).toBe(200);
    });

    it('excludes infrastructure containers by default', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'infra-1',
              container_name: 'redis',
              endpoint_id: 1,
              metric_type: 'cpu',
              avg_value: 10,
              min_value: 5,
              max_value: 20,
              sample_count: 50,
            },
            {
              container_id: 'app-1',
              container_name: 'web',
              endpoint_id: 1,
              metric_type: 'cpu',
              avg_value: 60,
              min_value: 20,
              max_value: 95,
              sample_count: 50,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ p50: 40, p95: 90, p99: 95 }] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=7d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.includeInfrastructure).toBe(false);
      expect(body.containers).toHaveLength(1);
      expect(body.containers[0].container_name).toBe('web');
    });
  });

  describe('GET /api/reports/trends', () => {
    it('returns hourly trend data', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { hour: '2025-01-01T10:00:00', metric_type: 'cpu', avg_value: 40, max_value: 80, min_value: 5, sample_count: 60 },
          { hour: '2025-01-01T11:00:00', metric_type: 'cpu', avg_value: 45, max_value: 85, min_value: 8, sample_count: 60 },
          { hour: '2025-01-01T10:00:00', metric_type: 'memory', avg_value: 55, max_value: 70, min_value: 40, sample_count: 60 },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/trends?timeRange=24h',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.trends.cpu).toHaveLength(2);
      expect(body.trends.memory).toHaveLength(1);
      expect(body.trends.cpu[0].avg).toBe(40);
    });

    it('returns empty trends when no data', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/trends?timeRange=30d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.trends.cpu).toEqual([]);
      expect(body.trends.memory).toEqual([]);
    });
  });

  describe('GET /api/reports/management', () => {
    it('returns management report payload contract with default settings', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'app-1',
              container_name: 'web',
              endpoint_id: 1,
              cpu_avg: 65.2,
              cpu_max: 94,
              memory_avg: 70.1,
              memory_max: 91,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              day: '2025-01-01T00:00:00.000Z',
              metric_type: 'cpu',
              avg_value: 62,
              min_value: 20,
              max_value: 94,
              sample_count: 120,
            },
            {
              day: '2025-01-01T00:00:00.000Z',
              metric_type: 'memory',
              avg_value: 70,
              min_value: 35,
              max_value: 91,
              sample_count: 120,
            },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/management',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.reportType).toBe('management');
      expect(body.scope.timeRange).toBe('7d');
      expect(body.scope.includeInfrastructure).toBe(false);
      expect(body.executiveSummary.totalServices).toBe(1);
      expect(body.topServices).toHaveLength(1);
      expect(body.weeklyTrends.cpu).toHaveLength(1);
    });

    it('supports includeInfrastructure query parameter', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'infra-1',
              container_name: 'redis',
              endpoint_id: 1,
              cpu_avg: 20,
              cpu_max: 30,
              memory_avg: 30,
              memory_max: 45,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/management?includeInfrastructure=true',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.scope.includeInfrastructure).toBe(true);
      expect(body.topServices).toHaveLength(1);
      expect(body.topServices[0].containerName).toBe('redis');
    });
  });
});
