import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { v4 as uuidv4 } from 'uuid';
import { insertSpan } from '../services/trace-store.js';
import { runWithTraceContext, getCurrentTraceContext } from '../services/trace-context.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('request-tracing');

const EXCLUDED_PREFIXES = ['/api/health', '/socket.io', '/assets/', '/favicon'];

async function requestTracingPlugin(fastify: FastifyInstance) {
  // Merged from request-context: assign requestId and set up logging context
  fastify.addHook('onRequest', async (request, reply) => {
    const requestId = (request.headers['x-request-id'] as string) || uuidv4();
    request.requestId = requestId;
    reply.header('X-Request-ID', requestId);
    request.log = request.log.child({ requestId });

    // Start trace context for this request
    (request as unknown as Record<string, number>).__traceStart = Date.now();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const url = request.routeOptions?.url ?? request.url;
    const host = request.hostname || (typeof request.headers.host === 'string' ? request.headers.host : '');
    const protocol = request.protocol || 'http';
    const urlFull = host ? `${protocol}://${host}${url}` : url;

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

    // Use trace context if available (set by the route handler wrapper),
    // otherwise fall back to requestId
    const ctx = getCurrentTraceContext();
    const traceId = ctx?.traceId ?? request.requestId ?? request.id;
    const spanId = ctx?.spanId ?? request.requestId ?? request.id;

    try {
      await insertSpan({
        id: spanId,
        trace_id: traceId,
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
          'url.full': urlFull,
          'url.path': url,
          'http.method': request.method,
          statusCode: reply.statusCode,
          'http.status_code': reply.statusCode,
          'server.address': host || null,
          'url.scheme': protocol,
          'network.protocol.name': protocol,
          'network.transport': 'tcp',
          contentLength: reply.getHeader('content-length') ?? null,
        }),
        trace_source: 'http',
        http_method: request.method,
        http_route: url,
        http_status_code: reply.statusCode,
        server_address: host || null,
        url_full: urlFull || null,
        url_scheme: protocol,
        network_transport: 'tcp',
        network_protocol_name: protocol,
      });
    } catch (err) {
      log.warn({ err }, 'Failed to insert request span');
    }
  });

  // Wrap route handlers with trace context so downstream withSpan() calls
  // can attach child spans to this request's trace
  fastify.addHook('onRoute', (routeOptions) => {
    const originalHandler = routeOptions.handler;

    routeOptions.handler = async function (this: FastifyInstance, request, reply) {
      const traceId = request.requestId ?? request.id;
      const spanId = traceId; // Root span ID matches trace ID

      return runWithTraceContext(
        { traceId, spanId, source: 'http' },
        () => (originalHandler as (...args: unknown[]) => unknown).call(this, request, reply),
      );
    };
  });
}

export default fp(requestTracingPlugin, {
  name: 'request-tracing',
});

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}
