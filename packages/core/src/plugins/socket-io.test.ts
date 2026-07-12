import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const mockVerifyJwt = vi.fn().mockResolvedValue({ sub: 'u1', username: 'test', sessionId: 's1' });
const mockGetSession = vi.fn().mockReturnValue({
  id: 's1',
  user_id: 'u1',
  username: 'test',
  created_at: '2026-02-07T10:00:00.000Z',
  expires_at: '2026-02-07T11:00:00.000Z',
  last_active: '2026-02-07T10:30:00.000Z',
  is_valid: 1,
});

// Kept: crypto mock — file I/O and bcrypt dependency
vi.mock('../utils/crypto.js', () => ({
  verifyJwt: (...args: unknown[]) => mockVerifyJwt(...args),
}));

// Kept: session-store mock — no PostgreSQL in CI
vi.mock('../services/session-store.js', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

// user-store is pulled in by the live-revalidation logic; mock so the plugin
// loads without a real DB. Controllable so the revalidation loop test (#1520)
// can simulate an admin who lost their role.
const mockGetUserById = vi.fn();
vi.mock('../services/user-store.js', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

import socketIoPlugin from './socket-io.js';
import {
  authenticateSocketToken,
  verifyTransportRequest,
  socketRevalidationVerdict,
  SOCKET_REVALIDATE_INTERVAL_MS,
} from './socket-io.js';
import { IncomingMessage } from 'http';

describe('socket-io plugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockVerifyJwt.mockResolvedValue({ sub: 'u1', username: 'test', sessionId: 's1' });
    mockGetSession.mockReturnValue({
      id: 's1',
      user_id: 'u1',
      username: 'test',
      created_at: '2026-02-07T10:00:00.000Z',
      expires_at: '2026-02-07T11:00:00.000Z',
      last_active: '2026-02-07T10:30:00.000Z',
      is_valid: 1,
    });
    app = Fastify();
    await app.register(socketIoPlugin);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should decorate fastify with io instance', () => {
    expect(app.io).toBeDefined();
  });

  it('should create all three namespaces', () => {
    expect(app.ioNamespaces.llm).toBeDefined();
    expect(app.ioNamespaces.monitoring).toBeDefined();
    expect(app.ioNamespaces.remediation).toBeDefined();
  });

  it('should enable perMessageDeflate compression', () => {
    const opts = (app.io as unknown as { opts: Record<string, unknown> }).opts;
    expect(opts.perMessageDeflate).toBeTruthy();
  });

  it('should enable connectionStateRecovery', () => {
    const opts = (app.io as unknown as { opts: Record<string, unknown> }).opts;
    expect(opts.connectionStateRecovery).toBeTruthy();
  });

  it('should set correct transport order', () => {
    const opts = (app.io as unknown as { opts: Record<string, unknown> }).opts;
    expect(opts.transports).toEqual(['websocket', 'polling']);
  });

  it('authenticateSocketToken rejects missing token', async () => {
    expect(await authenticateSocketToken(undefined)).toBeNull();
  });

  it('authenticateSocketToken rejects revoked sessions', async () => {
    mockGetSession.mockReturnValue(undefined);
    expect(await authenticateSocketToken('token')).toBeNull();
  });

  it('authenticateSocketToken rejects mismatched identity', async () => {
    mockVerifyJwt.mockResolvedValue({ sub: 'u2', username: 'other', sessionId: 's1' });
    expect(await authenticateSocketToken('token')).toBeNull();
  });

  it('authenticateSocketToken returns user for active valid session', async () => {
    const user = await authenticateSocketToken('token');
    expect(user).toEqual({ sub: 'u1', username: 'test', sessionId: 's1' });
  });

  it('authenticateSocketToken includes role from JWT payload', async () => {
    mockVerifyJwt.mockResolvedValue({ sub: 'u1', username: 'test', sessionId: 's1', role: 'admin' });
    const user = await authenticateSocketToken('token');
    expect(user).toEqual({ sub: 'u1', username: 'test', sessionId: 's1', role: 'admin' });
  });
});

// =====================================================================
//  Remediation namespace – admin role enforcement (issue #977)
// =====================================================================
describe('remediation namespace admin role middleware', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetSession.mockReturnValue({
      id: 's1',
      user_id: 'u1',
      username: 'test',
      created_at: '2026-02-07T10:00:00.000Z',
      expires_at: '2026-02-07T11:00:00.000Z',
      last_active: '2026-02-07T10:30:00.000Z',
      is_valid: 1,
    });
    app = Fastify();
    await app.register(socketIoPlugin);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should have a dedicated admin role middleware on the remediation namespace', () => {
    // The remediation namespace should have more middleware than llm/monitoring
    // because it has the shared auth middleware PLUS the admin role middleware.
    const remediationNs = app.ioNamespaces.remediation;
    const llmNs = app.ioNamespaces.llm;

    // Access the internal middleware stack (_fns is Socket.IO's internal array
    // of middleware functions registered via .use())
    const remFns = (remediationNs as unknown as { _fns: unknown[] })._fns;
    const llmFns = (llmNs as unknown as { _fns: unknown[] })._fns;

    // Remediation should have 1 more middleware (admin role check) than llm
    expect(remFns.length).toBe(llmFns.length + 1);
  });

  it('should reject non-admin users from the remediation namespace via middleware', async () => {
    const remediationNs = app.ioNamespaces.remediation;
    const middlewares = (remediationNs as unknown as { _fns: Array<(socket: unknown, next: (err?: Error) => void) => void> })._fns;

    // The last middleware is the admin role check
    const adminMiddleware = middlewares[middlewares.length - 1];

    // Simulate a socket with a non-admin user (viewer role)
    const fakeSocket = {
      data: { user: { sub: 'u1', username: 'test', sessionId: 's1', role: 'viewer' } },
      handshake: { auth: { token: 'valid-token' } },
    };

    const next = vi.fn();
    adminMiddleware(fakeSocket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Admin role required',
    }));
  });

  it('should reject users with no role from the remediation namespace', async () => {
    const remediationNs = app.ioNamespaces.remediation;
    const middlewares = (remediationNs as unknown as { _fns: Array<(socket: unknown, next: (err?: Error) => void) => void> })._fns;
    const adminMiddleware = middlewares[middlewares.length - 1];

    const fakeSocket = {
      data: { user: { sub: 'u1', username: 'test', sessionId: 's1' } },
      handshake: { auth: { token: 'valid-token' } },
    };

    const next = vi.fn();
    adminMiddleware(fakeSocket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Admin role required',
    }));
  });

  it('should allow admin users to connect to the remediation namespace', async () => {
    const remediationNs = app.ioNamespaces.remediation;
    const middlewares = (remediationNs as unknown as { _fns: Array<(socket: unknown, next: (err?: Error) => void) => void> })._fns;
    const adminMiddleware = middlewares[middlewares.length - 1];

    const fakeSocket = {
      data: { user: { sub: 'u1', username: 'test', sessionId: 's1', role: 'admin' } },
      handshake: { auth: { token: 'valid-token' } },
    };

    const next = vi.fn();
    adminMiddleware(fakeSocket, next);

    // next() called with no arguments means success
    expect(next).toHaveBeenCalledWith();
  });

  it('should NOT have admin role middleware on llm or monitoring namespaces', () => {
    const llmNs = app.ioNamespaces.llm;
    const monitoringNs = app.ioNamespaces.monitoring;

    // llm and monitoring should only have the shared auth middleware (1 function)
    const llmFns = (llmNs as unknown as { _fns: unknown[] })._fns;
    const monitoringFns = (monitoringNs as unknown as { _fns: unknown[] })._fns;

    expect(llmFns.length).toBe(1);
    expect(monitoringFns.length).toBe(1);
  });
});

// =====================================================================
//  CORS allow-list (issue #1115) — REST + Socket.IO share getAllowedOrigins
// =====================================================================
describe('socket-io CORS allow-list (#1115)', () => {
  let app: FastifyInstance;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(async () => {
    if (app) await app.close();
    process.env.NODE_ENV = originalNodeEnv;
    // Late-import to avoid the module path differing in mock setup above.
    const { resetConfig } = await import('../config/index.js');
    resetConfig();
  });

  it('production with CORS_ALLOWED_ORIGINS unset → cors.origin=false (legacy default)', async () => {
    const { setConfigForTest } = await import('../config/index.js');
    process.env.NODE_ENV = 'test';
    setConfigForTest({ CORS_ALLOWED_ORIGINS: undefined });
    process.env.NODE_ENV = 'production';

    app = Fastify();
    await app.register(socketIoPlugin);
    await app.ready();

    const opts = (app.io as unknown as { opts: { cors: { origin: unknown } } }).opts;
    expect(opts.cors.origin).toBe(false);
  });

  it('production with CORS_ALLOWED_ORIGINS list → cors.origin = parsed array (same source as REST)', async () => {
    const { setConfigForTest } = await import('../config/index.js');
    process.env.NODE_ENV = 'test';
    setConfigForTest({ CORS_ALLOWED_ORIGINS: 'https://example.com,https://other.com' });
    process.env.NODE_ENV = 'production';

    app = Fastify();
    await app.register(socketIoPlugin);
    await app.ready();

    const opts = (app.io as unknown as { opts: { cors: { origin: unknown } } }).opts;
    expect(opts.cors.origin).toEqual(['https://example.com', 'https://other.com']);

    // Cross-check: REST helper returns the same list — single source of truth.
    const { getAllowedOrigins } = await import('./allowed-origins.js');
    expect(getAllowedOrigins()).toEqual(['https://example.com', 'https://other.com']);
  });
});

describe('verifyTransportRequest (Engine.IO allowRequest)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyJwt.mockResolvedValue({ sub: 'u1', username: 'test', sessionId: 's1' });
    mockGetSession.mockReturnValue({
      id: 's1',
      user_id: 'u1',
      username: 'test',
      created_at: '2026-02-07T10:00:00.000Z',
      expires_at: '2026-02-07T11:00:00.000Z',
      last_active: '2026-02-07T10:30:00.000Z',
      is_valid: 1,
    });
  });

  function fakeReq(url: string): IncomingMessage {
    return { url } as IncomingMessage;
  }

  it('rejects requests without a token query parameter', async () => {
    const cb = vi.fn();
    await verifyTransportRequest(fakeReq('/socket.io/?EIO=4&transport=polling'), cb);
    expect(cb).toHaveBeenCalledWith('Authentication required', false);
  });

  it('rejects requests with an invalid/expired token', async () => {
    mockVerifyJwt.mockResolvedValue(null);
    const cb = vi.fn();
    await verifyTransportRequest(fakeReq('/socket.io/?EIO=4&transport=polling&token=bad'), cb);
    expect(cb).toHaveBeenCalledWith('Invalid or expired token', false);
  });

  it('rejects requests with a revoked session', async () => {
    mockGetSession.mockReturnValue(undefined);
    const cb = vi.fn();
    await verifyTransportRequest(fakeReq('/socket.io/?EIO=4&transport=polling&token=valid'), cb);
    expect(cb).toHaveBeenCalledWith('Session invalid or revoked', false);
  });

  it('rejects requests with mismatched identity', async () => {
    mockVerifyJwt.mockResolvedValue({ sub: 'u2', username: 'other', sessionId: 's1' });
    const cb = vi.fn();
    await verifyTransportRequest(fakeReq('/socket.io/?EIO=4&transport=polling&token=valid'), cb);
    expect(cb).toHaveBeenCalledWith('Session invalid or revoked', false);
  });

  it('accepts requests with a valid token and active session', async () => {
    const cb = vi.fn();
    await verifyTransportRequest(fakeReq('/socket.io/?EIO=4&transport=polling&token=valid'), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });
});

// SECURITY REGRESSION: live sockets must be torn down when the session is
// revoked or an admin loses the role — handshake-time checks are not enough.
describe('socketRevalidationVerdict', () => {
  const session = { user_id: 'u1' };

  it('returns ok for a still-valid session (non-admin namespace)', () => {
    expect(socketRevalidationVerdict(session, 'u1', false, undefined)).toBe('ok');
  });

  it('flags a revoked/expired session (getSession returned null)', () => {
    expect(socketRevalidationVerdict(null, 'u1', false, undefined)).toBe('session-invalid');
  });

  it('flags a session that no longer belongs to the expected user (deleted/reissued)', () => {
    expect(socketRevalidationVerdict({ user_id: 'someone-else' }, 'u1', false, undefined)).toBe('session-invalid');
  });

  it('keeps an admin on the remediation namespace while still admin', () => {
    expect(socketRevalidationVerdict(session, 'u1', true, 'admin')).toBe('ok');
  });

  it('flags an admin who was downgraded (remediation namespace)', () => {
    expect(socketRevalidationVerdict(session, 'u1', true, 'operator')).toBe('role-lost');
    expect(socketRevalidationVerdict(session, 'u1', true, undefined)).toBe('role-lost');
  });
});

// =====================================================================
//  Live revalidation loop wiring (#1520). The pure verdict function is
//  covered above; this drives the actual enforcement: the per-connection
//  setInterval, the getSession/getUserById lookups, requireAdmin derived
//  from namespace identity, socket.disconnect(true), and clearInterval on
//  disconnect (timer-leak guard).
// =====================================================================
describe('live socket revalidation loop (#1520)', () => {
  let app: FastifyInstance;

  interface FakeSocket {
    data: { user: { sub: string; username: string; sessionId: string; role?: string } };
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    _disconnectHandler?: () => void;
  }

  function makeSocket(role?: string): FakeSocket {
    const socket: FakeSocket = {
      data: { user: { sub: 'u1', username: 'test', sessionId: 's1', role } },
      disconnect: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'disconnect') socket._disconnectHandler = cb;
      }),
    };
    return socket;
  }

  // Socket.IO overrides Namespace.emit to broadcast to connected clients, so we
  // invoke the registered 'connection' listener directly instead of emitting.
  function fireConnection(ns: unknown, socket: FakeSocket): void {
    const handlers = (ns as { listeners(ev: string): Array<(s: FakeSocket) => void> }).listeners('connection');
    handlers[handlers.length - 1](socket);
  }

  const validSession = {
    id: 's1', user_id: 'u1', username: 'test',
    created_at: '2026-02-07T10:00:00.000Z', expires_at: '2026-02-07T11:00:00.000Z',
    last_active: '2026-02-07T10:30:00.000Z', is_valid: 1,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetSession.mockReturnValue(validSession);
    app = Fastify();
    await app.register(socketIoPlugin);
    await app.ready();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('disconnects a socket whose session was revoked, after the interval elapses', async () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    fireConnection(app.ioNamespaces.monitoring, socket);

    mockGetSession.mockReturnValue(undefined); // revoked (logout / force-revoke / deletion)
    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('leaves a socket connected while its session stays valid', async () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    fireConnection(app.ioNamespaces.monitoring, socket);

    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects a demoted admin on the remediation namespace (requireAdmin path)', async () => {
    vi.useFakeTimers();
    const socket = makeSocket('admin');
    fireConnection(app.ioNamespaces.remediation, socket);

    mockGetUserById.mockResolvedValue({ id: 'u1', role: 'operator' }); // no longer admin
    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS);

    expect(mockGetUserById).toHaveBeenCalledWith('u1');
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('does not fetch the DB role on non-admin namespaces (requireAdmin=false)', async () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    fireConnection(app.ioNamespaces.llm, socket);

    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS);
    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('clears the interval on disconnect so a torn-down socket is never re-checked', async () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    fireConnection(app.ioNamespaces.monitoring, socket);

    expect(socket._disconnectHandler).toBeTypeOf('function');
    socket._disconnectHandler!(); // socket disconnected → clearInterval(timer)

    // Even with a now-revoked session, the cleared interval must not fire again.
    mockGetSession.mockReturnValue(undefined);
    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS * 3);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
