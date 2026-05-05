import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { getConfig } from '../config/index.js';

const OBSERVER_READ_PATH_PREFIXES = [
  '/api/containers',
  '/api/dashboard',
  '/api/endpoints',
  '/api/images',
  '/api/llm/stats',
  '/api/llm/traces',
  '/api/logs',
  '/api/metrics',
  '/api/monitoring',
  '/api/networks',
  '/api/reports',
  '/api/search',
  '/api/stacks',
  '/api/status',
  '/api/traces',
];

function getRequestPath(url: string | undefined): string {
  if (!url) return '';
  return url.split('?')[0] ?? '';
}

export function shouldBypassGlobalRateLimit(method: string, url: string | undefined): boolean {
  if (method !== 'GET') return false;
  const path = getRequestPath(url);

  return OBSERVER_READ_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

async function rateLimitPlugin(fastify: FastifyInstance) {
  const config = getConfig();

  await fastify.register(rateLimit, {
    max: config.API_RATE_LIMIT,
    timeWindow: '1 minute',
    // Bucket per client IP. `request.ip` is populated by Fastify's proxy-addr
    // integration only when the app is constructed with `trustProxy` set
    // (see `packages/server/src/app.ts` and #1099). Without trustProxy, every
    // request behind the nginx container shares one bucket — defeating per-client
    // throttling. TRUSTED_PROXY_IPS narrows which hops are honoured.
    keyGenerator: (request) => {
      return request.ip;
    },
    allowList: (request) => shouldBypassGlobalRateLimit(request.method, request.raw.url),
  });
}

export default fp(rateLimitPlugin, { name: 'rate-limit' });
