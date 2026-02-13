import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { EndpointIdQuerySchema } from '../models/api-schemas.js';
import { getStalenessRecords, getStalenessSummary, runStalenessChecks } from '../services/image-staleness.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('route:images');

export async function imagesRoutes(fastify: FastifyInstance) {
  fastify.get('/api/images', {
    schema: {
      tags: ['Images'],
      summary: 'List Docker images across all endpoints',
      security: [{ bearerAuth: [] }],
      querystring: EndpointIdQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId } = request.query as { endpointId?: number };

    if (endpointId) {
      const images = await cachedFetch(
        getCacheKey('images', endpointId),
        TTL.IMAGES,
        () => portainer.getImages(endpointId),
      );
      return images.map((img) => normalizeImage(img, endpointId));
    }

    // Fetch images from all endpoints
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => portainer.getEndpoints(),
    );

    const allImages = await Promise.all(
      endpoints.map(async (ep) => {
        try {
          const images = await cachedFetch(
            getCacheKey('images', ep.Id),
            TTL.IMAGES,
            () => portainer.getImages(ep.Id),
          );
          return images.map((img) => normalizeImage(img, ep.Id, ep.Name));
        } catch {
          return [];
        }
      }),
    );

    // De-duplicate images by ID across endpoints
    const seen = new Map<string, NormalizedImage>();
    for (const img of allImages.flat()) {
      const existing = seen.get(img.id);
      if (!existing) {
        seen.set(img.id, img);
      } else {
        // Keep the one with more tags, append endpoint info
        if (img.tags.length > existing.tags.length) {
          seen.set(img.id, {
            ...img,
            endpointName: `${existing.endpointName || `Endpoint ${existing.endpointId}`}, ${img.endpointName || `Endpoint ${img.endpointId}`}`,
          });
        } else {
          seen.set(img.id, {
            ...existing,
            endpointName: `${existing.endpointName || `Endpoint ${existing.endpointId}`}, ${img.endpointName || `Endpoint ${img.endpointId}`}`,
          });
        }
      }
    }

    return Array.from(seen.values());
  });

  // Image staleness endpoints
  fastify.get('/api/images/staleness', {
    schema: {
      tags: ['Images'],
      summary: 'Get image staleness check results',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    return {
      records: getStalenessRecords(),
      summary: getStalenessSummary(),
    };
  });

  fastify.post('/api/images/staleness/check', {
    schema: {
      tags: ['Images'],
      summary: 'Trigger image staleness check for all images',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    try {
      const endpoints = await cachedFetch(
        getCacheKey('endpoints'),
        TTL.ENDPOINTS,
        () => portainer.getEndpoints(),
      );

      const allImages: Array<{ name: string; tags: string[]; registry: string; id: string }> = [];
      for (const ep of endpoints) {
        try {
          const images = await cachedFetch(
            getCacheKey('images', ep.Id),
            TTL.IMAGES,
            () => portainer.getImages(ep.Id),
          );
          for (const img of images) {
            const norm = normalizeImage(img, ep.Id);
            allImages.push({ name: norm.name, tags: norm.tags, registry: norm.registry, id: norm.id });
          }
        } catch {
          // skip endpoint
        }
      }

      const result = await runStalenessChecks(allImages);
      return { success: true, ...result };
    } catch (err) {
      log.error({ err }, 'Manual staleness check failed');
      return { success: false, checked: 0, stale: 0 };
    }
  });
}

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

  // Remove tag from name for display
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
