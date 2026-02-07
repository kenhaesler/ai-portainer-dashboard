import { getDb, prepareStmt } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';
import type { Metric } from '../models/metrics.js';

const log = createChildLogger('metrics-store');

export interface MetricInsert {
  endpoint_id: number;
  container_id: string;
  container_name: string;
  metric_type: 'cpu' | 'memory' | 'memory_bytes' | 'network_rx_bytes' | 'network_tx_bytes';
  value: number;
}

export function insertMetrics(metrics: MetricInsert[]): void {
  if (metrics.length === 0) return;

  const db = getDb();
  const stmt = prepareStmt(`
    INSERT INTO metrics (endpoint_id, container_id, container_name, metric_type, value, timestamp)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertMany = db.transaction((rows: MetricInsert[]) => {
    for (const row of rows) {
      stmt.run(
        row.endpoint_id,
        row.container_id,
        row.container_name,
        row.metric_type,
        row.value,
      );
    }
  });

  insertMany(metrics);
  log.debug({ count: metrics.length }, 'Metrics inserted');
}

export function getMetrics(
  containerId: string,
  metricType: string,
  from: string,
  to: string,
): Metric[] {
  return prepareStmt(
    `SELECT * FROM metrics
     WHERE container_id = ? AND metric_type = ?
       AND timestamp >= ? AND timestamp <= ?
     ORDER BY timestamp ASC`,
  ).all(containerId, metricType, from, to) as Metric[];
}

export interface MovingAverageResult {
  mean: number;
  std_dev: number;
  sample_count: number;
}

export function getMovingAverage(
  containerId: string,
  metricType: string,
  windowSize: number,
): MovingAverageResult | null {
  const result = prepareStmt(
    `SELECT
       AVG(value) as mean,
       COUNT(*) as sample_count
     FROM (
       SELECT value FROM metrics
       WHERE container_id = ? AND metric_type = ?
       ORDER BY timestamp DESC
       LIMIT ?
     )`,
  ).get(containerId, metricType, windowSize) as {
    mean: number | null;
    sample_count: number;
  } | undefined;

  if (!result || result.sample_count === 0 || result.mean === null) {
    return null;
  }

  // Calculate standard deviation in a separate query for accuracy
  const stdResult = prepareStmt(
    `SELECT
       AVG((value - ?) * (value - ?)) as variance
     FROM (
       SELECT value FROM metrics
       WHERE container_id = ? AND metric_type = ?
       ORDER BY timestamp DESC
       LIMIT ?
     )`,
  ).get(result.mean, result.mean, containerId, metricType, windowSize) as {
    variance: number | null;
  } | undefined;

  const variance = stdResult?.variance ?? 0;
  const stdDev = Math.sqrt(Math.max(0, variance));

  return {
    mean: result.mean,
    std_dev: stdDev,
    sample_count: result.sample_count,
  };
}

export function cleanOldMetrics(retentionDays: number): number {
  const result = prepareStmt(
    `DELETE FROM metrics
     WHERE timestamp < datetime('now', ? || ' days')`,
  ).run(`-${retentionDays}`);

  log.info({ deleted: result.changes, retentionDays }, 'Old metrics cleaned');
  return result.changes;
}

export function getLatestMetrics(
  containerId: string,
): Record<string, number> {
  const rows = prepareStmt(
    `SELECT metric_type, value FROM metrics
     WHERE container_id = ?
       AND timestamp = (
         SELECT MAX(timestamp) FROM metrics m2
         WHERE m2.container_id = metrics.container_id
           AND m2.metric_type = metrics.metric_type
       )`,
  ).all(containerId) as Array<{ metric_type: string; value: number }>;

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.metric_type] = row.value;
  }
  return result;
}

export interface NetworkRate {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export function getNetworkRates(
  endpointId: number,
): Record<string, NetworkRate> {
  const rows = getDb().prepare(`
    SELECT container_id, metric_type, value, timestamp
    FROM metrics
    WHERE endpoint_id = ?
      AND metric_type IN ('network_rx_bytes', 'network_tx_bytes')
      AND timestamp > datetime('now', '-5 minutes')
    ORDER BY container_id, metric_type, timestamp DESC
  `).all(endpointId) as Array<{
    container_id: string;
    metric_type: string;
    value: number;
    timestamp: string;
  }>;

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
