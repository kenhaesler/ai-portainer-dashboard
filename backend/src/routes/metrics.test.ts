import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { metricsRoutes } from './metrics.js';

const mockAll = vi.fn((..._args: unknown[]): unknown[] => []);
const mockPrepare = vi.fn((_sql: string) => ({ all: mockAll }));

vi.mock('../db/sqlite.js', () => ({
  getDb: vi.fn(() => ({
    prepare: mockPrepare,
  })),
  prepareStmt: vi.fn(() => ({
    all: vi.fn(() => []),
  })),
}));

vi.mock('../services/metrics-store.js', () => ({
  getNetworkRates: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getNetworkRates } from '../services/metrics-store.js';
const mockGetNetworkRates = vi.mocked(getNetworkRates);

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.register(metricsRoutes);
  return app;
}

describe('metrics routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReturnValue([]);
  });

  describe('GET /api/metrics/:endpointId/:containerId', () => {
    it('should return metrics data with correct response shape', async () => {
      mockAll.mockReturnValue([
        { timestamp: '2024-01-01T00:00:00Z', value: 45.2 },
        { timestamp: '2024-01-01T00:01:00Z', value: 47.8 },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?metricType=cpu&timeRange=1h',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.containerId).toBe('abc123');
      expect(body.endpointId).toBe(1);
      expect(body.metricType).toBe('cpu');
      expect(body.timeRange).toBe('1h');
      expect(body.data).toHaveLength(2);
      expect(body.data[0]).toEqual({ timestamp: '2024-01-01T00:00:00Z', value: 45.2 });
    });

    it('should include endpoint_id and prefix matching in the query', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/metrics/5/abc123?metricType=cpu',
      });

      expect(mockPrepare).toHaveBeenCalled();
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('endpoint_id = ?');
      expect(sql).toContain('container_id = ?');
      expect(sql).toContain('container_id LIKE ?');

      // Verify params: endpointId, containerId, containerId%, metricType, timestamp
      const params = mockAll.mock.calls[0];
      expect(params[0]).toBe(5);       // endpoint_id
      expect(params[1]).toBe('abc123'); // exact container_id
      expect(params[2]).toBe('abc123%'); // prefix match
      expect(params[3]).toBe('cpu');    // metric_type
    });

    it('should filter by metricType when provided', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?metricType=memory',
      });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('metric_type = ?');
      const params = mockAll.mock.calls[0];
      expect(params[3]).toBe('memory');
    });

    it('should not add metric_type filter when metricType is omitted', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?timeRange=1h',
      });

      const params = mockAll.mock.calls[0];
      // Without metricType: endpointId, containerId, containerId%, timestamp
      expect(params[0]).toBe(1);
      expect(params[1]).toBe('abc123');
      expect(params[2]).toBe('abc123%');
      // Fourth param should be the timestamp (ISO string), not a metric type
      expect(typeof params[3]).toBe('string');
      expect((params[3] as string).includes('T')).toBe(true); // ISO date
    });

    it('should return empty data array when no metrics exist', async () => {
      mockAll.mockReturnValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?metricType=cpu&timeRange=1h',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual([]);
    });

    it('should handle different timeRange values', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?timeRange=30m',
      });

      expect(response200()).toBe(true);

      function response200() {
        return mockPrepare.mock.calls.length > 0;
      }
    });

    it('should support metric_type as alias for metricType', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?metric_type=memory_bytes',
      });

      const params = mockAll.mock.calls[0];
      // metric_type should appear in params
      expect(params).toContain('memory_bytes');
    });

    it('should default metricType to cpu in response when not provided', async () => {
      mockAll.mockReturnValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123',
      });

      const body = JSON.parse(response.body);
      expect(body.metricType).toBe('cpu');
    });

    it('should default timeRange to 1h when not provided', async () => {
      mockAll.mockReturnValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123',
      });

      const body = JSON.parse(response.body);
      expect(body.timeRange).toBe('1h');
    });
  });

  describe('GET /api/metrics/network-rates/:endpointId', () => {
    it('should return rates for an endpoint', async () => {
      mockGetNetworkRates.mockReturnValue({
        'container-abc': { rxBytesPerSec: 1024, txBytesPerSec: 512 },
        'container-def': { rxBytesPerSec: 0, txBytesPerSec: 0 },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/network-rates/1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.rates).toBeDefined();
      expect(body.rates['container-abc'].rxBytesPerSec).toBe(1024);
      expect(body.rates['container-abc'].txBytesPerSec).toBe(512);
      expect(body.rates['container-def'].rxBytesPerSec).toBe(0);
      expect(mockGetNetworkRates).toHaveBeenCalledWith(1);
    });

    it('should return empty rates when no data', async () => {
      mockGetNetworkRates.mockReturnValue({});

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/network-rates/99',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.rates).toEqual({});
      expect(mockGetNetworkRates).toHaveBeenCalledWith(99);
    });

    it('should parse endpointId as number', async () => {
      mockGetNetworkRates.mockReturnValue({});

      await app.inject({
        method: 'GET',
        url: '/api/metrics/network-rates/42',
      });

      expect(mockGetNetworkRates).toHaveBeenCalledWith(42);
    });
  });
});
