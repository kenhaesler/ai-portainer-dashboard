import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { getMovingAverage } from './metrics-store.js';
import type { AnomalyDetection } from '../models/metrics.js';

const log = createChildLogger('adaptive-anomaly');

export type DetectionMethod = 'zscore' | 'bollinger' | 'adaptive' | 'isolation-forest';

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
 * - Time-of-day aware → adjusts baseline based on hour patterns (future)
 */
export async function detectAnomalyAdaptive(
  containerId: string,
  containerName: string,
  metricType: string,
  currentValue: number,
  method?: DetectionMethod,
): Promise<AnomalyDetection | null> {
  const config = getConfig();
  const windowSize = config.ANOMALY_MOVING_AVERAGE_WINDOW;
  const minSamples = config.ANOMALY_MIN_SAMPLES;

  const stats = await getMovingAverage(containerId, metricType, windowSize);

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
    // Bollinger bands: flag values outside the bands
    const bands = calculateBollingerBands(stats.mean, stats.std_dev, 2);
    isAnomalous = currentValue > bands.upper || currentValue < bands.lower;
    threshold = 2; // band multiplier
    zScore = stats.std_dev > 0 ? (currentValue - stats.mean) / stats.std_dev : 0;
  } else if (selectedMethod === 'adaptive') {
    // Adaptive: use coefficient of variation to scale the threshold
    const cv = stats.mean > 0 ? stats.std_dev / stats.mean : 0;
    // Higher variance → wider threshold to avoid false positives
    const adaptiveThreshold = cv > 0.5
      ? config.ANOMALY_ZSCORE_THRESHOLD * 1.5
      : cv > 0.2
        ? config.ANOMALY_ZSCORE_THRESHOLD
        : config.ANOMALY_ZSCORE_THRESHOLD * 1.2;

    zScore = stats.std_dev > 0 ? (currentValue - stats.mean) / stats.std_dev : 0;
    isAnomalous = Math.abs(zScore) > adaptiveThreshold;
    threshold = adaptiveThreshold;
  } else {
    // Standard z-score
    threshold = config.ANOMALY_ZSCORE_THRESHOLD;
    zScore = stats.std_dev > 0 ? (currentValue - stats.mean) / stats.std_dev : 0;
    isAnomalous = Math.abs(zScore) > threshold;
  }

  // Handle zero std_dev
  if (stats.std_dev === 0) {
    const absMean = Math.abs(stats.mean);
    // Use a percentage-based tolerance for stable workloads to avoid tiny-value false positives.
    const tolerance = absMean > 0
      ? Math.max(absMean * 0.1, 0.01)
      : 0.01;
    const delta = currentValue - stats.mean;
    isAnomalous = Math.abs(delta) > tolerance;
    zScore = isAnomalous ? delta / tolerance : 0;
  }

  if (isAnomalous) {
    log.warn(
      { containerId, metricType, method: selectedMethod, currentValue, mean: stats.mean, zScore, threshold },
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
    timestamp: new Date().toISOString(),
    method: selectedMethod,
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

function resolveDetectionMethod(
  requestedMethod: DetectionMethod,
  bollingerEnabled: boolean,
): DetectionMethod {
  if (requestedMethod === 'bollinger' && !bollingerEnabled) {
    return 'zscore';
  }
  return requestedMethod;
}
