import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeStack, normalizeEndpoint } from '../services/portainer-normalizers.js';
import { StackIdParamsSchema } from '../models/api-schemas.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('route:stacks');

export async function stacksRoutes(fastify: FastifyInstance) {
  fastify.get('/api/stacks', {
    schema: {
      tags: ['Stacks'],
      summary: 'List all stacks across all endpoints',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (_request, reply) => {
    let endpoints;
    try {
      endpoints = await cachedFetchSWR(
        getCacheKey('endpoints'),
        TTL.ENDPOINTS,
        () => portainer.getEndpoints(),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch endpoints from Portainer');
      return reply.code(502).send({ error: 'Unable to connect to Portainer', details: msg });
    }

    const upEndpoints = endpoints.filter((ep) => normalizeEndpoint(ep).status === 'up');
    const seen = new Set<number>();
    const results: ReturnType<typeof normalizeStack>[] = [];
    const errors: string[] = [];

    const settled = await Promise.allSettled(
      upEndpoints.map((ep) =>
        cachedFetchSWR(
          getCacheKey('stacks', ep.Id),
          TTL.STACKS,
          () => portainer.getStacksByEndpoint(ep.Id),
        ).then((stacks) => ({ ep, stacks })),
      ),
    );

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        for (const stack of result.value.stacks) {
          if (!seen.has(stack.Id)) {
            seen.add(stack.Id);
            results.push(normalizeStack(stack));
          }
        }
      } else {
        const ep = upEndpoints[i];
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        log.warn({ endpointId: ep.Id, endpointName: ep.Name, err: result.reason }, 'Failed to fetch stacks for endpoint');
        errors.push(`${ep.Name}: ${msg}`);
      }
    }

    if (upEndpoints.length > 0 && results.length === 0 && errors.length > 0) {
      return reply.code(502).send({ error: 'Failed to fetch stacks from Portainer', details: errors });
    }

    return results;
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
