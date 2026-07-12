import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

// Kept: app-db-router mock — redirects to the real test PostgreSQL instance so
// the store runs its actual SQL (unique-violation dedup, transition guards)
// against the real schema, per the project rule "never mock the database" (#1497).
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import {
  insertAction,
  hasPendingAction,
  updateActionStatus,
  getAction,
  getActions,
  type ActionInsert,
} from '../services/actions-store.js';

const makeAction = (overrides: Partial<ActionInsert> = {}): ActionInsert => ({
  id: 'act-1',
  insight_id: null,
  endpoint_id: 1,
  container_id: 'c1',
  container_name: 'web',
  action_type: 'RESTART_CONTAINER',
  rationale: 'CPU sustained above threshold',
  ...overrides,
});

beforeAll(async () => { testDb = await getTestDb(); });
afterAll(async () => { await closeTestDb(); });
beforeEach(async () => { await truncateTestTables('actions'); });

describe('actions-store (#1497)', () => {
  describe('insertAction — PostgreSQL unique-violation dedup', () => {
    it('inserts a new pending action and returns true', async () => {
      expect(await insertAction(makeAction())).toBe(true);
      expect((await getAction('act-1'))?.status).toBe('pending');
    });

    it('suppresses a duplicate pending action (same container+type) via the partial unique index → false', async () => {
      expect(await insertAction(makeAction({ id: 'a' }))).toBe(true);
      // Same container_id + action_type, both pending → 23505 unique_violation,
      // caught by insertAction and reported as a suppressed duplicate (not thrown).
      expect(await insertAction(makeAction({ id: 'b' }))).toBe(false);
      expect(await getActions()).toHaveLength(1);
    });

    it('allows a new pending action once the prior one leaves pending (index is WHERE status=pending)', async () => {
      expect(await insertAction(makeAction({ id: 'a' }))).toBe(true);
      expect(await updateActionStatus('a', 'approved', { approved_by: 'admin' })).toBe(true);
      // The first row is no longer pending, so the partial unique index does not fire.
      expect(await insertAction(makeAction({ id: 'b' }))).toBe(true);
      expect(await getActions()).toHaveLength(2);
    });

    it('allows the same container with a different action_type', async () => {
      expect(await insertAction(makeAction({ id: 'a', action_type: 'RESTART_CONTAINER' }))).toBe(true);
      expect(await insertAction(makeAction({ id: 'b', action_type: 'STOP_CONTAINER' }))).toBe(true);
      expect(await getActions()).toHaveLength(2);
    });
  });

  describe('hasPendingAction', () => {
    it('is true only while a matching pending action exists', async () => {
      await insertAction(makeAction());
      expect(await hasPendingAction('c1', 'RESTART_CONTAINER')).toBe(true);
      // Different container or type does not match.
      expect(await hasPendingAction('c1', 'STOP_CONTAINER')).toBe(false);
      expect(await hasPendingAction('other', 'RESTART_CONTAINER')).toBe(false);
      // Once the action leaves pending it no longer counts.
      await updateActionStatus('act-1', 'approved', { approved_by: 'admin' });
      expect(await hasPendingAction('c1', 'RESTART_CONTAINER')).toBe(false);
    });
  });

  describe('updateActionStatus — transition guard + changes semantics', () => {
    it('allows pending → approved and records the approver', async () => {
      await insertAction(makeAction());
      expect(await updateActionStatus('act-1', 'approved', { approved_by: 'admin' })).toBe(true);
      const row = await getAction('act-1');
      expect(row?.status).toBe('approved');
      expect(row?.approved_by).toBe('admin');
      expect(row?.approved_at).toBeTruthy();
    });

    it('refuses an invalid transition (pending → executing) and leaves the row unchanged', async () => {
      await insertAction(makeAction());
      expect(await updateActionStatus('act-1', 'executing')).toBe(false);
      expect((await getAction('act-1'))?.status).toBe('pending');
    });

    it('refuses to skip states (pending → completed)', async () => {
      await insertAction(makeAction());
      expect(await updateActionStatus('act-1', 'completed')).toBe(false);
      expect((await getAction('act-1'))?.status).toBe('pending');
    });

    it('walks the full happy path pending → approved → executing → completed', async () => {
      await insertAction(makeAction());
      expect(await updateActionStatus('act-1', 'approved', { approved_by: 'admin' })).toBe(true);
      expect(await updateActionStatus('act-1', 'executing')).toBe(true);
      expect(
        await updateActionStatus('act-1', 'completed', {
          execution_result: 'Executed RESTART_CONTAINER successfully',
          execution_duration_ms: 42,
        }),
      ).toBe(true);
      const row = await getAction('act-1');
      expect(row?.status).toBe('completed');
      expect(row?.execution_duration_ms).toBe(42);
      expect(row?.completed_at).toBeTruthy();
    });

    it('returns false for a non-existent action', async () => {
      expect(await updateActionStatus('nope', 'approved', { approved_by: 'admin' })).toBe(false);
    });
  });
});
