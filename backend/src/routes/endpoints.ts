import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeEndpoint } from '../services/portainer-normalizers.js';

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

  fastify.get('/api/endpoints/:id', {
    schema: {
      tags: ['Endpoints'],
      summary: 'Get a specific endpoint',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
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
