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

/**
 * Get recent metric snapshots for a container with z-scores.
 */
async function getMetricSnapshots(containerId: string, windowSize: number, db?: Queryable): Promise<MetricSnapshot[]> {
  if (!db) db = await getMetricsDb();

  const { rows: metricTypes } = await db.query(
    `SELECT DISTINCT metric_type FROM metrics
     WHERE container_id = $1 AND timestamp >= NOW() - INTERVAL '1 hour'`,
    [containerId],
  );

  const snapshots: MetricSnapshot[] = [];

  for (const { metric_type } of metricTypes as Array<{ metric_type: string }>) {
    const { rows: statsRows } = await db.query(
      `SELECT
        AVG(value) as mean,
        STDDEV_POP(value) as std_dev,
        COUNT(*)::int as sample_count
      FROM (
        SELECT value FROM metrics
        WHERE container_id = $1 AND metric_type = $2
        ORDER BY timestamp DESC
        LIMIT $3
      ) sub`,
      [containerId, metric_type, windowSize],
    );

    const stats = statsRows[0];
    if (!stats || stats.sample_count < 5 || stats.mean === null) continue;

    const mean = Number(stats.mean);
    const stdDev = Number(stats.std_dev ?? 0);

    // Get latest value
    const { rows: latestRows } = await db.query(
      `SELECT value FROM metrics
       WHERE container_id = $1 AND metric_type = $2
       ORDER BY timestamp DESC
       LIMIT 1`,
      [containerId, metric_type],
    );

    const latest = latestRows[0];
    if (!latest) continue;

    const zScore = stdDev > 0 ? (latest.value - mean) / stdDev : 0;

    snapshots.push({
      metric_type,
      value: latest.value,
      mean,
      std_dev: stdDev,
      z_score: Math.round(zScore * 100) / 100,
    });
  }

  return snapshots;
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
 * 1. Fetches 5-minute-bucketed averages per container over the given time range
 * 2. Aligns timestamps between every container pair
 * 3. Computes Pearson correlation and retains pairs with |r| >= minCorrelation
 *
 * To keep the O(n²) manageable we limit to the top 50 most-active containers
 * and only process cpu / memory metric types.
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
    // Fetch 5-min bucketed averages for all containers
    const { rows } = await db.query<{
      container_id: string;
      container_name: string;
      bucket: string;
      avg_value: number;
    }>(
      `SELECT container_id, container_name,
              time_bucket('5 minutes', timestamp) AS bucket,
              AVG(value) AS avg_value
       FROM metrics
       WHERE metric_type = $1
         AND timestamp >= NOW() - make_interval(hours => $2)
       GROUP BY container_id, container_name, bucket
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

  // Get containers with recent metrics
  const { rows: containers } = await db.query(
    `SELECT DISTINCT container_id, container_name
     FROM metrics
     WHERE timestamp >= NOW() - INTERVAL '1 hour'
     GROUP BY container_id, container_name
     HAVING COUNT(DISTINCT metric_type) >= 2`,
  );

  const results: CorrelatedAnomaly[] = [];

  for (const container of containers as Array<{ container_id: string; container_name: string }>) {
    const snapshots = await getMetricSnapshots(container.container_id, windowSize, db);

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
      containerId: container.container_id,
      containerName: container.container_name,
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
