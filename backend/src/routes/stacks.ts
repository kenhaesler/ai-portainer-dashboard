import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeStack } from '../services/portainer-normalizers.js';
import { StackIdParamsSchema } from '../models/api-schemas.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('route:stacks');

export async function stacksRoutes(fastify: FastifyInstance) {
  fastify.get('/api/stacks', {
    schema: {
      tags: ['Stacks'],
      summary: 'List all stacks',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (_request, reply) => {
    try {
      const stacks = await cachedFetch(
        getCacheKey('stacks'),
        TTL.STACKS,
        () => portainer.getStacks(),
      );
      return stacks.map(normalizeStack);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch stacks from Portainer');
      return reply.code(502).send({ error: 'Unable to fetch stacks from Portainer', details: msg });
    }
  });

  fastify.get('/api/stacks/:id', {
    schema: {
      tags: ['Stacks'],
      summary: 'Get stack details',
      security: [{ bearerAuth: [] }],
      params: StackIdParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: number };
    try {
      const stack = await portainer.getStack(id);
      return normalizeStack(stack);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, stackId: id }, 'Failed to fetch stack details from Portainer');
      return reply.code(502).send({ error: 'Unable to fetch stack details from Portainer', details: msg });
    }
  });
}
