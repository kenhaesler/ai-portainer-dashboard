import { FastifyInstance } from 'fastify';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetchSWR, getCacheKey, getSnapshotTimestamp, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { normalizeNetwork, normalizeEndpointAsOf } from '@dashboard/core/portainer/portainer-normalizers.js';
import { EndpointIdQuerySchema, NetworksListResponseSchema, ErrorWithDetailsSchema } from '@dashboard/core/models/api-schemas.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { errorDetails } from '@dashboard/core/plugins/error-handler.js';

const log = createChildLogger('route:networks');

export async function networksRoutes(fastify: FastifyInstance) {
  // List networks (optionally filtered by endpoint)
  fastify.get('/api/networks', {
    schema: {
      tags: ['Networks'],
      summary: 'List networks across all endpoints',
      security: [{ bearerAuth: [] }],
      querystring: EndpointIdQuerySchema,
      response: { 200: NetworksListResponseSchema, 502: ErrorWithDetailsSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId } = request.query as { endpointId?: number };

    let endpoints;
    const endpointsCacheKey = getCacheKey('endpoints');
    try {
      endpoints = await cachedFetchSWR(
        endpointsCacheKey,
        TTL.ENDPOINTS,
        () => portainer.getEndpoints(),
      );
    } catch (err) {
      log.error({ err }, 'Failed to fetch endpoints from Portainer');
      return reply.code(502).send({
        error: 'Unable to connect to Portainer',
        details: errorDetails(err),
      });
    }

    const targetEndpoints = endpointId
      ? endpoints.filter((e) => e.Id === endpointId)
      : endpoints;

    const results = [];
    const errors: string[] = [];
    // Evaluate Edge heartbeat status against when this snapshot was actually
    // fetched, not "now" (issue #1566).
    const referenceTimeMs = getSnapshotTimestamp(endpointsCacheKey) ?? Date.now();
    const upEndpoints = targetEndpoints.filter((ep) => normalizeEndpointAsOf(ep, { referenceTimeMs }).status === 'up');
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
        details: errorDetails(errors),
      });
    }

    return results;
  });
}
