import { describe, it, expect } from 'vitest';
import { recommendThreshold } from '../services/anomaly-threshold-tuner.js';

const base = {
  current: 3.5,
  sampleCount: 50,
  targetFpRate: 0.05,
  tolerance: 0.02,
  step: 0.1,
  minSamples: 20,
  min: 1.5,
  max: 8,
};

describe('recommendThreshold — feedback → threshold loop (#1364)', () => {
  it('holds when there is not enough labelled feedback', () => {
    const r = recommendThreshold({ ...base, measuredFpRate: 0.4, sampleCount: 5 });
    expect(r).toMatchObject({ threshold: 3.5, changed: false, reason: 'insufficient-data' });
  });

  it('raises the threshold when the measured FP rate is too high', () => {
    const r = recommendThreshold({ ...base, measuredFpRate: 0.2 });
    expect(r.reason).toBe('too-many-fp');
    expect(r.threshold).toBeCloseTo(3.85, 6); // 3.5 × 1.1
    expect(r.changed).toBe(true);
  });

  it('lowers the threshold when the measured FP rate is well below target (too strict)', () => {
    const r = recommendThreshold({ ...base, measuredFpRate: 0.0 });
    expect(r.reason).toBe('too-strict');
    expect(r.threshold).toBeCloseTo(3.15, 6); // 3.5 × 0.9
  });

  it('holds inside the deadband around the target', () => {
    const r = recommendThreshold({ ...base, measuredFpRate: 0.05 });
    expect(r).toMatchObject({ threshold: 3.5, changed: false, reason: 'within-target' });
  });

  it('clamps to the max and reports no change at the ceiling', () => {
    const r = recommendThreshold({ ...base, current: 8, measuredFpRate: 0.5 });
    expect(r.threshold).toBe(8);
    expect(r.changed).toBe(false);
  });

  it('clamps to the min at the floor', () => {
    const r = recommendThreshold({ ...base, current: 1.5, measuredFpRate: 0 });
    expect(r.threshold).toBe(1.5);
    expect(r.changed).toBe(false);
  });
});
