import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeStack } from '../services/portainer-normalizers.js';
import { StackIdParamsSchema } from '../models/api-schemas.js';

export async function stacksRoutes(fastify: FastifyInstance) {
  fastify.get('/api/stacks', {
    schema: {
      tags: ['Stacks'],
      summary: 'List all stacks',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const stacks = await cachedFetch(
      getCacheKey('stacks'),
      TTL.STACKS,
      () => portainer.getStacks(),
    );
    return stacks.map(normalizeStack);
  });

  fastify.get('/api/stacks/:id', {
    schema: {
      tags: ['Stacks'],
      summary: 'Get stack details',
      security: [{ bearerAuth: [] }],
      params: StackIdParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: number };
    const stack = await portainer.getStack(id);
    return normalizeStack(stack);
  });
}
