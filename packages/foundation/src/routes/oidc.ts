import { FastifyInstance } from 'fastify';
import { getOIDCConfig, generateAuthorizationUrl, exchangeCode, resolveRoleFromGroups, getEffectiveRedirectUri, isOIDCConfigEnabled } from '@dashboard/core/services/oidc.js';
import { syncUserGroups, listDiscoveredGroups } from '@dashboard/core/services/oidc-group-tracking.js';
import { createSession, invalidateSession, invalidateAllUserSessions } from '@dashboard/core/services/session-store.js';
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
        403: ErrorResponseSchema,
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
      // Fire-and-forget: tracking is a UX affordance, not a security control,
      // so we don't block login latency on the DB write.
      void syncUserGroups(claims.sub, claims.groups ?? []).catch((err) => {
        log.warn({ err, sub: claims.sub }, 'Failed to sync OIDC user groups — login continuing');
      });
      const username = claims.email || claims.name || claims.sub;
      const oidcConfig = await getOIDCConfig();

      // Resolve role from group mappings (highest-privilege-wins)
      const resolvedRole = resolveRoleFromGroups(
        claims.groups || [],
        oidcConfig.group_role_mappings,
      );

      // Restrictive mode: when the implicit viewer fallback is disabled, an OIDC
      // login that resolves to no mapped role (and no '*' wildcard) is denied
      // outright. Applies to new AND existing users — the role derives only from
      // current group membership, so IDP group removal revokes access at next
      // login. Local auth is unaffected (this path only runs for OIDC).
      if (!resolvedRole && !oidcConfig.allow_unmapped_viewer) {
        // Revoke any lingering session so a prior login cannot outlive the
        // access revocation. Best-effort — a failure here must not turn the
        // denial into a 400/500; we still deny.
        try {
          await invalidateAllUserSessions(claims.sub);
        } catch (revokeErr) {
          log.warn(
            { err: (revokeErr as Error).message, sub: claims.sub },
            'Failed to revoke existing sessions for denied OIDC user',
          );
        }
        writeAuditLog({
          user_id: claims.sub,
          username,
          action: 'oidc_login_denied',
          target_type: 'user',
          target_id: claims.sub,
          details: { reason: 'no_matching_group', groups: claims.groups },
          request_id: request.requestId,
          ip_address: request.ip,
        });
        log.warn(
          { sub: claims.sub, groups: claims.groups },
          'OIDC login denied: no matching group mapping (restrictive mode)',
        );
        return reply.code(403).send({
          error: 'Access denied: your account is not in a group authorized for this dashboard.',
        });
      }

      // Check if user already exists to get their current role
      const existingUser = await getUserById(claims.sub);
      const effectiveRole = resolvedRole || existingUser?.role || 'viewer';

      // Auto-provision or update user if enabled
      if (oidcConfig.auto_provision) {
        const { roleChanged, previousRole } = await upsertOIDCUser(claims.sub, username, effectiveRole);

        if (roleChanged) {
          // SECURITY: a role change (incl. downgrade) must revoke prior sessions.
          // The role is frozen into the previously-issued JWT and never re-read
          // from the DB, so without this a user demoted from admin keeps admin
          // authority on their old token until it expires. Revoke BEFORE
          // createSession() below so only the freshly-issued correct-role token
          // survives. Mirrors the revoke-on-deny path above; best-effort.
          try {
            await invalidateAllUserSessions(claims.sub);
          } catch (revokeErr) {
            log.warn(
              { err: (revokeErr as Error).message, sub: claims.sub },
              'Failed to revoke prior sessions on OIDC role change — continuing',
            );
          }
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
      // A username (email/name claim) collision against the UNIQUE users.username
      // column surfaces as a Postgres 23505. Return a static, generic message —
      // never reflect the raw DB error (which leaks the index name + colliding
      // value) to the unauthenticated callback caller.
      if ((err as { code?: string }).code === '23505'
        || (err instanceof Error && err.message.includes('UNIQUE constraint'))) {
        // Cast: this route declares a typed response schema that does not list
        // 409 (same pattern used elsewhere for off-schema error codes).
        return (reply as { code: (n: number) => typeof reply }).code(409)
          .send({ error: 'This account could not be provisioned (username already in use).' });
      }
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
