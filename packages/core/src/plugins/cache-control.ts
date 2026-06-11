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
  /** stale-while-revalidate in seconds (optional) */
  swr?: number;
}

const CACHE_RULES: CacheRule[] = [
  { prefix: '/api/dashboard/full', maxAge: 30, swr: 60 },
  { prefix: '/api/dashboard/summary', maxAge: 30, swr: 60 },
  { prefix: '/api/dashboard/kpi-history', maxAge: 120, swr: 300 },
  { prefix: '/api/endpoints', maxAge: 60, swr: 120 },
  { prefix: '/api/containers', maxAge: 30, swr: 60 },
  { prefix: '/api/images', maxAge: 300, swr: 600 },
  { prefix: '/api/networks', maxAge: 300, swr: 600 },
  { prefix: '/api/stacks', maxAge: 300, swr: 600 },
  { prefix: '/api/security/audit', maxAge: 120, swr: 300 },
  { prefix: '/api/monitoring/insights', maxAge: 60, swr: 120 },
  { prefix: '/api/metrics', maxAge: 30, swr: 60 },
];

/** Routes that must never be cached */
const NO_CACHE_PREFIXES = [
  '/api/auth',
  '/api/admin',
  '/api/llm',
  '/api/remediation',
  '/api/settings',
  // Sensitive admin reads: the user roster and database backup downloads must
  // not be written to the browser's private disk cache (survives logout).
  '/api/users',
  '/api/backup',
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
        const swr = rule.swr ? `, stale-while-revalidate=${rule.swr}` : '';
        reply.header('Cache-Control', `private, max-age=${rule.maxAge}${swr}`);
        return payload;
      }
    }

    return payload;
  });
}

export default fp(cacheControlPlugin, { name: 'cache-control' });
