import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

// Stub external/DB-touching boundaries so the route test stays in-process.
vi.mock('openid-client', () => ({}));
vi.mock('@dashboard/core/services/oidc.js', async (importOriginal) => {
  const real = await importOriginal() as typeof import('@dashboard/core/services/oidc.js');
  return {
    ...real,
    getOIDCConfig: vi.fn(),
    generateAuthorizationUrl: vi.fn(),
    exchangeCode: vi.fn(),
  };
});
// All user/session/audit boundaries stubbed so the callback test is hermetic.
vi.mock('@dashboard/core/services/user-store.js', () => ({
  upsertOIDCUser: vi.fn().mockResolvedValue({ roleChanged: false }),
  getUserById: vi.fn().mockResolvedValue(null),
  getUserDefaultLandingPage: vi.fn().mockResolvedValue('/dashboard'),
}));
vi.mock('@dashboard/core/services/session-store.js', () => ({
  createSession: vi.fn().mockResolvedValue({ id: 'sess-1', expires_at: '2099-01-01T00:00:00Z' }),
  invalidateSession: vi.fn(),
  invalidateAllUserSessions: vi.fn().mockResolvedValue(0),
}));
vi.mock('@dashboard/core/services/audit-logger.js', () => ({ writeAuditLog: vi.fn() }));
vi.mock('@dashboard/core/utils/crypto.js', () => ({ signJwt: vi.fn().mockResolvedValue('signed.jwt.token') }));
vi.mock('@dashboard/core/services/oidc-group-tracking.js', () => ({
  syncUserGroups: vi.fn().mockResolvedValue(undefined),
  listDiscoveredGroups: vi.fn().mockResolvedValue([]),
}));

import * as oidcService from '@dashboard/core/services/oidc.js';
import * as groupTracking from '@dashboard/core/services/oidc-group-tracking.js';
import * as sessionStore from '@dashboard/core/services/session-store.js';
import * as auditLogger from '@dashboard/core/services/audit-logger.js';
import * as userStore from '@dashboard/core/services/user-store.js';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import { oidcRoutes } from '../routes/oidc.js';

const mockedGetConfig = vi.mocked(oidcService.getOIDCConfig);
const mockedGenerateAuthUrl = vi.mocked(oidcService.generateAuthorizationUrl);
const mockedExchangeCode = vi.mocked(oidcService.exchangeCode);
const mockedSyncUserGroups = vi.mocked(groupTracking.syncUserGroups);
const mockedCreateSession = vi.mocked(sessionStore.createSession);
const mockedInvalidateAll = vi.mocked(sessionStore.invalidateAllUserSessions);
const mockedWriteAuditLog = vi.mocked(auditLogger.writeAuditLog);
const mockedGetUserById = vi.mocked(userStore.getUserById);

const baseOidcConfig = {
  enabled: true,
  issuer_url: 'https://idp.example.com',
  client_id: 'client',
  client_secret: 'secret',
  redirect_uri: '',
  scopes: 'openid profile email',
  local_auth_enabled: true,
  groups_claim: 'groups',
  group_role_mappings: {},
  auto_provision: true,
  // Permissive by default in this fixture so the pre-existing callback tests
  // (which rely on the viewer fallback) stay green. Restrictive-mode tests
  // override this to false explicitly.
  allow_unmapped_viewer: true,
  allow_insecure_transport: false,
};

describe('OIDC Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(oidcRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockedGetConfig.mockReset();
    mockedGenerateAuthUrl.mockReset();
    mockedSyncUserGroups.mockReset();
    mockedSyncUserGroups.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetConfig();
  });

  describe('GET /api/auth/oidc/effective-redirect-uri', () => {
    it('returns env-derived URI when DASHBOARD_EXTERNAL_URL is set', async () => {
      setConfigForTest({ DASHBOARD_EXTERNAL_URL: 'https://dashboard.example.com' });
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, redirect_uri: 'https://stale.example.com/auth/callback' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/oidc/effective-redirect-uri',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        redirectUri: 'https://dashboard.example.com/auth/callback',
        source: 'env',
      });
    });

    it('falls back to the manual setting when env is unset', async () => {
      setConfigForTest({ DASHBOARD_EXTERNAL_URL: undefined });
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, redirect_uri: 'https://manual.example.com/auth/callback' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/oidc/effective-redirect-uri',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        redirectUri: 'https://manual.example.com/auth/callback',
        source: 'setting',
      });
    });

    it('reports source "none" when neither is configured', async () => {
      setConfigForTest({ DASHBOARD_EXTERNAL_URL: undefined });
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, redirect_uri: '' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/oidc/effective-redirect-uri',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ redirectUri: '', source: 'none' });
    });
  });

  describe('GET /api/auth/oidc/status', () => {
    it('passes the env-derived URI to generateAuthorizationUrl', async () => {
      setConfigForTest({ DASHBOARD_EXTERNAL_URL: 'https://dashboard.example.com' });
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, redirect_uri: 'http://localhost:5173/auth/callback' });
      mockedGenerateAuthUrl.mockResolvedValue({ url: 'https://idp.example.com/authz?state=xyz', state: 'xyz' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/oidc/status',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        enabled: true,
        authUrl: 'https://idp.example.com/authz?state=xyz',
        state: 'xyz',
      });
      expect(mockedGenerateAuthUrl).toHaveBeenCalledWith(
        'https://dashboard.example.com/auth/callback',
        'openid profile email',
      );
    });

    it('uses the manual setting when env is unset', async () => {
      setConfigForTest({ DASHBOARD_EXTERNAL_URL: undefined });
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, redirect_uri: 'https://manual.example.com/auth/callback' });
      mockedGenerateAuthUrl.mockResolvedValue({ url: 'https://idp.example.com/authz', state: 's' });

      const response = await app.inject({ method: 'GET', url: '/api/auth/oidc/status' });

      expect(response.statusCode).toBe(200);
      expect(mockedGenerateAuthUrl).toHaveBeenCalledWith(
        'https://manual.example.com/auth/callback',
        'openid profile email',
      );
    });

    it('reports disabled when redirect URI cannot be resolved', async () => {
      setConfigForTest({ DASHBOARD_EXTERNAL_URL: undefined });
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, redirect_uri: '' });

      const response = await app.inject({ method: 'GET', url: '/api/auth/oidc/status' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ enabled: false });
      expect(mockedGenerateAuthUrl).not.toHaveBeenCalled();
    });

    it('reports disabled when enabled flag is off, even with a resolvable URI', async () => {
      setConfigForTest({ DASHBOARD_EXTERNAL_URL: 'https://dashboard.example.com' });
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, enabled: false });

      const response = await app.inject({ method: 'GET', url: '/api/auth/oidc/status' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ enabled: false });
      expect(mockedGenerateAuthUrl).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/oidc/callback', () => {
    it('returns a LoginResponse including defaultLandingPage (regression for serialization)', async () => {
      setConfigForTest({ DASHBOARD_EXTERNAL_URL: undefined });
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, redirect_uri: 'https://x/auth/callback' });
      mockedExchangeCode.mockResolvedValue({
        sub: 'kc-admin-sub',
        email: 'kc-admin@example.com',
        name: 'kc-admin',
        groups: ['Dashboard-Admins'],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/auth/callback?code=abc&state=xyz', state: 'xyz' },
        headers: { 'content-type': 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toEqual({
        token: 'signed.jwt.token',
        username: 'kc-admin@example.com',
        expiresAt: '2099-01-01T00:00:00Z',
        defaultLandingPage: '/dashboard',
      });
    });
  });

  describe('POST /api/auth/oidc/callback group tracking', () => {
    it('calls syncUserGroups with sub + raw groups from the ID token', async () => {
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig, group_role_mappings: { Admins: 'admin' } });
      mockedExchangeCode.mockResolvedValue({
        sub: 'user-42',
        email: 'a@b.com',
        name: 'A B',
        groups: ['Admins', 'Devs'],
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedSyncUserGroups).toHaveBeenCalledTimes(1);
      expect(mockedSyncUserGroups).toHaveBeenCalledWith('user-42', ['Admins', 'Devs']);
    });

    it('does NOT fail the login when syncUserGroups rejects', async () => {
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig });
      mockedExchangeCode.mockResolvedValue({
        sub: 'user-43', email: 'x@y.com', name: 'X', groups: ['Admins'],
      } as any);
      mockedSyncUserGroups.mockRejectedValueOnce(new Error('db down'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('calls syncUserGroups with empty array when no groups claim is present', async () => {
      mockedGetConfig.mockResolvedValue({ ...baseOidcConfig });
      mockedExchangeCode.mockResolvedValue({
        sub: 'user-44', email: 'e@f.com', name: 'E', groups: [],
      } as any);

      await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
      });

      expect(mockedSyncUserGroups).toHaveBeenCalledWith('user-44', []);
    });
  });

  describe('POST /api/auth/oidc/callback restrict-to-mapped-groups', () => {
    beforeEach(() => {
      mockedCreateSession.mockClear();
      mockedInvalidateAll.mockClear();
      mockedWriteAuditLog.mockClear();
      mockedGetUserById.mockReset();
      mockedGetUserById.mockResolvedValue(null);
    });

    it('denies login with 403 and no session when restrictive and no group matches', async () => {
      mockedGetConfig.mockResolvedValue({
        ...baseOidcConfig,
        allow_unmapped_viewer: false,
        group_role_mappings: { Admins: 'admin' },
      });
      mockedExchangeCode.mockResolvedValue({
        sub: 'new-user', email: 'n@e.com', name: 'N', groups: ['Contractors'],
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatch(/not in a group authorized/i);
      expect(mockedCreateSession).not.toHaveBeenCalled();
      expect(mockedWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'oidc_login_denied' }),
      );
    });

    it('allows login when restrictive and a group maps to a role', async () => {
      mockedGetConfig.mockResolvedValue({
        ...baseOidcConfig,
        allow_unmapped_viewer: false,
        group_role_mappings: { Admins: 'admin' },
      });
      mockedExchangeCode.mockResolvedValue({
        sub: 'mapped-user', email: 'm@e.com', name: 'M', groups: ['Admins'],
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    });

    it('allows login when restrictive and a "*" wildcard mapping exists', async () => {
      mockedGetConfig.mockResolvedValue({
        ...baseOidcConfig,
        allow_unmapped_viewer: false,
        group_role_mappings: { '*': 'viewer' },
      });
      mockedExchangeCode.mockResolvedValue({
        sub: 'wild-user', email: 'w@e.com', name: 'W', groups: ['Anything'],
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    });

    it('admits a user with NO groups when a "*" wildcard mapping exists (no lockout)', async () => {
      mockedGetConfig.mockResolvedValue({
        ...baseOidcConfig,
        allow_unmapped_viewer: false,
        group_role_mappings: { '*': 'viewer' },
      });
      // IdP sends an empty/absent groups claim — the wildcard must still admit them.
      mockedExchangeCode.mockResolvedValue({
        sub: 'no-groups-user', email: 'ng@e.com', name: 'NG', groups: [],
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    });

    it('denies an EXISTING user whose groups no longer match (enforce for everyone)', async () => {
      mockedGetConfig.mockResolvedValue({
        ...baseOidcConfig,
        allow_unmapped_viewer: false,
        group_role_mappings: { Admins: 'admin' },
      });
      // User already exists with an operator role from a prior login.
      mockedGetUserById.mockResolvedValue({ id: 'existing', role: 'operator' } as any);
      mockedExchangeCode.mockResolvedValue({
        sub: 'existing', email: 'ex@e.com', name: 'Ex', groups: ['Contractors'],
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
      });

      expect(response.statusCode).toBe(403);
      expect(mockedCreateSession).not.toHaveBeenCalled();
      // Lingering sessions for the now-unmatched user are revoked.
      expect(mockedInvalidateAll).toHaveBeenCalledWith('existing');
    });

    it('still grants viewer to unmatched users when permissive (switch on)', async () => {
      mockedGetConfig.mockResolvedValue({
        ...baseOidcConfig,
        allow_unmapped_viewer: true,
        group_role_mappings: { Admins: 'admin' },
      });
      mockedExchangeCode.mockResolvedValue({
        sub: 'perm-user', email: 'p@e.com', name: 'P', groups: ['Contractors'],
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { callbackUrl: 'https://x/callback?code=c&state=s', state: 's' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/auth/oidc/discovered-groups', () => {
    it('returns aggregated groups from listDiscoveredGroups', async () => {
      vi.mocked(groupTracking.listDiscoveredGroups).mockResolvedValueOnce([
        { group_name: 'Admins', user_count: 3, last_seen_at: '2026-05-20T10:00:00.000Z' },
        { group_name: 'Devs',   user_count: 1, last_seen_at: '2026-05-19T09:00:00.000Z' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/oidc/discovered-groups',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        groups: [
          { group_name: 'Admins', user_count: 3, last_seen_at: '2026-05-20T10:00:00.000Z' },
          { group_name: 'Devs',   user_count: 1, last_seen_at: '2026-05-19T09:00:00.000Z' },
        ],
      });
    });

    it('returns an empty array when no groups have been observed', async () => {
      vi.mocked(groupTracking.listDiscoveredGroups).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/oidc/discovered-groups',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ groups: [] });
    });
  });
});
