import { FastifyInstance } from 'fastify';
import { getCapacityForecasts, generateForecast } from '../services/capacity-forecaster.js';

export async function forecastRoutes(fastify: FastifyInstance) {
  fastify.get('/api/forecasts', {
    schema: {
      tags: ['Forecasts'],
      summary: 'Get capacity forecasts for all containers',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 10 },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { limit } = request.query as { limit?: number };
    return getCapacityForecasts(limit ?? 10);
  });

  fastify.get<{ Params: { containerId: string }; Querystring: { metric?: string; hours?: number } }>(
    '/api/forecasts/:containerId',
    {
      schema: {
        tags: ['Forecasts'],
        summary: 'Get capacity forecast for a specific container',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['containerId'],
          properties: {
            containerId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            metric: { type: 'string', default: 'cpu' },
            hours: { type: 'number', default: 24 },
          },
        },
      },
      preHandler: [fastify.authenticate],
    },
    async (request) => {
      const { containerId } = request.params;
      const { metric, hours } = request.query;
      const forecast = generateForecast(
        containerId,
        '',
        metric ?? 'cpu',
        90,
        hours ?? 24,
        hours ?? 24,
      );
      if (!forecast) {
        return { error: 'Insufficient data for forecast' };
      }
      return forecast;
    },
  );
}
