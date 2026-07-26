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
  /**
   * `patternMatch.summary`, or null when no rule fired. Kept as a plain string
   * for existing consumers; prefer `patternMatch` for anything that wants to
   * show which rule fired and on what numbers.
   */
  pattern: string | null;
  /** The deterministic rule that fired, with the values that triggered it. */
  patternMatch: MetricPatternMatch | null;
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

/** z-score a metric must exceed for the deviation rules below to count it. */
export const PATTERN_Z_SCORE_THRESHOLD = 2;

/** Stable ids for the deterministic deviation rules in `identifyPattern`. */
export type MetricPatternId =
  | 'cpu-and-memory-deviation'
  | 'memory-only-deviation'
  | 'cpu-only-deviation';

export interface PatternMetricObservation {
  type: string;
  zScore: number;
}

/**
 * The outcome of `identifyPattern` — which rule fired, on which metrics, and at
 * what threshold.
 *
 * This used to be a single hardcoded English sentence per branch ("…suggesting
 * gradual memory accumulation"), which read as a diagnosis the code had not
 * made and rendered byte-identically on every card that hit the same branch.
 * The classification is worth keeping; the prose was not. `summary` now
 * restates the rule with the measured z-scores so the operator can see the
 * arithmetic, and `id` / `triggeredBy` / `zScoreThreshold` let the UI render the
 * rule itself instead of a sentence.
 */
export interface MetricPatternMatch {
  id: MetricPatternId;
  /** Names what was observed, not what caused it. */
  label: string;
  /** The z-score each `triggeredBy` metric had to exceed. */
  zScoreThreshold: number;
  /** Metrics that crossed the threshold. */
  triggeredBy: PatternMetricObservation[];
  /** Metrics the rule inspected that stayed within the threshold. */
  withinThreshold: PatternMetricObservation[];
  /** Restatement of the rule and the numbers it fired on. Not an inference. */
  summary: string;
}

function formatObservation(m: PatternMetricObservation): string {
  return `${m.type} z=${m.zScore.toFixed(2)}`;
}

function formatObservations(metrics: PatternMetricObservation[]): string {
  return metrics.map(formatObservation).join(', ');
}

/**
 * Classify a container's elevated metrics against three fixed deviation rules.
 *
 * Deterministic: a metric counts as deviating when its z-score exceeds
 * `PATTERN_Z_SCORE_THRESHOLD`. Nothing is inferred about the cause. Returns
 * null when no rule matches.
 */
export function identifyPattern(
  metrics: Array<{ type: string; zScore: number }>,
): MetricPatternMatch | null {
  const cpuMetric = metrics.find((m) => m.type === 'cpu');
  const memMetric = metrics.find((m) => m.type === 'memory');
  const memBytesMetric = metrics.find((m) => m.type === 'memory_bytes');

  const threshold = PATTERN_Z_SCORE_THRESHOLD;
  const observed = (m?: { type: string; zScore: number }): PatternMetricObservation[] =>
    m ? [{ type: m.type, zScore: m.zScore }] : [];

  const cpuHigh = !!cpuMetric && cpuMetric.zScore > threshold;
  const memHigh = !!memMetric && memMetric.zScore > threshold;
  const memBytesHigh = !!memBytesMetric && memBytesMetric.zScore > threshold;

  const cpuObserved = observed(cpuMetric);
  const memoryObserved = [...observed(memMetric), ...observed(memBytesMetric)];
  const memoryTriggered = [
    ...(memHigh ? observed(memMetric) : []),
    ...(memBytesHigh ? observed(memBytesMetric) : []),
  ];
  const memoryWithin = [
    ...(memMetric && !memHigh ? observed(memMetric) : []),
    ...(memBytesMetric && !memBytesHigh ? observed(memBytesMetric) : []),
  ];

  // Both CPU and memory deviate.
  if (cpuHigh && (memHigh || memBytesHigh)) {
    const triggeredBy = [...cpuObserved, ...memoryTriggered];
    return {
      id: 'cpu-and-memory-deviation',
      label: 'CPU and memory both deviating',
      zScoreThreshold: threshold,
      triggeredBy,
      withinThreshold: memoryWithin,
      summary: `${formatObservations(triggeredBy)} — both above the z>${threshold} rule threshold`,
    };
  }

  // Memory deviates, CPU stays within the threshold.
  if (!cpuHigh && (memHigh || memBytesHigh)) {
    return {
      id: 'memory-only-deviation',
      label: 'Memory deviating, CPU within threshold',
      zScoreThreshold: threshold,
      triggeredBy: memoryTriggered,
      withinThreshold: [...cpuObserved, ...memoryWithin],
      summary: `${formatObservations(memoryTriggered)} above the z>${threshold} rule threshold`
        + (cpuMetric ? `, ${formatObservation(cpuObserved[0])} within it` : ', no CPU sample this window'),
    };
  }

  // CPU deviates, memory stays within the threshold.
  if (cpuHigh && !memHigh && !memBytesHigh) {
    return {
      id: 'cpu-only-deviation',
      label: 'CPU deviating, memory within threshold',
      zScoreThreshold: threshold,
      triggeredBy: cpuObserved,
      withinThreshold: memoryObserved,
      summary: `${formatObservation(cpuObserved[0])} above the z>${threshold} rule threshold`
        + (memoryObserved.length > 0
          ? `, ${formatObservations(memoryObserved)} within it`
          : ', no memory sample this window'),
    };
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

    const patternMatch = identifyPattern(metricDetails);
    const severity = scoreSeverity(compositeScore);

    results.push({
      containerId,
      containerName,
      metrics: metricDetails,
      compositeScore,
      pattern: patternMatch?.summary ?? null,
      patternMatch,
      severity,
      timestamp: new Date().toISOString(),
    });
  }

  return results.sort((a, b) => b.compositeScore - a.compositeScore);
}

// Suppress unused variable warning for log
void log;
