import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { metricsRoutes } from './metrics.js';

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('../db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: (...args: unknown[]) => mockQuery(...args) }),
}));

vi.mock('../services/metrics-store.js', () => ({
  getNetworkRates: vi.fn(),
}));

vi.mock('../services/metrics-rollup-selector.js', () => ({
  selectRollupTable: vi.fn().mockReturnValue({
    table: 'metrics',
    timestampCol: 'timestamp',
    valueCol: 'value',
    isRollup: false,
  }),
}));

vi.mock('../services/lttb-decimator.js', () => ({
  decimateLTTB: vi.fn((data: unknown[]) => data),
}));

vi.mock('../services/llm-client.js', () => ({
  chatStream: vi.fn(),
  isOllamaAvailable: vi.fn(),
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
import { chatStream, isOllamaAvailable } from '../services/llm-client.js';
const mockGetNetworkRates = vi.mocked(getNetworkRates);
const mockChatStream = vi.mocked(chatStream);
const mockIsOllamaAvailable = vi.mocked(isOllamaAvailable);

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
    mockQuery.mockResolvedValue({ rows: [] });
  });

  describe('GET /api/metrics/:endpointId/:containerId', () => {
    it('should return metrics data with correct response shape', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { timestamp: '2024-01-01T00:00:00Z', value: 45.2 },
          { timestamp: '2024-01-01T00:01:00Z', value: 47.8 },
        ],
      });

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

      expect(mockQuery).toHaveBeenCalled();
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('endpoint_id = $1');
      expect(sql).toContain('container_id = $2');
      expect(sql).toContain('container_id LIKE $3');

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe(5);        // endpoint_id
      expect(params[1]).toBe('abc123'); // exact container_id
      expect(params[2]).toBe('abc123%'); // prefix match
      expect(params[3]).toBe('cpu');    // metric_type
    });

    it('should filter by metricType when provided', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?metricType=memory',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('metric_type =');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[3]).toBe('memory');
    });

    it('should not add metric_type filter when metricType is omitted', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?timeRange=1h',
      });

      const params = mockQuery.mock.calls[0][1] as unknown[];
      // Without metricType: endpointId, containerId, containerId%, timestamp_from, timestamp_to
      expect(params[0]).toBe(1);
      expect(params[1]).toBe('abc123');
      expect(params[2]).toBe('abc123%');
      // Fourth param should be a timestamp (ISO string), not a metric type
      expect(typeof params[3]).toBe('string');
      expect((params[3] as string).includes('T')).toBe(true);
    });

    it('should return empty data array when no metrics exist', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

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

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should support metric_type as alias for metricType', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?metric_type=memory_bytes',
      });

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toContain('memory_bytes');
    });

    it('should default metricType to cpu in response when not provided', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123',
      });

      const body = JSON.parse(response.body);
      expect(body.metricType).toBe('cpu');
    });

    it('should default timeRange to 1h when not provided', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

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
      mockGetNetworkRates.mockResolvedValue({
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
      mockGetNetworkRates.mockResolvedValue({});

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
      mockGetNetworkRates.mockResolvedValue({});

      await app.inject({
        method: 'GET',
        url: '/api/metrics/network-rates/42',
      });

      expect(mockGetNetworkRates).toHaveBeenCalledWith(42);
    });
  });

  describe('error handling', () => {
    it('should return 500 when metrics query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/1/abc123?metricType=cpu&timeRange=1h',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Failed to query metrics');
      expect(body.details).toContain('DB connection lost');
    });

    it('should return 500 when anomalies query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('timeout'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/anomalies?limit=10',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Failed to query anomalies');
    });

    it('should return 500 when network rates fail', async () => {
      mockGetNetworkRates.mockRejectedValueOnce(new Error('store error'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/network-rates/1',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Failed to fetch network rates');
    });
  });

  describe('GET /api/metrics/:endpointId/:containerId/ai-summary', () => {
    it('should return 503 when LLM is unavailable', async () => {
      mockIsOllamaAvailable.mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/1/container-abc/ai-summary',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('LLM service unavailable');
    });

    it('should stream SSE response when LLM is available', async () => {
      mockIsOllamaAvailable.mockResolvedValue(true);
      mockChatStream.mockImplementation(async (_msgs, _sys, onChunk) => {
        onChunk('CPU is stable.');
        return 'CPU is stable.';
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/1/container-abc/ai-summary?timeRange=1h',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.body).toContain('data: ');
      expect(response.body).toContain('"chunk"');
      expect(response.body).toContain('"done":true');
    });

    it('should pass correct time range to metrics query', async () => {
      mockIsOllamaAvailable.mockResolvedValue(true);
      mockChatStream.mockImplementation(async (_msgs, _sys, onChunk) => {
        onChunk('All good.');
        return 'All good.';
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/2/container-xyz/ai-summary?timeRange=24h',
      });

      expect(response.statusCode).toBe(200);
      // Verify chatStream was called with prompt containing "24h"
      expect(mockChatStream).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('24h'),
          }),
        ]),
        expect.any(String),
        expect.any(Function),
      );
    });

    it('should handle chatStream errors gracefully', async () => {
      mockIsOllamaAvailable.mockResolvedValue(true);
      mockChatStream.mockRejectedValue(new Error('Ollama timeout'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/metrics/1/container-abc/ai-summary',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"error"');
    });
  });
});
