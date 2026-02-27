import { getConfig } from '@dashboard/core/config/index.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import type { AnomalyDetection } from '@dashboard/core/models/metrics.js';
import type { MovingAverageResult } from '@dashboard/contracts';

const log = createChildLogger('anomaly-detector');

/**
 * @param getMovingAverage - injected dependency to avoid @dashboard/observability import
 */
export async function detectAnomaly(
  containerId: string,
  containerName: string,
  metricType: string,
  currentValue: number,
  getMovingAverage?: (containerId: string, metricType: string, windowSize: number) => Promise<MovingAverageResult | null>,
): Promise<AnomalyDetection | null> {
  const config = getConfig();
  const threshold = config.ANOMALY_ZSCORE_THRESHOLD;
  const windowSize = config.ANOMALY_MOVING_AVERAGE_WINDOW;
  const minSamples = config.ANOMALY_MIN_SAMPLES;

  if (!getMovingAverage) {
    log.debug({ containerId, metricType }, 'No getMovingAverage provided, skipping anomaly detection');
    return null;
  }

  const stats = await getMovingAverage(containerId, metricType, windowSize);

  if (!stats || stats.sample_count < minSamples) {
    log.debug(
      { containerId, metricType, sampleCount: stats?.sample_count ?? 0, minSamples },
      'Insufficient samples for anomaly detection',
    );
    return null;
  }

  // Avoid division by zero when standard deviation is zero
  if (stats.std_dev === 0) {
    // If std_dev is 0, all values are the same. Flag only if current differs from mean.
    const isAnomalous = Math.abs(currentValue - stats.mean) > 0.001;
    return {
      container_id: containerId,
      container_name: containerName,
      metric_type: metricType,
      current_value: currentValue,
      mean: stats.mean,
      std_dev: 0,
      z_score: isAnomalous ? Infinity : 0,
      is_anomalous: isAnomalous,
      threshold,
      timestamp: new Date().toISOString(),
      method: 'zscore' as const,
    };
  }

  const zScore = (currentValue - stats.mean) / stats.std_dev;
  const isAnomalous = Math.abs(zScore) > threshold;

  if (isAnomalous) {
    log.warn(
      { containerId, metricType, currentValue, mean: stats.mean, zScore, threshold },
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
    timestamp: new Date().toISOString(),
    method: 'zscore' as const,
  };
}
