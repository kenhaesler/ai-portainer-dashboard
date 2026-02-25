import { FastifyInstance, FastifyRequest } from 'fastify';
import { getConfig } from '../../../core/config/index.js';
import { transformOtlpToSpans, type OtlpExportRequest } from '../../../core/tracing/otlp-transformer.js';
import { decodeOtlpProtobuf } from '../../../core/tracing/otlp-protobuf.js';
import { insertSpans } from '../../../core/tracing/trace-store.js';
import { createChildLogger } from '../../../core/utils/logger.js';

const log = createChildLogger('traces-ingest');

export async function tracesIngestRoutes(fastify: FastifyInstance) {
  // Register a content-type parser for protobuf so Fastify reads the raw buffer
  fastify.addContentTypeParser(
    'application/x-protobuf',
    { parseAs: 'buffer' },
    (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
      done(null, body);
    },
  );

  // Also accept application/x-protobuf under the generic protobuf content type
  fastify.addContentTypeParser(
    'application/protobuf',
    { parseAs: 'buffer' },
    (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
      done(null, body);
    },
  );

  // Register on both paths:
  // - /api/traces/otlp           → for manual/curl testing
  // - /api/traces/otlp/v1/traces → Beyla auto-appends /v1/traces to OTEL_EXPORTER_OTLP_ENDPOINT
  const paths = ['/api/traces/otlp', '/api/traces/otlp/v1/traces'];

  for (const path of paths) {
    fastify.post(path, {
      schema: {
        tags: ['Traces'],
        summary: 'Ingest OTLP traces from external sources (e.g. Grafana Beyla)',
      },
    }, handleOtlpIngest);
  }

  // Silently accept (and discard) OTLP metrics from Beyla to prevent 404 log noise.
  // Beyla sends metrics to /v1/metrics even with OTEL_METRICS_EXPORTER=none.
  fastify.post('/api/traces/otlp/v1/metrics', {
    schema: { hide: true },
  }, async (_request, reply) => {
    return reply.status(200).send({});
  });
}

async function handleOtlpIngest(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
) {
  const config = getConfig();

  // Feature flag check
  if (!config.TRACES_INGESTION_ENABLED) {
    return reply.status(501).send({ error: 'Trace ingestion is not enabled' });
  }

  // API key auth (service-to-service, not JWT)
  const apiKey = extractApiKey(request.headers);
  if (!apiKey || apiKey !== config.TRACES_INGESTION_API_KEY) {
    return reply.status(401).send({ error: 'Invalid or missing API key' });
  }

  // Decode body based on content type
  let otlpPayload: OtlpExportRequest;
  const contentType = request.headers['content-type'] || '';

  if (contentType.includes('protobuf')) {
    // Protobuf: body is a raw Buffer from our content type parser
    try {
      otlpPayload = decodeOtlpProtobuf(request.body as Buffer);
    } catch (err) {
      log.warn({ err }, 'Failed to decode protobuf OTLP payload');
      return reply.status(400).send({ error: 'Invalid protobuf OTLP payload' });
    }
  } else {
    // JSON (default)
    otlpPayload = request.body as OtlpExportRequest;
  }

  if (!otlpPayload || !otlpPayload.resourceSpans || !Array.isArray(otlpPayload.resourceSpans)) {
    return reply.status(400).send({ error: 'Invalid OTLP payload: resourceSpans array required' });
  }

  // Transform and insert
  const spans = transformOtlpToSpans(otlpPayload);
  if (spans.length === 0) {
    return { accepted: 0 };
  }

  const accepted = await insertSpans(spans);
  log.info({ accepted, resourceSpans: otlpPayload.resourceSpans.length, format: contentType.includes('protobuf') ? 'protobuf' : 'json' }, 'OTLP spans ingested');

  return { accepted };
}

function extractApiKey(headers: Record<string, string | string[] | undefined>): string | undefined {
  // Check X-API-Key header first
  const xApiKey = headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey) return xApiKey;

  // Check Authorization: Bearer <key>
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }

  return undefined;
}
