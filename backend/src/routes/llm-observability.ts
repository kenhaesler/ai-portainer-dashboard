import { FastifyInstance } from 'fastify';
import { getRecentTraces, getLlmStats, updateFeedback } from '../services/llm-trace-store.js';

export async function llmObservabilityRoutes(fastify: FastifyInstance) {
  fastify.get('/api/llm/traces', {
    schema: {
      tags: ['LLM'],
      summary: 'Get recent LLM interaction traces',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 50 },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { limit } = request.query as { limit?: number };
    return getRecentTraces(limit ?? 50);
  });

  fastify.get('/api/llm/stats', {
    schema: {
      tags: ['LLM'],
      summary: 'Get LLM usage statistics',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          hours: { type: 'number', default: 24 },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { hours } = request.query as { hours?: number };
    return getLlmStats(hours ?? 24);
  });

  fastify.post<{ Body: { traceId: string; score: number; text?: string } }>('/api/llm/feedback', {
    schema: {
      tags: ['LLM'],
      summary: 'Submit feedback for an LLM interaction',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['traceId', 'score'],
        properties: {
          traceId: { type: 'string' },
          score: { type: 'number', minimum: 1, maximum: 5 },
          text: { type: 'string' },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { traceId, score, text } = request.body;
    const updated = updateFeedback(traceId, score, text);
    return { success: updated };
  });
}
