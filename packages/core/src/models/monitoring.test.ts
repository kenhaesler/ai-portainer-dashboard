import { describe, it, expect } from 'vitest';
import {
  PERSISTED_ANOMALY_DETECTORS,
  IN_MEMORY_ANOMALY_DETECTORS,
  ANOMALY_DETECTORS,
  InsightSchema,
} from './monitoring.js';

describe('InsightSchema', () => {
  const valid = {
    id: 'i-123',
    endpoint_id: 1,
    endpoint_name: 'edge-1',
    container_id: 'c-abc',
    container_name: 'web-server',
    severity: 'warning' as const,
    category: 'anomaly',
    title: 'Anomalous CPU usage',
    description: 'detail',
    suggested_action: null,
    is_acknowledged: 0,
    created_at: new Date().toISOString(),
  };

  it('accepts optional metric_type and detection_method', () => {
    const result = InsightSchema.safeParse({
      ...valid,
      metric_type: 'cpu',
      detection_method: 'ml-anomaly',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metric_type).toBe('cpu');
      expect(result.data.detection_method).toBe('ml-anomaly');
    }
  });

  it('parses without the new optional fields', () => {
    const result = InsightSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metric_type).toBeUndefined();
      expect(result.data.detection_method).toBeUndefined();
    }
  });

  it('rejects unknown metric_type values', () => {
    const result = InsightSchema.safeParse({ ...valid, metric_type: 'bogus' });
    expect(result.success).toBe(false);
  });

  it('accepts a multi-signal `dimensions` array for correlated anomalies (#1296)', () => {
    const result = InsightSchema.safeParse({
      ...valid,
      metric_type: 'latency_p95',
      detection_method: 'ml-anomaly',
      dimensions: [
        { type: 'latency_p95', value: 800, baseline: 20, zScore: 4.2, severity: 'critical' },
        { type: 'error_rate', value: 0.08, baseline: 0.005, zScore: 1.6, severity: 'warning' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dimensions).toHaveLength(2);
      expect(result.data.dimensions?.[0].type).toBe('latency_p95');
    }
  });

  it('rejects a `dimensions` entry with an unknown type', () => {
    const result = InsightSchema.safeParse({
      ...valid,
      dimensions: [{ type: 'bogus', value: 1, baseline: 0, zScore: 0, severity: 'warning' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts the new trace metric_type values (`latency_p95`, `error_rate`)', () => {
    for (const t of ['latency_p95', 'error_rate'] as const) {
      const result = InsightSchema.safeParse({ ...valid, metric_type: t });
      expect(result.success).toBe(true);
    }
  });
});

describe('anomaly detector constants (#1314)', () => {
  it('ANOMALY_DETECTORS is exactly the union of persisted + in-memory, in order', () => {
    expect(ANOMALY_DETECTORS).toEqual([
      'threshold', 'ml-anomaly', 'prediction', 'health-check', 'log-pattern', 'security-scan',
      'correlated-zscore', 'isolation-forest',
    ]);
  });

  it('ANOMALY_DETECTORS length equals the sum of its two groups', () => {
    expect(ANOMALY_DETECTORS.length).toBe(
      PERSISTED_ANOMALY_DETECTORS.length + IN_MEMORY_ANOMALY_DETECTORS.length,
    );
  });

  it('has no duplicate identifiers across the two groups', () => {
    expect(new Set(ANOMALY_DETECTORS).size).toBe(ANOMALY_DETECTORS.length);
  });

  it('exposes the persisted set the insert path historically hard-coded', () => {
    expect([...PERSISTED_ANOMALY_DETECTORS]).toEqual([
      'threshold', 'ml-anomaly', 'prediction', 'health-check', 'log-pattern', 'security-scan',
    ]);
  });

  it('exposes the in-memory correlated detectors', () => {
    expect([...IN_MEMORY_ANOMALY_DETECTORS]).toEqual(['correlated-zscore', 'isolation-forest']);
  });

  it('InsightSchema.detection_method accepts persisted detectors and rejects in-memory ones', () => {
    for (const d of PERSISTED_ANOMALY_DETECTORS) {
      expect(InsightSchema.shape.detection_method.safeParse(d).success).toBe(true);
    }
    expect(InsightSchema.shape.detection_method.safeParse('correlated-zscore').success).toBe(false);
    expect(InsightSchema.shape.detection_method.safeParse('isolation-forest').success).toBe(false);
    expect(InsightSchema.shape.detection_method.safeParse(undefined).success).toBe(true); // optional
  });
});
