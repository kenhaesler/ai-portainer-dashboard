import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
});
