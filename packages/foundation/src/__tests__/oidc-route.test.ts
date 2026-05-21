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
  };
});

import * as oidcService from '@dashboard/core/services/oidc.js';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import { oidcRoutes } from '../routes/oidc.js';

const mockedGetConfig = vi.mocked(oidcService.getOIDCConfig);
const mockedGenerateAuthUrl = vi.mocked(oidcService.generateAuthorizationUrl);

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
});
