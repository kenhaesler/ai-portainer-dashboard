import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { verifyJwt } from '../utils/crypto.js';

async function authPlugin(fastify: FastifyInstance) {
  fastify.decorate('authenticate', async function (
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    const payload = await verifyJwt(token);
    if (!payload) {
      reply.code(401).send({ error: 'Invalid or expired token' });
      return;
    }

    request.user = {
      sub: payload.sub,
      username: payload.username,
      sessionId: payload.sessionId,
    };
  });
}

export default fp(authPlugin, { name: 'auth' });

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: {
      sub: string;
      username: string;
      sessionId: string;
    };
  }
}
