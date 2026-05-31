import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import type { AnomalyDetection } from '@dashboard/core/models/metrics.js';
import type { MovingAverageResult } from '@dashboard/contracts';
import { exceedsThreshold } from './anomaly-stats.js';

const log = createChildLogger('anomaly-detector');

export type GetMovingAverageFn = (
  containerId: string,
  metricType: string,
  windowSize: number,
) => Promise<MovingAverageResult | null>;

export type GetMovingAverageByHourOfDayFn = (
  containerId: string,
  metricType: string,
  hourOfDay: number,
  lookbackDays: number,
) => Promise<MovingAverageResult | null>;

/**
 * Resolve the baseline distribution for the current hour-of-day, falling back
 * to the flat rolling-window baseline when:
 *   • no hour-of-day fetcher was injected, or
 *   • the hour-of-day bucket has fewer than `minHourSamples` samples
 *     (warm-up window — issue #1295).
 *
 * The fallback is the historical (flat 24h) behavior, so existing callers
 * preserve their semantics until the hour bucket warms up.
 *
 * Exported so that the trace detector and tests can reuse the same warm-up
 * policy.
 */
export async function resolveBaseline(opts: {
  containerId: string;
  metricType: string;
  windowSize: number;
  /** UTC hour, 0..23. Pass the hour of the sample being evaluated. */
  hourOfDay: number;
  lookbackDays: number;
  minHourSamples: number;
  getMovingAverage: GetMovingAverageFn;
  getMovingAverageByHourOfDay?: GetMovingAverageByHourOfDayFn;
}): Promise<{ stats: MovingAverageResult | null; usedHourOfDay: boolean }> {
  if (opts.getMovingAverageByHourOfDay) {
    const hourly = await opts.getMovingAverageByHourOfDay(
      opts.containerId,
      opts.metricType,
      opts.hourOfDay,
      opts.lookbackDays,
    );
    if (hourly && hourly.sample_count >= opts.minHourSamples) {
      return { stats: hourly, usedHourOfDay: true };
    }
  }
  const flat = await opts.getMovingAverage(
    opts.containerId,
    opts.metricType,
    opts.windowSize,
  );
  return { stats: flat, usedHourOfDay: false };
}

/**
 * @param getMovingAverage - injected dependency to avoid @dashboard/observability import
 * @param getMovingAverageByHourOfDay - optional hour-of-day baseline fetcher.
 *   When supplied AND the hour bucket has enough samples, supersedes the flat
 *   rolling-window baseline (issue #1295 — fix 3, metric path).
 * @param now - optional clock injection (test-only). Defaults to `new Date()`.
 */
export async function detectAnomaly(
  containerId: string,
  containerName: string,
  metricType: string,
  currentValue: number,
  getMovingAverage?: GetMovingAverageFn,
  getMovingAverageByHourOfDay?: GetMovingAverageByHourOfDayFn,
  now: Date = new Date(),
): Promise<AnomalyDetection | null> {
  const config = getConfig();
  const threshold = config.ANOMALY_ZSCORE_THRESHOLD;
  const direction = config.ANOMALY_DETECTION_DIRECTION;
  const windowSize = config.ANOMALY_MOVING_AVERAGE_WINDOW;
  const minSamples = config.ANOMALY_MIN_SAMPLES;
  const lookbackDays = config.ANOMALY_HOUROFDAY_LOOKBACK_DAYS;
  const minHourSamples = config.ANOMALY_HOUROFDAY_MIN_SAMPLES;

  if (!getMovingAverage) {
    log.debug({ containerId, metricType }, 'No getMovingAverage provided, skipping anomaly detection');
    return null;
  }

  const { stats, usedHourOfDay } = await resolveBaseline({
    containerId,
    metricType,
    windowSize,
    hourOfDay: now.getUTCHours(),
    lookbackDays,
    minHourSamples,
    getMovingAverage,
    getMovingAverageByHourOfDay,
  });

  if (!stats || stats.sample_count < minSamples) {
    log.debug(
      { containerId, metricType, sampleCount: stats?.sample_count ?? 0, minSamples },
      'Insufficient samples for anomaly detection',
    );
    return null;
  }

  // Avoid division by zero when standard deviation is zero
  if (stats.std_dev === 0) {
    // If std_dev is 0, all values are the same. Flag only if current differs
    // from mean in the configured direction (#1361 fix 3).
    const delta = currentValue - stats.mean;
    const isAnomalous = exceedsThreshold(delta, 0.001, direction);
    return {
      container_id: containerId,
      container_name: containerName,
      metric_type: metricType,
      current_value: currentValue,
      mean: stats.mean,
      std_dev: 0,
      z_score: isAnomalous ? (delta >= 0 ? Infinity : -Infinity) : 0,
      is_anomalous: isAnomalous,
      threshold,
      timestamp: now.toISOString(),
      method: 'zscore' as const,
    };
  }

  const zScore = (currentValue - stats.mean) / stats.std_dev;
  const isAnomalous = exceedsThreshold(zScore, threshold, direction);

  if (isAnomalous) {
    log.warn(
      { containerId, metricType, currentValue, mean: stats.mean, zScore, threshold, usedHourOfDay },
      'Anomaly detected',
    );
  }

  return {
    container_id: containerId,
    container_name: containerName,
    metric_type: metricType,
    current_value: currentValue,
    mean: stats.mean,
    std_dev: stats.std_dev,
    z_score: Math.round(zScore * 100) / 100,
    is_anomalous: isAnomalous,
    threshold,
    timestamp: now.toISOString(),
    method: 'zscore' as const,
  };
}
