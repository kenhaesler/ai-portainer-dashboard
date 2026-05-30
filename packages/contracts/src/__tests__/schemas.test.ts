import { describe, it, expect } from 'vitest';
import {
  InsightSchema,
  MetricSchema,
  AnomalyDetectionSchema,
  NormalizedContainerSchema,
  NormalizedEndpointSchema,
  InvestigationSchema,
  InvestigationStatusSchema,
  IncidentSchema,
  IncidentInsertSchema,
  SecurityFindingSchema,
  RemediationAnalysisResultSchema,
} from '../schemas/index.js';

describe('InsightSchema', () => {
  it('parses a valid insight', () => {
    const raw = {
      id: 'abc123',
      endpoint_id: 1,
      endpoint_name: 'local',
      container_id: 'c1',
      container_name: 'nginx',
      severity: 'warning',
      category: 'cpu',
      title: 'High CPU',
      description: 'CPU usage is high',
      suggested_action: 'Restart container',
      is_acknowledged: 0,
      created_at: '2024-01-01T00:00:00.000Z',
    };
    const result = InsightSchema.parse(raw);
    expect(result.severity).toBe('warning');
    expect(result.is_acknowledged).toBe(0);
  });

  it('defaults is_acknowledged to 0 when omitted', () => {
    const raw = {
      id: 'x',
      endpoint_id: null,
      endpoint_name: null,
      container_id: null,
      container_name: null,
      severity: 'info',
      category: 'mem',
      title: 'T',
      description: 'D',
      suggested_action: null,
      created_at: '2024-01-01T00:00:00.000Z',
    };
    const result = InsightSchema.parse(raw);
    expect(result.is_acknowledged).toBe(0);
  });

  it('rejects invalid severity', () => {
    expect(() =>
      InsightSchema.parse({ id: 'x', endpoint_id: null, endpoint_name: null, container_id: null,
        container_name: null, severity: 'fatal', category: 'c', title: 't', description: 'd',
        suggested_action: null, created_at: '2024-01-01T00:00:00.000Z' })
    ).toThrow();
  });
});

describe('MetricSchema', () => {
  it('parses a valid metric', () => {
    const raw = { id: 1, endpoint_id: 2, container_id: 'c1', container_name: 'redis',
      metric_type: 'cpu', value: 42.5, timestamp: '2024-01-01T00:00:00.000Z' };
    expect(MetricSchema.parse(raw).metric_type).toBe('cpu');
  });

  it('rejects unknown metric_type', () => {
    expect(() =>
      MetricSchema.parse({ id: 1, endpoint_id: 2, container_id: 'c1', container_name: 'redis',
        metric_type: 'disk', value: 42.5, timestamp: '2024-01-01T00:00:00.000Z' })
    ).toThrow();
  });
});

describe('AnomalyDetectionSchema', () => {
  it('parses a valid anomaly', () => {
    const raw = { container_id: 'c1', container_name: 'nginx', metric_type: 'cpu',
      current_value: 95, mean: 30, std_dev: 10, z_score: 6.5, is_anomalous: true,
      threshold: 3, timestamp: '2024-01-01T00:00:00.000Z', method: 'zscore' };
    const result = AnomalyDetectionSchema.parse(raw);
    expect(result.is_anomalous).toBe(true);
  });

  it('accepts Infinity z_score for zero-variance samples', () => {
    const raw = { container_id: 'c1', container_name: 'nginx', metric_type: 'cpu',
      current_value: 95, mean: 30, std_dev: 0, z_score: Infinity, is_anomalous: true,
      threshold: 3, timestamp: '2024-01-01T00:00:00.000Z' };
    const result = AnomalyDetectionSchema.parse(raw);
    expect(result.z_score).toBe(Infinity);
  });

  it('accepts -Infinity z_score', () => {
    const raw = { container_id: 'c1', container_name: 'nginx', metric_type: 'cpu',
      current_value: 0, mean: 30, std_dev: 0, z_score: -Infinity, is_anomalous: false,
      threshold: 3, timestamp: '2024-01-01T00:00:00.000Z' };
    const result = AnomalyDetectionSchema.parse(raw);
    expect(result.z_score).toBe(-Infinity);
  });
});

describe('NormalizedContainerSchema', () => {
  it('parses a valid container', () => {
    const raw = { id: 'c1', name: 'nginx', image: 'nginx:latest', state: 'running',
      status: 'Up 2 hours', endpointId: 1, endpointName: 'local',
      ports: [{ private: 80, public: 8080, type: 'tcp' }],
      created: 1700000000, labels: { app: 'web' }, networks: ['bridge'] };
    expect(NormalizedContainerSchema.parse(raw).name).toBe('nginx');
  });

  it('accepts optional healthStatus', () => {
    const raw = { id: 'c1', name: 'nginx', image: 'nginx:latest', state: 'running',
      status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 1700000000,
      labels: {}, networks: [], healthStatus: 'healthy' };
    expect(NormalizedContainerSchema.parse(raw).healthStatus).toBe('healthy');
  });
});

describe('NormalizedEndpointSchema', () => {
  it('parses a valid endpoint', () => {
    const raw = { id: 1, name: 'local', type: 1, url: 'http://localhost:2375',
      status: 'up', containersRunning: 5, containersStopped: 2, containersHealthy: 4,
      containersUnhealthy: 1, totalContainers: 7, stackCount: 3 };
    expect(NormalizedEndpointSchema.parse(raw).id).toBe(1);
  });
});

describe('InvestigationSchema', () => {
  it('parses a complete investigation', () => {
    const raw = { id: 'i1', insight_id: 'ins1', endpoint_id: 1, container_id: 'c1',
      container_name: 'nginx', status: 'complete', evidence_summary: 'logs...',
      root_cause: 'OOM', contributing_factors: 'memory leak', severity_assessment: 'high',
      recommended_actions: '["restart"]', confidence_score: 0.9, analysis_duration_ms: 5000,
      llm_model: 'llama3', ai_summary: 'Analysis done', error_message: null,
      created_at: '2024-01-01T00:00:00.000Z', completed_at: '2024-01-01T00:01:00.000Z' };
    expect(InvestigationSchema.parse(raw).status).toBe('complete');
  });

  it('validates InvestigationStatus enum', () => {
    expect(() => InvestigationStatusSchema.parse('unknown')).toThrow();
    expect(InvestigationStatusSchema.parse('pending')).toBe('pending');
  });
});

describe('IncidentSchema', () => {
  it('parses a valid incident', () => {
    const raw = { id: 'inc1', title: 'High CPU cluster', severity: 'critical',
      status: 'active', root_cause_insight_id: 'ins1',
      related_insight_ids: ['ins1', 'ins2'], affected_containers: ['nginx'],
      endpoint_id: 1, endpoint_name: 'prod', correlation_type: 'resource',
      correlation_confidence: 'high', insight_count: 2, summary: 'Cluster issue',
      created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z',
      resolved_at: null };
    expect(IncidentSchema.parse(raw).status).toBe('active');
  });

  it('IncidentInsertSchema omits status, timestamps', () => {
    const raw = { id: 'inc1', title: 'CPU', severity: 'warning', root_cause_insight_id: null,
      related_insight_ids: [], affected_containers: [], endpoint_id: null,
      endpoint_name: null, correlation_type: 'cpu', correlation_confidence: 'low',
      insight_count: 1, summary: null };
    expect(IncidentInsertSchema.parse(raw).id).toBe('inc1');
  });
});

describe('SecurityFindingSchema', () => {
  it('parses a valid finding', () => {
    const raw = { severity: 'critical', category: 'capabilities', title: 'Privileged container',
      description: 'Container runs with --privileged flag' };
    expect(SecurityFindingSchema.parse(raw).severity).toBe('critical');
  });
});

describe('RemediationAnalysisResultSchema', () => {
  it('parses a valid analysis result', () => {
    const raw = { root_cause: 'Memory leak', severity: 'warning',
      recommended_actions: [{ action: 'Restart', priority: 'high', rationale: 'OOM' }],
      log_analysis: 'Logs show OOM', confidence_score: 0.85 };
    expect(RemediationAnalysisResultSchema.parse(raw).confidence_score).toBe(0.85);
  });

  it('rejects confidence_score > 1', () => {
    expect(() =>
      RemediationAnalysisResultSchema.parse({ root_cause: 'x', severity: 'info',
        recommended_actions: [], log_analysis: 'x', confidence_score: 1.5 })
    ).toThrow();
  });
});
