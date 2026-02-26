import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { forecastRoutes, buildForecastPrompt, clearNarrativeCache } from '../routes/forecasts.js';

const mockGetCapacityForecasts = vi.fn();
const mockGenerateForecast = vi.fn();
const mockLookupContainerName = vi.fn();

// Kept: capacity-forecaster mock — no TimescaleDB in CI
vi.mock('../services/capacity-forecaster.js', () => ({
  getCapacityForecasts: (...args: unknown[]) => mockGetCapacityForecasts(...args),
  generateForecast: (...args: unknown[]) => mockGenerateForecast(...args),
  lookupContainerName: (...args: unknown[]) => mockLookupContainerName(...args),
}));

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('../../ai-intelligence/services/llm-client.js', async (importOriginal) => await importOriginal());

import * as llmClient from '../../ai-intelligence/services/llm-client.js';
let mockChatStream: any;

// Kept: prompt-store mock — no PostgreSQL in CI
vi.mock('../../ai-intelligence/services/prompt-store.js', () => ({
  getEffectivePrompt: vi.fn().mockReturnValue('You are a concise infrastructure analyst.'),
}));

describe('Forecast Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockChatStream = vi.spyOn(llmClient, 'chatStream');
    clearNarrativeCache();
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

  describe('GET /api/forecasts/:containerId/narrative', () => {
    const mockForecast = {
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
    };

    it('returns AI-generated narrative for a forecast', async () => {
      mockLookupContainerName.mockResolvedValue('web-server');
      mockGenerateForecast.mockResolvedValue(mockForecast);
      mockChatStream.mockResolvedValue('CPU is rising steadily. Consider scaling soon.');

      const res = await app.inject({
        method: 'GET',
        url: '/api/forecasts/abc123/narrative?metricType=cpu',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.narrative).toBe('CPU is rising steadily. Consider scaling soon.');
      expect(mockChatStream).toHaveBeenCalledTimes(1);
    });

    it('returns null narrative when forecast data is insufficient', async () => {
      mockLookupContainerName.mockResolvedValue('web-server');
      mockGenerateForecast.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/forecasts/abc123/narrative?metricType=cpu',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ narrative: null });
      expect(mockChatStream).not.toHaveBeenCalled();
    });

    it('returns null narrative when LLM fails', async () => {
      mockLookupContainerName.mockResolvedValue('web-server');
      mockGenerateForecast.mockResolvedValue(mockForecast);
      mockChatStream.mockRejectedValue(new Error('Ollama down'));

      const res = await app.inject({
        method: 'GET',
        url: '/api/forecasts/abc123/narrative?metricType=cpu',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ narrative: null });
    });

    it('defaults metricType to cpu', async () => {
      mockLookupContainerName.mockResolvedValue('web-server');
      mockGenerateForecast.mockResolvedValue(mockForecast);
      mockChatStream.mockResolvedValue('All good.');

      await app.inject({
        method: 'GET',
        url: '/api/forecasts/abc123/narrative',
      });

      expect(mockGenerateForecast).toHaveBeenCalledWith(
        'abc123', 'web-server', 'cpu', 90, 24, 24,
      );
    });
  });
});

describe('buildForecastPrompt', () => {
  it('includes all forecast fields in the prompt', () => {
    const prompt = buildForecastPrompt({
      containerName: 'api-server',
      metricType: 'memory',
      currentValue: 82.5,
      trend: 'increasing',
      slope: 1.2,
      r_squared: 0.91,
      timeToThreshold: 4,
      confidence: 'high',
    });

    expect(prompt).toContain('api-server');
    expect(prompt).toContain('memory');
    expect(prompt).toContain('82.5%');
    expect(prompt).toContain('increasing');
    expect(prompt).toContain('1.20%/hour');
    expect(prompt).toContain('0.910');
    expect(prompt).toContain('~4 hours');
    expect(prompt).toContain('high');
  });

  it('handles null timeToThreshold', () => {
    const prompt = buildForecastPrompt({
      containerName: 'worker',
      metricType: 'cpu',
      currentValue: 10,
      trend: 'stable',
      slope: 0.01,
      r_squared: 0.15,
      timeToThreshold: null,
      confidence: 'low',
    });

    expect(prompt).toContain('not predicted to breach 90%');
    expect(prompt).not.toContain('~null');
  });
});
