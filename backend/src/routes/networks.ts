import { FastifyInstance } from 'fastify';
import * as portainer from '../core/portainer/portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from '../core/portainer/portainer-cache.js';
import { normalizeNetwork, normalizeEndpoint } from '../core/portainer/portainer-normalizers.js';
import { EndpointIdQuerySchema } from '../core/models/api-schemas.js';
import { createChildLogger } from '../core/utils/logger.js';

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
          getCacheKey('networks', ep.Id),
          TTL.NETWORKS,
          () => portainer.getNetworks(ep.Id),
        ).then((networks) => ({ ep, networks })),
      ),
    );
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        const { ep, networks } = result.value;
        results.push(...networks.map((n) => normalizeNetwork(n, ep.Id, ep.Name)));
      } else {
        const ep = upEndpoints[i];
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        log.warn({ endpointId: ep.Id, endpointName: ep.Name, err: result.reason }, 'Failed to fetch networks for endpoint');
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
