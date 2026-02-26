import type { Metric, AnomalyDetection } from '../schemas/metric.js';

/**
 * Abstract interface for metrics access.
 * Implemented by metrics-service in @dashboard/observability.
 * Allows operations and ai-intelligence to query metrics without direct import.
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
}
