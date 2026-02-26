import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import '@dashboard/core/plugins/auth.js';
import '@fastify/swagger';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { writeAuditLog } from '@dashboard/core/services/audit-logger.js';

const EdgeJobIdParamsSchema = z.object({
  id: z.coerce.number(),
});

const CreateEdgeJobBodySchema = z.object({
  name: z.string().min(1).max(200),
  cronExpression: z.string().min(1),
  recurring: z.boolean(),
  endpoints: z.array(z.number()).min(1),
  fileContent: z.string().min(1),
});

export async function edgeJobsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/edge-jobs', {
    schema: {
      tags: ['Edge Jobs'],
      summary: 'List all edge jobs',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    return cachedFetch(
      getCacheKey('edge-jobs'),
      TTL.ENDPOINTS,
      () => portainer.getEdgeJobs(),
    );
  });

  fastify.get('/api/edge-jobs/:id', {
    schema: {
      tags: ['Edge Jobs'],
      summary: 'Get a specific edge job',
      security: [{ bearerAuth: [] }],
      params: EdgeJobIdParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: number };
    return portainer.getEdgeJob(id);
  });

  fastify.post('/api/edge-jobs', {
    schema: {
      tags: ['Edge Jobs'],
      summary: 'Create an edge job',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const body = CreateEdgeJobBodySchema.parse(request.body);
    const result = await portainer.createEdgeJob(body);

    writeAuditLog({
      username: (request as any).user?.username,
      action: 'edge_job.create',
      target_type: 'edge_job',
      target_id: String(result.Id),
      details: { name: body.name, recurring: body.recurring },
      request_id: request.id,
      ip_address: request.ip,
    });

    return reply.code(201).send(result);
  });

  fastify.delete('/api/edge-jobs/:id', {
    schema: {
      tags: ['Edge Jobs'],
      summary: 'Delete an edge job',
      security: [{ bearerAuth: [] }],
      params: EdgeJobIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: number };
    await portainer.deleteEdgeJob(id);

    writeAuditLog({
      username: (request as any).user?.username,
      action: 'edge_job.delete',
      target_type: 'edge_job',
      target_id: String(id),
      request_id: request.id,
      ip_address: request.ip,
    });

    return reply.code(204).send();
  });
}
