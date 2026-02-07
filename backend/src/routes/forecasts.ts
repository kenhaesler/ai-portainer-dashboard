import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getCapacityForecasts, generateForecast, lookupContainerName } from '../services/capacity-forecaster.js';

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
    return getCapacityForecasts(limit);
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
    const containerName = lookupContainerName(containerId);
    const forecast = generateForecast(
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
}
