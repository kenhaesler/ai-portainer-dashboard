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

function makePool(queryImpl?: (sql: string, values?: unknown[]) => Promise<unknown>) {
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

    const added = query.mock.calls.filter((call) =>
      (call[0] as string).includes('add_retention_policy'),
    );
    expect(added).toHaveLength(5);
    expect(added.map((call) => call[1])).toEqual([
      ['metrics', 7],
      ['kpi_snapshots', 7],
      ['metrics_5min', 30],
      ['metrics_1hour', 90],
      ['metrics_1day', 365],
    ]);
    expect(added.every((call) => (call[0] as string).includes('$1::regclass'))).toBe(true);
    expect(added.every((call) => (call[0] as string).includes('make_interval(days => $2)'))).toBe(true);
  });

  it('removes any pre-existing policy before adding the configured one', async () => {
    const { pool, query } = makePool();

    await applyRetentionPolicies(pool, makeConfig());

    const removeIdx = query.mock.calls.findIndex((call) =>
      (call[0] as string).includes('remove_retention_policy') && call[1]?.[0] === 'metrics',
    );
    const addIdx = query.mock.calls.findIndex((call) =>
      (call[0] as string).includes('add_retention_policy') && call[1]?.[0] === 'metrics',
    );
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(removeIdx);
  });

  it('raw hypertable policies follow METRICS_RETENTION_DAYS when the override is unset', async () => {
    const { pool, query } = makePool();

    await applyRetentionPolicies(pool, makeConfig({ METRICS_RETENTION_DAYS: 14 }));

    const addedParams = query.mock.calls
      .filter((call) => (call[0] as string).includes('add_retention_policy'))
      .map((call) => call[1]);
    expect(addedParams).toContainEqual(['metrics', 14]);
    expect(addedParams).toContainEqual(['kpi_snapshots', 14]);
  });

  it('marks tables as policy-owned only on success', async () => {
    const { pool } = makePool(async (sql: string, values?: unknown[]) => {
      // Simulate the rollup views not existing yet
      if (sql.includes('add_retention_policy') && values?.[0] === 'metrics_5min') {
        throw new Error('relation does not exist');
      }
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
