import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrepare = vi.fn();

vi.mock('../db/sqlite.js', () => {
  return {
    getDb: vi.fn(() => ({ prepare: mockPrepare })),
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

import { getCapacityForecasts, linearRegression } from './capacity-forecaster.js';

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

  describe('getCapacityForecasts', () => {
    it('loads metrics in a single batched query for selected containers', () => {
      const containers = [
        { container_id: 'c1', container_name: 'web' },
      ];
      const metrics = [
        { container_id: 'c1', metric_type: 'cpu', timestamp: '2026-02-07T00:00:00.000Z', value: 10 },
        { container_id: 'c1', metric_type: 'cpu', timestamp: '2026-02-07T00:05:00.000Z', value: 20 },
        { container_id: 'c1', metric_type: 'cpu', timestamp: '2026-02-07T00:10:00.000Z', value: 30 },
        { container_id: 'c1', metric_type: 'cpu', timestamp: '2026-02-07T00:15:00.000Z', value: 40 },
        { container_id: 'c1', metric_type: 'cpu', timestamp: '2026-02-07T00:20:00.000Z', value: 50 },
        { container_id: 'c1', metric_type: 'memory', timestamp: '2026-02-07T00:00:00.000Z', value: 30 },
        { container_id: 'c1', metric_type: 'memory', timestamp: '2026-02-07T00:05:00.000Z', value: 35 },
        { container_id: 'c1', metric_type: 'memory', timestamp: '2026-02-07T00:10:00.000Z', value: 40 },
        { container_id: 'c1', metric_type: 'memory', timestamp: '2026-02-07T00:15:00.000Z', value: 45 },
        { container_id: 'c1', metric_type: 'memory', timestamp: '2026-02-07T00:20:00.000Z', value: 50 },
      ];

      const allMock = vi.fn()
        .mockReturnValueOnce(containers)
        .mockReturnValueOnce(metrics);
      mockPrepare.mockReturnValue({ all: allMock });

      const result = getCapacityForecasts(10);

      expect(mockPrepare).toHaveBeenCalledTimes(2);
      expect(mockPrepare.mock.calls[1][0]).toContain('container_id IN');
      expect(allMock.mock.calls[0]).toEqual(['-6', 20]);
      expect(allMock.mock.calls[1]).toEqual(['-6', 'c1']);
      expect(result).toHaveLength(2);
      expect(result.map((f) => f.metricType).sort()).toEqual(['cpu', 'memory']);
    });
  });
});
