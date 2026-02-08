import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import rateLimitPlugin from '../plugins/rate-limit.js';
import { authRoutes } from './auth.js';

const mockGetConfig = vi.fn();
const mockSignJwt = vi.fn();
const mockCreateSession = vi.fn();
const mockAuthenticateUser = vi.fn();
const mockEnsureDefaultAdmin = vi.fn();

vi.mock('../config/index.js', () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock('../utils/crypto.js', () => ({
  signJwt: (...args: unknown[]) => mockSignJwt(...args),
}));

vi.mock('../services/session-store.js', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  getSession: vi.fn(),
  invalidateSession: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('../services/user-store.js', () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
  ensureDefaultAdmin: (...args: unknown[]) => mockEnsureDefaultAdmin(...args),
  getUserDefaultLandingPage: vi.fn().mockReturnValue('/'),
}));

describe('auth login rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetConfig.mockReturnValue({
      API_RATE_LIMIT: 1000,
      LOGIN_RATE_LIMIT: 2,
    });
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
});
