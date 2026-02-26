import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import rateLimitPlugin from '@dashboard/core/plugins/rate-limit.js';
import { authRoutes } from './auth.js';

const mockSignJwt = vi.fn();
const mockCreateSession = vi.fn();
const mockAuthenticateUser = vi.fn();
const mockEnsureDefaultAdmin = vi.fn();

// Kept: crypto mock — file I/O and bcrypt dependency
vi.mock('@dashboard/core/utils/crypto.js', () => ({
  signJwt: (...args: unknown[]) => mockSignJwt(...args),
}));

// Kept: session-store mock — no PostgreSQL in CI
vi.mock('@dashboard/core/services/session-store.js', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  getSession: vi.fn(),
  invalidateSession: vi.fn(),
  refreshSession: vi.fn(),
}));

// Kept: audit-logger mock — side-effect isolation
vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

// Kept: user-store mock — no PostgreSQL in CI
vi.mock('@dashboard/core/services/user-store.js', () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
  ensureDefaultAdmin: (...args: unknown[]) => mockEnsureDefaultAdmin(...args),
  getUserDefaultLandingPage: vi.fn().mockReturnValue('/'),
}));

describe('auth login rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConfigForTest({ API_RATE_LIMIT: 1000, LOGIN_RATE_LIMIT: 2 });
    mockEnsureDefaultAdmin.mockResolvedValue(undefined);
    mockAuthenticateUser.mockResolvedValue({
      id: 'user-1',
      username: 'admin',
      role: 'admin',
    });
    mockCreateSession.mockReturnValue({
      id: 'session-1',
      expires_at: '2099-01-01T00:00:00.000Z',
    });
    mockSignJwt.mockResolvedValue('token-123');
  });

  it('uses LOGIN_RATE_LIMIT for /api/auth/login', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);

    await app.register(rateLimitPlugin);
    await app.register(authRoutes);
    await app.ready();

    const body = { username: 'admin', password: 'password' };
    const responses = [];
    for (let i = 0; i < 3; i += 1) {
      responses.push(await app.inject({ method: 'POST', url: '/api/auth/login', payload: body }));
    }

    expect(responses[0]?.statusCode).toBe(200);
    expect(responses[1]?.statusCode).toBe(200);
    expect(responses[2]?.statusCode).toBe(429);

    await app.close();
  });

  afterEach(() => {
    resetConfig();
  });
});
