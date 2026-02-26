import pLimit from 'p-limit';
import { FastifyInstance } from 'fastify';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { normalizeContainer, normalizeEndpoint, normalizeStack } from '@dashboard/core/portainer/portainer-normalizers.js';
import { supportsLiveFeatures } from '@dashboard/infrastructure';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { SearchQuerySchema } from '@dashboard/core/models/api-schemas.js';

const log = createChildLogger('search-route');
const TTL_LOG_SEARCH = 120; // 120 seconds — cache for repeated/refined searches

/** Max concurrent log fetches per search — avoids saturating Portainer. */
const LOG_FETCH_CONCURRENCY = 3;

interface NormalizedImage {
  id: string;
  name: string;
  tags: string[];
  size: number;
  created: number;
  endpointId: number;
  endpointName?: string;
  registry: string;
}

interface LogSearchResult {
  id: string;
  endpointId: number;
  endpointName: string;
  containerId: string;
  containerName: string;
  message: string;
  timestamp?: string;
}

function normalizeImage(
  img: { Id: string; RepoTags?: string[]; Size?: number; Created?: number },
  endpointId: number,
  endpointName?: string,
): NormalizedImage {
  const tags = img.RepoTags?.filter((t) => t !== '<none>:<none>') ?? [];
  const firstTag = tags[0] || '<none>';
  const nameParts = firstTag.split('/');

  let registry = 'docker.io';
  let name = firstTag;

  if (nameParts.length > 1 && nameParts[0].includes('.')) {
    registry = nameParts[0];
    name = nameParts.slice(1).join('/');
  } else if (nameParts.length === 1) {
    name = `library/${nameParts[0]}`;
  }

  const displayName = name.split(':')[0];

  return {
    id: img.Id,
    name: displayName,
    tags,
    size: img.Size ?? 0,
    created: img.Created ?? 0,
    endpointId,
    endpointName,
    registry,
  };
}

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function matchesValue(value: string | undefined, query: string) {
  if (!value) return false;
  return value.toLowerCase().includes(query);
}

async function searchContainerLogs(
  query: string,
  limit: number,
  maxContainers: number,
  tail: number,
): Promise<LogSearchResult[]> {
  const results: LogSearchResult[] = [];
  const endpoints = await cachedFetch(
    getCacheKey('endpoints'),
    TTL.ENDPOINTS,
    () => portainer.getEndpoints(),
  );

  // Fetch containers from all endpoints in parallel
  const upEndpoints = endpoints
    .map(normalizeEndpoint)
    .filter((ep) => ep.status === 'up');

  const containerResults = await Promise.allSettled(
    upEndpoints.map(async (ep) => {
      const rawContainers = await cachedFetch(
        getCacheKey('containers', ep.id),
        TTL.CONTAINERS,
        () => portainer.getContainers(ep.id),
      );
      return rawContainers.map((c) => normalizeContainer(c, ep.id, ep.name));
    }),
  );

  const allContainers = containerResults.flatMap((r) => {
    if (r.status === 'fulfilled') return r.value;
    log.warn({ err: r.reason }, 'Failed to load containers for log search');
    return [];
  });

  const candidates = allContainers
    .filter((c) => c.state === 'running')
    .sort((a, b) => b.created - a.created)
    .slice(0, maxContainers);

  // Check live capability for all candidate endpoints in parallel
  const uniqueEndpointIds = [...new Set(candidates.map((c) => c.endpointId))];
  const capabilityResults = await Promise.allSettled(
    uniqueEndpointIds.map(async (epId) => ({ epId, live: await supportsLiveFeatures(epId) })),
  );
  const liveCapableEndpoints = new Set<number>(
    capabilityResults
      .filter((r): r is PromiseFulfilledResult<{ epId: number; live: boolean }> => r.status === 'fulfilled' && r.value.live)
      .map((r) => r.value.epId),
  );

  const queryLower = query.toLowerCase();
  const limit$ = pLimit(LOG_FETCH_CONCURRENCY);

  // Fetch logs from all candidates in parallel (bounded by concurrency limit)
  const logResults = await Promise.allSettled(
    candidates
      .filter((c) => liveCapableEndpoints.has(c.endpointId))
      .map((container) =>
        limit$(async () => {
          const logCacheKey = getCacheKey('search-logs', container.endpointId, container.id, query);
          const logs = await cachedFetch(
            logCacheKey,
            TTL_LOG_SEARCH,
            () => portainer.getContainerLogs(container.endpointId, container.id, {
              tail,
              timestamps: true,
            }),
          );

          const matches: LogSearchResult[] = [];
          const lines = logs.split('\n').filter((line) => line.trim().length > 0);
          for (const line of lines) {
            if (!line.toLowerCase().includes(queryLower)) continue;
            const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/);
            const timestamp = match?.[1];
            const message = match?.[2] ?? line;
            matches.push({
              id: `${container.endpointId}:${container.id}:${matches.length}`,
              endpointId: container.endpointId,
              endpointName: container.endpointName,
              containerId: container.id,
              containerName: container.name,
              message,
              timestamp,
            });
          }
          return matches;
        }),
      ),
  );

  for (const r of logResults) {
    if (r.status === 'fulfilled') {
      results.push(...r.value);
    } else {
      log.warn({ err: r.reason }, 'Failed to fetch container logs for search');
    }
  }

  return results.slice(0, limit);
}

export async function searchRoutes(fastify: FastifyInstance) {
  fastify.get('/api/search', {
    schema: {
      tags: ['Search'],
      summary: 'Search containers, images, stacks, and container logs',
      security: [{ bearerAuth: [] }],
      querystring: SearchQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { query, limit = 8, logLimit = 8, includeLogs = false } = request.query as {
      query?: string;
      limit?: number;
      logLimit?: number;
      includeLogs?: boolean;
    };

    if (!query || query.trim().length < 2) {
      return {
        query: query || '',
        containers: [],
        images: [],
        stacks: [],
        logs: [],
      };
    }

    const normalized = normalizeQuery(query);
    const limitSafe = Math.max(1, Math.min(25, limit));
    const logLimitSafe = Math.max(1, Math.min(25, logLimit));

    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => portainer.getEndpoints(),
    );

    const upEndpoints = endpoints.map(normalizeEndpoint).filter((ep) => ep.status === 'up');

    // Fetch containers, images, and stacks in parallel across all endpoints
    const [endpointResults, stacksRaw] = await Promise.all([
      Promise.allSettled(
        upEndpoints.map(async (ep) => {
          const [rawContainers, rawImages] = await Promise.allSettled([
            cachedFetch(
              getCacheKey('containers', ep.id),
              TTL.CONTAINERS,
              () => portainer.getContainers(ep.id),
            ),
            cachedFetch(
              getCacheKey('images', ep.id),
              TTL.IMAGES,
              () => portainer.getImages(ep.id),
            ),
          ]);

          let epContainers: ReturnType<typeof normalizeContainer>[] = [];
          let epImages: NormalizedImage[] = [];

          if (rawContainers.status === 'fulfilled') {
            epContainers = rawContainers.value.map((c) => normalizeContainer(c, ep.id, ep.name));
          } else {
            log.warn({ endpointId: ep.id, err: rawContainers.reason }, 'Failed to fetch containers for search');
          }

          if (rawImages.status === 'fulfilled') {
            epImages = rawImages.value.map((img) => normalizeImage(img, ep.id, ep.name));
          } else {
            log.warn({ endpointId: ep.id, err: rawImages.reason }, 'Failed to fetch images for search');
          }

          return {
            epId: ep.id,
            epName: ep.name,
            containers: epContainers,
            images: epImages,
          };
        }),
      ),
      cachedFetch(
        getCacheKey('stacks'),
        TTL.STACKS,
        () => portainer.getStacks(),
      ),
    ]);

    const containers: ReturnType<typeof normalizeContainer>[] = [];
    const images: NormalizedImage[] = [];

    for (const result of endpointResults) {
      if (result.status === 'fulfilled') {
        containers.push(...result.value.containers);
        images.push(...result.value.images);
      }
    }

    const stacks = stacksRaw.map(normalizeStack);

    const containerMatches = containers.filter((container) => {
      if (
        matchesValue(container.name, normalized) ||
        matchesValue(container.image, normalized) ||
        matchesValue(container.status, normalized) ||
        matchesValue(container.state, normalized) ||
        matchesValue(container.endpointName, normalized)
      ) {
        return true;
      }
      return Object.entries(container.labels || {}).some(
        ([key, value]) => matchesValue(key, normalized) || matchesValue(value, normalized),
      );
    }).slice(0, limitSafe);

    const imageMatches = images.filter((image) => {
      if (
        matchesValue(image.name, normalized) ||
        matchesValue(image.registry, normalized) ||
        matchesValue(image.endpointName, normalized)
      ) {
        return true;
      }
      return image.tags.some((tag) => matchesValue(tag, normalized));
    }).slice(0, limitSafe);

    const stackMatches = stacks.filter((stack) => (
      matchesValue(stack.name, normalized) ||
      matchesValue(stack.status, normalized)
    )).slice(0, limitSafe);

    const logs = includeLogs
      ? await searchContainerLogs(normalized, logLimitSafe, 3, 200)
      : [];

    return {
      query,
      containers: containerMatches,
      images: imageMatches,
      stacks: stackMatches,
      logs,
    };
  });
}
