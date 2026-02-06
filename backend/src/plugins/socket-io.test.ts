import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../utils/crypto.js', () => ({
  verifyJwt: vi.fn().mockResolvedValue({ sub: 'u1', username: 'test', sessionId: 's1' }),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import socketIoPlugin from './socket-io.js';

describe('socket-io plugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
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
});
