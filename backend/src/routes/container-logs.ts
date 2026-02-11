import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { getContainerLogsWithRetry } from '../services/edge-log-fetcher.js';
import { ContainerParamsSchema, ContainerLogsQuerySchema } from '../models/api-schemas.js';
import { assertCapability, isEdgeStandard } from '../services/edge-capability-guard.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('container-logs-route');

export async function containerLogsRoutes(fastify: FastifyInstance) {
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
}
