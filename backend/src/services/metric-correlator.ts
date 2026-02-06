import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('metric-correlator');

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
function getMetricSnapshots(containerId: string, windowSize: number): MetricSnapshot[] {
  const db = getDb();

  const metricTypes = db.prepare(`
    SELECT DISTINCT metric_type FROM metrics
    WHERE container_id = ? AND timestamp >= datetime('now', '-1 hour')
  `).all(containerId) as Array<{ metric_type: string }>;

  const snapshots: MetricSnapshot[] = [];

  for (const { metric_type } of metricTypes) {
    const stats = db.prepare(`
      SELECT
        AVG(value) as mean,
        COUNT(*) as sample_count
      FROM (
        SELECT value FROM metrics
        WHERE container_id = ? AND metric_type = ?
        ORDER BY timestamp DESC
        LIMIT ?
      )
    `).get(containerId, metric_type, windowSize) as { mean: number | null; sample_count: number } | undefined;

    if (!stats || stats.sample_count < 5 || stats.mean === null) continue;

    const stdResult = db.prepare(`
      SELECT AVG((value - ?) * (value - ?)) as variance
      FROM (
        SELECT value FROM metrics
        WHERE container_id = ? AND metric_type = ?
        ORDER BY timestamp DESC
        LIMIT ?
      )
    `).get(stats.mean, stats.mean, containerId, metric_type, windowSize) as { variance: number | null } | undefined;

    const stdDev = Math.sqrt(Math.max(0, stdResult?.variance ?? 0));

    // Get latest value
    const latest = db.prepare(`
      SELECT value FROM metrics
      WHERE container_id = ? AND metric_type = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(containerId, metric_type) as { value: number } | undefined;

    if (!latest) continue;

    const zScore = stdDev > 0 ? (latest.value - stats.mean) / stdDev : 0;

    snapshots.push({
      metric_type,
      value: latest.value,
      mean: stats.mean,
      std_dev: stdDev,
      z_score: Math.round(zScore * 100) / 100,
    });
  }

  return snapshots;
}

/**
 * Detect correlated anomalies across multiple metrics for all active containers.
 */
export function detectCorrelatedAnomalies(
  windowSize: number = 30,
  minCompositeScore: number = 2,
): CorrelatedAnomaly[] {
  const db = getDb();

  // Get containers with recent metrics
  const containers = db.prepare(`
    SELECT DISTINCT container_id, container_name
    FROM metrics
    WHERE timestamp >= datetime('now', '-1 hour')
    GROUP BY container_id
    HAVING COUNT(DISTINCT metric_type) >= 2
  `).all() as Array<{ container_id: string; container_name: string }>;

  const results: CorrelatedAnomaly[] = [];

  for (const container of containers) {
    const snapshots = getMetricSnapshots(container.container_id, windowSize);

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
