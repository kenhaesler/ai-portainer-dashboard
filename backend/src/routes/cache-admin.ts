import { FastifyInstance } from 'fastify';
import { cache } from '../services/portainer-cache.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { CacheInvalidateQuerySchema } from '../models/api-schemas.js';

const VALID_RESOURCES = ['endpoints', 'containers', 'images', 'networks', 'stacks'] as const;
type CacheResource = (typeof VALID_RESOURCES)[number];

export async function cacheAdminRoutes(fastify: FastifyInstance) {
  // Get cache stats + entries
  fastify.get('/api/admin/cache/stats', {
    schema: {
      tags: ['Cache Admin'],
      summary: 'Get cache statistics and active entries',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    return {
      ...cache.getStats(),
      entries: cache.getEntries(),
    };
  });

  // Clear entire cache
  fastify.post('/api/admin/cache/clear', {
    schema: {
      tags: ['Cache Admin'],
      summary: 'Clear all cache entries',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    cache.clear();

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'cache.clear',
      target_type: 'cache',
      target_id: '*',
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true };
  });

  // Invalidate cache by resource pattern
  fastify.post('/api/admin/cache/invalidate', {
    schema: {
      tags: ['Cache Admin'],
      summary: 'Invalidate cache entries matching a resource pattern',
      security: [{ bearerAuth: [] }],
      querystring: CacheInvalidateQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { resource } = request.query as { resource?: string };

    if (!resource) {
      return reply.status(400).send({ error: 'Missing required query parameter: resource' });
    }

    if (!VALID_RESOURCES.includes(resource as CacheResource)) {
      return reply.status(400).send({
        error: `Invalid resource: ${resource}. Must be one of: ${VALID_RESOURCES.join(', ')}`,
      });
    }

    cache.invalidatePattern(resource);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'cache.invalidate',
      target_type: 'cache',
      target_id: resource,
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true, resource };
  });
}
