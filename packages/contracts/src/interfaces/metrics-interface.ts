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

  /**
   * Compute the baseline distribution for a container metric at a specific
   * hour-of-day, aggregated over the last N days. Powers the hour-of-day
   * baseline that supersedes the flat 24h window for metrics with strong
   * diurnal patterns (issue #1295).
   *
   * @param hourOfDay  - 0..23 (UTC)
   * @param lookbackDays - number of days to scan back from now
   * @returns null when no samples were found
   */
  getMovingAverageByHourOfDay?(
    containerId: string,
    metricType: string,
    hourOfDay: number,
    lookbackDays: number,
    /** Optional UTC day-of-week (0=Sun..6=Sat) for week-aware seasonality (#1307). */
    dayOfWeek?: number,
  ): Promise<MovingAverageResult | null>;

  /**
   * Raw trailing window of metric values (newest-first), excluding the most
   * recent sample. Powers robust median+MAD detection (#1362), which needs the
   * actual values rather than pre-aggregated mean/std.
   */
  getMetricWindow?(
    containerId: string,
    metricType: string,
    windowSize: number,
  ): Promise<number[]>;

  /**
   * Raw hour-of-day window of metric values (newest-first), excluding the most
   * recent sample. Lets robust median+MAD detection keep #1295's seasonality
   * handling instead of comparing against a flat window.
   */
  getMetricWindowByHourOfDay?(
    containerId: string,
    metricType: string,
    hourOfDay: number,
    lookbackDays: number,
    /** Optional UTC day-of-week (0=Sun..6=Sat); narrows the raw window (#1307). */
    dayOfWeek?: number,
  ): Promise<number[]>;

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
