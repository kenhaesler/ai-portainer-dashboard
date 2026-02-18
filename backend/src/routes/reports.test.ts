import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { reportsRoutes, clearReportCache } from './reports.js';

// The implementation acquires a pool client per request via pool.connect(),
// sets statement_timeout, then queries via client.query(). We mirror that here.
const mockClientQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockRelease = vi.fn();
const mockClient = {
  query: (...args: unknown[]) => mockClientQuery(...args),
  release: mockRelease,
};
const mockConnect = vi.fn().mockResolvedValue(mockClient);

vi.mock('../db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ connect: () => mockConnect() }),
}));

const mockSelectRollupTable = vi.fn().mockReturnValue({
  table: 'metrics',
  timestampCol: 'timestamp',
  valueCol: 'value',
  isRollup: false,
});

vi.mock('../services/metrics-rollup-selector.js', () => ({
  selectRollupTable: (...args: unknown[]) => mockSelectRollupTable(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../services/infrastructure-service-classifier.js', () => ({
  getInfrastructureServicePatterns: vi.fn().mockReturnValue(['traefik', 'portainer_agent', 'beyla', 'redis']),
  matchesInfrastructurePattern: vi.fn((name: string, patterns: string[]) => {
    const normalized = name.toLowerCase();
    return patterns.some((pattern) => (
      normalized === pattern
      || normalized.startsWith(`${pattern}-`)
      || normalized.startsWith(`${pattern}_`)
    ));
  }),
  isInfrastructureService: vi.fn((name: string) => {
    const normalized = name.toLowerCase();
    return ['traefik', 'portainer_agent', 'beyla', 'redis'].some((pattern) => (
      normalized === pattern
      || normalized.startsWith(`${pattern}-`)
      || normalized.startsWith(`${pattern}_`)
    ));
  }),
}));

vi.mock('../services/metrics-store.js', () => ({
  isUndefinedTableError: vi.fn().mockReturnValue(false),
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
    mockClientQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockReset().mockResolvedValue(mockClient);
    mockSelectRollupTable.mockReturnValue({
      table: 'metrics',
      timestampCol: 'timestamp',
      valueCol: 'value',
      isRollup: false,
    });
    clearReportCache();
  });

  describe('GET /api/reports/utilization', () => {
    it('returns empty report when no metrics exist', async () => {
      // First call: SET statement_timeout, second: main agg query (no rows)
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }); // main agg query

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
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
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
        // Percentile queries (always on raw metrics)
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
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }); // main agg query

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=24h&endpointId=1',
      });

      expect(res.statusCode).toBe(200);
    });

    it('excludes infrastructure containers by default', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
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
      expect(body.excludeInfrastructure).toBe(true);
      expect(body.containers).toHaveLength(1);
      expect(body.containers[0].container_name).toBe('web');
      expect(body.containers[0].service_type).toBe('application');
    });

    it('supports excludeInfrastructure=false query parameter', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
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
          ],
        })
        .mockResolvedValueOnce({ rows: [{ p50: 9, p95: 18, p99: 20 }] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?excludeInfrastructure=false',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.includeInfrastructure).toBe(true);
      expect(body.excludeInfrastructure).toBe(false);
      expect(body.containers).toHaveLength(1);
      expect(body.containers[0].service_type).toBe('infrastructure');
    });

    it('uses rollup table columns when isRollup=true', async () => {
      mockSelectRollupTable.mockReturnValue({
        table: 'metrics_5min',
        timestampCol: 'bucket',
        valueCol: 'avg_value',
        isRollup: true,
      });

      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'c1',
              container_name: 'api',
              endpoint_id: 1,
              metric_type: 'cpu',
              avg_value: 55,
              min_value: 10,
              max_value: 90,
              sample_count: 288,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ p50: 50, p95: 88, p99: 92 }] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=7d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.containers).toHaveLength(1);
      expect(body.containers[0].container_name).toBe('api');
      expect(body.containers[0].cpu.avg).toBe(55);
      expect(body.containers[0].cpu.p95).toBe(88);
      // Main agg query should reference the rollup table
      const aggCall = mockClientQuery.mock.calls.find(
        (c) => String(c[0]).includes('metrics_5min'),
      );
      expect(aggCall).toBeTruthy();
      // Percentile query must always use raw metrics table
      const pCall = mockClientQuery.mock.calls.find(
        (c) => String(c[0]).includes('percentile_cont') && String(c[0]).includes('FROM metrics'),
      );
      expect(pCall).toBeTruthy();
    });

    it('serves cached result on second request', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }); // agg query

      await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=24h' });
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Second request — cache hit, no new pool connection
      await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=24h' });
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/reports/trends', () => {
    it('returns hourly trend data', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
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
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }); // trend query

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/trends?timeRange=30d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.trends.cpu).toEqual([]);
      expect(body.trends.memory).toEqual([]);
    });

    it('uses time_bucket when rollup table is selected', async () => {
      mockSelectRollupTable.mockReturnValue({
        table: 'metrics_1hour',
        timestampCol: 'bucket',
        valueCol: 'avg_value',
        isRollup: true,
      });

      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            { hour: '2025-01-01T10:00:00', metric_type: 'cpu', avg_value: 38, max_value: 75, min_value: 5, sample_count: 12 },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/trends?timeRange=30d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.trends.cpu).toHaveLength(1);
      const trendCall = mockClientQuery.mock.calls.find(
        (c) => String(c[0]).includes('metrics_1hour'),
      );
      expect(trendCall).toBeTruthy();
      expect(String(trendCall![0])).toContain('time_bucket');
    });
  });

  describe('GET /api/reports/management', () => {
    it('returns management report payload contract with default settings', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
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
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
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

    it('uses rollup table columns for both queries when isRollup=true', async () => {
      mockSelectRollupTable.mockReturnValue({
        table: 'metrics_5min',
        timestampCol: 'bucket',
        valueCol: 'avg_value',
        isRollup: true,
      });

      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'c1',
              container_name: 'api',
              endpoint_id: 1,
              cpu_avg: 40,
              cpu_max: 80,
              memory_avg: 55,
              memory_max: 85,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              day: '2025-01-01T00:00:00.000Z',
              metric_type: 'cpu',
              avg_value: 40,
              min_value: 10,
              max_value: 80,
              sample_count: 1440,
            },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/management?timeRange=7d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.topServices).toHaveLength(1);
      expect(body.topServices[0].cpuAvg).toBe(40);

      // Both the top-services and trend queries should reference the rollup table
      const rollupCalls = mockClientQuery.mock.calls.filter(
        (c) => String(c[0]).includes('metrics_5min'),
      );
      expect(rollupCalls.length).toBeGreaterThanOrEqual(2);

      // The trend query should use time_bucket for rollup
      const trendCall = rollupCalls.find((c) => String(c[0]).includes('time_bucket'));
      expect(trendCall).toBeTruthy();
    });

    it('serves cached result on second request', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }) // top services
        .mockResolvedValueOnce({ rows: [] }); // trend rows

      await app.inject({ method: 'GET', url: '/api/reports/management' });
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Second identical request — cache hit, no new pool connection
      await app.inject({ method: 'GET', url: '/api/reports/management' });
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });
});
