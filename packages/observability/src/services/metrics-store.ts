import { getMetricsDb } from '@dashboard/core/db/timescale.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import type { Metric } from '@dashboard/core/models/metrics.js';
import { poolHourlyBuckets, type HourlyBucket } from './seasonal-baseline.js';

const log = createChildLogger('metrics-store');

/**
 * Check if a database error is PostgreSQL 42P01 (undefined_table).
 * This happens when the metrics hypertable hasn't been created yet.
 */
export function isUndefinedTableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code: string }).code === '42P01'
  );
}

export interface MetricInsert {
  endpoint_id: number;
  container_id: string;
  container_name: string;
  metric_type: 'cpu' | 'memory' | 'memory_bytes' | 'network_rx_bytes' | 'network_tx_bytes';
  value: number;
}

export async function insertMetrics(metrics: MetricInsert[]): Promise<void> {
  if (metrics.length === 0) return;

  const db = await getMetricsDb();

  // Batch insert using unnest arrays for performance
  const endpointIds: number[] = [];
  const containerIds: string[] = [];
  const containerNames: string[] = [];
  const metricTypes: string[] = [];
  const values: number[] = [];

  for (const m of metrics) {
    endpointIds.push(m.endpoint_id);
    containerIds.push(m.container_id);
    containerNames.push(m.container_name);
    metricTypes.push(m.metric_type);
    values.push(m.value);
  }

  await db.query(
    `INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
     SELECT * FROM unnest(
       $1::int[], $2::text[], $3::text[], $4::text[], $5::double precision[],
       array_fill(NOW(), ARRAY[$6::int])::timestamptz[]
     )`,
    [endpointIds, containerIds, containerNames, metricTypes, values, metrics.length],
  );

  log.debug({ count: metrics.length }, 'Metrics inserted');
}

export async function getMetrics(
  containerId: string,
  metricType: string,
  from: string,
  to: string,
): Promise<Metric[]> {
  const db = await getMetricsDb();
  const { rows } = await db.query(
    `SELECT endpoint_id, container_id, container_name, metric_type, value, timestamp
     FROM metrics
     WHERE container_id = $1 AND metric_type = $2
       AND timestamp >= $3 AND timestamp <= $4
     ORDER BY timestamp ASC`,
    [containerId, metricType, from, to],
  );
  return rows as Metric[];
}

export interface MovingAverageResult {
  mean: number;
  std_dev: number;
  sample_count: number;
}

export async function getMovingAverage(
  containerId: string,
  metricType: string,
  windowSize: number,
): Promise<MovingAverageResult | null> {
  const db = await getMetricsDb();

  // #1361 fix 2 — exclude the point under test from its own baseline.
  // `OFFSET 1` skips the most recent sample so the rolling window ends BEFORE
  // the value being evaluated. Without it the current sample is part of the
  // AVG/STDDEV it is compared against: a spike inflates the std that hides it
  // (self-masking) and a sustained regression poisons the baseline within one
  // window. The window therefore covers the `windowSize` samples immediately
  // preceding the latest one.
  const { rows } = await db.query(
    `SELECT
       AVG(value) as mean,
       STDDEV_POP(value) as std_dev,
       COUNT(*)::int as sample_count
     FROM (
       SELECT value FROM metrics
       WHERE container_id = $1 AND metric_type = $2
       ORDER BY timestamp DESC
       LIMIT $3 OFFSET 1
     ) sub`,
    [containerId, metricType, windowSize],
  );

  const result = rows[0];
  if (!result || result.sample_count === 0 || result.mean === null) {
    return null;
  }

  return {
    mean: Number(result.mean),
    std_dev: Number(result.std_dev ?? 0),
    sample_count: result.sample_count,
  };
}

/**
 * Raw trailing window of metric values, newest-first, EXCLUDING the most recent
 * sample (the point under test — same `OFFSET 1` leakage exclusion as
 * getMovingAverage, #1361 fix 2). Robust detectors (#1362) need the actual
 * values to compute median + MAD, which cannot be derived from pre-aggregated
 * mean/std.
 */
export async function getMetricWindow(
  containerId: string,
  metricType: string,
  windowSize: number,
): Promise<number[]> {
  const db = await getMetricsDb();
  const { rows } = await db.query(
    `SELECT value FROM metrics
     WHERE container_id = $1 AND metric_type = $2
     ORDER BY timestamp DESC
     LIMIT $3 OFFSET 1`,
    [containerId, metricType, windowSize],
  );
  return (rows as Array<{ value: number }>).map((r) => Number(r.value));
}

/**
 * Hour-of-day (optionally day-of-week) baseline statistics for a container
 * metric (issue #1295; #1307 aggregate migration).
 *
 * Reads TimescaleDB's `metrics_1hour` continuous aggregate — one pre-computed
 * row per (container, metric, hour) — instead of scanning the raw `metrics`
 * hypertable, then pools the matching per-day hourly buckets back into the
 * population mean + stddev of the underlying raw samples via the law of total
 * variance (`poolHourlyBuckets`). This is statistically equivalent to the old
 * `AVG(value)` / `STDDEV_POP(value)` raw query but touches a few dozen rows
 * rather than millions.
 *
 * When `dayOfWeek` (0=Sun..6=Sat, UTC) is supplied, buckets are additionally
 * filtered to that weekday — week-aware seasonality (weekday vs weekend), the
 * #1364 carry-over. The caller decides the lookback (a wider window is needed
 * for day-of-week so each weekday has enough occurrences).
 *
 * The current, in-progress hour bucket is excluded (`bucket < date_trunc('hour',
 * NOW())`) so the baseline cannot include / be poisoned by the value under test
 * — the aggregate-era equivalent of the raw path's OFFSET 1. Returns null when
 * no completed buckets match; callers then fall back to a coarser baseline.
 */
export async function getMovingAverageByHourOfDay(
  containerId: string,
  metricType: string,
  hourOfDay: number,
  lookbackDays: number,
  dayOfWeek?: number,
): Promise<MovingAverageResult | null> {
  if (!Number.isInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) {
    return null;
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    return null;
  }
  const filterByDow = Number.isInteger(dayOfWeek) && dayOfWeek! >= 0 && dayOfWeek! <= 6;
  const db = await getMetricsDb();

  const params: unknown[] = [containerId, metricType, lookbackDays, hourOfDay];
  if (filterByDow) params.push(dayOfWeek);

  const { rows } = await db.query(
    `SELECT avg_value, stddev_value, sample_count
     FROM metrics_1hour
     WHERE container_id = $1
       AND metric_type = $2
       AND bucket >= NOW() - ($3::int * INTERVAL '1 day')
       AND date_part('hour', bucket AT TIME ZONE 'UTC') = $4
       ${filterByDow ? `AND date_part('dow', bucket AT TIME ZONE 'UTC') = $5` : ''}
       -- Exclude the current, in-progress hour (the point under test lives there)
       -- so the seasonal baseline is built only from completed past hours.
       AND bucket < date_trunc('hour', NOW())`,
    params,
  );

  const buckets: HourlyBucket[] = (rows as Array<{ avg_value: number; stddev_value: number | null; sample_count: number }>)
    .map((r) => ({
      avg_value: Number(r.avg_value),
      stddev_value: r.stddev_value == null ? null : Number(r.stddev_value),
      sample_count: Number(r.sample_count),
    }));

  const pooled = poolHourlyBuckets(buckets);
  if (!pooled) return null;
  return { mean: pooled.mean, std_dev: pooled.std_dev, sample_count: pooled.sample_count };
}

/**
 * Raw hour-of-day (optionally day-of-week) window: metric values whose timestamp
 * falls in the supplied UTC hour-of-day over the last N days, newest-first,
 * EXCLUDING the most recent sample (the point under test). Robust detection
 * (#1362) uses this to keep #1295 seasonality while computing median + MAD.
 *
 * Unlike the mean/std path, this stays on the RAW `metrics` hypertable: median +
 * MAD need the actual samples, and the `metrics_1hour` aggregate only stores
 * mean/stddev — pooling daily hourly *averages* would understate the spread and
 * over-flag. When `dayOfWeek` (0=Sun..6=Sat, UTC) is supplied the query is
 * narrowed to that weekday (week-aware seasonality, #1307/#1364), which also
 * scans *fewer* rows. Returns [] for an out-of-range hour, bad lookback, or
 * empty bucket.
 */
export async function getMetricWindowByHourOfDay(
  containerId: string,
  metricType: string,
  hourOfDay: number,
  lookbackDays: number,
  dayOfWeek?: number,
): Promise<number[]> {
  if (!Number.isInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) {
    return [];
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    return [];
  }
  const filterByDow = Number.isInteger(dayOfWeek) && dayOfWeek! >= 0 && dayOfWeek! <= 6;
  const db = await getMetricsDb();
  const params: unknown[] = [containerId, metricType, lookbackDays, hourOfDay];
  if (filterByDow) params.push(dayOfWeek);

  const { rows } = await db.query(
    `SELECT value FROM metrics
     WHERE container_id = $1
       AND metric_type = $2
       AND timestamp >= NOW() - ($3::int * INTERVAL '1 day')
       AND date_part('hour', timestamp AT TIME ZONE 'UTC') = $4
       ${filterByDow ? `AND date_part('dow', timestamp AT TIME ZONE 'UTC') = $5` : ''}
       AND timestamp < (
         SELECT MAX(timestamp) FROM metrics
         WHERE container_id = $1 AND metric_type = $2
       )
     ORDER BY timestamp DESC`,
    params,
  );
  return (rows as Array<{ value: number }>).map((r) => Number(r.value));
}

export async function cleanOldMetrics(retentionDays: number): Promise<number> {
  // TimescaleDB retention is handled by policies, but this provides manual cleanup
  const db = await getMetricsDb();
  const { rowCount } = await db.query(
    `DELETE FROM metrics WHERE timestamp < NOW() - $1 * INTERVAL '1 day'`,
    [retentionDays],
  );

  const deleted = rowCount ?? 0;
  log.info({ deleted, retentionDays }, 'Old metrics cleaned');
  return deleted;
}

export async function getLatestMetrics(
  containerId: string,
): Promise<Record<string, number>> {
  const db = await getMetricsDb();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (metric_type) metric_type, value
     FROM metrics
     WHERE container_id = $1
     ORDER BY metric_type, timestamp DESC`,
    [containerId],
  );

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.metric_type] = row.value;
  }
  return result;
}

/**
 * Batch fetch the latest metrics for multiple containers in a single query.
 * Returns a map of containerId -> { metric_type: value }.
 * Much more efficient than calling getLatestMetrics() per container.
 */
export async function getLatestMetricsBatch(
  containerIds: string[],
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (containerIds.length === 0) return result;

  const db = await getMetricsDb();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (container_id, metric_type) container_id, metric_type, value
     FROM metrics
     WHERE container_id = ANY($1)
     ORDER BY container_id, metric_type, timestamp DESC`,
    [containerIds],
  );

  for (const row of rows) {
    if (!result.has(row.container_id)) {
      result.set(row.container_id, {});
    }
    result.get(row.container_id)![row.metric_type] = row.value;
  }

  log.debug({ containerCount: containerIds.length, resultCount: result.size }, 'Batch metrics fetched');
  return result;
}

export interface NetworkRate {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export async function getNetworkRates(
  endpointId: number,
): Promise<Record<string, NetworkRate>> {
  const db = await getMetricsDb();
  const { rows } = await db.query(
    `SELECT container_id, metric_type, value, timestamp
     FROM metrics
     WHERE endpoint_id = $1
       AND metric_type IN ('network_rx_bytes', 'network_tx_bytes')
       AND timestamp > NOW() - INTERVAL '5 minutes'
     ORDER BY container_id, metric_type, timestamp DESC`,
    [endpointId],
  );

  // Group by container_id + metric_type, keep only first 2 entries (latest)
  const grouped = new Map<string, Array<{ value: number; timestamp: string }>>();
  for (const row of rows) {
    const key = `${row.container_id}:${row.metric_type}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    const entries = grouped.get(key)!;
    if (entries.length < 2) {
      entries.push({ value: row.value, timestamp: row.timestamp });
    }
  }

  // Compute rates per container
  const rates: Record<string, NetworkRate> = {};

  for (const [key, entries] of grouped) {
    if (entries.length < 2) continue;

    const [containerId, metricType] = key.split(':');
    const timeDiff = (new Date(entries[0].timestamp).getTime() - new Date(entries[1].timestamp).getTime()) / 1000;
    if (timeDiff <= 0) continue;

    const byteDiff = entries[0].value - entries[1].value;
    if (byteDiff < 0) continue;

    const rate = byteDiff / timeDiff;

    if (!rates[containerId]) {
      rates[containerId] = { rxBytesPerSec: 0, txBytesPerSec: 0 };
    }

    if (metricType === 'network_rx_bytes') {
      rates[containerId].rxBytesPerSec = Math.round(rate * 100) / 100;
    } else {
      rates[containerId].txBytesPerSec = Math.round(rate * 100) / 100;
    }
  }

  return rates;
}

export async function getAllNetworkRates(): Promise<Record<string, NetworkRate>> {
  const db = await getMetricsDb();
  const { rows } = await db.query(
    `SELECT container_id, metric_type, value, timestamp
     FROM metrics
     WHERE metric_type IN ('network_rx_bytes', 'network_tx_bytes')
       AND timestamp > NOW() - INTERVAL '5 minutes'
     ORDER BY container_id, metric_type, timestamp DESC`,
  );

  const grouped = new Map<string, Array<{ value: number; timestamp: string }>>();
  for (const row of rows) {
    const key = `${row.container_id}:${row.metric_type}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    const entries = grouped.get(key)!;
    if (entries.length < 2) {
      entries.push({ value: row.value, timestamp: row.timestamp });
    }
  }

  const rates: Record<string, NetworkRate> = {};

  for (const [key, entries] of grouped) {
    if (entries.length < 2) continue;

    const [containerId, metricType] = key.split(':');
    const timeDiff = (new Date(entries[0].timestamp).getTime() - new Date(entries[1].timestamp).getTime()) / 1000;
    if (timeDiff <= 0) continue;

    const byteDiff = entries[0].value - entries[1].value;
    if (byteDiff < 0) continue;

    const rate = byteDiff / timeDiff;

    if (!rates[containerId]) {
      rates[containerId] = { rxBytesPerSec: 0, txBytesPerSec: 0 };
    }

    if (metricType === 'network_rx_bytes') {
      rates[containerId].rxBytesPerSec = Math.round(rate * 100) / 100;
    } else {
      rates[containerId].txBytesPerSec = Math.round(rate * 100) / 100;
    }
  }

  return rates;
}
