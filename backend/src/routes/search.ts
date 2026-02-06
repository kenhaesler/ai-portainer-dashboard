import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { normalizeContainer, normalizeEndpoint, normalizeStack } from '../services/portainer-normalizers.js';
import { createChildLogger } from '../utils/logger.js';
import { SearchQuerySchema } from '../models/api-schemas.js';

const log = createChildLogger('search-route');

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

  const containers: ReturnType<typeof normalizeContainer>[] = [];
  for (const ep of endpoints) {
    const norm = normalizeEndpoint(ep);
    if (norm.status !== 'up') continue;
    try {
      const rawContainers = await cachedFetch(
        getCacheKey('containers', ep.Id),
        TTL.CONTAINERS,
        () => portainer.getContainers(ep.Id),
      );
      containers.push(...rawContainers.map((c) => normalizeContainer(c, ep.Id, ep.Name)));
    } catch (err) {
      log.warn({ endpointId: ep.Id, err }, 'Failed to load containers for log search');
    }
  }

  const candidates = containers
    .filter((c) => c.state === 'running')
    .sort((a, b) => b.created - a.created)
    .slice(0, maxContainers);

  const queryLower = query.toLowerCase();

  for (const container of candidates) {
    if (results.length >= limit) break;
    try {
      const logs = await portainer.getContainerLogs(container.endpointId, container.id, {
        tail,
        timestamps: true,
      });
      const lines = logs.split('\n').filter((line) => line.trim().length > 0);
      for (const line of lines) {
        if (results.length >= limit) break;
        if (!line.toLowerCase().includes(queryLower)) continue;

        const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/);
        const timestamp = match?.[1];
        const message = match?.[2] ?? line;

        results.push({
          id: `${container.endpointId}:${container.id}:${results.length}`,
          endpointId: container.endpointId,
          endpointName: container.endpointName,
          containerId: container.id,
          containerName: container.name,
          message,
          timestamp,
        });
      }
    } catch (err) {
      log.warn({ endpointId: container.endpointId, containerId: container.id, err }, 'Failed to fetch container logs');
    }
  }

  return results;
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
    const { query, limit = 8, logLimit = 8 } = request.query as {
      query?: string;
      limit?: number;
      logLimit?: number;
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

    const containers: ReturnType<typeof normalizeContainer>[] = [];
    const images: NormalizedImage[] = [];

    for (const ep of endpoints) {
      const norm = normalizeEndpoint(ep);
      if (norm.status !== 'up') continue;

      try {
        const rawContainers = await cachedFetch(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => portainer.getContainers(ep.Id),
        );
        containers.push(...rawContainers.map((c) => normalizeContainer(c, ep.Id, ep.Name)));
      } catch (err) {
        log.warn({ endpointId: ep.Id, err }, 'Failed to fetch containers for search');
      }

      try {
        const rawImages = await cachedFetch(
          getCacheKey('images', ep.Id),
          TTL.IMAGES,
          () => portainer.getImages(ep.Id),
        );
        images.push(...rawImages.map((img) => normalizeImage(img, ep.Id, ep.Name)));
      } catch (err) {
        log.warn({ endpointId: ep.Id, err }, 'Failed to fetch images for search');
      }
    }

    const stacksRaw = await cachedFetch(
      getCacheKey('stacks'),
      TTL.STACKS,
      () => portainer.getStacks(),
    );
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

    const logs = await searchContainerLogs(normalized, logLimitSafe, 6, 200);

    return {
      query,
      containers: containerMatches,
      images: imageMatches,
      stacks: stackMatches,
      logs,
    };
  });
}
