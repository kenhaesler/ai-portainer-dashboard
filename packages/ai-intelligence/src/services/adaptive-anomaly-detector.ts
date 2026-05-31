import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import type { AnomalyDetection } from '@dashboard/core/models/metrics.js';
import type { MovingAverageResult } from '@dashboard/contracts';
import {
  resolveBaseline,
  type GetMovingAverageByHourOfDayFn,
  type GetMovingAverageFn,
} from './anomaly-detector.js';
import {
  classifyCv,
  cvThresholdMultiplier,
  exceedsThreshold,
  medianAndMad,
  modifiedZScore,
} from './anomaly-stats.js';

const log = createChildLogger('adaptive-anomaly');

export type DetectionMethod = 'zscore' | 'bollinger' | 'adaptive' | 'isolation-forest' | 'robust-mad';

/** Fetches the raw trailing window (newest-first, excludes the point under test). */
export type GetMetricWindowFn = (
  containerId: string,
  metricType: string,
  windowSize: number,
) => Promise<number[]>;

/** Fetches the raw hour-of-day window (newest-first, excludes the point under test). */
export type GetMetricWindowByHourOfDayFn = (
  containerId: string,
  metricType: string,
  hourOfDay: number,
  lookbackDays: number,
  dayOfWeek?: number,
) => Promise<number[]>;

interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
}

/**
 * Calculate Bollinger Bands for a given mean and standard deviation.
 * multiplier controls how many standard deviations for the bands (default 2).
 */
export function calculateBollingerBands(
  mean: number,
  stdDev: number,
  multiplier: number = 2,
): BollingerBands {
  const upper = mean + multiplier * stdDev;
  const lower = mean - multiplier * stdDev;
  return {
    upper,
    middle: mean,
    lower: Math.max(0, lower), // Can't go below 0 for resource metrics
    bandwidth: stdDev > 0 ? (upper - lower) / mean : 0,
  };
}

/**
 * Adaptive detection that selects the best method based on data characteristics.
 * - Low variance → use Bollinger bands (more sensitive to outliers)
 * - High variance → use wider z-score threshold (avoid false positives)
 * - Hour-of-day baseline (issue #1295 — fix 3): when `getMovingAverageByHourOfDay`
 *   is supplied and the current hour-of-day bucket has enough samples, the
 *   baseline distribution comes from that bucket rather than the flat
 *   rolling-window. Warm-up falls back to the legacy flat baseline.
 *
 * @param getMovingAverage - injected dependency to avoid @dashboard/observability import
 * @param getMovingAverageByHourOfDay - optional hour-of-day baseline fetcher
 * @param now - optional clock injection (test-only). Defaults to `new Date()`.
 */
export async function detectAnomalyAdaptive(
  containerId: string,
  containerName: string,
  metricType: string,
  currentValue: number,
  method?: DetectionMethod,
  getMovingAverage?: GetMovingAverageFn,
  getMovingAverageByHourOfDay?: GetMovingAverageByHourOfDayFn,
  now: Date = new Date(),
): Promise<AnomalyDetection | null> {
  const config = getConfig();
  const direction = config.ANOMALY_DETECTION_DIRECTION;
  const windowSize = config.ANOMALY_MOVING_AVERAGE_WINDOW;
  const minSamples = config.ANOMALY_MIN_SAMPLES;
  const lookbackDays = config.ANOMALY_HOUROFDAY_LOOKBACK_DAYS;
  const minHourSamples = config.ANOMALY_HOUROFDAY_MIN_SAMPLES;

  if (!getMovingAverage) {
    log.debug({ containerId, metricType }, 'No getMovingAverage provided, skipping adaptive detection');
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
      { containerId, metricType, sampleCount: stats?.sample_count ?? 0 },
      'Insufficient samples for adaptive detection',
    );
    return null;
  }

  // Determine detection method
  const selectedMethod = resolveDetectionMethod(
    method ?? selectMethod(stats.mean, stats.std_dev, stats.sample_count),
    config.BOLLINGER_BANDS_ENABLED !== false,
  );

  let isAnomalous: boolean;
  let threshold: number;
  let zScore: number;

  if (selectedMethod === 'bollinger') {
    // Bollinger bands: flag values outside the bands, honouring the configured
    // direction (#1361 fix 3) — 'spike' only flags above the upper band.
    const bands = calculateBollingerBands(stats.mean, stats.std_dev, 2);
    const aboveUpper = currentValue > bands.upper;
    const belowLower = currentValue < bands.lower;
    isAnomalous =
      direction === 'spike' ? aboveUpper
      : direction === 'drop' ? belowLower
      : aboveUpper || belowLower;
    threshold = 2; // band multiplier
    zScore = stats.std_dev > 0 ? (currentValue - stats.mean) / stats.std_dev : 0;
  } else if (selectedMethod === 'adaptive') {
    // Adaptive (issue #1295 — fix 2): scale the threshold by the coefficient
    // of variation of the baseline window. Low / Medium / High CV regimes
    // map to 1.0× / 1.2× / 1.5× multipliers respectively. Naturally noisy
    // services therefore stop tripping the detector when they wobble inside
    // their normal envelope.
    const regime = classifyCv(stats.mean, stats.std_dev);
    const adaptiveThreshold = config.ANOMALY_ZSCORE_THRESHOLD * cvThresholdMultiplier(regime);

    zScore = stats.std_dev > 0 ? (currentValue - stats.mean) / stats.std_dev : 0;
    isAnomalous = exceedsThreshold(zScore, adaptiveThreshold, direction);
    threshold = adaptiveThreshold;
  } else {
    // Standard z-score
    threshold = config.ANOMALY_ZSCORE_THRESHOLD;
    zScore = stats.std_dev > 0 ? (currentValue - stats.mean) / stats.std_dev : 0;
    isAnomalous = exceedsThreshold(zScore, threshold, direction);
  }

  // Handle zero std_dev
  if (stats.std_dev === 0) {
    const absMean = Math.abs(stats.mean);
    // Use a percentage-based tolerance for stable workloads to avoid tiny-value false positives.
    const tolerance = absMean > 0
      ? Math.max(absMean * 0.1, 0.01)
      : 0.01;
    const delta = currentValue - stats.mean;
    isAnomalous = exceedsThreshold(delta, tolerance, direction);
    zScore = isAnomalous ? delta / tolerance : 0;
  }

  if (isAnomalous) {
    log.warn(
      { containerId, metricType, method: selectedMethod, currentValue, mean: stats.mean, zScore, threshold, usedHourOfDay },
      'Anomaly detected (adaptive)',
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
    method: selectedMethod,
  };
}

/**
 * Robust median+MAD detection (#1362). Uses the modified z-score
 * (Iglewicz–Hoaglin) over the RAW trailing window so outliers in the baseline
 * neither mask a real anomaly nor poison the band — unlike the mean/std
 * detectors. One-sided by default (`ANOMALY_DETECTION_DIRECTION`).
 *
 * Baseline (#1362 review): prefer the hour-of-day window so robust detection
 * keeps #1295's seasonality handling — a diurnal ramp is compared against the
 * same hour historically, not flagged as a deviation. Falls back to the flat
 * trailing window during warm-up or when no hour-of-day fetcher is injected.
 * Both windows already exclude the point under test (#1361 fix 2).
 */
export async function detectAnomalyRobust(
  containerId: string,
  containerName: string,
  metricType: string,
  currentValue: number,
  getMetricWindow: GetMetricWindowFn,
  getMetricWindowByHourOfDay?: GetMetricWindowByHourOfDayFn,
  now: Date = new Date(),
): Promise<AnomalyDetection | null> {
  const config = getConfig();
  const threshold = config.ANOMALY_ZSCORE_THRESHOLD;
  const direction = config.ANOMALY_DETECTION_DIRECTION;
  const windowSize = config.ANOMALY_MOVING_AVERAGE_WINDOW;
  const minSamples = config.ANOMALY_MIN_SAMPLES;
  const lookbackDays = config.ANOMALY_HOUROFDAY_LOOKBACK_DAYS;
  const minHourSamples = config.ANOMALY_HOUROFDAY_MIN_SAMPLES;

  let window: number[] = [];
  // Seasonal preference: day-of-week × hour (#1307) → hour-of-day (#1295) →
  // flat. Each level keeps RAW samples (median+MAD needs them) and excludes the
  // point under test; we fall through when a bucket is below its warm-up floor.
  let baselineKind: 'flat' | 'hourOfDay' | 'dayOfWeek' = 'flat';
  if (getMetricWindowByHourOfDay) {
    if (config.ANOMALY_DAYOFWEEK_ENABLED) {
      const dow = await getMetricWindowByHourOfDay(
        containerId,
        metricType,
        now.getUTCHours(),
        config.ANOMALY_DAYOFWEEK_LOOKBACK_DAYS,
        now.getUTCDay(),
      );
      if (dow.length >= config.ANOMALY_DAYOFWEEK_MIN_SAMPLES) {
        window = dow;
        baselineKind = 'dayOfWeek';
      }
    }
    if (baselineKind === 'flat') {
      const hourly = await getMetricWindowByHourOfDay(
        containerId,
        metricType,
        now.getUTCHours(),
        lookbackDays,
      );
      if (hourly.length >= minHourSamples) {
        window = hourly;
        baselineKind = 'hourOfDay';
      }
    }
  }
  const usedHourOfDay = baselineKind !== 'flat';
  if (!usedHourOfDay) {
    window = await getMetricWindow(containerId, metricType, windowSize);
  }

  if (window.length < minSamples) {
    log.debug(
      { containerId, metricType, sampleCount: window.length, minSamples, usedHourOfDay },
      'Insufficient samples for robust detection',
    );
    return null;
  }

  const { median, mad } = medianAndMad(window);

  let zScore: number;
  let isAnomalous: boolean;
  if (mad === 0) {
    // Perfectly stable baseline → modified z is undefined. Use a relative
    // tolerance (mirrors the std === 0 path in the other detectors).
    const tolerance = Math.max(Math.abs(median) * 0.1, 0.01);
    const delta = currentValue - median;
    isAnomalous = exceedsThreshold(delta, tolerance, direction);
    zScore = isAnomalous ? delta / tolerance : 0;
  } else {
    zScore = modifiedZScore(currentValue, median, mad);
    isAnomalous = exceedsThreshold(zScore, threshold, direction);
  }

  if (isAnomalous) {
    log.warn(
      { containerId, metricType, currentValue, median, mad, zScore, threshold, usedHourOfDay },
      'Anomaly detected (robust-mad)',
    );
  }

  return {
    container_id: containerId,
    container_name: containerName,
    metric_type: metricType,
    current_value: currentValue,
    mean: median, // robust center (median)
    std_dev: mad, // robust spread (MAD)
    z_score: Math.round(zScore * 100) / 100,
    is_anomalous: isAnomalous,
    threshold,
    timestamp: now.toISOString(),
    method: 'robust-mad',
  };
}

/**
 * Select the best detection method based on data characteristics.
 */
function selectMethod(mean: number, stdDev: number, sampleCount: number): DetectionMethod {
  if (sampleCount < 20) return 'zscore'; // Not enough data for adaptive

  const cv = mean > 0 ? stdDev / mean : 0;

  // Low variance → bollinger bands are more sensitive
  if (cv < 0.1) return 'bollinger';

  // High variance → adaptive scaling
  if (cv > 0.3) return 'adaptive';

  // Medium → standard z-score works well
  return 'zscore';
}

export interface BatchDetectionItem {
  containerId: string;
  containerName: string;
  metricType: string;
  currentValue: number;
}

/**
 * Batch anomaly detection: runs detectAnomalyAdaptive for each item concurrently
 * using Promise.allSettled. Returns a Map keyed by `containerId:metricType`.
 *
 * @param getMovingAverage - injected dependency to avoid @dashboard/observability import
 * @param getMovingAverageByHourOfDay - optional hour-of-day baseline fetcher
 *   (issue #1295 — fix 3)
 */
export async function detectAnomaliesBatch(
  items: BatchDetectionItem[],
  method?: DetectionMethod,
  getMovingAverage?: GetMovingAverageFn,
  getMovingAverageByHourOfDay?: GetMovingAverageByHourOfDayFn,
  getMetricWindow?: GetMetricWindowFn,
  getMetricWindowByHourOfDay?: GetMetricWindowByHourOfDayFn,
): Promise<Map<string, AnomalyDetection>> {
  const results = new Map<string, AnomalyDetection>();
  if (items.length === 0) return results;

  // Robust median+MAD (#1362) requires the raw window. If 'robust-mad' is
  // selected but no window fetcher was injected, fall back to 'adaptive'
  // (mean/std) rather than mislabelling a z-score result as robust-mad.
  const robust = method === 'robust-mad' && !!getMetricWindow;
  const fallbackMethod: DetectionMethod | undefined =
    method === 'robust-mad' ? 'adaptive' : method;

  const settled = await Promise.allSettled(
    items.map(async (item) => {
      const detection = robust
        ? await detectAnomalyRobust(
            item.containerId,
            item.containerName,
            item.metricType,
            item.currentValue,
            getMetricWindow!,
            getMetricWindowByHourOfDay,
          )
        : await detectAnomalyAdaptive(
            item.containerId,
            item.containerName,
            item.metricType,
            item.currentValue,
            fallbackMethod,
            getMovingAverage,
            getMovingAverageByHourOfDay,
          );
      return { key: `${item.containerId}:${item.metricType}`, detection };
    }),
  );

  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.detection) {
      results.set(result.value.key, result.value.detection);
    } else if (result.status === 'rejected') {
      log.warn({ err: result.reason }, 'Batch anomaly detection item failed');
    }
  }

  return results;
}

function resolveDetectionMethod(
  requestedMethod: DetectionMethod,
  bollingerEnabled: boolean,
): DetectionMethod {
  if (requestedMethod === 'bollinger' && !bollingerEnabled) {
    return 'zscore';
  }
  return requestedMethod;
}

// Re-export the contract type so consumers don't need a second import.
export type { MovingAverageResult };
