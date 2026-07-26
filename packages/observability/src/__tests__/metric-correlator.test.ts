import { describe, it, expect, vi, beforeEach } from 'vitest';

// Kept: timescale mock — no TimescaleDB in CI
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

import {
  pearsonCorrelation,
  calculateCompositeScore,
  identifyPattern,
  PATTERN_Z_SCORE_THRESHOLD,
  scoreSeverity,
  correlationStrength,
} from '../services/metric-correlator.js';

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
    it('classifies both metrics deviating, and reports the z-scores that triggered it', () => {
      const match = identifyPattern([
        { type: 'cpu', zScore: 3 },
        { type: 'memory', zScore: 3.4 },
      ]);
      expect(match).not.toBeNull();
      expect(match!.id).toBe('cpu-and-memory-deviation');
      expect(match!.zScoreThreshold).toBe(PATTERN_Z_SCORE_THRESHOLD);
      expect(match!.triggeredBy).toEqual([
        { type: 'cpu', zScore: 3 },
        { type: 'memory', zScore: 3.4 },
      ]);
      expect(match!.withinThreshold).toEqual([]);
      expect(match!.summary).toContain('cpu z=3.00');
      expect(match!.summary).toContain('memory z=3.40');
    });

    it('classifies memory-only deviation and names CPU as within threshold', () => {
      const match = identifyPattern([
        { type: 'cpu', zScore: 0.4 },
        { type: 'memory', zScore: 3.7 },
      ]);
      expect(match!.id).toBe('memory-only-deviation');
      expect(match!.triggeredBy).toEqual([{ type: 'memory', zScore: 3.7 }]);
      expect(match!.withinThreshold).toEqual([{ type: 'cpu', zScore: 0.4 }]);
      // The measured numbers must be in the summary — this is what makes two
      // cards with the same classification distinguishable on screen.
      expect(match!.summary).toContain('memory z=3.70');
      expect(match!.summary).toContain('cpu z=0.40');
    });

    it('classifies memory_bytes deviation the same way as memory', () => {
      const match = identifyPattern([
        { type: 'cpu', zScore: 0.1 },
        { type: 'memory_bytes', zScore: 2.6 },
      ]);
      expect(match!.id).toBe('memory-only-deviation');
      expect(match!.triggeredBy).toEqual([{ type: 'memory_bytes', zScore: 2.6 }]);
    });

    it('classifies CPU-only deviation and names memory as within threshold', () => {
      const match = identifyPattern([
        { type: 'cpu', zScore: 4 },
        { type: 'memory', zScore: 0.5 },
      ]);
      expect(match!.id).toBe('cpu-only-deviation');
      expect(match!.triggeredBy).toEqual([{ type: 'cpu', zScore: 4 }]);
      expect(match!.withinThreshold).toEqual([{ type: 'memory', zScore: 0.5 }]);
      expect(match!.summary).toContain('cpu z=4.00');
      expect(match!.summary).toContain('memory z=0.50');
    });

    it('says so when the rule fired with no counterpart sample in the window', () => {
      const match = identifyPattern([{ type: 'cpu', zScore: 4 }]);
      expect(match!.id).toBe('cpu-only-deviation');
      expect(match!.withinThreshold).toEqual([]);
      expect(match!.summary).toContain('no memory sample this window');
    });

    it('returns null when no rule matches', () => {
      const match = identifyPattern([
        { type: 'cpu', zScore: 0.5 },
        { type: 'memory', zScore: 0.5 },
      ]);
      expect(match).toBeNull();
    });

    it('keeps the threshold at the documented value (the maths must not drift)', () => {
      expect(PATTERN_Z_SCORE_THRESHOLD).toBe(2);
      // Exactly at the threshold does not fire — the rule is strictly greater.
      expect(identifyPattern([{ type: 'cpu', zScore: 2 }, { type: 'memory', zScore: 0 }])).toBeNull();
      expect(identifyPattern([{ type: 'cpu', zScore: 2.01 }, { type: 'memory', zScore: 0 }])!.id)
        .toBe('cpu-only-deviation');
    });

    it('carries no diagnostic prose — the classification must not read as inference', () => {
      const summaries = [
        identifyPattern([{ type: 'cpu', zScore: 3 }, { type: 'memory', zScore: 3 }])!,
        identifyPattern([{ type: 'cpu', zScore: 0.5 }, { type: 'memory', zScore: 3 }])!,
        identifyPattern([{ type: 'cpu', zScore: 4 }, { type: 'memory', zScore: 0.5 }])!,
      ].flatMap((m) => [m.summary, m.label]);

      for (const text of summaries) {
        expect(text.toLowerCase()).not.toContain('suggesting');
        expect(text.toLowerCase()).not.toContain('leak');
      }
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
