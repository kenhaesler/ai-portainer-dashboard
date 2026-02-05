import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeNetwork, normalizeEndpoint } from '../services/portainer-normalizers.js';

export async function networksRoutes(fastify: FastifyInstance) {
  // List networks (optionally filtered by endpoint)
  fastify.get('/api/networks', {
    schema: {
      tags: ['Networks'],
      summary: 'List networks across all endpoints',
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
        const networks = await cachedFetch(
          getCacheKey('networks', ep.Id),
          TTL.NETWORKS,
          () => portainer.getNetworks(ep.Id),
        );
        results.push(...networks.map((n) => normalizeNetwork(n, ep.Id, ep.Name)));
      } catch {
        // Skip failing endpoints
      }
    }

    return results;
  });
}
