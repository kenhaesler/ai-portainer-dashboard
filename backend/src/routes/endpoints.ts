import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeEndpoint } from '../services/portainer-normalizers.js';
import { EndpointIdParamsSchema } from '../models/api-schemas.js';

export async function endpointsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/endpoints', {
    schema: {
      tags: ['Endpoints'],
      summary: 'List all Portainer endpoints',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => portainer.getEndpoints(),
    );
    return endpoints.map(normalizeEndpoint);
  });

  // Diagnostic endpoint: shows raw Portainer data for Edge endpoints
  fastify.get('/api/endpoints/debug/edge-status', {
    schema: {
      tags: ['Endpoints'],
      summary: 'Debug: raw Edge endpoint data from Portainer',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const endpoints = await portainer.getEndpoints();
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
  }, async (request) => {
    const { id } = request.params as { id: number };
    const endpoint = await cachedFetch(
      getCacheKey('endpoint', id),
      TTL.ENDPOINTS,
      () => portainer.getEndpoint(id),
    );
    return normalizeEndpoint(endpoint);
  });
}
