import { FastifyInstance } from 'fastify';
import {
  getInvestigations,
  getInvestigation,
  getInvestigationByInsightId,
} from '../services/investigation-store.js';
import type { InvestigationStatus } from '@dashboard/core/models/investigation.js';
import { InvestigationsQuerySchema, InvestigationIdParamsSchema, InsightIdParamsForInvestigationSchema } from '@dashboard/core/models/api-schemas.js';

export async function investigationRoutes(fastify: FastifyInstance) {
  fastify.get('/api/investigations', {
    schema: {
      tags: ['Investigations'],
      summary: 'List investigations with optional filters',
      security: [{ bearerAuth: [] }],
      querystring: InvestigationsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { status, container_id, limit = 50, offset = 0 } = request.query as {
      status?: InvestigationStatus;
      container_id?: string;
      limit?: number;
      offset?: number;
    };

    const investigations = await getInvestigations({ status, container_id, limit, offset });
    return { investigations };
  });

  fastify.get('/api/investigations/:id', {
    schema: {
      tags: ['Investigations'],
      summary: 'Get a single investigation by ID',
      security: [{ bearerAuth: [] }],
      params: InvestigationIdParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const investigation = await getInvestigation(id);

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
      params: InsightIdParamsForInvestigationSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { insightId } = request.params as { insightId: string };
    const investigation = await getInvestigationByInsightId(insightId);

    if (!investigation) {
      return reply.status(404).send({ error: 'No investigation found for this insight' });
    }

    return investigation;
  });
}
