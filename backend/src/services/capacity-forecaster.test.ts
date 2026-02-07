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

import { linearRegression, getCapacityForecasts, lookupContainerName, resetForecastCache } from './capacity-forecaster.js';
import { getDb } from '../db/sqlite.js';

// Helper to access the mock
function getMockPrepare() {
  return (getDb() as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
}

describe('capacity-forecaster', () => {
  beforeEach(() => {
    resetForecastCache();
    vi.clearAllMocks();
  });

  describe('lookupContainerName', () => {
    it('returns container name from metrics table', () => {
      const mockPrepare = getMockPrepare();
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ container_name: 'web-server' }),
      });

      const name = lookupContainerName('abc123');
      expect(name).toBe('web-server');
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT container_name FROM metrics'),
      );
    });

    it('returns empty string when container not found', () => {
      const mockPrepare = getMockPrepare();
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const name = lookupContainerName('nonexistent');
      expect(name).toBe('');
    });
  });

  describe('getCapacityForecasts', () => {
    it('queries per metric type and returns forecasts', () => {
      const mockPrepare = getMockPrepare();
      const now = new Date();
      const makeTimestamp = (minutesAgo: number) =>
        new Date(now.getTime() - minutesAgo * 60 * 1000).toISOString();

      // First call: the overview query (returns rows per container+metric)
      const overviewAll = vi.fn().mockReturnValue([
        { container_id: 'c1', container_name: 'web', metric_type: 'cpu' },
        { container_id: 'c1', container_name: 'web', metric_type: 'memory' },
      ]);
      // Subsequent calls: getRecentMetrics for each (container, metricType)
      const metricsAll = vi.fn().mockReturnValue(
        Array.from({ length: 6 }, (_, i) => ({
          timestamp: makeTimestamp(6 - i),
          value: 40 + i * 2,
        })),
      );

      let callCount = 0;
      mockPrepare.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return { all: overviewAll };
        return { all: metricsAll };
      });

      const result = getCapacityForecasts(10);

      // The overview query should filter by metric_type IN ('cpu', 'memory')
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("metric_type IN ('cpu', 'memory')"),
      );
      // Should GROUP BY container_id, metric_type
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY container_id, metric_type'),
      );
      // Should produce forecasts (one per row returned)
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns empty array when no containers have enough per-type data', () => {
      const mockPrepare = getMockPrepare();
      mockPrepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });

      const result = getCapacityForecasts(10);
      expect(result).toEqual([]);
    });
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
