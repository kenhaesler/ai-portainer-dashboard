/**
 * Pure-utility tests for `anomaly-stats.ts` (#1295 fix 2).
 * Tested directly per CLAUDE.md: "never mock pure utility functions".
 */
import { describe, expect, it } from 'vitest';
import {
  classifyCv,
  cvThresholdMultiplier,
  meanAndStd,
  scaledThresholdForCv,
} from '../services/anomaly-stats.js';

describe('classifyCv', () => {
  it('returns "low" for stable series (cv < 0.1)', () => {
    expect(classifyCv(100, 0)).toBe('low');
    expect(classifyCv(100, 5)).toBe('low');
    expect(classifyCv(100, 9.999)).toBe('low');
  });

  it('returns "medium" for the [0.1, 0.3) band', () => {
    expect(classifyCv(100, 10)).toBe('medium');
    expect(classifyCv(100, 20)).toBe('medium');
    expect(classifyCv(100, 29.999)).toBe('medium');
  });

  it('returns "high" for cv ≥ 0.3', () => {
    expect(classifyCv(100, 30)).toBe('high');
    expect(classifyCv(100, 50)).toBe('high');
    expect(classifyCv(10, 100)).toBe('high'); // cv = 10
  });

  it('treats non-positive mean as "low" (CV is undefined)', () => {
    expect(classifyCv(0, 5)).toBe('low');
    expect(classifyCv(-5, 5)).toBe('low');
  });

  it('treats non-finite inputs as "low"', () => {
    expect(classifyCv(Number.NaN, 5)).toBe('low');
    expect(classifyCv(100, Number.POSITIVE_INFINITY)).toBe('low');
  });
});

describe('cvThresholdMultiplier', () => {
  it('matches the issue table exactly', () => {
    // Low CV < 0.1 → 1.0×; Medium 0.1–0.3 → 1.2×; High ≥ 0.3 → 1.5×.
    expect(cvThresholdMultiplier('low')).toBe(1.0);
    expect(cvThresholdMultiplier('medium')).toBe(1.2);
    expect(cvThresholdMultiplier('high')).toBe(1.5);
  });
});

describe('CV bucket boundaries (regression pin — #1302)', () => {
  // Pin the post-#1302 mapping so a future change to the boundaries fails
  // loudly. Each row represents an operator-visible behavioural contract;
  // changing it requires updating the release-notes comment block at the top
  // of `services/anomaly-stats.ts` AND the PR description.
  const cases: ReadonlyArray<{
    cv: number;
    regime: 'low' | 'medium' | 'high';
    multiplier: number;
    mean: number;
    std: number;
  }> = [
    // cv = 0.05 — previously got 1.2× (legacy: cv ≤ 0.2 → 1.2×). Now gets 1.0×.
    { cv: 0.05, regime: 'low', multiplier: 1.0, mean: 100, std: 5 },
    // cv = 0.2 — previously got 1.0× (legacy: cv > 0.2 was the base case). Now gets 1.2×.
    { cv: 0.2, regime: 'medium', multiplier: 1.2, mean: 100, std: 20 },
    // cv = 0.4 — previously got 1.0× (legacy fell into the cv > 0.2 base band). Now gets 1.5×.
    { cv: 0.4, regime: 'high', multiplier: 1.5, mean: 100, std: 40 },
  ];

  it.each(cases)('cv=$cv → regime=$regime, multiplier=$multiplier', ({ regime, multiplier, mean, std }) => {
    expect(classifyCv(mean, std)).toBe(regime);
    expect(cvThresholdMultiplier(regime)).toBe(multiplier);
  });
});

describe('scaledThresholdForCv', () => {
  it('composes classify + multiplier for a base threshold of 2.5', () => {
    expect(scaledThresholdForCv(2.5, 100, 5)).toMatchObject({
      regime: 'low',
      multiplier: 1.0,
      threshold: 2.5,
    });
    expect(scaledThresholdForCv(2.5, 100, 15)).toMatchObject({
      regime: 'medium',
      multiplier: 1.2,
    });
    expect(scaledThresholdForCv(2.5, 100, 15).threshold).toBeCloseTo(3.0, 6);
    expect(scaledThresholdForCv(2.5, 100, 40)).toMatchObject({
      regime: 'high',
      multiplier: 1.5,
    });
    expect(scaledThresholdForCv(2.5, 100, 40).threshold).toBeCloseTo(3.75, 6);
  });
});

describe('meanAndStd', () => {
  it('returns zero for empty arrays', () => {
    expect(meanAndStd([])).toEqual({ mean: 0, std: 0 });
  });

  it('returns mean with zero std for single-element arrays', () => {
    expect(meanAndStd([42])).toEqual({ mean: 42, std: 0 });
  });

  it('computes population mean and std for known sequences', () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] is the canonical example: mean 5, popVar 4, popStd 2.
    const { mean, std } = meanAndStd([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(mean).toBe(5);
    expect(std).toBeCloseTo(2.0, 9);
  });
});
