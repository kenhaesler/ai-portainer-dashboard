import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Cache-Control header plugin.
 *
 * Adds Cache-Control headers to API responses based on route patterns,
 * allowing browsers and proxies to cache stable data and reduce
 * redundant requests to the backend.
 */

interface CacheRule {
  /** Route prefix to match (e.g. '/api/endpoints') */
  prefix: string;
  /** max-age in seconds */
  maxAge: number;
}

const CACHE_RULES: CacheRule[] = [
  { prefix: '/api/endpoints', maxAge: 60 },
  { prefix: '/api/containers', maxAge: 30 },
  { prefix: '/api/images', maxAge: 120 },
  { prefix: '/api/networks', maxAge: 120 },
  { prefix: '/api/stacks', maxAge: 60 },
  { prefix: '/api/dashboard/summary', maxAge: 30 },
];

/** Routes that must never be cached */
const NO_CACHE_PREFIXES = [
  '/api/auth',
  '/api/admin',
  '/api/llm',
  '/api/remediation',
  '/api/settings',
];

async function cacheControlPlugin(fastify: FastifyInstance) {
  fastify.addHook('onSend', async (request, reply, payload) => {
    const url = request.url;

    // Skip if header already set (e.g. SSE streams)
    if (reply.getHeader('Cache-Control')) return payload;

    // Skip non-GET requests — mutations should never be cached
    if (request.method !== 'GET') return payload;

    // Explicitly no-cache for sensitive routes
    for (const prefix of NO_CACHE_PREFIXES) {
      if (url.startsWith(prefix)) {
        reply.header('Cache-Control', 'no-store');
        return payload;
      }
    }

    // Apply cache rules
    for (const rule of CACHE_RULES) {
      if (url.startsWith(rule.prefix)) {
        reply.header('Cache-Control', `private, max-age=${rule.maxAge}`);
        return payload;
      }
    }

    return payload;
  });
}

export default fp(cacheControlPlugin, { name: 'cache-control' });
