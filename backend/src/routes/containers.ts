import { z } from 'zod';
import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeContainer, normalizeEndpoint } from '../services/portainer-normalizers.js';
import { ContainerParamsSchema } from '../models/api-schemas.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('route:containers');

const ContainerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().optional(),
  state: z.string().optional(),
  endpointId: z.coerce.number().optional(),
});

const FavoritesQuerySchema = z.object({
  ids: z.string(), // comma-separated "endpointId:containerId" pairs
});

/** Fetch all normalized containers across endpoints */
async function fetchAllContainers(endpointIdFilter?: number) {
  const endpoints = await cachedFetchSWR(
    getCacheKey('endpoints'),
    TTL.ENDPOINTS,
    () => portainer.getEndpoints(),
  );

  const targetEndpoints = endpointIdFilter
    ? endpoints.filter((e) => e.Id === endpointIdFilter)
    : endpoints;

  const results: ReturnType<typeof normalizeContainer>[] = [];
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

  return { results, errors, upEndpoints };
}

export async function containersRoutes(fastify: FastifyInstance) {
  // List containers with optional pagination and filtering
  fastify.get('/api/containers', {
    schema: {
      tags: ['Containers'],
      summary: 'List containers across all endpoints',
      security: [{ bearerAuth: [] }],
      querystring: ContainerListQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { page, pageSize, search, state, endpointId } = request.query as z.infer<typeof ContainerListQuerySchema>;

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

    const allContainers: ReturnType<typeof normalizeContainer>[] = [];
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
        allContainers.push(...containers.map((c) => normalizeContainer(c, ep.Id, ep.Name)));
      } else {
        const ep = upEndpoints[i];
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        log.warn({ endpointId: ep.Id, endpointName: ep.Name, err: result.reason }, 'Failed to fetch containers for endpoint');
        errors.push(`${ep.Name}: ${msg}`);
      }
    }

    if (upEndpoints.length > 0 && allContainers.length === 0 && errors.length > 0) {
      return reply.code(502).send({
        error: 'Failed to fetch containers from Portainer',
        details: errors,
      });
    }

    // Server-side filtering
    let filtered = allContainers;
    if (search) {
      const term = search.toLowerCase();
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(term));
    }
    if (state) {
      filtered = filtered.filter((c) => c.state === state);
    }

    // If no pagination params, return flat array (backward compat)
    if (page === undefined && pageSize === undefined) {
      return filtered;
    }

    // Paginate
    const effectivePage = page ?? 1;
    const effectivePageSize = pageSize ?? 50;
    const total = filtered.length;
    const start = (effectivePage - 1) * effectivePageSize;
    const data = filtered.slice(start, start + effectivePageSize);

    return { data, total, page: effectivePage, pageSize: effectivePageSize };
  });

  // Container count summary
  fastify.get('/api/containers/count', {
    schema: {
      tags: ['Containers'],
      summary: 'Get container counts by state',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (_request, reply) => {
    try {
      const { results } = await fetchAllContainers();
      const byState: Record<string, number> = {};
      for (const c of results) {
        byState[c.state] = (byState[c.state] || 0) + 1;
      }
      return { total: results.length, byState };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch container counts');
      return reply.code(502).send({ error: 'Unable to fetch container counts', details: msg });
    }
  });

  // Favorites — fetch specific containers by composite IDs
  fastify.get('/api/containers/favorites', {
    schema: {
      tags: ['Containers'],
      summary: 'Get specific containers by endpoint:container ID pairs',
      security: [{ bearerAuth: [] }],
      querystring: FavoritesQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { ids } = request.query as z.infer<typeof FavoritesQuerySchema>;
    const pairs = ids.split(',').map((pair) => pair.trim()).filter(Boolean);

    if (pairs.length === 0) {
      return [];
    }

    // Parse composite IDs into a lookup set
    const requested = new Set(pairs);

    try {
      const { results } = await fetchAllContainers();
      return results.filter((c) => requested.has(`${c.endpointId}:${c.id}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch favorite containers');
      return reply.code(502).send({ error: 'Unable to fetch containers', details: msg });
    }
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
      const container = await cachedFetchSWR(
        getCacheKey('container-detail', endpointId, containerId),
        TTL.STATS, // 60s TTL — detail changes infrequently, matches scheduler interval
        () => portainer.getContainer(endpointId, containerId),
      );
      return container;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, endpointId, containerId }, 'Failed to fetch container details');
      return reply.code(502).send({ error: 'Unable to fetch container details from Portainer', details: msg });
    }
  });
}
