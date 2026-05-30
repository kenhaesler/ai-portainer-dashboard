import { getMetricsDb } from '@dashboard/core/db/timescale.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import type { Metric } from '@dashboard/core/models/metrics.js';

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
 * Hour-of-day baseline statistics for a container metric (issue #1295).
 *
 * Aggregates samples whose timestamp falls in the supplied UTC hour-of-day
 * (0..23) across the last `lookbackDays` days. Returns null when no samples
 * are available; callers should then fall back to the flat-window baseline.
 *
 * The aggregation uses Postgres `date_part('hour', timestamp AT TIME ZONE
 * 'UTC')` so the bucket boundary is fixed and not influenced by the server
 * local timezone.
 */
export async function getMovingAverageByHourOfDay(
  containerId: string,
  metricType: string,
  hourOfDay: number,
  lookbackDays: number,
): Promise<MovingAverageResult | null> {
  if (!Number.isInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) {
    return null;
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    return null;
  }
  const db = await getMetricsDb();

  const { rows } = await db.query(
    `SELECT
       AVG(value) as mean,
       STDDEV_POP(value) as std_dev,
       COUNT(*)::int as sample_count
     FROM metrics
     WHERE container_id = $1
       AND metric_type = $2
       AND timestamp >= NOW() - ($3::int * INTERVAL '1 day')
       AND date_part('hour', timestamp AT TIME ZONE 'UTC') = $4`,
    [containerId, metricType, lookbackDays, hourOfDay],
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
