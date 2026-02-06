import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/sqlite.js', () => {
  const mockPrepare = vi.fn();
  return {
    getDb: vi.fn(() => ({ prepare: mockPrepare })),
    __mockPrepare: mockPrepare,
  };
});

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { linearRegression } from './capacity-forecaster.js';

describe('capacity-forecaster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('linearRegression', () => {
    it('returns zero slope for constant data', () => {
      const points = [
        { x: 0, y: 50 },
        { x: 1, y: 50 },
        { x: 2, y: 50 },
      ];
      const result = linearRegression(points);
      expect(result.slope).toBeCloseTo(0);
      expect(result.intercept).toBeCloseTo(50);
    });

    it('returns correct slope for perfectly linear increasing data', () => {
      const points = [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
        { x: 2, y: 30 },
        { x: 3, y: 40 },
      ];
      const result = linearRegression(points);
      expect(result.slope).toBeCloseTo(10);
      expect(result.intercept).toBeCloseTo(10);
      expect(result.rSquared).toBeCloseTo(1);
    });

    it('returns negative slope for decreasing data', () => {
      const points = [
        { x: 0, y: 100 },
        { x: 1, y: 80 },
        { x: 2, y: 60 },
        { x: 3, y: 40 },
      ];
      const result = linearRegression(points);
      expect(result.slope).toBeCloseTo(-20);
      expect(result.rSquared).toBeCloseTo(1);
    });

    it('handles single point', () => {
      const result = linearRegression([{ x: 0, y: 50 }]);
      expect(result.slope).toBe(0);
      expect(result.intercept).toBe(50);
    });

    it('returns low R² for noisy data', () => {
      const points = [
        { x: 0, y: 10 },
        { x: 1, y: 90 },
        { x: 2, y: 20 },
        { x: 3, y: 80 },
        { x: 4, y: 30 },
      ];
      const result = linearRegression(points);
      expect(result.rSquared).toBeLessThan(0.3);
    });
  });
});
