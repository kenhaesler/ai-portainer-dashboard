import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { forecastRoutes } from './forecasts.js';

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({}),
}));

const mockGetCapacityForecasts = vi.fn();
const mockGenerateForecast = vi.fn();
const mockLookupContainerName = vi.fn();

vi.mock('../services/capacity-forecaster.js', () => ({
  getCapacityForecasts: (...args: unknown[]) => mockGetCapacityForecasts(...args),
  generateForecast: (...args: unknown[]) => mockGenerateForecast(...args),
  lookupContainerName: (...args: unknown[]) => mockLookupContainerName(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Forecast Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(forecastRoutes);
    await app.ready();
  });

  it('GET /api/forecasts returns forecast list', async () => {
    mockGetCapacityForecasts.mockResolvedValue([
      {
        containerId: 'abc123',
        containerName: 'web-server',
        metricType: 'cpu',
        currentValue: 75,
        trend: 'increasing',
        slope: 2.5,
        r_squared: 0.85,
        forecast: [],
        timeToThreshold: 6,
        confidence: 'high',
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/forecasts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].trend).toBe('increasing');
    expect(body[0].timeToThreshold).toBe(6);
  });

  it('clamps overview limit to safe maximum', async () => {
    mockGetCapacityForecasts.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/forecasts?limit=999',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetCapacityForecasts).toHaveBeenCalledWith(50);
  });

  it('GET /api/forecasts/:containerId returns single forecast', async () => {
    mockGenerateForecast.mockResolvedValue({
      containerId: 'abc123',
      containerName: 'web',
      metricType: 'cpu',
      currentValue: 60,
      trend: 'stable',
      slope: 0.01,
      r_squared: 0.2,
      forecast: [],
      timeToThreshold: null,
      confidence: 'low',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/forecasts/abc123?metric=cpu',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trend).toBe('stable');
  });

  it('looks up container name for per-container forecast', async () => {
    mockLookupContainerName.mockResolvedValue('my-container');
    mockGenerateForecast.mockResolvedValue({
      containerId: 'abc123',
      containerName: 'my-container',
      metricType: 'cpu',
      currentValue: 60,
      trend: 'stable',
      slope: 0.01,
      r_squared: 0.2,
      forecast: [],
      timeToThreshold: null,
      confidence: 'low',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/forecasts/abc123?metric=cpu',
    });

    expect(res.statusCode).toBe(200);
    expect(mockLookupContainerName).toHaveBeenCalledWith('abc123');
    expect(mockGenerateForecast).toHaveBeenCalledWith(
      'abc123',
      'my-container',
      'cpu',
      90,
      24,
      24,
    );
  });

  it('returns error when insufficient data', async () => {
    mockGenerateForecast.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/forecasts/nodata',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error).toBe('Insufficient data for forecast');
  });
});
