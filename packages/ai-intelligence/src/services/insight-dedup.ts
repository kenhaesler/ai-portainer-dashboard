import type { InsightInsert } from './insights-store.js';

/**
 * Cross-detector dedup signature (#1363). An anomaly is a duplicate when one
 * already exists this cycle for the same (container, metric) — the real
 * signature. Replaces a fragile `title.toLowerCase().includes(metricType)`
 * check, which falsely deduped whenever the container NAME contained a metric
 * substring (e.g. a container named "cpu-pod" would suppress a real CPU
 * threshold breach because a memory insight's title mentioned "cpu-pod").
 */
export function hasMetricInsight(
  insights: ReadonlyArray<Pick<InsightInsert, 'container_id' | 'metric_type'>>,
  containerId: string,
  metricType: string,
): boolean {
  return insights.some(
    (a) => a.container_id === containerId && a.metric_type === metricType,
  );
}
