import { describe, it, expect } from 'vitest';
import { tokenize, jaccardSimilarity, findSimilarInsights } from '../services/alert-similarity.js';
import type { Insight } from '@dashboard/core/models/monitoring.js';

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'test-id',
    endpoint_id: 1,
    endpoint_name: 'test-endpoint',
    container_id: 'container-1',
    container_name: 'test-container',
    severity: 'warning',
    category: 'anomaly',
    title: 'Test insight',
    description: 'Test description',
    suggested_action: null,
    is_acknowledged: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('tokenize', () => {
  it('extracts unique lowercase tokens', () => {
    const tokens = tokenize('Hello World hello');
    expect(tokens.has('hello')).toBe(true);
    expect(tokens.has('world')).toBe(true);
    expect(tokens.size).toBe(2);
  });

  it('filters out short tokens', () => {
    const tokens = tokenize('I am a test string');
    expect(tokens.has('am')).toBe(true);
    expect(tokens.has('test')).toBe(true);
    expect(tokens.has('string')).toBe(true);
    expect(tokens.has('i')).toBe(false);
    expect(tokens.has('a')).toBe(false);
  });

  it('splits on non-alphanumeric characters', () => {
    const tokens = tokenize('cpu-usage: 95.5%');
    expect(tokens.has('cpu')).toBe(true);
    expect(tokens.has('usage')).toBe(true);
    expect(tokens.has('95')).toBe(true);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical sets', () => {
    const a = new Set(['hello', 'world']);
    const b = new Set(['hello', 'world']);
    expect(jaccardSimilarity(a, b)).toBe(1.0);
  });

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['hello']);
    const b = new Set(['world']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it('returns correct partial overlap', () => {
    const a = new Set(['hello', 'world']);
    const b = new Set(['hello', 'earth']);
    // intersection=1 (hello), union=3 (hello, world, earth) → 1/3
    expect(jaccardSimilarity(a, b)).toBeCloseTo(1 / 3);
  });
});

describe('findSimilarInsights', () => {
  it('groups similar insights together', () => {
    const insights = [
      makeInsight({
        id: '1',
        title: 'High CPU usage on web-app',
        description: 'CPU usage is 95%, z-score 3.2',
      }),
      makeInsight({
        id: '2',
        title: 'High CPU usage on api-server',
        description: 'CPU usage is 92%, z-score 2.8',
      }),
    ];

    const groups = findSimilarInsights(insights, 0.3);
    expect(groups.length).toBe(1);
    expect(groups[0].insights.length).toBe(2);
  });

  it('does not group dissimilar insights', () => {
    const insights = [
      makeInsight({
        id: '1',
        title: 'High CPU usage on web-app',
        description: 'CPU usage is 95%',
      }),
      makeInsight({
        id: '2',
        title: 'Privileged container detected',
        description: 'Container running in privileged mode with host network',
      }),
    ];

    const groups = findSimilarInsights(insights, 0.3);
    expect(groups.length).toBe(0);
  });

  it('returns empty for single insight', () => {
    const insights = [makeInsight({ id: '1' })];
    expect(findSimilarInsights(insights, 0.3)).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(findSimilarInsights([], 0.3)).toEqual([]);
  });

  it('creates multiple groups for distinct clusters', () => {
    const insights = [
      makeInsight({ id: '1', title: 'High CPU usage on web-app', description: 'CPU at 95%' }),
      makeInsight({ id: '2', title: 'High CPU usage on api-server', description: 'CPU at 92%' }),
      makeInsight({ id: '3', title: 'Memory leak detected in database', description: 'Memory growing continuously' }),
      makeInsight({ id: '4', title: 'Memory leak suspected in cache-service', description: 'Memory growing steadily' }),
    ];

    const groups = findSimilarInsights(insights, 0.3);
    // Should create 2 groups: CPU cluster and memory cluster
    expect(groups.length).toBe(2);
  });
});
