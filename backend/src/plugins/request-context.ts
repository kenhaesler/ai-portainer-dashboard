import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { v4 as uuidv4 } from 'uuid';

async function requestContextPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    const requestId = (request.headers['x-request-id'] as string) || uuidv4();
    request.requestId = requestId;
    reply.header('X-Request-ID', requestId);
    request.log = request.log.child({ requestId });
  });
}

export default fp(requestContextPlugin, {
  name: 'request-context',
});

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}
