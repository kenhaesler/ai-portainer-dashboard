import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeContainer, normalizeEndpoint } from '../services/portainer-normalizers.js';

export async function containersRoutes(fastify: FastifyInstance) {
  // List containers (optionally filtered by endpoint)
  fastify.get('/api/containers', {
    schema: {
      tags: ['Containers'],
      summary: 'List containers across all endpoints',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          endpointId: { type: 'number' },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId } = request.query as { endpointId?: number };

    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => portainer.getEndpoints(),
    );

    const targetEndpoints = endpointId
      ? endpoints.filter((e) => e.Id === endpointId)
      : endpoints;

    const results = [];
    for (const ep of targetEndpoints) {
      const norm = normalizeEndpoint(ep);
      if (norm.status !== 'up') continue;
      try {
        const containers = await cachedFetch(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => portainer.getContainers(ep.Id),
        );
        results.push(...containers.map((c) => normalizeContainer(c, ep.Id, ep.Name)));
      } catch {
        // Skip failing endpoints
      }
    }

    return results;
  });

  // Get container details
  fastify.get('/api/containers/:endpointId/:containerId', {
    schema: {
      tags: ['Containers'],
      summary: 'Get container details',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          endpointId: { type: 'number' },
          containerId: { type: 'string' },
        },
        required: ['endpointId', 'containerId'],
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId, containerId } = request.params as {
      endpointId: number;
      containerId: string;
    };
    const container = await portainer.getContainer(endpointId, containerId);
    return container;
  });
}
