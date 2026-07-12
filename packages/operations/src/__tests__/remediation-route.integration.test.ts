import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

/**
 * Real-PostgreSQL integration test for the remediation state machine (#1497).
 *
 * The sibling remediation-route.test.ts drives the handlers against a hand-rolled
 * SQL-string-matching mock that re-implements the intended guards in JS, so a
 * regression in the actual `WHERE id = ? AND status = '<state>'` guards, the
 * parameter order, or the `changes` semantics cannot be caught. This suite runs
 * the exact SQL against the real schema (mirroring webhook-service.test.ts): it
 * seeds an `actions` row and asserts the persisted state after each transition,
 * including the execute-before-approve rejection and the double-execute guard.
 */

let testDb: AppDb;

// Kept: app-db-router mock — redirects to the real test PostgreSQL instance.
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

// Kept: audit-logger mock — side-effect isolation.
vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

// Kept: remediation socket broadcast mock — no Socket.IO server in this test.
const mockBroadcastActionUpdate = vi.fn();
vi.mock('../sockets/remediation.js', () => ({
  broadcastActionUpdate: (...args: unknown[]) => mockBroadcastActionUpdate(...args),
}));

// Kept: portainer-client mock — the external container-mutation boundary. Fully
// stubbed so execute() exercises only the DB state machine, no Redis/Portainer.
const mockRestartContainer = vi.fn();
const mockStopContainer = vi.fn();
const mockStartContainer = vi.fn();
vi.mock('@dashboard/core/portainer/portainer-client.js', () => ({
  restartContainer: (...args: unknown[]) => mockRestartContainer(...args),
  stopContainer: (...args: unknown[]) => mockStopContainer(...args),
  startContainer: (...args: unknown[]) => mockStartContainer(...args),
}));

import { remediationRoutes } from '../routes/remediation.js';

interface SeedOverrides {
  id?: string;
  status?: string;
  action_type?: string;
  endpoint_id?: number;
  container_id?: string;
}

async function seedAction(over: SeedOverrides = {}): Promise<void> {
  await testDb.execute(
    `INSERT INTO actions
       (id, insight_id, endpoint_id, container_id, container_name, action_type, rationale, status, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      over.id ?? 'a1',
      over.endpoint_id ?? 1,
      over.container_id ?? 'c1',
      'web',
      over.action_type ?? 'RESTART_CONTAINER',
      'CPU sustained above threshold',
      over.status ?? 'pending',
    ],
  );
}

async function statusOf(id: string): Promise<string | undefined> {
  const row = await testDb.queryOne<{ status: string }>('SELECT status FROM actions WHERE id = ?', [id]);
  return row?.status;
}

describe('remediation routes — real PostgreSQL state machine (#1497)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await getTestDb();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    app.decorateRequest('user', undefined);
    app.addHook('preHandler', async (request) => {
      request.user = { sub: 'u1', username: 'admin-user', sessionId: 's1', role: 'admin' };
    });
    await app.register(remediationRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateTestTables('actions');
    vi.clearAllMocks();
    mockRestartContainer.mockResolvedValue(undefined);
    mockStopContainer.mockResolvedValue(undefined);
    mockStartContainer.mockResolvedValue(undefined);
  });

  describe('approve', () => {
    it('transitions a pending action to approved and stamps the approver', async () => {
      await seedAction();
      const res = await app.inject({ method: 'POST', url: '/api/remediation/actions/a1/approve' });

      expect(res.statusCode).toBe(200);
      const row = await testDb.queryOne<{ status: string; approved_by: string; approved_at: string }>(
        'SELECT status, approved_by, approved_at FROM actions WHERE id = ?', ['a1'],
      );
      expect(row?.status).toBe('approved');
      expect(row?.approved_by).toBe('admin-user');
      expect(row?.approved_at).toBeTruthy();
    });

    it('returns 409 and leaves the row unchanged when the action is not pending', async () => {
      await seedAction({ status: 'approved' });
      const res = await app.inject({ method: 'POST', url: '/api/remediation/actions/a1/approve' });

      expect(res.statusCode).toBe(409);
      expect(res.json().currentStatus).toBe('approved');
      expect(await statusOf('a1')).toBe('approved');
    });

    it('returns 404 for an unknown action id', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/remediation/actions/missing/approve' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('reject', () => {
    it('transitions a pending action to rejected and stores the reason', async () => {
      await seedAction();
      const res = await app.inject({
        method: 'POST',
        url: '/api/remediation/actions/a1/reject',
        payload: { reason: 'not a real problem' },
      });

      expect(res.statusCode).toBe(200);
      const row = await testDb.queryOne<{ status: string; rejected_by: string; rejection_reason: string }>(
        'SELECT status, rejected_by, rejection_reason FROM actions WHERE id = ?', ['a1'],
      );
      expect(row?.status).toBe('rejected');
      expect(row?.rejected_by).toBe('admin-user');
      expect(row?.rejection_reason).toBe('not a real problem');
    });
  });

  describe('execute', () => {
    it('rejects execute-before-approve with 409 and never calls Portainer', async () => {
      await seedAction({ status: 'pending' });
      const res = await app.inject({ method: 'POST', url: '/api/remediation/actions/a1/execute' });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain('must be approved');
      expect(mockRestartContainer).not.toHaveBeenCalled();
      expect(await statusOf('a1')).toBe('pending');
    });

    it('executes an approved action end-to-end (approved → executing → completed)', async () => {
      await seedAction({ status: 'approved', action_type: 'RESTART_CONTAINER' });
      const res = await app.inject({ method: 'POST', url: '/api/remediation/actions/a1/execute' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, actionId: 'a1', status: 'completed' });
      expect(mockRestartContainer).toHaveBeenCalledWith(1, 'c1');
      expect(await statusOf('a1')).toBe('completed');
    });

    it('guards against double-execution: a completed action cannot be re-executed', async () => {
      await seedAction({ status: 'approved' });
      const first = await app.inject({ method: 'POST', url: '/api/remediation/actions/a1/execute' });
      expect(first.statusCode).toBe(200);
      expect(await statusOf('a1')).toBe('completed');

      // The WHERE id = ? AND status = 'approved' guard must reject the second run:
      // the row is now 'completed', so no update happens and Portainer is not hit again.
      const second = await app.inject({ method: 'POST', url: '/api/remediation/actions/a1/execute' });
      expect(second.statusCode).toBe(409);
      expect(second.json().currentStatus).toBe('completed');
      expect(mockRestartContainer).toHaveBeenCalledTimes(1);
    });

    it('marks the action failed (502) when the Portainer call throws', async () => {
      await seedAction({ status: 'approved' });
      mockRestartContainer.mockRejectedValue(new Error('portainer unavailable'));

      const res = await app.inject({ method: 'POST', url: '/api/remediation/actions/a1/execute' });
      expect(res.statusCode).toBe(502);
      expect(await statusOf('a1')).toBe('failed');
    });
  });
});
