import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { insertSpan } from '../services/trace-store.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('request-tracing');

const EXCLUDED_PREFIXES = ['/api/health', '/socket.io', '/assets/', '/favicon'];

async function requestTracingPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request) => {
    (request as unknown as Record<string, number>).__traceStart = Date.now();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const url = request.routeOptions?.url ?? request.url;

    // Skip excluded paths
    for (const prefix of EXCLUDED_PREFIXES) {
      if (url.startsWith(prefix)) return;
    }

    const startMs = (request as unknown as Record<string, number>).__traceStart;
    if (!startMs) return;

    const endMs = Date.now();
    const durationMs = endMs - startMs;
    const startTime = new Date(startMs).toISOString();
    const endTime = new Date(endMs).toISOString();

    try {
      insertSpan({
        id: request.requestId ?? request.id,
        trace_id: request.requestId ?? request.id,
        parent_span_id: null,
        name: `${request.method} ${url}`,
        kind: 'server',
        status: reply.statusCode >= 400 ? 'error' : 'ok',
        start_time: startTime,
        end_time: endTime,
        duration_ms: durationMs,
        service_name: 'api-gateway',
        attributes: JSON.stringify({
          method: request.method,
          url,
          statusCode: reply.statusCode,
          contentLength: reply.getHeader('content-length') ?? null,
        }),
      });
    } catch (err) {
      log.warn({ err }, 'Failed to insert request span');
    }
  });
}

export default fp(requestTracingPlugin, {
  name: 'request-tracing',
  dependencies: ['request-context'],
});
