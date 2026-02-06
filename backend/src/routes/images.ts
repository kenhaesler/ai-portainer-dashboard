import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { EndpointIdQuerySchema } from '../models/api-schemas.js';

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
        TTL.CONTAINERS,
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
            TTL.CONTAINERS,
            () => portainer.getImages(ep.Id),
          );
          return images.map((img) => normalizeImage(img, ep.Id, ep.Name));
        } catch {
          return [];
        }
      }),
    );

    return allImages.flat();
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
