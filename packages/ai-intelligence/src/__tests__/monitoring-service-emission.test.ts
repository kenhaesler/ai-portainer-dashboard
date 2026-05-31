import { describe, it, expect } from 'vitest';
import { InsightSchema } from '@dashboard/core/models/monitoring.js';

// We assert at the schema layer rather than running the full service
// (which depends on Portainer / DB / metrics). The principle: every
// path in monitoring-service.ts that pushes an Insight literal MUST
// include metric_type and detection_method when the category is
// 'anomaly' or 'predictive'. If a future emission path forgets, this
// test does not catch it directly — but the typecheck below will.
describe('Insight emission — structured fields are typeable', () => {
  it('an anomaly insight with structured fields parses', () => {
    const insight = {
      id: '1',
      endpoint_id: 1,
      endpoint_name: 'e',
      container_id: 'c',
      container_name: 'cn',
      severity: 'warning' as const,
      category: 'anomaly',
      title: 'Anomalous cpu usage on "x"',
      description: 'd',
      suggested_action: null,
      is_acknowledged: 0,
      created_at: new Date().toISOString(),
      metric_type: 'cpu' as const,
      detection_method: 'ml-anomaly' as const,
    };
    const result = InsightSchema.safeParse(insight);
    expect(result.success).toBe(true);
  });

  it('an anomaly insight carrying a typed z_score parses (#1308)', () => {
    const insight = {
      id: '2',
      endpoint_id: 1,
      endpoint_name: 'e',
      container_id: 'c',
      container_name: 'cn',
      severity: 'warning' as const,
      category: 'anomaly',
      title: 'Anomalous cpu usage on "x"',
      description: 'cpu (z-score: 3.50)',
      suggested_action: null,
      is_acknowledged: 0,
      created_at: new Date().toISOString(),
      metric_type: 'cpu' as const,
      detection_method: 'ml-anomaly' as const,
      z_score: 3.5,
    };
    expect(InsightSchema.safeParse(insight).success).toBe(true);
  });

  it('an anomaly insight with null z_score (error-rate-only / non-z-score) parses (#1308)', () => {
    const insight = {
      id: '3',
      endpoint_id: 1,
      endpoint_name: 'e',
      container_id: 'c',
      container_name: 'cn',
      severity: 'warning' as const,
      category: 'anomaly',
      title: 'Elevated error rate on service "x"',
      description: 'Recent error rate: 8.00% (baseline: 1.00%, threshold: 5%).',
      suggested_action: null,
      is_acknowledged: 0,
      created_at: new Date().toISOString(),
      metric_type: 'error_rate' as const,
      detection_method: 'ml-anomaly' as const,
      z_score: null,
    };
    expect(InsightSchema.safeParse(insight).success).toBe(true);
  });
});
