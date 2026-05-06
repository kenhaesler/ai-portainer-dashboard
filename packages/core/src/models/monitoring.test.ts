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
});
