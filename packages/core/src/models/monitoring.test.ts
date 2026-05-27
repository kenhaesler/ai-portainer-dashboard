import { describe, it, expect } from 'vitest';
import { InsightSchema } from './monitoring.js';

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
