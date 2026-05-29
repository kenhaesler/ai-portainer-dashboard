import { FastifyInstance } from 'fastify';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { normalizeEndpoint } from '@dashboard/core/portainer/portainer-normalizers.js';
import { EndpointIdParamsSchema } from '@dashboard/core/models/api-schemas.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { enrichEdgeStandardWithLiveInfo } from '../services/edge-live-enrichment.js';

const log = createChildLogger('route:endpoints');

export async function endpointsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/endpoints', {
    schema: {
      tags: ['Endpoints'],
      summary: 'List all Portainer endpoints',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (_request, reply) => {
    // Upstream Portainer failures (including 401 from Portainer itself) must
    // surface as 502 Bad Gateway, not 401. The frontend treats 401 as
    // "session expired" and clears the user's auth, which would otherwise
    // bounce a logged-in user back to /login on every page load when the
    // dashboard's PORTAINER_API_KEY is missing or invalid.
    try {
      // Guard once at the source: a cache layer or upstream that resolves
      // undefined (e.g. HTTP 204 / empty body) must not crash the .map() below.
      const endpoints = (await cachedFetch(
        getCacheKey('endpoints'),
        TTL.ENDPOINTS,
        () => portainer.getEndpoints(),
      )) ?? [];
      const normalized = endpoints.map(normalizeEndpoint);
      // Fill in live container counts for Edge Standard endpoints whose
      // Portainer Snapshots[] never gets populated (issue #1249).
      return await enrichEdgeStandardWithLiveInfo(normalized);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch endpoints from Portainer');
      return reply.code(502).send({ error: 'Unable to connect to Portainer', details: msg });
    }
  });

  // Diagnostic endpoint: shows raw Portainer data for Edge endpoints
  fastify.get('/api/endpoints/debug/edge-status', {
    schema: {
      tags: ['Endpoints'],
      summary: 'Debug: raw Edge endpoint data from Portainer',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (_request, reply) => {
    let endpoints;
    try {
      // Guard once at the source so the .map() below cannot crash on undefined.
      endpoints = (await portainer.getEndpoints()) ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch endpoints from Portainer (edge-status)');
      return reply.code(502).send({ error: 'Unable to connect to Portainer', details: msg });
    }
    return endpoints.map((ep) => {
      const normalized = normalizeEndpoint(ep);
      return {
        id: ep.Id,
        name: ep.Name,
        type: ep.Type,
        portainerStatus: ep.Status,
        edgeId: ep.EdgeID || null,
        lastCheckInDate: ep.LastCheckInDate ?? null,
        edgeCheckinInterval: ep.EdgeCheckinInterval ?? null,
        snapshotCount: ep.Snapshots?.length ?? 0,
        snapshotTime: ep.Snapshots?.[0]?.Time ?? null,
        normalizedStatus: normalized.status,
        normalizedEdgeMode: normalized.edgeMode,
        normalizedIsEdge: normalized.isEdge,
        nowUnix: Math.floor(Date.now() / 1000),
        elapsedSinceCheckIn: ep.LastCheckInDate
          ? Math.floor(Date.now() / 1000) - ep.LastCheckInDate
          : null,
      };
    });
  });

  fastify.get('/api/endpoints/:id', {
    schema: {
      tags: ['Endpoints'],
      summary: 'Get a specific endpoint',
      security: [{ bearerAuth: [] }],
      params: EndpointIdParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: number };
    try {
      const endpoint = await cachedFetch(
        getCacheKey('endpoint', id),
        TTL.ENDPOINTS,
        () => portainer.getEndpoint(id),
      );
      return normalizeEndpoint(endpoint);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, id }, 'Failed to fetch endpoint from Portainer');
      return reply.code(502).send({ error: 'Unable to connect to Portainer', details: msg });
    }
  });
}
