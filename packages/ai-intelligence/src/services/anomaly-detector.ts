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
  dayOfWeek?: number,
) => Promise<MovingAverageResult | null>;

/** Which seasonal bucket the baseline was drawn from (finest that had data). */
export type BaselineKind = 'flat' | 'hourOfDay' | 'dayOfWeek';

/**
 * Resolve the baseline distribution for the current seasonal bucket, trying the
 * finest bucket first and falling back when it is unavailable or too sparse:
 *
 *   1. day-of-week × hour-of-day (#1307) — when enabled and warm,
 *   2. hour-of-day (#1295) — when warm,
 *   3. flat rolling window — the historical behavior.
 *
 * Each fallback preserves older callers' semantics until the finer bucket warms
 * up. Exported so the trace detector and tests reuse the same policy.
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
  /** Day-of-week layer (#1307). When dayOfWeekEnabled, tried before hour-of-day. */
  dayOfWeek?: number;
  dayOfWeekEnabled?: boolean;
  dayOfWeekLookbackDays?: number;
  dayOfWeekMinSamples?: number;
}): Promise<{ stats: MovingAverageResult | null; usedHourOfDay: boolean; baselineKind: BaselineKind }> {
  if (opts.getMovingAverageByHourOfDay) {
    // 1. day-of-week × hour-of-day
    if (opts.dayOfWeekEnabled && Number.isInteger(opts.dayOfWeek)) {
      const dow = await opts.getMovingAverageByHourOfDay(
        opts.containerId,
        opts.metricType,
        opts.hourOfDay,
        opts.dayOfWeekLookbackDays ?? opts.lookbackDays,
        opts.dayOfWeek,
      );
      if (dow && dow.sample_count >= (opts.dayOfWeekMinSamples ?? opts.minHourSamples)) {
        return { stats: dow, usedHourOfDay: true, baselineKind: 'dayOfWeek' };
      }
    }
    // 2. hour-of-day
    const hourly = await opts.getMovingAverageByHourOfDay(
      opts.containerId,
      opts.metricType,
      opts.hourOfDay,
      opts.lookbackDays,
    );
    if (hourly && hourly.sample_count >= opts.minHourSamples) {
      return { stats: hourly, usedHourOfDay: true, baselineKind: 'hourOfDay' };
    }
  }
  // 3. flat
  const flat = await opts.getMovingAverage(
    opts.containerId,
    opts.metricType,
    opts.windowSize,
  );
  return { stats: flat, usedHourOfDay: false, baselineKind: 'flat' };
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
    dayOfWeek: now.getUTCDay(),
    dayOfWeekEnabled: config.ANOMALY_DAYOFWEEK_ENABLED,
    dayOfWeekLookbackDays: config.ANOMALY_DAYOFWEEK_LOOKBACK_DAYS,
    dayOfWeekMinSamples: config.ANOMALY_DAYOFWEEK_MIN_SAMPLES,
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
