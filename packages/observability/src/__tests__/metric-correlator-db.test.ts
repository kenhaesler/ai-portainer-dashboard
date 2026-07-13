/**
 * DB-backed tests for the set-based correlation queries (#1501).
 *
 * Exercises the rewritten queries end-to-end against real PostgreSQL:
 *  - detectCorrelatedAnomalies now issues ONE window/LATERAL query for the whole
 *    fleet (replacing the ~11 sequential round-trips per container).
 *  - findCorrelatedContainers reads pre-bucketed averages from the metrics_5min
 *    continuous aggregate instead of re-aggregating the raw hypertable.
 *
 * The app test DB is plain PostgreSQL (no TimescaleDB), and the timescale
 * migrations don't run here, so we create plain `metrics` / `metrics_5min`
 * tables. Both rewritten queries use only standard SQL, so this is a faithful
 * exercise of the production statements.
 *
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5466/portainer_dashboard_test \
 *   npx vitest run src/__tests__/metric-correlator-db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type pg from 'pg';
import { getTestPool, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import { detectCorrelatedAnomalies, findCorrelatedContainers } from '../services/metric-correlator.js';

let pool: pg.Pool;

beforeAll(async () => {
  pool = await getTestPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metrics (
      endpoint_id INTEGER NOT NULL,
      container_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_metrics_composite ON metrics(container_id, metric_type, timestamp DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metrics_5min (
      bucket TIMESTAMPTZ NOT NULL,
      endpoint_id INTEGER,
      container_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      avg_value DOUBLE PRECISION
    )`);
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS metrics');
  await pool.query('DROP TABLE IF EXISTS metrics_5min');
  await closeTestDb();
});

beforeEach(async () => {
  await pool.query('TRUNCATE metrics, metrics_5min');
});

describe('detectCorrelatedAnomalies (real PG, set-based rewrite)', () => {
  it('flags a container whose latest CPU sample spikes above its recent baseline', async () => {
    // "web": 29 baseline cpu samples at 10 plus a fresh spike to 50 (z ≈ 5.4),
    // memory flat at 40 (z = 0) → one elevated metric, composite ≈ 5.4.
    await pool.query(
      `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
       SELECT 1, 'c-web', 'web', 'cpu', 10, NOW() - make_interval(mins => g)
       FROM generate_series(2, 30) g`,
    );
    await pool.query(
      `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
       VALUES (1, 'c-web', 'web', 'cpu', 50, NOW() - make_interval(secs => 30))`,
    );
    await pool.query(
      `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
       SELECT 1, 'c-web', 'web', 'memory', 40, NOW() - make_interval(mins => g)
       FROM generate_series(1, 30) g`,
    );

    // "idle": both metrics flat → no elevated z-scores → excluded.
    await pool.query(
      `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
       SELECT 1, 'c-idle', 'idle', 'cpu', 20, NOW() - make_interval(mins => g)
       FROM generate_series(1, 10) g`,
    );
    await pool.query(
      `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
       SELECT 1, 'c-idle', 'idle', 'memory', 60, NOW() - make_interval(mins => g)
       FROM generate_series(1, 10) g`,
    );

    // "single": only one metric type → excluded by the >=2-distinct-types filter.
    await pool.query(
      `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
       SELECT 1, 'c-single', 'single', 'cpu', 30, NOW() - make_interval(mins => g)
       FROM generate_series(1, 10) g`,
    );

    const anomalies = await detectCorrelatedAnomalies(30, 2, pool);

    expect(anomalies).toHaveLength(1);
    const a = anomalies[0];
    expect(a.containerId).toBe('c-web');
    expect(a.containerName).toBe('web');
    expect(a.severity).toBe('critical');
    expect(a.compositeScore).toBeGreaterThanOrEqual(5);
    expect(a.pattern).toContain('CPU Spike');

    // Only the elevated metric is reported; its z-score reflects the fresh spike.
    expect(a.metrics).toHaveLength(1);
    expect(a.metrics[0].type).toBe('cpu');
    expect(a.metrics[0].zScore).toBeGreaterThan(2);
    expect(a.metrics[0].currentValue).toBe(50);
  });

  it('returns nothing when no container has an elevated metric', async () => {
    await pool.query(
      `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
       SELECT 1, 'c-flat', 'flat', 'cpu', 15, NOW() - make_interval(mins => g)
       FROM generate_series(1, 10) g`,
    );
    await pool.query(
      `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
       SELECT 1, 'c-flat', 'flat', 'memory', 25, NOW() - make_interval(mins => g)
       FROM generate_series(1, 10) g`,
    );

    const anomalies = await detectCorrelatedAnomalies(30, 2, pool);
    expect(anomalies).toEqual([]);
  });
});

describe('findCorrelatedContainers (real PG, reads metrics_5min)', () => {
  it('returns a strongly-correlated pair from the aggregate (raw metrics untouched)', async () => {
    // Two containers with perfectly linear, aligned CPU buckets → Pearson r ≈ 1.
    // Both containers + all six buckets are inserted in a single statement so
    // NOW() is evaluated once and the bucket timestamps align exactly.
    // `metrics` is deliberately left empty to prove the read hits metrics_5min.
    await pool.query(
      `INSERT INTO metrics_5min (bucket, endpoint_id, container_id, container_name, metric_type, avg_value)
       SELECT b.bucket, 1, c.cid, c.cname, 'cpu', c.base + b.idx * c.slope
       FROM (VALUES
         (0, date_trunc('minute', NOW()) - make_interval(mins => 30)),
         (1, date_trunc('minute', NOW()) - make_interval(mins => 25)),
         (2, date_trunc('minute', NOW()) - make_interval(mins => 20)),
         (3, date_trunc('minute', NOW()) - make_interval(mins => 15)),
         (4, date_trunc('minute', NOW()) - make_interval(mins => 10)),
         (5, date_trunc('minute', NOW()) - make_interval(mins => 5))
       ) AS b(idx, bucket)
       CROSS JOIN (VALUES
         ('c-a', 'svcA', 10.0, 10.0),
         ('c-b', 'svcB', 12.0, 10.0)
       ) AS c(cid, cname, base, slope)`,
    );

    const pairs = await findCorrelatedContainers(24, 0.7, pool);

    expect(pairs).toHaveLength(1);
    const p = pairs[0];
    expect(p.metricType).toBe('cpu');
    expect(p.correlation).toBeGreaterThan(0.99);
    expect(p.strength).toBe('very_strong');
    expect(p.direction).toBe('positive');
    expect(p.sampleCount).toBe(6);
    expect([p.containerA.name, p.containerB.name].sort()).toEqual(['svcA', 'svcB']);
  });

  it('drops pairs below the correlation threshold', async () => {
    // One rising series vs a flat series → Pearson r = 0, well under the 0.7
    // minimum, so no pair is returned.
    await pool.query(
      `INSERT INTO metrics_5min (bucket, endpoint_id, container_id, container_name, metric_type, avg_value)
       SELECT b.bucket, 1, c.cid, c.cname, 'cpu', c.v[b.idx + 1]
       FROM (VALUES
         (0, date_trunc('minute', NOW()) - make_interval(mins => 30)),
         (1, date_trunc('minute', NOW()) - make_interval(mins => 25)),
         (2, date_trunc('minute', NOW()) - make_interval(mins => 20)),
         (3, date_trunc('minute', NOW()) - make_interval(mins => 15)),
         (4, date_trunc('minute', NOW()) - make_interval(mins => 10)),
         (5, date_trunc('minute', NOW()) - make_interval(mins => 5))
       ) AS b(idx, bucket)
       CROSS JOIN (VALUES
         ('c-x', 'svcX', ARRAY[10.0, 20.0, 30.0, 40.0, 50.0, 60.0]),
         ('c-y', 'svcY', ARRAY[30.0, 30.0, 30.0, 30.0, 30.0, 30.0])
       ) AS c(cid, cname, v)`,
    );

    const pairs = await findCorrelatedContainers(24, 0.7, pool);
    expect(pairs).toEqual([]);
  });
});
