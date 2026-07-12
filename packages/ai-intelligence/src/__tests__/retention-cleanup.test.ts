/**
 * Real-PostgreSQL tests for the llm_traces / monitoring_cycles /
 * monitoring_snapshots retention sweeps (#1505).
 *
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:...@localhost:5434/portainer_dashboard_test \
 *   npx vitest run src/__tests__/retention-cleanup.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { cleanOldLlmTraces } from '../services/llm-trace-store.js';
import {
  cleanOldMonitoringCycles,
  cleanOldMonitoringSnapshots,
} from '../services/monitoring-telemetry-store.js';

async function seedLlmTrace(traceId: string, daysAgo: number): Promise<void> {
  await testDb.execute(
    `INSERT INTO llm_traces (trace_id, model, created_at)
     VALUES (?, 'gpt-4o-mini', NOW() - make_interval(days => ?))`,
    [traceId, daysAgo],
  );
}

async function seedCycle(durationMs: number, daysAgo: number): Promise<void> {
  await testDb.execute(
    `INSERT INTO monitoring_cycles (duration_ms, created_at)
     VALUES (?, NOW() - make_interval(days => ?))`,
    [durationMs, daysAgo],
  );
}

async function seedSnapshot(daysAgo: number): Promise<void> {
  await testDb.execute(
    `INSERT INTO monitoring_snapshots (
       containers_running, containers_stopped, containers_unhealthy,
       endpoints_up, endpoints_down, created_at
     ) VALUES (1, 0, 0, 1, 0, NOW() - make_interval(days => ?))`,
    [daysAgo],
  );
}

beforeAll(async () => {
  testDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('llm_traces', 'monitoring_cycles', 'monitoring_snapshots');
});

describe('cleanOldLlmTraces (#1505)', () => {
  it('prunes traces past the retention window', async () => {
    await seedLlmTrace('t-old', 45);
    await seedLlmTrace('t-recent', 5);

    const deleted = await cleanOldLlmTraces(30);

    expect(deleted).toBe(1);
    const remaining = await testDb.query<{ trace_id: string }>('SELECT trace_id FROM llm_traces');
    expect(remaining.map((r) => r.trace_id)).toEqual(['t-recent']);
  });

  it('returns 0 on an already-clean table', async () => {
    await seedLlmTrace('t-recent', 1);
    expect(await cleanOldLlmTraces(30)).toBe(0);
  });
});

describe('cleanOldMonitoringCycles (#1505)', () => {
  it('prunes cycle telemetry past the retention window', async () => {
    await seedCycle(1200, 20);
    await seedCycle(900, 15);
    await seedCycle(800, 3);

    const deleted = await cleanOldMonitoringCycles(14);

    expect(deleted).toBe(2);
    const remaining = await testDb.query<{ duration_ms: number }>(
      'SELECT duration_ms FROM monitoring_cycles',
    );
    expect(remaining.map((r) => r.duration_ms)).toEqual([800]);
  });
});

describe('cleanOldMonitoringSnapshots (#1505)', () => {
  it('keeps the full 90-day status-page window at the default retention', async () => {
    await seedSnapshot(120); // past the window — pruned
    await seedSnapshot(89); // inside the 90-day uptime timeline — kept
    await seedSnapshot(1);

    const deleted = await cleanOldMonitoringSnapshots(90);

    expect(deleted).toBe(1);
    const row = await testDb.queryOne<{ count: number }>(
      'SELECT COUNT(*)::integer as count FROM monitoring_snapshots',
    );
    expect(row?.count).toBe(2);
  });
});
