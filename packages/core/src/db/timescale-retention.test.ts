/**
 * Retention-policy ownership tests (#1504).
 *
 * The throwaway test database is plain PostgreSQL without the timescaledb
 * extension, so add_retention_policy cannot run for real — these tests assert
 * the issued SQL against a stubbed pool instead (same boundary the production
 * code talks to).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import type { getConfig } from '../config/index.js';
import {
  applyRetentionPolicies,
  hasTimescaleRetentionPolicy,
  resolveRawMetricsRetentionDays,
  _resetRetentionPolicyStateForTests,
} from './timescale.js';

type Config = ReturnType<typeof getConfig>;

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    METRICS_RETENTION_DAYS: 7,
    METRICS_RAW_RETENTION_DAYS: undefined,
    METRICS_ROLLUP_5MIN_RETENTION_DAYS: 30,
    METRICS_ROLLUP_1HOUR_RETENTION_DAYS: 90,
    METRICS_ROLLUP_1DAY_RETENTION_DAYS: 365,
    ...overrides,
  } as Config;
}

function makePool(queryImpl?: (sql: string) => Promise<unknown>) {
  const query = vi.fn(queryImpl ?? (async () => ({ rows: [] })));
  return { pool: { query } as unknown as pg.Pool, query };
}

beforeEach(() => {
  _resetRetentionPolicyStateForTests();
});

describe('resolveRawMetricsRetentionDays (#1504 env-var reconciliation)', () => {
  it('falls back to the canonical METRICS_RETENTION_DAYS when the override is unset', () => {
    expect(resolveRawMetricsRetentionDays(makeConfig({ METRICS_RETENTION_DAYS: 21 }))).toBe(21);
  });

  it('prefers an explicitly set METRICS_RAW_RETENTION_DAYS', () => {
    const config = makeConfig({ METRICS_RETENTION_DAYS: 21, METRICS_RAW_RETENTION_DAYS: 3 });
    expect(resolveRawMetricsRetentionDays(config)).toBe(3);
  });
});

describe('applyRetentionPolicies', () => {
  it('installs policies for both hypertables and all three rollup aggregates', async () => {
    const { pool, query } = makePool();

    await applyRetentionPolicies(pool, makeConfig());

    const sql = query.mock.calls.map((call) => call[0] as string);
    const added = sql.filter((s) => s.includes('add_retention_policy'));
    expect(added).toHaveLength(5);
    expect(added.find((s) => s.includes("'metrics'"))).toContain("INTERVAL '7 days'");
    expect(added.find((s) => s.includes("'kpi_snapshots'"))).toContain("INTERVAL '7 days'");
    expect(added.find((s) => s.includes("'metrics_5min'"))).toContain("INTERVAL '30 days'");
    expect(added.find((s) => s.includes("'metrics_1hour'"))).toContain("INTERVAL '90 days'");
    expect(added.find((s) => s.includes("'metrics_1day'"))).toContain("INTERVAL '365 days'");
  });

  it('removes any pre-existing policy before adding the configured one', async () => {
    const { pool, query } = makePool();

    await applyRetentionPolicies(pool, makeConfig());

    const sql = query.mock.calls.map((call) => call[0] as string);
    const removeIdx = sql.findIndex((s) => s.includes("remove_retention_policy('metrics'"));
    const addIdx = sql.findIndex((s) => s.includes("add_retention_policy('metrics'"));
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(removeIdx);
  });

  it('raw hypertable policies follow METRICS_RETENTION_DAYS when the override is unset', async () => {
    const { pool, query } = makePool();

    await applyRetentionPolicies(pool, makeConfig({ METRICS_RETENTION_DAYS: 14 }));

    const sql = query.mock.calls.map((call) => call[0] as string);
    expect(sql.find((s) => s.includes("add_retention_policy('metrics'"))).toContain("INTERVAL '14 days'");
    expect(sql.find((s) => s.includes("add_retention_policy('kpi_snapshots'"))).toContain("INTERVAL '14 days'");
  });

  it('marks tables as policy-owned only on success', async () => {
    const { pool } = makePool(async (sql: string) => {
      // Simulate the rollup views not existing yet
      if (sql.includes('metrics_5min')) throw new Error('relation does not exist');
      return { rows: [] };
    });

    await applyRetentionPolicies(pool, makeConfig());

    expect(hasTimescaleRetentionPolicy('metrics')).toBe(true);
    expect(hasTimescaleRetentionPolicy('kpi_snapshots')).toBe(true);
    expect(hasTimescaleRetentionPolicy('metrics_5min')).toBe(false);
    expect(hasTimescaleRetentionPolicy('metrics_1hour')).toBe(true);
    expect(hasTimescaleRetentionPolicy('metrics_1day')).toBe(true);
  });

  it('reports no policy ownership on plain Postgres (add_retention_policy unavailable)', async () => {
    const { pool } = makePool(async () => {
      throw new Error('function add_retention_policy(unknown, interval) does not exist');
    });

    await applyRetentionPolicies(pool, makeConfig());

    expect(hasTimescaleRetentionPolicy('metrics')).toBe(false);
    expect(hasTimescaleRetentionPolicy('kpi_snapshots')).toBe(false);
  });

  it('revokes ownership when a previously installed policy fails to re-apply', async () => {
    const { pool: okPool } = makePool();
    await applyRetentionPolicies(okPool, makeConfig());
    expect(hasTimescaleRetentionPolicy('metrics')).toBe(true);

    const { pool: failPool } = makePool(async () => {
      throw new Error('connection lost');
    });
    await applyRetentionPolicies(failPool, makeConfig());
    expect(hasTimescaleRetentionPolicy('metrics')).toBe(false);
  });
});
