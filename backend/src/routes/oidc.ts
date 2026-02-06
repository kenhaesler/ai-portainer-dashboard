import { FastifyInstance } from 'fastify';
import { isOIDCEnabled, getOIDCConfig, generateAuthorizationUrl, exchangeCode } from '../services/oidc.js';
import { createSession, invalidateSession } from '../services/session-store.js';
import { signJwt } from '../utils/crypto.js';
import { writeAuditLog } from '../services/audit-logger.js';
import { OidcStatusResponseSchema, OidcCallbackBodySchema, LoginResponseSchema, ErrorResponseSchema, SuccessResponseSchema } from '../models/api-schemas.js';

export async function oidcRoutes(fastify: FastifyInstance) {
  // Get OIDC status (public — no auth required)
  fastify.get('/api/auth/oidc/status', {
    schema: {
      tags: ['Auth'],
      summary: 'Get OIDC SSO status and authorization URL',
      response: {
        200: OidcStatusResponseSchema,
        500: ErrorResponseSchema,
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
      body: OidcCallbackBodySchema,
      response: {
        200: LoginResponseSchema,
        400: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const parsed = OidcCallbackBodySchema.safeParse(request.body);
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
      response: { 200: SuccessResponseSchema },
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
