import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { testAdminOnly } from '../../../test-utils/rbac-test-helper.js';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { remediationRoutes } from '../routes/remediation.js';

const mockBroadcastActionUpdate = vi.fn();

let state: { action: any } = {
  action: null,
};

vi.mock('../core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('../sockets/remediation.js', () => ({
  broadcastActionUpdate: (...args: unknown[]) => mockBroadcastActionUpdate(...args),
}));

// Passthrough mock: keeps real implementations but makes the module writable for vi.spyOn
vi.mock('../core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());

import * as portainerClient from '../../../core/portainer/portainer-client.js';
import { cache, waitForInFlight } from '../../../core/portainer/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../../../test-utils/test-redis-helper.js';

let mockRestartContainer: any;
let mockStopContainer: any;
let mockStartContainer: any;

// Kept: stateful SQL mock simulates approve/reject/execute state transitions
vi.mock('../core/db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM actions WHERE id = ?')) {
        return state.action;
      }
      if (sql.includes('SELECT COUNT(*)')) {
        return { count: 0 };
      }
      return null;
    }),
    query: vi.fn(async () => []),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("status = 'approved'")) {
        state.action = { ...state.action, status: 'approved' };
      } else if (sql.includes("status = 'rejected'")) {
        state.action = { ...state.action, status: 'rejected' };
      } else if (sql.includes("status = 'executing'")) {
        state.action = { ...state.action, status: 'executing' };
      } else if (sql.includes("status = 'completed'")) {
        state.action = {
          ...state.action,
          status: 'completed',
          execution_result: params[0],
          execution_duration_ms: params[1],
        };
      } else if (sql.includes("status = 'failed'")) {
        state.action = {
          ...state.action,
          status: 'failed',
          execution_result: params[0],
          execution_duration_ms: params[1],
        };
      }
      return { changes: 1 };
    }),
  }),
}));

describe('remediation routes', () => {
  let app: FastifyInstance;
  let currentRole: 'viewer' | 'operator' | 'admin';

  beforeAll(async () => {
    currentRole = 'admin';
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request, reply) => {
      const rank = { viewer: 0, operator: 1, admin: 2 };
      const userRole = request.user?.role ?? 'viewer';
      if (rank[userRole] < rank[minRole]) {
        reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'operator', sessionId: 's1', role: currentRole };
    });
    await app.register(remediationRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await waitForInFlight();
  });

  afterAll(async () => {
    await app.close();
    await closeTestRedis();
  });

  beforeEach(async () => {
    currentRole = 'admin';
    await cache.clear();
    await flushTestCache();
    vi.restoreAllMocks();
    mockRestartContainer = vi.spyOn(portainerClient, 'restartContainer').mockResolvedValue(undefined);
    mockStopContainer = vi.spyOn(portainerClient, 'stopContainer').mockResolvedValue(undefined);
    mockStartContainer = vi.spyOn(portainerClient, 'startContainer').mockResolvedValue(undefined);
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

  describe('RBAC', () => {
    const setRole = (r: 'viewer' | 'operator' | 'admin') => { currentRole = r; };
    testAdminOnly(() => app, setRole, 'POST', '/api/remediation/actions/a1/approve');
    testAdminOnly(() => app, setRole, 'POST', '/api/remediation/actions/a1/reject', { reason: 'not now' });
    testAdminOnly(() => app, setRole, 'POST', '/api/remediation/actions/a1/execute');
  });

  it('rejects execute when action is not approved', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/remediation/actions/a1/execute',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('must be approved');
    expect(mockRestartContainer).not.toHaveBeenCalled();
  });

  it('executes approved restart actions', async () => {
    state.action.status = 'approved';
    state.action.action_type = 'RESTART_CONTAINER';

    const res = await app.inject({
      method: 'POST',
      url: '/api/remediation/actions/a1/execute',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, actionId: 'a1', status: 'completed' });
    expect(mockRestartContainer).toHaveBeenCalledWith(1, 'c1');
    expect(mockBroadcastActionUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'executing' }));
    expect(mockBroadcastActionUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('marks action failed when execution throws', async () => {
    state.action.status = 'approved';
    state.action.action_type = 'RESTART_CONTAINER';
    mockRestartContainer.mockRejectedValue(new Error('portainer unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/remediation/actions/a1/execute',
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: 'Failed to execute remediation action',
      details: 'portainer unavailable',
    });
    expect(mockBroadcastActionUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('rejects unsupported action types', async () => {
    state.action.status = 'approved';
    state.action.action_type = 'INVESTIGATE';

    const res = await app.inject({
      method: 'POST',
      url: '/api/remediation/actions/a1/execute',
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('Failed to execute remediation action');
    expect(res.json().details).toContain('Unsupported action type');
    expect(mockRestartContainer).not.toHaveBeenCalled();
    expect(mockStopContainer).not.toHaveBeenCalled();
    expect(mockStartContainer).not.toHaveBeenCalled();
  });
});
