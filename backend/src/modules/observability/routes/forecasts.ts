import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { getCapacityForecasts, generateForecast, lookupContainerName } from '../services/capacity-forecaster.js';
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- Phase 3: replace with @dashboard/contracts AI interface
import { chatStream } from '../../ai-intelligence/services/llm-client.js';
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- Phase 3: replace with @dashboard/contracts AI interface
import { getEffectivePrompt } from '../../ai-intelligence/services/prompt-store.js';
import { createChildLogger } from '../../../core/utils/logger.js';

const log = createChildLogger('routes:forecasts');

const ForecastsQuerySchema = z.object({
  limit: z.coerce.number().optional().default(10),
});

const ForecastParamsSchema = z.object({
  containerId: z.string(),
});

const ForecastDetailQuerySchema = z.object({
  metric: z.string().optional().default('cpu'),
  hours: z.coerce.number().optional().default(24),
});

const NarrativeQuerySchema = z.object({
  metricType: z.enum(['cpu', 'memory']).optional().default('cpu'),
});

// Simple in-memory cache for narratives (5 min TTL)
const NARRATIVE_TTL = 5 * 60 * 1000;
const narrativeCache = new Map<string, { narrative: string; expiresAt: number }>();

/** Clear the narrative cache (for testing) */
export function clearNarrativeCache() {
  narrativeCache.clear();
}

export function buildForecastPrompt(forecast: {
  containerName: string;
  metricType: string;
  currentValue: number;
  trend: string;
  slope: number;
  r_squared: number;
  timeToThreshold: number | null;
  confidence: string;
}): string {
  const threshold = forecast.timeToThreshold !== null
    ? `predicted to reach 90% in ~${forecast.timeToThreshold} hours`
    : 'not predicted to breach 90% within the forecast window';

  return `Explain this capacity forecast in 2-3 plain-English sentences for a DevOps user. Be actionable — say what they should do (or that no action is needed). Mention the confidence level and what R² means in this context. Do NOT use bullet points, headings, or markdown.

Container: ${forecast.containerName}
Metric: ${forecast.metricType}
Current value: ${forecast.currentValue.toFixed(1)}%
Trend: ${forecast.trend}
Slope: ${forecast.slope.toFixed(2)}%/hour
R² (model fit): ${forecast.r_squared.toFixed(3)}
Threshold: ${threshold}
Confidence: ${forecast.confidence}`;
}

export async function forecastRoutes(fastify: FastifyInstance) {
  fastify.get('/api/forecasts', {
    schema: {
      tags: ['Forecasts'],
      summary: 'Get capacity forecasts for all containers',
      security: [{ bearerAuth: [] }],
      querystring: ForecastsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { limit } = request.query as z.infer<typeof ForecastsQuerySchema>;
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit ?? 10)));
    const startedAt = Date.now();
    const forecasts = await getCapacityForecasts(safeLimit);
    request.log.info({
      limit: safeLimit,
      forecastCount: forecasts.length,
      durationMs: Date.now() - startedAt,
    }, 'Computed forecast overview');
    return forecasts;
  });

  fastify.get('/api/forecasts/:containerId', {
    schema: {
      tags: ['Forecasts'],
      summary: 'Get capacity forecast for a specific container',
      security: [{ bearerAuth: [] }],
      params: ForecastParamsSchema,
      querystring: ForecastDetailQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { containerId } = request.params as z.infer<typeof ForecastParamsSchema>;
    const { metric, hours } = request.query as z.infer<typeof ForecastDetailQuerySchema>;
    const containerName = await lookupContainerName(containerId);
    const forecast = await generateForecast(
      containerId,
      containerName,
      metric,
      90,
      hours,
      hours,
    );
    if (!forecast) {
      return { error: 'Insufficient data for forecast' };
    }
    return forecast;
  });

  // AI narrative for a forecast
  fastify.get('/api/forecasts/:containerId/narrative', {
    schema: {
      tags: ['Forecasts'],
      summary: 'Get AI-generated narrative for a capacity forecast',
      security: [{ bearerAuth: [] }],
      params: ForecastParamsSchema,
      querystring: NarrativeQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { containerId } = request.params as z.infer<typeof ForecastParamsSchema>;
    const { metricType } = request.query as z.infer<typeof NarrativeQuerySchema>;

    // Check cache
    const cacheKey = `${containerId}:${metricType}`;
    const cached = narrativeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { narrative: cached.narrative };
    }

    // Generate forecast data
    const containerName = await lookupContainerName(containerId);
    const forecast = await generateForecast(containerId, containerName, metricType, 90, 24, 24);
    if (!forecast) {
      return { narrative: null };
    }

    // Build prompt and call LLM
    const prompt = buildForecastPrompt(forecast);
    try {
      const narrative = await chatStream(
        [{ role: 'user', content: prompt }],
        await getEffectivePrompt('capacity_forecast'),
        () => {}, // no streaming needed for this endpoint
      );

      const trimmed = narrative.trim();
      narrativeCache.set(cacheKey, { narrative: trimmed, expiresAt: Date.now() + NARRATIVE_TTL });
      return { narrative: trimmed };
    } catch (err) {
      log.warn({ err, containerId, metricType }, 'Failed to generate forecast narrative');
      return { narrative: null };
    }
  });
}
