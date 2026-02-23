import { describe, it, expect, vi, beforeEach } from 'vitest';

// Kept: timescale mock — no TimescaleDB in CI
vi.mock('../core/db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

import {
  pearsonCorrelation,
  calculateCompositeScore,
  identifyPattern,
  scoreSeverity,
  correlationStrength,
} from './metric-correlator.js';

describe('metric-correlator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pearsonCorrelation', () => {
    it('returns 1 for perfectly correlated data', () => {
      const r = pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
      expect(r).toBeCloseTo(1);
    });

    it('returns -1 for perfectly inversely correlated data', () => {
      const r = pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
      expect(r).toBeCloseTo(-1);
    });

    it('returns near 0 for uncorrelated data', () => {
      const r = pearsonCorrelation([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
      expect(Math.abs(r)).toBeLessThan(0.6);
    });

    it('handles insufficient data', () => {
      expect(pearsonCorrelation([1, 2], [3, 4])).toBe(0);
      expect(pearsonCorrelation([], [])).toBe(0);
    });
  });

  describe('calculateCompositeScore', () => {
    it('calculates RMS of z-scores', () => {
      const score = calculateCompositeScore([3, 4]);
      // RMS = sqrt((9 + 16) / 2) = sqrt(12.5) ≈ 3.54
      expect(score).toBeCloseTo(3.54, 1);
    });

    it('returns 0 for empty array', () => {
      expect(calculateCompositeScore([])).toBe(0);
    });

    it('returns the value for single z-score', () => {
      expect(calculateCompositeScore([3])).toBe(3);
    });
  });

  describe('identifyPattern', () => {
    it('identifies resource exhaustion', () => {
      const pattern = identifyPattern([
        { type: 'cpu', zScore: 3 },
        { type: 'memory', zScore: 3 },
      ]);
      expect(pattern).toContain('Resource Exhaustion');
    });

    it('identifies memory leak', () => {
      const pattern = identifyPattern([
        { type: 'cpu', zScore: 0.5 },
        { type: 'memory', zScore: 3 },
      ]);
      expect(pattern).toContain('Memory Leak');
    });

    it('identifies CPU spike', () => {
      const pattern = identifyPattern([
        { type: 'cpu', zScore: 4 },
        { type: 'memory', zScore: 0.5 },
      ]);
      expect(pattern).toContain('CPU Spike');
    });

    it('returns null for no known pattern', () => {
      const pattern = identifyPattern([
        { type: 'cpu', zScore: 0.5 },
        { type: 'memory', zScore: 0.5 },
      ]);
      expect(pattern).toBeNull();
    });
  });

  describe('correlationStrength', () => {
    it('returns very_strong for |r| >= 0.9', () => {
      expect(correlationStrength(0.95)).toBe('very_strong');
      expect(correlationStrength(0.9)).toBe('very_strong');
      expect(correlationStrength(1.0)).toBe('very_strong');
    });

    it('returns strong for |r| >= 0.7', () => {
      expect(correlationStrength(0.7)).toBe('strong');
      expect(correlationStrength(0.89)).toBe('strong');
    });

    it('returns moderate for |r| >= 0.4', () => {
      expect(correlationStrength(0.4)).toBe('moderate');
      expect(correlationStrength(0.69)).toBe('moderate');
    });

    it('returns weak for |r| < 0.4', () => {
      expect(correlationStrength(0.39)).toBe('weak');
      expect(correlationStrength(0)).toBe('weak');
    });
  });

  describe('scoreSeverity', () => {
    it('returns critical for score >= 5', () => {
      expect(scoreSeverity(5)).toBe('critical');
      expect(scoreSeverity(10)).toBe('critical');
    });

    it('returns high for score >= 3.5', () => {
      expect(scoreSeverity(3.5)).toBe('high');
      expect(scoreSeverity(4.9)).toBe('high');
    });

    it('returns medium for score >= 2', () => {
      expect(scoreSeverity(2)).toBe('medium');
      expect(scoreSeverity(3.4)).toBe('medium');
    });

    it('returns low for score < 2', () => {
      expect(scoreSeverity(1.9)).toBe('low');
      expect(scoreSeverity(0)).toBe('low');
    });
  });
});
