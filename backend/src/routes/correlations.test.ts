import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { correlationRoutes } from './correlations.js';

const mockDetectCorrelated = vi.fn();

vi.mock('../services/metric-correlator.js', () => ({
  detectCorrelatedAnomalies: (...args: unknown[]) => mockDetectCorrelated(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Correlation Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.decorate('authenticate', async () => undefined);
    await app.register(correlationRoutes);
    await app.ready();
  });

  it('GET /api/anomalies/correlated returns correlated anomalies', async () => {
    mockDetectCorrelated.mockReturnValue([
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
    mockDetectCorrelated.mockReturnValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/anomalies/correlated',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
