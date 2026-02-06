import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { forecastRoutes } from './forecasts.js';

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({}),
}));

const mockGetCapacityForecasts = vi.fn();
const mockGenerateForecast = vi.fn();

vi.mock('../services/capacity-forecaster.js', () => ({
  getCapacityForecasts: (...args: unknown[]) => mockGetCapacityForecasts(...args),
  generateForecast: (...args: unknown[]) => mockGenerateForecast(...args),
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
    app.decorate('authenticate', async () => undefined);
    await app.register(forecastRoutes);
    await app.ready();
  });

  it('GET /api/forecasts returns forecast list', async () => {
    mockGetCapacityForecasts.mockReturnValue([
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

  it('GET /api/forecasts/:containerId returns single forecast', async () => {
    mockGenerateForecast.mockReturnValue({
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

  it('returns error when insufficient data', async () => {
    mockGenerateForecast.mockReturnValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/forecasts/nodata',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error).toBe('Insufficient data for forecast');
  });
});
