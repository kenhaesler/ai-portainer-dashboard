import { FastifyInstance } from 'fastify';
import { detectCorrelatedAnomalies } from '../services/metric-correlator.js';

export async function correlationRoutes(fastify: FastifyInstance) {
  fastify.get('/api/anomalies/correlated', {
    schema: {
      tags: ['Anomalies'],
      summary: 'Get multi-metric correlated anomalies',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          windowSize: { type: 'number', default: 30 },
          minScore: { type: 'number', default: 2 },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { windowSize, minScore } = request.query as { windowSize?: number; minScore?: number };
    return detectCorrelatedAnomalies(windowSize ?? 30, minScore ?? 2);
  });
}
