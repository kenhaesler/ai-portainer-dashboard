import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeNetwork, normalizeEndpoint } from '../services/portainer-normalizers.js';
import { EndpointIdQuerySchema } from '../models/api-schemas.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('route:networks');

export async function networksRoutes(fastify: FastifyInstance) {
  // List networks (optionally filtered by endpoint)
  fastify.get('/api/networks', {
    schema: {
      tags: ['Networks'],
      summary: 'List networks across all endpoints',
      security: [{ bearerAuth: [] }],
      querystring: EndpointIdQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId } = request.query as { endpointId?: number };

    let endpoints;
    try {
      endpoints = await cachedFetch(
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
    const upEndpoints = [];
    for (const ep of targetEndpoints) {
      const norm = normalizeEndpoint(ep);
      if (norm.status !== 'up') continue;
      upEndpoints.push(ep);
      try {
        const networks = await cachedFetch(
          getCacheKey('networks', ep.Id),
          TTL.NETWORKS,
          () => portainer.getNetworks(ep.Id),
        );
        results.push(...networks.map((n) => normalizeNetwork(n, ep.Id, ep.Name)));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        log.warn({ endpointId: ep.Id, endpointName: ep.Name, err }, 'Failed to fetch networks for endpoint');
        errors.push(`${ep.Name}: ${msg}`);
      }
    }

    if (upEndpoints.length > 0 && results.length === 0 && errors.length > 0) {
      return reply.code(502).send({
        error: 'Failed to fetch networks from Portainer',
        details: errors,
      });
    }

    return results;
  });
}
