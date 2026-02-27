import type { Metric, AnomalyDetection, MovingAverageResult, CapacityForecast } from '../schemas/metric.js';
import type { Insight } from '../schemas/insight.js';

/**
 * Abstract interface for metrics and observability access.
 * Implemented by @dashboard/observability.
 * Injected into @dashboard/ai to break the direct import dependency.
 */
export interface MetricsInterface {
  getMetrics(
    endpointId: number,
    containerId: string,
    metricType: string,
    from: Date,
    to: Date,
  ): Promise<Metric[]>;

  detectAnomalies(
    endpointId: number,
    containerId: string,
  ): Promise<AnomalyDetection[]>;

  /** Retrieve the latest value for each metric type for a container. */
  getLatestMetrics(containerId: string): Promise<Record<string, number>>;

  /** Batch fetch the latest metric values for multiple containers. */
  getLatestMetricsBatch(containerIds: string[]): Promise<Map<string, Record<string, number>>>;

  /** Compute moving average for a container metric over a window of recent samples. */
  getMovingAverage(
    containerId: string,
    metricType: string,
    windowSize: number,
  ): Promise<MovingAverageResult | null>;

  /** Retrieve top-N capacity forecasts sorted by urgency. */
  getCapacityForecasts(topN: number): Promise<CapacityForecast[]>;

  /**
   * Generate a single capacity forecast for a container metric.
   * Returns null if insufficient data.
   */
  generateForecast(
    containerId: string,
    containerName: string,
    metricType: string,
  ): Promise<CapacityForecast | null>;

  /**
   * Find groups of similar insights using text similarity clustering.
   * Used by incident-correlator to group related alerts.
   */
  findSimilarInsights(
    insights: Insight[],
    threshold: number,
  ): Array<{ insights: Insight[] }>;
}
