import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as portainer from '../services/portainer-client.js';
import { getContainerLogsWithRetry } from '../services/edge-log-fetcher.js';
import { ContainerParamsSchema, ContainerLogsQuerySchema } from '../models/api-schemas.js';
import { assertCapability, isEdgeStandard, isEdgeAsync } from '../services/edge-capability-guard.js';
import {
  initiateEdgeAsyncLogCollection,
  checkEdgeJobStatus,
  retrieveEdgeJobLogs,
  cleanupEdgeJob,
} from '../services/edge-async-log-fetcher.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('container-logs-route');

const CollectJobIdParamsSchema = z.object({
  endpointId: z.coerce.number(),
  containerId: z.string(),
  jobId: z.coerce.number(),
});

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
      const statusCode = (err as any).statusCode ?? (err as any).status;
      if (statusCode === 422) {
        return reply.status(422).send({
          error: err instanceof Error ? err.message : 'Capability unavailable',
          code: 'EDGE_ASYNC_UNSUPPORTED',
        });
      }
      if (statusCode === 504) {
        const message = err instanceof Error ? err.message : 'Edge agent tunnel timed out';
        log.warn({ err, endpointId, containerId }, 'Edge tunnel warmup timed out');
        return reply.status(504).send({
          error: message,
          code: 'EDGE_TUNNEL_TIMEOUT',
        });
      }
      const message = err instanceof Error ? err.message : 'Failed to fetch container logs';
      log.error({ err, endpointId, containerId }, 'Failed to fetch container logs');
      return reply.status(502).send({ error: message });
    }
  });

  // POST: Initiate Edge Async log collection via Edge Job
  fastify.post('/api/containers/:endpointId/:containerId/logs/collect', {
    schema: {
      tags: ['Containers'],
      summary: 'Initiate async log collection for Edge Async endpoints',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { endpointId, containerId } = request.params as {
      endpointId: number;
      containerId: string;
    };
    const body = request.body as { tail?: number } | undefined;

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
      const message = err instanceof Error ? err.message : 'Failed to initiate log collection';
      log.error({ err, endpointId, containerId }, 'Failed to initiate async log collection');
      return reply.status(502).send({ error: message });
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
    preHandler: [fastify.authenticate],
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
      const message = err instanceof Error ? err.message : 'Failed to retrieve logs';
      log.error({ err, endpointId, containerId, jobId }, 'Failed to check/retrieve async logs');
      return reply.status(502).send({ error: message });
    }
  });
}
