import { FastifyInstance } from 'fastify';
import { getRecentTraces, getLlmStats } from '../services/llm-trace-store.js';
import { LlmTracesQuerySchema, LlmStatsQuerySchema } from '../core/models/api-schemas.js';

export async function llmObservabilityRoutes(fastify: FastifyInstance) {
  fastify.get('/api/llm/traces', {
    schema: {
      tags: ['LLM'],
      summary: 'Get recent LLM interaction traces',
      security: [{ bearerAuth: [] }],
      querystring: LlmTracesQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { limit } = request.query as { limit: number };
    return getRecentTraces(limit);
  });

  fastify.get('/api/llm/stats', {
    schema: {
      tags: ['LLM'],
      summary: 'Get LLM usage statistics',
      security: [{ bearerAuth: [] }],
      querystring: LlmStatsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { hours } = request.query as { hours: number };
    return getLlmStats(hours);
  });
}
