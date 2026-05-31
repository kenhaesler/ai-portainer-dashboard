import { describe, it, expect } from 'vitest';
import { persistedDimensionZScore } from '../services/trace-anomaly.js';
import type { AnomalyDimension } from '@dashboard/core/models/monitoring.js';

const dim = (over: Partial<AnomalyDimension>): AnomalyDimension => ({
  type: 'latency_p95', value: 1, baseline: 1, zScore: 0, severity: 'warning', ...over,
});

describe('persistedDimensionZScore (#1308)', () => {
  it('returns the zScore for latency_p95 (its description embeds "z-score:")', () => {
    expect(persistedDimensionZScore(dim({ type: 'latency_p95', zScore: 4.8 }))).toBe(4.8);
  });

  it('returns null for error_rate (its description carries no z-score → legacy pass-through)', () => {
    expect(persistedDimensionZScore(dim({ type: 'error_rate', zScore: 2.3 }))).toBeNull();
  });
});
