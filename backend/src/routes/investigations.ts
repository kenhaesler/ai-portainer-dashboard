import { FastifyInstance } from 'fastify';
import {
  getInvestigations,
  getInvestigation,
  getInvestigationByInsightId,
} from '../services/investigation-store.js';
import type { InvestigationStatus } from '../models/investigation.js';

export async function investigationRoutes(fastify: FastifyInstance) {
  fastify.get('/api/investigations', {
    schema: {
      tags: ['Investigations'],
      summary: 'List investigations with optional filters',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'gathering', 'analyzing', 'complete', 'failed'] },
          container_id: { type: 'string' },
          limit: { type: 'number', default: 50 },
          offset: { type: 'number', default: 0 },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { status, container_id, limit = 50, offset = 0 } = request.query as {
      status?: InvestigationStatus;
      container_id?: string;
      limit?: number;
      offset?: number;
    };

    const investigations = getInvestigations({ status, container_id, limit, offset });
    return { investigations };
  });

  fastify.get('/api/investigations/:id', {
    schema: {
      tags: ['Investigations'],
      summary: 'Get a single investigation by ID',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const investigation = getInvestigation(id);

    if (!investigation) {
      return reply.status(404).send({ error: 'Investigation not found' });
    }

    return investigation;
  });

  fastify.get('/api/investigations/by-insight/:insightId', {
    schema: {
      tags: ['Investigations'],
      summary: 'Get investigation by triggering insight ID',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { insightId: { type: 'string' } },
        required: ['insightId'],
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { insightId } = request.params as { insightId: string };
    const investigation = getInvestigationByInsightId(insightId);

    if (!investigation) {
      return reply.status(404).send({ error: 'No investigation found for this insight' });
    }

    return investigation;
  });
}
