import { getMetricsDb } from '@dashboard/core/db/timescale.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('metric-correlator');

/** Minimal query interface satisfied by both pg.Pool and pg.PoolClient. */
export interface Queryable {
  query: <T = any>(...args: any[]) => Promise<{ rows: T[] }>;
}

export interface CorrelatedAnomaly {
  containerId: string;
  containerName: string;
  metrics: Array<{
    type: string;
    currentValue: number;
    mean: number;
    zScore: number;
  }>;
  compositeScore: number;
  pattern: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
}

interface MetricSnapshot {
  metric_type: string;
  value: number;
  mean: number;
  std_dev: number;
  z_score: number;
}

/**
 * Pearson correlation coefficient between two arrays.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3 || n !== y.length) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const denom = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
  );

  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Calculate composite anomaly score from multiple metric z-scores.
 * Uses a weighted combination where higher z-scores contribute more.
 */
export function calculateCompositeScore(zScores: number[]): number {
  if (zScores.length === 0) return 0;

  // Root mean square of z-scores gives more weight to larger deviations
  const rms = Math.sqrt(
    zScores.reduce((sum, z) => sum + z * z, 0) / zScores.length,
  );

  return Math.round(rms * 100) / 100;
}

/**
 * Identify known patterns from correlated metric anomalies.
 */
export function identifyPattern(
  metrics: Array<{ type: string; zScore: number }>,
): string | null {
  const cpuMetric = metrics.find((m) => m.type === 'cpu');
  const memMetric = metrics.find((m) => m.type === 'memory');
  const memBytesMetric = metrics.find((m) => m.type === 'memory_bytes');

  const cpuHigh = cpuMetric && cpuMetric.zScore > 2;
  const memHigh = memMetric && memMetric.zScore > 2;
  const memBytesHigh = memBytesMetric && memBytesMetric.zScore > 2;

  // Both CPU and memory are anomalous
  if (cpuHigh && (memHigh || memBytesHigh)) {
    return 'Resource Exhaustion: Both CPU and memory are elevated, suggesting a resource-intensive workload or memory leak with CPU thrashing';
  }

  // Memory high but CPU normal
  if (!cpuHigh && (memHigh || memBytesHigh)) {
    return 'Memory Leak Suspected: Memory usage is elevated while CPU remains normal, suggesting gradual memory accumulation';
  }

  // CPU high but memory normal
  if (cpuHigh && !memHigh && !memBytesHigh) {
    return 'CPU Spike: CPU usage is elevated while memory remains stable, suggesting a compute-intensive operation or busy loop';
  }

  return null;
}

/**
 * Determine severity from composite score.
 */
export function scoreSeverity(compositeScore: number): 'low' | 'medium' | 'high' | 'critical' {
  if (compositeScore >= 5) return 'critical';
  if (compositeScore >= 3.5) return 'high';
  if (compositeScore >= 2) return 'medium';
  return 'low';
}

interface ContainerSnapshots {
  containerName: string;
  snapshots: MetricSnapshot[];
}

/**
 * Compute recent metric snapshots (mean / stddev / latest value → z-score) for
 * the whole fleet in a single set-based query.
 *
 * Replaces the former per-container N+1 (one DISTINCT + two queries per metric
 * type, looped sequentially — ~11 round-trips per container). A CTE narrows to
 * containers with >=2 distinct metric types in the last hour, then a LATERAL
 * subquery computes AVG / STDDEV_POP / COUNT plus the latest value over each
 * (container, metric_type)'s last `windowSize` samples. The inner
 * `ORDER BY timestamp DESC LIMIT windowSize` is index-served by
 * idx_metrics_composite (container_id, metric_type, timestamp DESC), so the
 * per-partition scan stays bounded exactly as the old LIMIT query was.
 *
 * Semantics match the old getMetricSnapshots: the stats window is the last
 * `windowSize` samples regardless of age (no extra time bound), the latest
 * value is the most recent of those, and the same >=5-sample / non-null-mean
 * guard is applied in JS below.
 */
async function getAllMetricSnapshots(windowSize: number, db: Queryable): Promise<Map<string, ContainerSnapshots>> {
  const { rows } = await db.query<{
    container_id: string;
    container_name: string;
    metric_type: string;
    mean: number | null;
    std_dev: number | null;
    sample_count: number;
    latest_value: number | null;
  }>(
    `WITH recent_containers AS (
       SELECT container_id
       FROM metrics
       WHERE timestamp >= NOW() - INTERVAL '1 hour'
       GROUP BY container_id
       HAVING COUNT(DISTINCT metric_type) >= 2
     ),
     container_metric_types AS (
       SELECT DISTINCT m.container_id, m.metric_type
       FROM metrics m
       JOIN recent_containers rc ON rc.container_id = m.container_id
       WHERE m.timestamp >= NOW() - INTERVAL '1 hour'
     )
     SELECT
       cmt.container_id,
       s.container_name,
       cmt.metric_type,
       s.mean,
       s.std_dev,
       s.sample_count,
       s.latest_value
     FROM container_metric_types cmt
     CROSS JOIN LATERAL (
       SELECT
         AVG(value) AS mean,
         STDDEV_POP(value) AS std_dev,
         COUNT(*)::int AS sample_count,
         (ARRAY_AGG(value ORDER BY timestamp DESC))[1] AS latest_value,
         (ARRAY_AGG(container_name ORDER BY timestamp DESC))[1] AS container_name
       FROM (
         SELECT value, container_name, timestamp
         FROM metrics
         WHERE container_id = cmt.container_id AND metric_type = cmt.metric_type
         ORDER BY timestamp DESC
         LIMIT $1
       ) recent
     ) s`,
    [windowSize],
  );

  const byContainer = new Map<string, ContainerSnapshots>();

  for (const row of rows) {
    // Same guard as the old per-metric path: need >=5 samples and a real mean.
    if (!row.sample_count || row.sample_count < 5 || row.mean === null) continue;
    if (row.latest_value === null || row.latest_value === undefined) continue;

    const mean = Number(row.mean);
    const stdDev = Number(row.std_dev ?? 0);
    const latest = Number(row.latest_value);
    const zScore = stdDev > 0 ? (latest - mean) / stdDev : 0;

    let entry = byContainer.get(row.container_id);
    if (!entry) {
      entry = { containerName: row.container_name, snapshots: [] };
      byContainer.set(row.container_id, entry);
    }

    entry.snapshots.push({
      metric_type: row.metric_type,
      value: latest,
      mean,
      std_dev: stdDev,
      z_score: Math.round(zScore * 100) / 100,
    });
  }

  return byContainer;
}

// ---------------------------------------------------------------------------
// Cross-container correlation
// ---------------------------------------------------------------------------

export interface CorrelationPair {
  containerA: { id: string; name: string };
  containerB: { id: string; name: string };
  metricType: string;
  correlation: number;          // Pearson r (-1 … 1)
  strength: 'very_strong' | 'strong';
  direction: 'positive' | 'negative';
  sampleCount: number;
}

/**
 * Classify the strength label for a |correlation| value.
 */
export function correlationStrength(absR: number): 'very_strong' | 'strong' | 'moderate' | 'weak' {
  if (absR >= 0.9) return 'very_strong';
  if (absR >= 0.7) return 'strong';
  if (absR >= 0.4) return 'moderate';
  return 'weak';
}

/**
 * Find strongly correlated container pairs across the fleet.
 *
 * For each metric type (cpu, memory) this function:
 * 1. Reads 5-minute-bucketed averages per container from the metrics_5min
 *    continuous aggregate over the given time range
 * 2. Aligns timestamps between every container pair
 * 3. Computes Pearson correlation and retains pairs with |r| >= minCorrelation
 *
 * To keep the O(n²) manageable we limit to the top 50 most-active containers
 * and only process cpu / memory metric types.
 *
 * The bucketed averages are served straight from the metrics_5min continuous
 * aggregate rather than re-aggregating time_bucket()/AVG() off the raw metrics
 * hypertable on every request — the aggregate already materialises exactly
 * (bucket, container_id, container_name, avg_value), matching how rollups are
 * read elsewhere (selectRollupTable). Only the trailing ~1 minute (the
 * aggregate's refresh end_offset) is not yet materialised, which is immaterial
 * over a multi-hour correlation window.
 */
export async function findCorrelatedContainers(
  hours: number = 24,
  minCorrelation: number = 0.7,
  db?: Queryable,
): Promise<CorrelationPair[]> {
  if (!db) db = await getMetricsDb();

  const metricTypes = ['cpu', 'memory'];
  const results: CorrelationPair[] = [];

  for (const metricType of metricTypes) {
    // Read pre-bucketed 5-min averages for all containers from the aggregate
    const { rows } = await db.query<{
      container_id: string;
      container_name: string;
      bucket: string;
      avg_value: number;
    }>(
      `SELECT container_id, container_name, bucket, avg_value
       FROM metrics_5min
       WHERE metric_type = $1
         AND bucket >= NOW() - make_interval(hours => $2)
       ORDER BY container_id, bucket`,
      [metricType, hours],
    );

    // Group by container
    const byContainer = new Map<string, { name: string; series: Map<string, number> }>();
    for (const row of rows) {
      let entry = byContainer.get(row.container_id);
      if (!entry) {
        entry = { name: row.container_name, series: new Map() };
        byContainer.set(row.container_id, entry);
      }
      entry.series.set(String(row.bucket), Number(row.avg_value));
    }

    // Keep only the top 50 containers by sample count
    const containerIds = [...byContainer.entries()]
      .sort((a, b) => b[1].series.size - a[1].series.size)
      .slice(0, 50)
      .map(([id]) => id);

    // Pairwise correlation
    for (let i = 0; i < containerIds.length; i++) {
      const aId = containerIds[i];
      const aEntry = byContainer.get(aId)!;
      for (let j = i + 1; j < containerIds.length; j++) {
        const bId = containerIds[j];
        const bEntry = byContainer.get(bId)!;

        // Align on shared timestamps
        const xVals: number[] = [];
        const yVals: number[] = [];
        for (const [ts, val] of aEntry.series) {
          const bVal = bEntry.series.get(ts);
          if (bVal !== undefined) {
            xVals.push(val);
            yVals.push(bVal);
          }
        }

        if (xVals.length < 5) continue;

        const r = pearsonCorrelation(xVals, yVals);
        const absR = Math.abs(r);
        if (absR < minCorrelation) continue;

        const strength = correlationStrength(absR);
        if (strength !== 'very_strong' && strength !== 'strong') continue;

        results.push({
          containerA: { id: aId, name: aEntry.name },
          containerB: { id: bId, name: bEntry.name },
          metricType,
          correlation: Math.round(r * 1000) / 1000,
          strength,
          direction: r > 0 ? 'positive' : 'negative',
          sampleCount: xVals.length,
        });
      }
    }
  }

  // Sort by absolute correlation descending
  return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

// ---------------------------------------------------------------------------
// Correlated anomaly detection (within-container)
// ---------------------------------------------------------------------------

/**
 * Detect correlated anomalies across multiple metrics for all active containers.
 */
export async function detectCorrelatedAnomalies(
  windowSize: number = 30,
  minCompositeScore: number = 2,
  db?: Queryable,
): Promise<CorrelatedAnomaly[]> {
  if (!db) db = await getMetricsDb();

  // Single set-based fetch for the whole fleet, replacing the former
  // per-container N+1 loop (~11 sequential round-trips per container).
  const snapshotsByContainer = await getAllMetricSnapshots(windowSize, db);

  const results: CorrelatedAnomaly[] = [];

  for (const [containerId, { containerName, snapshots }] of snapshotsByContainer) {
    if (snapshots.length < 2) continue;

    // Only include metrics with elevated z-scores
    const elevatedMetrics = snapshots.filter((s) => Math.abs(s.z_score) > 1);

    if (elevatedMetrics.length === 0) continue;

    const zScores = elevatedMetrics.map((s) => Math.abs(s.z_score));
    const compositeScore = calculateCompositeScore(zScores);

    if (compositeScore < minCompositeScore) continue;

    const metricDetails = elevatedMetrics.map((s) => ({
      type: s.metric_type,
      currentValue: s.value,
      mean: s.mean,
      zScore: s.z_score,
    }));

    const pattern = identifyPattern(metricDetails);
    const severity = scoreSeverity(compositeScore);

    results.push({
      containerId,
      containerName,
      metrics: metricDetails,
      compositeScore,
      pattern,
      severity,
      timestamp: new Date().toISOString(),
    });
  }

  return results.sort((a, b) => b.compositeScore - a.compositeScore);
}

// Suppress unused variable warning for log
void log;
