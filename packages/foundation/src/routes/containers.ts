import { z } from 'zod/v4';
import { FastifyInstance } from 'fastify';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { normalizeContainer, normalizeEndpoint } from '@dashboard/core/portainer/portainer-normalizers.js';
import { ContainerParamsSchema, ErrorWithDetailsSchema } from '@dashboard/core/models/api-schemas.js';
import { isDockerEndpoint } from '@dashboard/core/models/portainer.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { errorDetails } from '@dashboard/core/plugins/error-handler.js';
import { NormalizedContainerSchema } from '@dashboard/contracts';

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

// Ordered union: [bare array, paginated, partial]. `total` is REQUIRED on the
// paginated member so a paginated-with-partial payload (which also carries
// partial/failedEndpoints) cannot false-match the partial member and lose its
// total/page/pageSize to object-stripping. The partial member requires
// partial+failedEndpoints and has no `total`, so it only matches the
// no-pagination partial-failure shape.
const ContainerListResponseSchema = z.union([
  z.array(NormalizedContainerSchema),
  z.object({
    data: z.array(NormalizedContainerSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    partial: z.boolean().optional(),
    failedEndpoints: z.array(z.string()).optional(),
  }),
  z.object({
    data: z.array(NormalizedContainerSchema),
    partial: z.boolean(),
    failedEndpoints: z.array(z.string()),
  }),
]);

const ContainerCountResponseSchema = z.object({
  total: z.number(),
  byState: z.record(z.string(), z.number()),
});

const ContainerListItemsSchema = z.array(NormalizedContainerSchema);

/** Fetch all normalized containers across endpoints */
async function fetchAllContainers(endpointIdFilter?: number) {
  const endpoints = await cachedFetchSWR(
    getCacheKey('endpoints'),
    TTL.ENDPOINTS,
    () => portainer.getEndpoints(),
  );

  // Only target Docker endpoints — K8s endpoints use separate /api/kubernetes/ routes
  const dockerEndpoints = endpoints.filter((e) => isDockerEndpoint(e.Type));
  const targetEndpoints = endpointIdFilter
    ? dockerEndpoints.filter((e) => e.Id === endpointIdFilter)
    : dockerEndpoints;

  const results: ReturnType<typeof normalizeContainer>[] = [];
  const errors: string[] = [];
  const failedEndpoints: number[] = [];
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
      failedEndpoints.push(ep.Id);
    }
  }

  return { results, errors, failedEndpoints, upEndpoints };
}

export async function containersRoutes(fastify: FastifyInstance) {
  // List containers with optional pagination and filtering
  fastify.get('/api/containers', {
    schema: {
      tags: ['Containers'],
      summary: 'List containers across all endpoints',
      security: [{ bearerAuth: [] }],
      querystring: ContainerListQuerySchema,
      response: { 200: ContainerListResponseSchema, 502: ErrorWithDetailsSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { page, pageSize, search, state, endpointId } = request.query as z.infer<typeof ContainerListQuerySchema>;

    let fetched: Awaited<ReturnType<typeof fetchAllContainers>>;
    try {
      fetched = await fetchAllContainers(endpointId);
    } catch (err) {
      log.error({ err }, 'Failed to fetch endpoints from Portainer');
      return reply.code(502).send({
        error: 'Unable to connect to Portainer',
        details: errorDetails(err),
      });
    }

    // errors contains endpoint-name-prefixed strings (e.g. "staging: Connection refused")
    // used in the response's failedEndpoints field (API contract: string array of names)
    const { results: allContainers, errors, upEndpoints } = fetched;
    const partial = errors.length > 0;

    if (upEndpoints.length > 0 && allContainers.length === 0 && errors.length > 0) {
      return reply.code(502).send({
        error: 'Failed to fetch containers from Portainer',
        details: errorDetails(errors),
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
    // When some endpoints failed, wrap in object with partial flag
    if (page === undefined && pageSize === undefined) {
      if (partial) {
        return { data: filtered, partial, failedEndpoints: errors };
      }
      return filtered;
    }

    // Paginate
    const effectivePage = page ?? 1;
    const effectivePageSize = pageSize ?? 50;
    const total = filtered.length;
    const start = (effectivePage - 1) * effectivePageSize;
    const data = filtered.slice(start, start + effectivePageSize);

    return {
      data,
      total,
      page: effectivePage,
      pageSize: effectivePageSize,
      ...(partial ? { partial, failedEndpoints: errors } : {}),
    };
  });

  // Container count summary
  fastify.get('/api/containers/count', {
    schema: {
      tags: ['Containers'],
      summary: 'Get container counts by state',
      security: [{ bearerAuth: [] }],
      response: { 200: ContainerCountResponseSchema, 502: ErrorWithDetailsSchema },
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
      log.error({ err }, 'Failed to fetch container counts');
      return reply.code(502).send({ error: 'Unable to fetch container counts', details: errorDetails(err) });
    }
  });

  // Favorites — fetch specific containers by composite IDs
  fastify.get('/api/containers/favorites', {
    schema: {
      tags: ['Containers'],
      summary: 'Get specific containers by endpoint:container ID pairs',
      security: [{ bearerAuth: [] }],
      querystring: FavoritesQuerySchema,
      response: { 200: ContainerListItemsSchema, 502: ErrorWithDetailsSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { ids } = request.query as z.infer<typeof FavoritesQuerySchema>;
    const pairs = ids.split(',').map((pair) => pair.trim()).filter(Boolean);

    if (pairs.length === 0) {
      return [];
    }

    // Parse composite IDs into per-endpoint groups for targeted fetching
    const byEndpoint = new Map<number, string[]>();
    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':');
      if (colonIndex === -1) continue;
      const epId = Number(pair.slice(0, colonIndex));
      const cId = pair.slice(colonIndex + 1);
      if (Number.isNaN(epId) || !cId) continue;
      const list = byEndpoint.get(epId) ?? [];
      list.push(cId);
      byEndpoint.set(epId, list);
    }

    if (byEndpoint.size === 0) {
      return [];
    }

    try {
      // Fetch endpoints for name resolution (cached)
      const endpoints = await cachedFetchSWR(
        getCacheKey('endpoints'),
        TTL.ENDPOINTS,
        () => portainer.getEndpoints(),
      );
      const endpointMap = new Map(endpoints.map((ep) => [ep.Id, ep]));

      // Fetch only the specific containers we need, in parallel per endpoint
      const settled = await Promise.allSettled(
        [...byEndpoint.entries()].map(async ([epId, containerIds]) => {
          const ep = endpointMap.get(epId);
          if (!ep) return [];
          const containers = await Promise.allSettled(
            containerIds.map((cId) =>
              portainer.getContainer(epId, cId)
                .then((c) => normalizeContainer(c, ep.Id, ep.Name))
            ),
          );
          return containers
            .filter((r): r is PromiseFulfilledResult<ReturnType<typeof normalizeContainer>> => r.status === 'fulfilled')
            .map((r) => r.value);
        }),
      );

      return settled
        .filter((r): r is PromiseFulfilledResult<ReturnType<typeof normalizeContainer>[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value);
    } catch (err) {
      log.error({ err }, 'Failed to fetch favorite containers');
      return reply.code(502).send({ error: 'Unable to fetch containers', details: errorDetails(err) });
    }
  });

  // Get container details
  //
  // Response is normalized through the same `normalizeContainer()` projection
  // used by the list/favorites endpoints (NormalizedContainerSchema), rather
  // than returned verbatim. `portainer.getContainer()` already bridges the raw
  // Docker *inspect* payload into the list-shaped `Container` contract via
  // `containerFromInspect()` (#1387), which drops `Mounts` entirely and only
  // maps a fixed allow-list of `HostConfig` fields — so no `Mounts[].Source`,
  // `LogPath`, or `HostConfig.Binds` reach this handler. `normalizeContainer()`
  // is a second, independent stripping layer: it only ever reads a fixed set
  // of known fields (id/name/image/state/status/ports/labels/networks/...)
  // onto the response, so even a future regression upstream that reintroduced
  // filesystem paths onto the `Container` object could not leak them here
  // (CLAUDE.md Security §5, issue #1564). This also gives the detail route the
  // exact same shape the container-detail UI (`ContainerOverview`) already
  // consumes from the list endpoint, so no field the UI reads is dropped.
  fastify.get('/api/containers/:endpointId/:containerId', {
    schema: {
      tags: ['Containers'],
      summary: 'Get container details',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
      response: { 200: NormalizedContainerSchema, 502: ErrorWithDetailsSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId, containerId } = request.params as {
      endpointId: number;
      containerId: string;
    };
    try {
      // Fetch the container first: if it fails (e.g. not found), bail before
      // ever touching the endpoints cache — keeps error responses focused on
      // the actual failure.
      const container = await cachedFetchSWR(
        getCacheKey('container-detail', endpointId, containerId),
        TTL.STATS, // 60s TTL — detail changes infrequently, matches scheduler interval
        () => portainer.getContainer(endpointId, containerId),
      );
      let endpointName = String(endpointId);
      try {
        const endpoints = await cachedFetchSWR(
          getCacheKey('endpoints'),
          TTL.ENDPOINTS,
          () => portainer.getEndpoints(),
        );
        endpointName = endpoints.find((e) => e.Id === endpointId)?.Name ?? endpointName;
      } catch (err) {
        // The endpoint name is display metadata. A transient failure of the
        // independent endpoint-list call must not hide a successfully fetched
        // container detail response.
        log.warn({ err, endpointId }, 'Failed to resolve endpoint name; using endpoint id');
      }
      return normalizeContainer(container, endpointId, endpointName);
    } catch (err) {
      log.error({ err, endpointId, containerId }, 'Failed to fetch container details');
      return reply.code(502).send({ error: 'Unable to fetch container details from Portainer', details: errorDetails(err) });
    }
  });
}
