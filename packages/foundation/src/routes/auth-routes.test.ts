import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import { verifyJwt } from '@dashboard/core/utils/crypto.js';

/**
 * Functional coverage for POST /api/auth/logout and /api/auth/refresh (#1519).
 * Both are load-bearing for the session-revocation security model and had zero
 * behavioural tests — only the generic "reject without a token" sweep. Crypto is
 * real so we can decode the re-signed token and prove refresh preserves the
 * frozen role claim; the session store / audit / user store are mocked (no DB).
 */

const mockCreateSession = vi.fn();
const mockGetSession = vi.fn();
const mockInvalidateSession = vi.fn();
const mockRefreshSession = vi.fn();
vi.mock('@dashboard/core/services/session-store.js', () => ({
  createSession: (...a: unknown[]) => mockCreateSession(...a),
  getSession: (...a: unknown[]) => mockGetSession(...a),
  invalidateSession: (...a: unknown[]) => mockInvalidateSession(...a),
  refreshSession: (...a: unknown[]) => mockRefreshSession(...a),
}));

vi.mock('@dashboard/core/services/stream-tickets.js', () => ({
  createStreamTicket: vi.fn(),
}));

const mockWriteAuditLog = vi.fn();
vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: (...a: unknown[]) => mockWriteAuditLog(...a),
}));

vi.mock('@dashboard/core/services/user-store.js', () => ({
  authenticateUser: vi.fn(),
  ensureDefaultAdmin: vi.fn(async () => undefined),
  getUserDefaultLandingPage: vi.fn(async () => '/'),
}));

import { authRoutes } from './auth.js';

const USER = { sub: 'u1', username: 'admin', sessionId: 's1', role: 'admin' };

describe('auth routes — logout + refresh (#1519)', () => {
  let app: FastifyInstance;
  let currentUser: typeof USER | null;

  beforeAll(async () => {
    // Deterministic secret so the real signJwt/verifyJwt round-trip is stable.
    setConfigForTest({ JWT_SECRET: 'test-secret-abcdefghijklmnopqrstuvwxyz-0123456789' });
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // Stand-in for the real auth plugin: attach the caller identity a valid
    // Bearer token would have produced.
    app.decorate('authenticate', async (request: FastifyRequest) => {
      if (currentUser) (request as { user?: typeof USER }).user = currentUser;
    });
    app.decorateRequest('user', undefined);
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    resetConfig();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { ...USER };
    mockInvalidateSession.mockResolvedValue(undefined);
  });

  describe('POST /api/auth/logout', () => {
    it('invalidates the caller session and writes a logout audit entry', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockInvalidateSession).toHaveBeenCalledWith('s1');
      expect(mockWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'logout' }));
    });

    it('revokes the session: a following GET /api/auth/session returns 401', async () => {
      mockInvalidateSession.mockImplementation(async () => {
        mockGetSession.mockReturnValue(null);
      });

      const logout = await app.inject({ method: 'POST', url: '/api/auth/logout' });
      expect(logout.statusCode).toBe(200);

      const session = await app.inject({ method: 'GET', url: '/api/auth/session' });
      expect(session.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('re-signs a token preserving sub/username/role and returns the extended expiry', async () => {
      mockRefreshSession.mockResolvedValue({ id: 's1', expires_at: '2999-01-01T00:00:00.000Z' });

      const res = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { token: string; expiresAt: string };
      expect(body.expiresAt).toBe('2999-01-01T00:00:00.000Z');

      const decoded = await verifyJwt(body.token);
      expect(decoded).toMatchObject({
        sub: 'u1',
        username: 'admin',
        role: 'admin',
        sessionId: 's1',
      });
    });

    it('returns 401 (does not issue a token) when refreshSession yields null', async () => {
      mockRefreshSession.mockResolvedValue(null);

      const res = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).not.toHaveProperty('token');
    });
  });
});
