import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import authPlugin from './auth.js';

const mockVerifyJwt = vi.fn();
const mockGetSession = vi.fn();

// Kept: crypto mock — file I/O and bcrypt dependency
vi.mock('../utils/crypto.js', () => ({
  verifyJwt: (...args: unknown[]) => mockVerifyJwt(...args),
}));

// Kept: session-store mock — no PostgreSQL in CI
vi.mock('../services/session-store.js', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

describe('auth plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing authorization header', async () => {
    const app = Fastify();
    await app.register(authPlugin);
    app.get('/protected', { preHandler: [app.authenticate] }, async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Missing or invalid authorization header');

    await app.close();
  });

  it('rejects token for revoked session', async () => {
    mockVerifyJwt.mockResolvedValue({
      sub: 'user-1',
      username: 'alice',
      sessionId: 'session-1',
      role: 'admin',
    });
    mockGetSession.mockReturnValue(undefined);

    const app = Fastify();
    await app.register(authPlugin);
    app.get('/protected', { preHandler: [app.authenticate] }, async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid, expired, or revoked token');

    await app.close();
  });

  it('rejects token when session identity does not match JWT', async () => {
    mockVerifyJwt.mockResolvedValue({
      sub: 'user-1',
      username: 'alice',
      sessionId: 'session-1',
      role: 'admin',
    });
    mockGetSession.mockReturnValue({
      id: 'session-1',
      user_id: 'user-2',
      username: 'bob',
      created_at: '2026-02-07T10:00:00.000Z',
      expires_at: '2026-02-07T11:00:00.000Z',
      last_active: '2026-02-07T10:30:00.000Z',
      is_valid: 1,
    });

    const app = Fastify();
    await app.register(authPlugin);
    app.get('/protected', { preHandler: [app.authenticate] }, async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it('accepts token with valid active session', async () => {
    mockVerifyJwt.mockResolvedValue({
      sub: 'user-1',
      username: 'alice',
      sessionId: 'session-1',
      role: 'admin',
    });
    mockGetSession.mockReturnValue({
      id: 'session-1',
      user_id: 'user-1',
      username: 'alice',
      created_at: '2026-02-07T10:00:00.000Z',
      expires_at: '2026-02-07T11:00:00.000Z',
      last_active: '2026-02-07T10:30:00.000Z',
      is_valid: 1,
    });

    const app = Fastify();
    await app.register(authPlugin);
    app.get('/protected', { preHandler: [app.authenticate] }, async (request) => ({ user: request.user }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.sub).toBe('user-1');
    expect(res.json().user.sessionId).toBe('session-1');

    await app.close();
  });
});
