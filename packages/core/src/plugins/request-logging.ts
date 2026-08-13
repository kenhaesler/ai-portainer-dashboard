import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { getConfig } from '../config/index.js';

/**
 * Access logging (#1552).
 *
 * Fastify's built-in per-request logging (an "incoming request" plus a
 * "request completed" line at info level for EVERY request) is disabled via
 * a `LogController` with `disableRequestLogging: true` in the server factory
 * options. This plugin
 * replaces it with a single deliberate access-log line per request:
 *
 *   - 5xx → error, 4xx → warn (always logged)
 *   - 2xx/3xx → info, or debug when LOG_HTTP_SUCCESS=false
 *   - excluded paths (health probes, Socket.IO, static assets) → never logged
 *
 * Without this, the Docker liveness probe alone (/health every 30s) emits
 * ~5,760 log lines/day/replica, burying the application's structured events.
 */

// Aligned with request-tracing's EXCLUDED_PREFIXES, plus the bare /health
// liveness endpoint (registered at /health, not /api/health) that Docker
// polls every 30 seconds.
export const ACCESS_LOG_EXCLUDED_PREFIXES = [
  '/health',
  '/api/health',
  '/socket.io',
  '/assets/',
  '/favicon',
];

async function requestLoggingPlugin(fastify: FastifyInstance) {
  fastify.addHook('onResponse', async (request, reply) => {
    // Prefer the route pattern over the raw URL so query strings (which may
    // carry one-time stream tickets) never reach the logs.
    const url = request.routeOptions?.url ?? request.url;

    for (const prefix of ACCESS_LOG_EXCLUDED_PREFIXES) {
      if (url.startsWith(prefix)) return;
    }

    const statusCode = reply.statusCode;
    const payload = {
      method: request.method,
      url,
      statusCode,
      durationMs: Math.round(reply.elapsedTime * 10) / 10,
    };

    if (statusCode >= 500) {
      request.log.error(payload, 'request completed');
    } else if (statusCode >= 400) {
      request.log.warn(payload, 'request completed');
    } else if (getConfig().LOG_HTTP_SUCCESS) {
      request.log.info(payload, 'request completed');
    } else {
      request.log.debug(payload, 'request completed');
    }
  });
}

export default fp(requestLoggingPlugin, {
  name: 'request-logging',
});
