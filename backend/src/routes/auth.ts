import { FastifyInstance } from 'fastify';
import { signJwt } from '../utils/crypto.js';
import { createSession, getSession, invalidateSession, refreshSession } from '../services/session-store.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { authenticateUser, ensureDefaultAdmin } from '../services/user-store.js';
import { LoginRequestSchema } from '../models/auth.js';
import { LoginResponseSchema, SessionResponseSchema, RefreshResponseSchema, ErrorResponseSchema, SuccessResponseSchema } from '../models/api-schemas.js';

export async function authRoutes(fastify: FastifyInstance) {
  // Ensure default admin exists on startup
  await ensureDefaultAdmin();

  // Login
  fastify.post('/api/auth/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login with username and password',
      body: LoginRequestSchema,
      response: {
        200: LoginResponseSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid credentials format' });
    }

    const { username, password } = parsed.data;

    const user = await authenticateUser(username, password);
    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const session = createSession(user.id, user.username);
    const token = await signJwt({
      sub: user.id,
      username: user.username,
      sessionId: session.id,
      role: user.role,
    });

    writeAuditLog({
      user_id: user.id,
      username: user.username,
      action: 'login',
      details: { role: user.role },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return {
      token,
      username: user.username,
      expiresAt: session.expires_at,
    };
  });

  // Logout
  fastify.post('/api/auth/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Logout and invalidate session',
      response: { 200: SuccessResponseSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    if (request.user) {
      invalidateSession(request.user.sessionId);
      writeAuditLog({
        user_id: request.user.sub,
        username: request.user.username,
        action: 'logout',
        details: { role: request.user.role },
        request_id: request.requestId,
        ip_address: request.ip,
      });
    }
    return { success: true };
  });

  // Get current session
  fastify.get('/api/auth/session', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current session info',
      response: { 200: SessionResponseSchema, 401: ErrorResponseSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const session = getSession(request.user.sessionId);
    if (!session) {
      return reply.code(401).send({ error: 'Session expired' });
    }

    return {
      username: session.username,
      role: request.user.role,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
    };
  });

  // Refresh token
  fastify.post('/api/auth/refresh', {
    schema: {
      tags: ['Auth'],
      summary: 'Refresh JWT token',
      response: { 200: RefreshResponseSchema, 401: ErrorResponseSchema },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const session = refreshSession(request.user.sessionId);
    if (!session) {
      return reply.code(401).send({ error: 'Session expired' });
    }

    const token = await signJwt({
      sub: request.user.sub,
      username: request.user.username,
      sessionId: session.id,
      role: request.user.role,
    });

    return {
      token,
      expiresAt: session.expires_at,
    };
  });
}
