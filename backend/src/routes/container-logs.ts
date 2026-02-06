import { FastifyInstance } from 'fastify';
import * as portainer from '../services/portainer-client.js';
import { ContainerParamsSchema, ContainerLogsQuerySchema } from '../models/api-schemas.js';

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
  }, async (request) => {
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

    const logs = await portainer.getContainerLogs(endpointId, containerId, {
      tail,
      since,
      until,
      timestamps,
    });

    return { logs, containerId, endpointId };
  });
}
