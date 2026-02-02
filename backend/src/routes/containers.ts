import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL, cache } from '../services/portainer-cache.js';
import { normalizeContainer, normalizeEndpoint } from '../services/portainer-normalizers.js';
import { writeAuditLog } from '../services/audit-logger.js';

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

  // Start container
  fastify.post('/api/containers/:endpointId/:containerId/start', {
    schema: {
      tags: ['Containers'],
      summary: 'Start a container',
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
    await portainer.startContainer(endpointId, containerId);
    cache.invalidate(getCacheKey('containers', endpointId));
    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'container.start',
      target_type: 'container',
      target_id: containerId,
      details: { endpointId },
      request_id: request.requestId,
      ip_address: request.ip,
    });
    return { success: true, action: 'start', containerId };
  });

  // Stop container
  fastify.post('/api/containers/:endpointId/:containerId/stop', {
    schema: {
      tags: ['Containers'],
      summary: 'Stop a container',
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
    await portainer.stopContainer(endpointId, containerId);
    cache.invalidate(getCacheKey('containers', endpointId));
    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'container.stop',
      target_type: 'container',
      target_id: containerId,
      details: { endpointId },
      request_id: request.requestId,
      ip_address: request.ip,
    });
    return { success: true, action: 'stop', containerId };
  });

  // Restart container
  fastify.post('/api/containers/:endpointId/:containerId/restart', {
    schema: {
      tags: ['Containers'],
      summary: 'Restart a container',
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
    await portainer.restartContainer(endpointId, containerId);
    cache.invalidate(getCacheKey('containers', endpointId));
    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'container.restart',
      target_type: 'container',
      target_id: containerId,
      details: { endpointId },
      request_id: request.requestId,
      ip_address: request.ip,
    });
    return { success: true, action: 'restart', containerId };
  });
}
