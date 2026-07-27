/**
 * Real-PostgreSQL tests for `getLlmStats` aggregation honesty.
 *
 * The LLM Observability page reported work that never happened. A single call
 * that failed before it left the process was folded into every aggregate: the
 * page showed "Avg Latency 69ms" (the time taken to raise a config error), a
 * Model Breakdown row crediting gpt-4o-mini with 100% share of a request it
 * never received, and — because `error_rate` is already a percentage and the
 * tile multiplied by 100 again — "Error Rate 10000.0%".
 *
 * The store computed `status` and then discarded it at the aggregate boundary.
 * These tests pin that it no longer does, and that `errorRate` is a percentage.
 *
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:...@localhost:5433/portainer_dashboard_test \
 *   npx vitest run src/__tests__/llm-stats-aggregation.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { getLlmStats } from '../services/llm-trace-store.js';

async function seedTrace(opts: {
  traceId: string;
  model?: string;
  tokens?: number;
  latencyMs?: number;
  status?: 'success' | 'error';
}): Promise<void> {
  await testDb.execute(
    `INSERT INTO llm_traces (trace_id, model, total_tokens, latency_ms, status, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [
      opts.traceId,
      opts.model ?? 'gpt-4o-mini',
      opts.tokens ?? 0,
      opts.latencyMs ?? 0,
      opts.status ?? 'success',
    ],
  );
}

describe('getLlmStats aggregation', () => {
  beforeAll(async () => {
    testDb = await getTestDb();
  });

  beforeEach(async () => {
    await truncateTestTables(['llm_traces']);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('reports errorRate as a percentage, not a fraction', async () => {
    await seedTrace({ traceId: 'a', status: 'error' });
    await seedTrace({ traceId: 'b', status: 'success' });
    await seedTrace({ traceId: 'c', status: 'success' });
    await seedTrace({ traceId: 'd', status: 'success' });

    const stats = await getLlmStats(24);

    // 1 of 4 failed => 25 percent. Not 0.25.
    expect(stats.errorRate).toBe(25);
  });

  it('reports a single failed call as 100 percent, which the UI must not square', async () => {
    await seedTrace({ traceId: 'only', status: 'error', latencyMs: 69 });

    const stats = await getLlmStats(24);

    expect(stats.errorRate).toBe(100);
    expect(stats.totalQueries).toBe(1);
    expect(stats.failedQueries).toBe(1);
    expect(stats.succeededQueries).toBe(0);
  });

  it('excludes failed calls from the latency average', async () => {
    // The failed call is fast because it never left the process. Averaging it
    // in drags the reported model latency toward a number no model produced.
    await seedTrace({ traceId: 'fail', status: 'error', latencyMs: 69 });
    await seedTrace({ traceId: 'ok1', status: 'success', latencyMs: 1000 });
    await seedTrace({ traceId: 'ok2', status: 'success', latencyMs: 2000 });

    const stats = await getLlmStats(24);

    expect(stats.avgLatencyMs).toBe(1500);
  });

  it('excludes failed calls from the token total', async () => {
    await seedTrace({ traceId: 'fail', status: 'error', tokens: 999 });
    await seedTrace({ traceId: 'ok', status: 'success', tokens: 120 });

    const stats = await getLlmStats(24);

    expect(stats.totalTokens).toBe(120);
  });

  it('does not credit a model with a request it never served', async () => {
    // The reported case: the only call errored, and the breakdown still showed
    // `gpt-4o-mini | Queries 1 | Share 100%` with a filled bar.
    await seedTrace({ traceId: 'fail', model: 'gpt-4o-mini', status: 'error' });

    const stats = await getLlmStats(24);

    expect(stats.modelBreakdown).toEqual([]);
  });

  it('still counts failed calls in totalQueries so the error rate has a denominator', async () => {
    await seedTrace({ traceId: 'fail', status: 'error' });
    await seedTrace({ traceId: 'ok', status: 'success', tokens: 10, latencyMs: 500 });

    const stats = await getLlmStats(24);

    expect(stats.totalQueries).toBe(2);
    expect(stats.failedQueries).toBe(1);
    expect(stats.succeededQueries).toBe(1);
    expect(stats.errorRate).toBe(50);
  });

  it('returns zeroes rather than nulls for an empty window', async () => {
    const stats = await getLlmStats(24);

    expect(stats).toMatchObject({
      totalQueries: 0,
      failedQueries: 0,
      succeededQueries: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      modelBreakdown: [],
    });
  });
});
