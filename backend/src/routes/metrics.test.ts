import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { metricsRoutes } from './metrics.js';

vi.mock('../db/sqlite.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
    })),
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
