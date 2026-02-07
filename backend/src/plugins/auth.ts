import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { verifyJwt } from '../utils/crypto.js';
import { hasMinRole, type Role } from '../services/user-store.js';
import { getSession } from '../services/session-store.js';

interface AuthenticatedUser {
  sub: string;
  username: string;
  sessionId: string;
  role: Role;
}

export async function authenticateBearerHeader(authHeader?: string): Promise<AuthenticatedUser | null> {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const payload = await verifyJwt(token);
  if (!payload?.sessionId) {
    return null;
  }

  const session = getSession(payload.sessionId);
  if (!session) {
    return null;
  }

  if (session.user_id !== payload.sub || session.username !== payload.username) {
    return null;
  }

  return {
    sub: payload.sub,
    username: payload.username,
    sessionId: payload.sessionId,
    role: (payload.role as Role) || 'viewer',
  };
}

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

    const user = await authenticateBearerHeader(authHeader);
    if (!user) {
      reply.code(401).send({ error: 'Invalid, expired, or revoked token' });
      return;
    }

    request.user = user;
  });

  fastify.decorate('requireRole', function (minRole: Role) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      if (!request.user) {
        reply.code(401).send({ error: 'Not authenticated' });
        return;
      }
      if (!hasMinRole(request.user.role, minRole)) {
        reply.code(403).send({ error: 'Insufficient permissions' });
        return;
      }
    };
  });
}

export default fp(authPlugin, { name: 'auth' });

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (minRole: Role) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: {
      sub: string;
      username: string;
      sessionId: string;
      role: Role;
    };
  }
}
