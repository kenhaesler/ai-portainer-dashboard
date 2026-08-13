import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/swagger';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { ContainerParamsSchema, ContainerLogsQuerySchema, ContainerLogStreamQuerySchema } from '@dashboard/core/models/api-schemas.js';
import {
  getContainerLogsWithRetry,
  waitForTunnel,
  assertCapability,
  isEdgeStandard,
  isEdgeAsync,
  initiateEdgeAsyncLogCollection,
  checkEdgeJobStatus,
  retrieveEdgeJobLogs,
  cleanupEdgeJob,
  IncrementalDockerFrameDecoder,
} from '@dashboard/infrastructure';
import { consumeStreamTicket } from '@dashboard/core/services/stream-tickets.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { getErrorStatusCode } from '@dashboard/core/utils/http-error.js';
import { errorDetails } from '@dashboard/core/plugins/error-handler.js';

const log = createChildLogger('container-logs-route');

const CollectJobIdParamsSchema = z.object({
  endpointId: z.coerce.number().int().positive(),
  containerId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  jobId: z.coerce.number().int().positive(),
});

const EdgeAsyncLogCollectionBodySchema = z.object({
  tail: z.number().int().min(1).max(10_000).optional(),
}).strict();

export async function containerLogsRoutes(fastify: FastifyInstance) {
  // Existing: GET live container logs (rejects Edge Async with 422)
  fastify.get('/api/containers/:endpointId/:containerId/logs', {
    schema: {
      tags: ['Containers'],
      summary: 'Get container logs',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
      querystring: ContainerLogsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId, containerId } = request.params as {
      endpointId: number;
      containerId: string;
    };
    const { tail, since, until, timestamps } = request.query as {
      tail?: number;
      since?: number;
      until?: number;
      timestamps?: boolean;
    };

    try {
      await assertCapability(endpointId, 'realtimeLogs');

      const edgeStd = await isEdgeStandard(endpointId);
      const logOptions = { tail, since, until, timestamps };

      const logs = edgeStd
        ? await getContainerLogsWithRetry(endpointId, containerId, logOptions)
        : await portainer.getContainerLogs(endpointId, containerId, logOptions);

      return { logs, containerId, endpointId };
    } catch (err) {
      const statusCode = getErrorStatusCode(err);
      if (statusCode === 422) {
        return reply.status(422).send({
          error: err instanceof Error ? err.message : 'Capability unavailable',
          code: 'EDGE_ASYNC_UNSUPPORTED',
        });
      }
      if (statusCode === 504) {
        log.warn({ err, endpointId, containerId }, 'Edge tunnel warmup timed out');
        return reply.status(504).send({
          error: 'Edge agent tunnel timed out',
          code: 'EDGE_TUNNEL_TIMEOUT',
          details: errorDetails(err),
        });
      }
      log.error({ err, endpointId, containerId }, 'Failed to fetch container logs');
      return reply.status(502).send({
        error: 'Failed to fetch container logs',
        details: errorDetails(err),
      });
    }
  });

  // POST: Initiate Edge Async log collection via Edge Job
  fastify.post('/api/containers/:endpointId/:containerId/logs/collect', {
    schema: {
      tags: ['Containers'],
      summary: 'Initiate async log collection for Edge Async endpoints',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
      // Fastify represents an absent request body as null at validation time.
      body: EdgeAsyncLogCollectionBodySchema.nullable().optional(),
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { endpointId, containerId } = request.params as {
      endpointId: number;
      containerId: string;
    };
    const body = request.body as { tail?: number } | null | undefined;

    try {
      const edgeAsync = await isEdgeAsync(endpointId);
      if (!edgeAsync) {
        return reply.status(400).send({
          error: 'This endpoint is not Edge Async. Use the standard logs endpoint.',
        });
      }

      const handle = await initiateEdgeAsyncLogCollection(endpointId, containerId, {
        tail: body?.tail,
      });

      return reply.status(202).send({
        jobId: handle.jobId,
        status: 'collecting',
      });
    } catch (err) {
      log.error({ err, endpointId, containerId }, 'Failed to initiate async log collection');
      return reply.status(502).send({
        error: 'Failed to initiate log collection',
        details: errorDetails(err),
      });
    }
  });

  // GET: Poll for Edge Job log collection status / retrieve results
  fastify.get('/api/containers/:endpointId/:containerId/logs/collect/:jobId', {
    schema: {
      tags: ['Containers'],
      summary: 'Check async log collection status or retrieve results',
      security: [{ bearerAuth: [] }],
      params: CollectJobIdParamsSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { endpointId, containerId, jobId } = request.params as {
      endpointId: number;
      containerId: string;
      jobId: number;
    };

    const startTime = Date.now();

    try {
      const handle = { jobId, endpointId, containerId };
      const status = await checkEdgeJobStatus(handle);

      if (!status.ready || !status.taskId) {
        return reply.status(202).send({
          jobId,
          status: 'collecting',
        });
      }

      const logs = await retrieveEdgeJobLogs(jobId, status.taskId);
      await cleanupEdgeJob(jobId);

      return reply.status(200).send({
        logs,
        containerId,
        endpointId,
        durationMs: Date.now() - startTime,
        source: 'edge-job',
      });
    } catch (err) {
      log.error({ err, endpointId, containerId, jobId }, 'Failed to check/retrieve async logs');
      return reply.status(502).send({
        error: 'Failed to retrieve logs',
        details: errorDetails(err),
      });
    }
  });

  // GET: SSE streaming endpoint for real-time log tailing
  // Accepts Bearer token via query param (?token=...) since EventSource cannot set headers.
  fastify.get('/api/containers/:endpointId/:containerId/logs/stream', {
    schema: {
      tags: ['Containers'],
      summary: 'Stream container logs via SSE (real-time tailing)',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
      querystring: ContainerLogStreamQuerySchema,
    },
    preHandler: [async (request, reply) => {
      // SSE auth path (#1112): EventSource cannot set Authorization headers,
      // so the client first POSTs /api/auth/stream-ticket (authenticated by
      // JWT in the Authorization header, which fetch supports) and then opens
      // the stream with ?ticket=… in the URL.
      //
      // The ticket is opaque, single-use, and 30-second TTL. nginx scrubs the
      // ticket from access logs via a per-location log_format that omits
      // $args (frontend/nginx.conf). No JWT ever touches the URL.
      //
      // We still accept a Bearer header path for non-EventSource callers
      // (e.g. native fetch streams used by useStreamingLogs).
      const { ticket } = request.query as { ticket?: string };
      if (!request.headers.authorization && ticket) {
        const validated = await consumeStreamTicket(ticket);
        if (!validated) {
          return reply.code(401).send({ error: 'Invalid, expired, or already-used stream ticket' });
        }
        // Tickets do not carry a role — the SSE endpoint is read-only and
        // its capability gating is handled by `assertCapability` below. We
        // populate request.user with viewer role so downstream middleware
        // (audit, logging) sees a consistent identity.
        request.user = {
          sub: validated.userId,
          username: validated.username,
          sessionId: '',
          role: 'viewer',
        };
        return;
      }
      return fastify.authenticate(request, reply);
    }],
  }, async (request, reply) => {
    const { endpointId, containerId } = request.params as {
      endpointId: number;
      containerId: string;
    };
    const { since, timestamps } = request.query as {
      since?: number;
      timestamps?: boolean;
    };

    // 1. Reject Edge Async endpoints
    try {
      await assertCapability(endpointId, 'realtimeLogs');
    } catch (err) {
      const statusCode = getErrorStatusCode(err);
      if (statusCode === 422) {
        return reply.status(422).send({
          error: err instanceof Error ? err.message : 'Capability unavailable',
          code: 'EDGE_ASYNC_UNSUPPORTED',
        });
      }
      throw err;
    }

    // 2. Edge Standard: warm up tunnel first
    const edgeStd = await isEdgeStandard(endpointId);
    if (edgeStd) {
      try {
        await waitForTunnel(endpointId);
      } catch (err) {
        const statusCode = getErrorStatusCode(err);
        if (statusCode === 504) {
          log.warn({ err, endpointId, containerId }, 'Edge tunnel warmup timed out for stream');
          return reply.status(504).send({
            error: 'Edge agent tunnel timed out',
            code: 'EDGE_TUNNEL_TIMEOUT',
            details: errorDetails(err),
          });
        }
        throw err;
      }
    }

    // 3. Open upstream streaming connection
    let stream: { body: ReadableStream<Uint8Array>; abort: () => void };
    try {
      stream = await portainer.streamContainerLogs(endpointId, containerId, {
        since,
        timestamps,
      });
    } catch (err) {
      log.error({ err, endpointId, containerId }, 'Failed to open log stream');
      return reply.status(502).send({
        error: 'Failed to open log stream',
        details: errorDetails(err),
      });
    }

    // 4. Hijack response for SSE (bypasses Fastify compression/serialization)
    const origin = request.headers.origin;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(origin ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
      } : {}),
    });

    const decoder = new IncrementalDockerFrameDecoder();
    let closed = false;

    // Heartbeat every 15s to keep the connection alive
    const heartbeatInterval = setInterval(() => {
      if (!closed) {
        reply.raw.write(`data: ${JSON.stringify({ heartbeat: true, ts: Date.now() })}\n\n`);
      }
    }, 15_000);

    // Edge Standard keep-alive: lightweight Docker API call every 3 min to prevent tunnel timeout
    const keepAliveInterval = edgeStd
      ? setInterval(() => {
          if (!closed) {
            portainer.getContainers(endpointId, false).catch((err) => {
              log.debug({ err, endpointId }, 'Edge keep-alive ping failed');
            });
          }
        }, 3 * 60_000)
      : null;

    function cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatInterval);
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      stream.abort();
    }

    // Clean up on client disconnect
    reply.raw.on('close', cleanup);

    // 5. Pipe upstream through decoder, emit SSE events
    try {
      const reader = (stream.body as any).getReader
        ? (stream.body as ReadableStream<Uint8Array>).getReader()
        : null;

      if (reader) {
        // Web ReadableStream (from undici)
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;

          const lines = decoder.push(Buffer.from(value));
          for (const line of lines) {
            if (closed) break;
            const ok = reply.raw.write(`data: ${JSON.stringify({ line, ts: Date.now() })}\n\n`);
            if (!ok) {
              // Backpressure: wait for drain before continuing
              await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
            }
          }
        }
      } else {
        // Node.js Readable stream fallback
        const nodeStream = stream.body as unknown as import('stream').Readable;
        for await (const chunk of nodeStream) {
          if (closed) break;
          const lines = decoder.push(Buffer.from(chunk));
          for (const line of lines) {
            if (closed) break;
            const ok = reply.raw.write(`data: ${JSON.stringify({ line, ts: Date.now() })}\n\n`);
            if (!ok) {
              await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
            }
          }
        }
      }

      // Drain remaining buffered content
      const remaining = decoder.drain();
      for (const line of remaining) {
        if (closed) break;
        reply.raw.write(`data: ${JSON.stringify({ line, ts: Date.now() })}\n\n`);
      }

      // Stream ended (container stopped or log stream closed)
      if (!closed) {
        reply.raw.write(`data: ${JSON.stringify({ done: true, reason: 'container_stopped' })}\n\n`);
      }
    } catch (err) {
      if (!closed) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (!isAbort) {
          log.error({ err, endpointId, containerId }, 'Log stream error');
          try {
            reply.raw.write(`data: ${JSON.stringify({ error: 'Stream interrupted', code: 'STREAM_ERROR' })}\n\n`);
          } catch {
            // Client already disconnected
          }
        }
      }
    } finally {
      cleanup();
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  });
}
