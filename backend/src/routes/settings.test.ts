import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { settingsRoutes } from './settings.js';

const mockGetUserDefaultLandingPage = vi.fn();
const mockSetUserDefaultLandingPage = vi.fn();

vi.mock('../services/user-store.js', () => ({
  getUserDefaultLandingPage: (...args: unknown[]) => mockGetUserDefaultLandingPage(...args),
  setUserDefaultLandingPage: (...args: unknown[]) => mockSetUserDefaultLandingPage(...args),
}));

vi.mock('../db/sqlite.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(undefined),
      run: vi.fn().mockReturnValue({ changes: 1 }),
    }),
  }),
}));

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

describe('settings preference routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' as const };
    });
    await app.register(settingsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDefaultLandingPage.mockReturnValue('/');
    mockSetUserDefaultLandingPage.mockReturnValue(true);
  });

  it('gets current user landing page preference', async () => {
    mockGetUserDefaultLandingPage.mockReturnValue('/ai-monitor');

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/preferences',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ defaultLandingPage: '/ai-monitor' });
    expect(mockGetUserDefaultLandingPage).toHaveBeenCalledWith('u1');
  });

  it('updates landing page preference for valid route', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: { authorization: 'Bearer test' },
      payload: { defaultLandingPage: '/workloads' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ defaultLandingPage: '/workloads' });
    expect(mockSetUserDefaultLandingPage).toHaveBeenCalledWith('u1', '/workloads');
  });

  it('rejects invalid landing page route', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: { authorization: 'Bearer test' },
      payload: { defaultLandingPage: '/not-a-real-route' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockSetUserDefaultLandingPage).not.toHaveBeenCalled();
  });
});
