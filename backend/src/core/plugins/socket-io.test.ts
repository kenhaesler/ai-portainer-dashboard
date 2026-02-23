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

import socketIoPlugin from './socket-io.js';
import { authenticateSocketToken, verifyTransportRequest } from './socket-io.js';
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
