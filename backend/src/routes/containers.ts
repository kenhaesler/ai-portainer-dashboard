import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeContainer, normalizeEndpoint } from '../services/portainer-normalizers.js';
import { EndpointIdQuerySchema, ContainerParamsSchema } from '../models/api-schemas.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('route:containers');

export async function containersRoutes(fastify: FastifyInstance) {
  // List containers (optionally filtered by endpoint)
  fastify.get('/api/containers', {
    schema: {
      tags: ['Containers'],
      summary: 'List containers across all endpoints',
      security: [{ bearerAuth: [] }],
      querystring: EndpointIdQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId } = request.query as { endpointId?: number };

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
      return reply.code(502).send({
        error: 'Unable to connect to Portainer',
        details: msg,
      });
    }

    const targetEndpoints = endpointId
      ? endpoints.filter((e) => e.Id === endpointId)
      : endpoints;

    const results = [];
    const errors: string[] = [];
    const upEndpoints = targetEndpoints.filter((ep) => normalizeEndpoint(ep).status === 'up');
    const settled = await Promise.allSettled(
      upEndpoints.map((ep) =>
        cachedFetchSWR(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => portainer.getContainers(ep.Id),
        ).then((containers) => ({ ep, containers })),
      ),
    );
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        const { ep, containers } = result.value;
        results.push(...containers.map((c) => normalizeContainer(c, ep.Id, ep.Name)));
      } else {
        const ep = upEndpoints[i];
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        log.warn({ endpointId: ep.Id, endpointName: ep.Name, err: result.reason }, 'Failed to fetch containers for endpoint');
        errors.push(`${ep.Name}: ${msg}`);
      }
    }

    if (upEndpoints.length > 0 && results.length === 0 && errors.length > 0) {
      return reply.code(502).send({
        error: 'Failed to fetch containers from Portainer',
        details: errors,
      });
    }

    return results;
  });

  // Get container details
  fastify.get('/api/containers/:endpointId/:containerId', {
    schema: {
      tags: ['Containers'],
      summary: 'Get container details',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId, containerId } = request.params as {
      endpointId: number;
      containerId: string;
    };
    try {
      const container = await portainer.getContainer(endpointId, containerId);
      return container;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, endpointId, containerId }, 'Failed to fetch container details');
      return reply.code(502).send({ error: 'Unable to fetch container details from Portainer', details: msg });
    }
  });
}
