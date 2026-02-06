import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { remediationRoutes } from './remediation.js';

const mockBroadcastActionUpdate = vi.fn();
const mockRestart = vi.fn();
const mockStop = vi.fn();
const mockStart = vi.fn();

let state: { action: any } = {
  action: null,
};

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('../sockets/remediation.js', () => ({
  broadcastActionUpdate: (...args: unknown[]) => mockBroadcastActionUpdate(...args),
}));

vi.mock('../services/portainer-client.js', () => ({
  restartContainer: (...args: unknown[]) => mockRestart(...args),
  stopContainer: (...args: unknown[]) => mockStop(...args),
  startContainer: (...args: unknown[]) => mockStart(...args),
}));

vi.mock('../db/sqlite.js', () => ({
  getDb: () => ({
    prepare: (query: string) => {
      if (query.includes('SELECT * FROM actions WHERE id = ?')) {
        return { get: () => state.action };
      }
      if (query.includes('UPDATE actions SET status = \'approved\'')) {
        return {
          run: () => {
            state.action = { ...state.action, status: 'approved' };
            return { changes: 1 };
          },
        };
      }
      if (query.includes('UPDATE actions SET status = \'rejected\'')) {
        return {
          run: () => {
            state.action = { ...state.action, status: 'rejected' };
            return { changes: 1 };
          },
        };
      }
      if (query.includes('UPDATE actions SET status = \'executing\'')) {
        return {
          run: () => {
            state.action = { ...state.action, status: 'executing' };
            return { changes: 1 };
          },
        };
      }
      if (query.includes('UPDATE actions SET status = \'completed\'')) {
        return {
          run: () => {
            state.action = { ...state.action, status: 'completed' };
            return { changes: 1 };
          },
        };
      }
      if (query.includes('UPDATE actions SET status = \'failed\'')) {
        return {
          run: () => {
            state.action = { ...state.action, status: 'failed' };
            return { changes: 1 };
          },
        };
      }
      if (query.includes('SELECT * FROM actions')) {
        return { all: () => [] };
      }
      if (query.includes('SELECT COUNT(*) as count FROM actions')) {
        return { get: () => ({ count: 0 }) };
      }
      return { run: () => ({ changes: 1 }), get: () => ({ count: 0 }), all: () => [] };
    },
  }),
}));

describe('remediation routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'operator', sessionId: 's1', role: 'operator' as const };
    });
    await app.register(remediationRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    state.action = {
      id: 'a1',
      status: 'pending',
      endpoint_id: 1,
      container_id: 'c1',
      action_type: 'RESTART_CONTAINER',
    };
  });

  it('returns 409 on stale approve', async () => {
    state.action.status = 'approved';

    const res = await app.inject({
      method: 'POST',
      url: '/api/remediation/actions/a1/approve',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('already approved');
  });

  it('broadcasts update after approve', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/remediation/actions/a1/approve',
    });

    expect(res.statusCode).toBe(200);
    expect(mockBroadcastActionUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });
});
