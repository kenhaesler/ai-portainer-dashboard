import { describe, it, expect } from 'vitest';
import { hasMetricInsight } from '../services/insight-dedup.js';

describe('hasMetricInsight — cross-detector dedup signature (#1363)', () => {
  const insight = (container_id: string | null, metric_type: string) =>
    ({ container_id, metric_type }) as never;

  it('dedups by (container, metric) — NOT by title substring', () => {
    // A memory anomaly on a container literally named "cpu-pod". The old
    // title-substring check (`title.includes('cpu')`) would wrongly treat a CPU
    // threshold breach as a duplicate because the container name contains "cpu".
    const insights = [insight('cpu-pod', 'memory')];

    expect(hasMetricInsight(insights, 'cpu-pod', 'cpu')).toBe(false); // different metric → emit
    expect(hasMetricInsight(insights, 'cpu-pod', 'memory')).toBe(true); // same → dedupe
    expect(hasMetricInsight(insights, 'other', 'memory')).toBe(false); // different container → emit
  });

  it('returns false for an empty set', () => {
    expect(hasMetricInsight([], 'c1', 'cpu')).toBe(false);
  });
});
