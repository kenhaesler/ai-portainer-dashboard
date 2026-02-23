import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { correlationRoutes, clearInsightsCache, clearCorrelationsCache, buildCorrelationPrompt, parseInsightsResponse } from './correlations.js';
import type { CorrelationPair } from '../services/metric-correlator.js';

const mockDetectCorrelated = vi.fn();
const mockFindCorrelatedContainers = vi.fn();

// Kept: metric-correlator mock — no TimescaleDB in CI
vi.mock('../services/metric-correlator.js', () => ({
  detectCorrelatedAnomalies: (...args: unknown[]) => mockDetectCorrelated(...args),
  findCorrelatedContainers: (...args: unknown[]) => mockFindCorrelatedContainers(...args),
}));

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('../services/llm-client.js', async (importOriginal) => await importOriginal());

import * as llmClient from '../services/llm-client.js';
let mockChatStream: any;

// Kept: prompt-store mock — no PostgreSQL in CI
vi.mock('../services/prompt-store.js', () => ({
  getEffectivePrompt: vi.fn().mockReturnValue('You are a test assistant.'),
}));

// withStatementTimeout in correlations.ts calls getMetricsDb() → pool.connect()
const mockClientRelease = vi.fn();
const mockClientQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockConnect = vi.fn().mockResolvedValue({
  query: (...args: unknown[]) => mockClientQuery(...args),
  release: mockClientRelease,
});

// Kept: timescale mock — no TimescaleDB in CI
vi.mock('../core/db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ connect: () => mockConnect() }),
}));

const mockIsUndefinedTableError = vi.fn().mockReturnValue(false);
// Kept: metrics-store mock — no TimescaleDB in CI
vi.mock('../services/metrics-store.js', () => ({
  isUndefinedTableError: (...args: unknown[]) => mockIsUndefinedTableError(...args),
}));

const samplePairs: CorrelationPair[] = [
  {
    containerA: { id: 'a1', name: 'nginx-proxy' },
    containerB: { id: 'b1', name: 'api-server' },
    metricType: 'cpu',
    correlation: 0.94,
    strength: 'very_strong',
    direction: 'positive',
    sampleCount: 100,
  },
  {
    containerA: { id: 'c1', name: 'postgres' },
    containerB: { id: 'd1', name: 'redis-cache' },
    metricType: 'memory',
    correlation: -0.87,
    strength: 'strong',
    direction: 'negative',
    sampleCount: 80,
  },
];

describe('Correlation Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockChatStream = vi.spyOn(llmClient, 'chatStream');
    clearInsightsCache();
    clearCorrelationsCache();
    mockConnect.mockResolvedValue({
      query: (...args: unknown[]) => mockClientQuery(...args),
      release: mockClientRelease,
    });
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockIsUndefinedTableError.mockReturnValue(false);
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(correlationRoutes);
    await app.ready();
  });

  describe('GET /api/anomalies/correlated', () => {
    it('returns correlated anomalies', async () => {
      mockDetectCorrelated.mockResolvedValue([
        {
          containerId: 'abc',
          containerName: 'web',
          metrics: [
            { type: 'cpu', currentValue: 95, mean: 50, zScore: 4.5 },
            { type: 'memory', currentValue: 88, mean: 60, zScore: 3.2 },
          ],
          compositeScore: 3.9,
          pattern: 'Resource Exhaustion',
          severity: 'high',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/anomalies/correlated',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].pattern).toBe('Resource Exhaustion');
      expect(body[0].severity).toBe('high');
    });

    it('returns empty array when no correlated anomalies', async () => {
      mockDetectCorrelated.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/anomalies/correlated',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('serves cached result on repeat request (5-min TTL)', async () => {
      mockDetectCorrelated.mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/api/anomalies/correlated' });
      expect(mockDetectCorrelated).toHaveBeenCalledTimes(1);

      // Second call — should hit cache, service not called again
      await app.inject({ method: 'GET', url: '/api/anomalies/correlated' });
      expect(mockDetectCorrelated).toHaveBeenCalledTimes(1);
    });

    it('applies statement_timeout and passes client to service', async () => {
      mockDetectCorrelated.mockResolvedValue([]);

      const res = await app.inject({ method: 'GET', url: '/api/anomalies/correlated' });
      expect(res.statusCode).toBe(200);

      // The SET statement_timeout query should have been executed
      expect(mockClientQuery).toHaveBeenCalledWith('SET statement_timeout = 10000');
      expect(mockClientRelease).toHaveBeenCalled();
      // Client is passed as 3rd argument so queries use the timeout-protected connection
      expect(mockDetectCorrelated).toHaveBeenCalledWith(
        30, 2,
        expect.objectContaining({ query: expect.any(Function) }),
      );
    });

    it('returns 503 when metrics table is not ready', async () => {
      mockDetectCorrelated.mockRejectedValue(new Error('relation "metrics" does not exist'));
      mockIsUndefinedTableError.mockReturnValue(true);

      const res = await app.inject({
        method: 'GET',
        url: '/api/anomalies/correlated',
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error).toBe('Metrics database not ready');
    });
  });

  describe('GET /api/metrics/correlations', () => {
    it('returns cross-container correlation pairs', async () => {
      mockFindCorrelatedContainers.mockResolvedValue(samplePairs);

      const res = await app.inject({
        method: 'GET',
        url: '/api/metrics/correlations',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pairs).toHaveLength(2);
      expect(body.pairs[0].containerA.name).toBe('nginx-proxy');
      expect(body.pairs[0].correlation).toBe(0.94);
    });

    it('respects hours and minCorrelation query params', async () => {
      mockFindCorrelatedContainers.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/api/metrics/correlations?hours=6&minCorrelation=0.8',
      });

      expect(mockFindCorrelatedContainers).toHaveBeenCalledWith(
        6, 0.8,
        expect.objectContaining({ query: expect.any(Function) }),
      );
    });

    it('clamps hours to safe range', async () => {
      mockFindCorrelatedContainers.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/api/metrics/correlations?hours=9999',
      });

      expect(mockFindCorrelatedContainers).toHaveBeenCalledWith(
        168, 0.7,
        expect.objectContaining({ query: expect.any(Function) }),
      );
    });

    it('serves cached pairs on repeat request', async () => {
      mockFindCorrelatedContainers.mockResolvedValue(samplePairs);

      await app.inject({ method: 'GET', url: '/api/metrics/correlations' });
      expect(mockFindCorrelatedContainers).toHaveBeenCalledTimes(1);

      await app.inject({ method: 'GET', url: '/api/metrics/correlations' });
      expect(mockFindCorrelatedContainers).toHaveBeenCalledTimes(1);
    });

    it('applies statement_timeout and passes client to service', async () => {
      mockFindCorrelatedContainers.mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/api/metrics/correlations' });

      expect(mockClientQuery).toHaveBeenCalledWith('SET statement_timeout = 10000');
      expect(mockClientRelease).toHaveBeenCalled();
      // Client is passed as 3rd argument so queries use the timeout-protected connection
      expect(mockFindCorrelatedContainers).toHaveBeenCalledWith(
        24, 0.7,
        expect.objectContaining({ query: expect.any(Function) }),
      );
    });

    it('returns 503 when metrics table is not ready', async () => {
      mockFindCorrelatedContainers.mockRejectedValue(new Error('relation "metrics" does not exist'));
      mockIsUndefinedTableError.mockReturnValue(true);

      const res = await app.inject({
        method: 'GET',
        url: '/api/metrics/correlations',
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('Metrics database not ready');
    });
  });

  describe('GET /api/metrics/correlations/insights', () => {
    it('returns LLM-generated insights', async () => {
      mockFindCorrelatedContainers.mockResolvedValue(samplePairs);
      mockChatStream.mockResolvedValue(
        '1. Strong CPU coupling between nginx-proxy and api-server due to proxied requests.\n' +
        '2. Inverse memory relationship between postgres and redis suggests cache eviction.\n' +
        'SUMMARY: Your stack shows tight coupling in the request path.',
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/metrics/correlations/insights',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.insights).toHaveLength(2);
      expect(body.insights[0].narrative).toContain('CPU coupling');
      expect(body.insights[1].narrative).toContain('cache eviction');
      expect(body.summary).toContain('tight coupling');
    });

    it('returns empty insights when no correlations found', async () => {
      mockFindCorrelatedContainers.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/metrics/correlations/insights',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.insights).toEqual([]);
      expect(body.summary).toBeNull();
      expect(mockChatStream).not.toHaveBeenCalled();
    });

    it('returns fallback insights when LLM fails', async () => {
      mockFindCorrelatedContainers.mockResolvedValue(samplePairs);
      mockChatStream.mockRejectedValue(new Error('Ollama down'));

      const res = await app.inject({
        method: 'GET',
        url: '/api/metrics/correlations/insights',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.insights).toHaveLength(2);
      expect(body.insights[0].narrative).toBeNull();
      expect(body.summary).toBeNull();
    });

    it('serves cached insights on repeat request', async () => {
      mockFindCorrelatedContainers.mockResolvedValue(samplePairs);
      mockChatStream.mockResolvedValue('1. Test\nSUMMARY: Test summary.');

      // First call
      await app.inject({ method: 'GET', url: '/api/metrics/correlations/insights' });
      expect(mockChatStream).toHaveBeenCalledTimes(1);

      // Second call — should hit cache
      const res = await app.inject({ method: 'GET', url: '/api/metrics/correlations/insights' });
      expect(res.statusCode).toBe(200);
      expect(mockChatStream).toHaveBeenCalledTimes(1); // not called again
    });

    it('applies statement_timeout and passes client for the correlation query', async () => {
      mockFindCorrelatedContainers.mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/api/metrics/correlations/insights' });

      expect(mockClientQuery).toHaveBeenCalledWith('SET statement_timeout = 10000');
      expect(mockClientRelease).toHaveBeenCalled();
      expect(mockFindCorrelatedContainers).toHaveBeenCalledWith(
        24, 0.7,
        expect.objectContaining({ query: expect.any(Function) }),
      );
    });
  });
});

describe('buildCorrelationPrompt', () => {
  it('includes all pair details in the prompt', () => {
    const prompt = buildCorrelationPrompt(samplePairs);

    expect(prompt).toContain('nginx-proxy');
    expect(prompt).toContain('api-server');
    expect(prompt).toContain('0.940');
    expect(prompt).toContain('positively');
    expect(prompt).toContain('postgres');
    expect(prompt).toContain('redis-cache');
    expect(prompt).toContain('-0.870');
    expect(prompt).toContain('inversely');
    expect(prompt).toContain('SUMMARY:');
  });
});

describe('parseInsightsResponse', () => {
  it('parses numbered explanations and summary', () => {
    const response = `1. Nginx and API server are tightly coupled through request forwarding.
2. Postgres and Redis show inverse memory patterns due to cache eviction policies.
SUMMARY: The stack has two notable correlations worth monitoring.`;

    const { insights, summary } = parseInsightsResponse(response, samplePairs);

    expect(insights).toHaveLength(2);
    expect(insights[0].narrative).toContain('tightly coupled');
    expect(insights[0].containerA).toBe('nginx-proxy');
    expect(insights[1].narrative).toContain('cache eviction');
    expect(summary).toContain('two notable correlations');
  });

  it('handles response without summary', () => {
    const response = `1. First pair explanation.
2. Second pair explanation.`;

    const { insights, summary } = parseInsightsResponse(response, samplePairs);

    expect(insights).toHaveLength(2);
    expect(insights[0].narrative).toBe('First pair explanation.');
    expect(summary).toBeNull();
  });

  it('returns null narrative when line not found', () => {
    const response = 'Some unstructured response without numbering.';

    const { insights } = parseInsightsResponse(response, samplePairs);

    expect(insights).toHaveLength(2);
    expect(insights[0].narrative).toBeNull();
    expect(insights[1].narrative).toBeNull();
  });
});
