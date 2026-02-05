import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isOIDCEnabled, getOIDCConfig, generateAuthorizationUrl, exchangeCode } from '../services/oidc.js';
import { createSession, invalidateSession } from '../services/session-store.js';
import { signJwt } from '../utils/crypto.js';
import { writeAuditLog } from '../services/audit-logger.js';

const callbackSchema = z.object({
  callbackUrl: z.string().url(),
  state: z.string().min(1),
});

export async function oidcRoutes(fastify: FastifyInstance) {
  // Get OIDC status (public — no auth required)
  fastify.get('/api/auth/oidc/status', {
    schema: {
      tags: ['Auth'],
      summary: 'Get OIDC SSO status and authorization URL',
      response: {
        200: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            authUrl: { type: 'string' },
            state: { type: 'string' },
          },
        },
        500: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (_request, reply) => {
    if (!isOIDCEnabled()) {
      return { enabled: false };
    }

    try {
      const oidcConfig = getOIDCConfig();
      const redirectUri = oidcConfig.redirect_uri;
      if (!redirectUri) {
        return { enabled: false };
      }

      const { url, state } = await generateAuthorizationUrl(redirectUri, oidcConfig.scopes);
      return { enabled: true, authUrl: url, state };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to generate OIDC authorization URL');
      return reply.code(500).send({ error: 'Failed to initialize OIDC' });
    }
  });

  // OIDC callback (public — no auth required)
  fastify.post('/api/auth/oidc/callback', {
    schema: {
      tags: ['Auth'],
      summary: 'Exchange OIDC authorization code for a session token',
      body: {
        type: 'object',
        required: ['callbackUrl', 'state'],
        properties: {
          callbackUrl: { type: 'string' },
          state: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            username: { type: 'string' },
            expiresAt: { type: 'string' },
          },
        },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        500: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const parsed = callbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid callback parameters' });
    }

    const { callbackUrl, state } = parsed.data;

    try {
      const claims = await exchangeCode(callbackUrl, state);
      const username = claims.email || claims.name || claims.sub;

      const session = createSession(claims.sub, username);
      const token = await signJwt({
        sub: claims.sub,
        username,
        sessionId: session.id,
      });

      writeAuditLog({
        user_id: claims.sub,
        username,
        action: 'oidc_login',
        details: { email: claims.email, name: claims.name },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return {
        token,
        username,
        expiresAt: session.expires_at,
      };
    } catch (err) {
      fastify.log.error({ err }, 'OIDC callback failed');
      const message = err instanceof Error ? err.message : 'OIDC authentication failed';
      return reply.code(400).send({ error: message });
    }
  });

  // OIDC logout (protected)
  fastify.post('/api/auth/oidc/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Logout OIDC session',
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    if (request.user) {
      invalidateSession(request.user.sessionId);
      writeAuditLog({
        user_id: request.user.sub,
        username: request.user.username,
        action: 'oidc_logout',
        request_id: request.requestId,
        ip_address: request.ip,
      });
    }
    return { success: true };
  });
}
