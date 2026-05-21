import { FastifyInstance } from 'fastify';
import { getOIDCConfig, generateAuthorizationUrl, exchangeCode, resolveRoleFromGroups, getEffectiveRedirectUri, isOIDCConfigEnabled } from '@dashboard/core/services/oidc.js';
import { syncUserGroups, listDiscoveredGroups } from '@dashboard/core/services/oidc-group-tracking.js';
import { createSession, invalidateSession } from '@dashboard/core/services/session-store.js';
import { signJwt } from '@dashboard/core/utils/crypto.js';
import { writeAuditLog } from '@dashboard/core/services/audit-logger.js';
import { upsertOIDCUser, getUserById, getUserDefaultLandingPage } from '@dashboard/core/services/user-store.js';
import {
  OidcStatusResponseSchema,
  OidcCallbackBodySchema,
  OidcEffectiveRedirectUriResponseSchema,
  DiscoveredOidcGroupsResponseSchema,
  LoginResponseSchema,
  ErrorResponseSchema,
  SuccessResponseSchema,
} from '@dashboard/core/models/api-schemas.js';
import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('oidc-routes');

export async function oidcRoutes(fastify: FastifyInstance) {
  const config = getConfig();

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
    try {
      const oidcConfig = await getOIDCConfig();
      const { redirectUri } = getEffectiveRedirectUri(oidcConfig.redirect_uri);
      if (!isOIDCConfigEnabled(oidcConfig, redirectUri)) {
        return { enabled: false };
      }

      const { url, state } = await generateAuthorizationUrl(redirectUri, oidcConfig.scopes);
      return { enabled: true, authUrl: url, state };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to generate OIDC authorization URL');
      return reply.code(500).send({ error: 'Failed to initialize OIDC' });
    }
  });

  // Effective redirect URI (admin-only) — surfaces the value the backend will
  // actually use, so the Settings UI can show the env-derived URI as a hint
  // even when no manual value is stored.
  fastify.get('/api/auth/oidc/effective-redirect-uri', {
    schema: {
      tags: ['Auth'],
      summary: 'Get the effective OIDC redirect URI (env or manual setting)',
      security: [{ bearerAuth: [] }],
      response: {
        200: OidcEffectiveRedirectUriResponseSchema,
      },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => {
    const oidcConfig = await getOIDCConfig();
    return getEffectiveRedirectUri(oidcConfig.redirect_uri);
  });

  // Discovered OIDC groups (admin-only) — backs the searchable dropdown in the
  // Settings → Security group-to-role mapping editor. Aggregates the
  // oidc_user_groups table observed across all past OIDC logins.
  fastify.get('/api/auth/oidc/discovered-groups', {
    schema: {
      tags: ['Auth'],
      summary: 'List OIDC groups observed via past logins (admin-only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: DiscoveredOidcGroupsResponseSchema,
      },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => {
    const groups = await listDiscoveredGroups();
    return { groups };
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
        max: config.LOGIN_RATE_LIMIT,
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
      try {
        await syncUserGroups(claims.sub, claims.groups ?? []);
      } catch (err) {
        log.warn({ err, sub: claims.sub }, 'Failed to sync OIDC user groups — login continuing');
      }
      const username = claims.email || claims.name || claims.sub;
      const oidcConfig = await getOIDCConfig();

      // Resolve role from group mappings (highest-privilege-wins)
      const resolvedRole = resolveRoleFromGroups(
        claims.groups || [],
        oidcConfig.group_role_mappings,
      );

      // Check if user already exists to get their current role
      const existingUser = await getUserById(claims.sub);
      const effectiveRole = resolvedRole || existingUser?.role || 'viewer';

      // Auto-provision or update user if enabled
      if (oidcConfig.auto_provision) {
        const { roleChanged, previousRole } = await upsertOIDCUser(claims.sub, username, effectiveRole);

        if (roleChanged) {
          writeAuditLog({
            user_id: claims.sub,
            username,
            action: 'oidc_role_changed',
            target_type: 'user',
            target_id: claims.sub,
            details: {
              previous_role: previousRole,
              new_role: effectiveRole,
              groups: claims.groups,
              source: 'group_mapping',
            },
            request_id: request.requestId,
            ip_address: request.ip,
          });
          log.info({ sub: claims.sub, previousRole, newRole: effectiveRole }, 'OIDC user role changed via group mapping');
        }
      }

      const session = await createSession(claims.sub, username);
      const token = await signJwt({
        sub: claims.sub,
        username,
        sessionId: session.id,
        role: effectiveRole,
      });

      writeAuditLog({
        user_id: claims.sub,
        username,
        action: 'oidc_login',
        details: {
          email: claims.email,
          name: claims.name,
          groups: claims.groups,
          resolved_role: effectiveRole,
        },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return {
        token,
        username,
        expiresAt: session.expires_at,
        defaultLandingPage: await getUserDefaultLandingPage(claims.sub),
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
      await invalidateSession(request.user.sessionId);
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
