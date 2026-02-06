import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    ANOMALY_ZSCORE_THRESHOLD: 2.5,
    ANOMALY_MOVING_AVERAGE_WINDOW: 30,
    ANOMALY_MIN_SAMPLES: 10,
    ANOMALY_DETECTION_METHOD: 'adaptive',
  }),
}));

const mockGetMovingAverage = vi.fn();
vi.mock('./metrics-store.js', () => ({
  getMovingAverage: (...args: unknown[]) => mockGetMovingAverage(...args),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { calculateBollingerBands, detectAnomalyAdaptive } from './adaptive-anomaly-detector.js';

describe('adaptive-anomaly-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateBollingerBands', () => {
    it('calculates correct bands', () => {
      const bands = calculateBollingerBands(50, 10, 2);
      expect(bands.upper).toBe(70);
      expect(bands.middle).toBe(50);
      expect(bands.lower).toBe(30);
    });

    it('clamps lower band to 0', () => {
      const bands = calculateBollingerBands(5, 10, 2);
      expect(bands.lower).toBe(0);
    });

    it('handles zero std dev', () => {
      const bands = calculateBollingerBands(50, 0, 2);
      expect(bands.upper).toBe(50);
      expect(bands.lower).toBe(50);
      expect(bands.bandwidth).toBe(0);
    });
  });

  describe('detectAnomalyAdaptive', () => {
    it('returns null when insufficient samples', () => {
      mockGetMovingAverage.mockReturnValue({ mean: 50, std_dev: 5, sample_count: 3 });
      const result = detectAnomalyAdaptive('c1', 'web', 'cpu', 60);
      expect(result).toBeNull();
    });

    it('detects anomaly with z-score method', () => {
      mockGetMovingAverage.mockReturnValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // z-score = (75 - 50) / 5 = 5 > 2.5 threshold
      const result = detectAnomalyAdaptive('c1', 'web', 'cpu', 75, 'zscore');
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(true);
      expect(result!.method).toBe('zscore');
    });

    it('detects normal values correctly', () => {
      mockGetMovingAverage.mockReturnValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // z-score = (52 - 50) / 5 = 0.4 < 2.5 threshold
      const result = detectAnomalyAdaptive('c1', 'web', 'cpu', 52, 'zscore');
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(false);
    });

    it('detects anomaly with bollinger bands', () => {
      mockGetMovingAverage.mockReturnValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // Bollinger upper = 50 + 2*5 = 60. Value 65 > 60 → anomaly
      const result = detectAnomalyAdaptive('c1', 'web', 'cpu', 65, 'bollinger');
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(true);
      expect(result!.method).toBe('bollinger');
    });

    it('uses adaptive method with high variance', () => {
      // cv = 20/50 = 0.4 > 0.3 → adaptive method with scaled threshold
      mockGetMovingAverage.mockReturnValue({ mean: 50, std_dev: 20, sample_count: 25 });
      // z-score = (80 - 50) / 20 = 1.5, adaptive threshold = 2.5 * 1.5 = 3.75
      const result = detectAnomalyAdaptive('c1', 'web', 'cpu', 80, 'adaptive');
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(false); // 1.5 < 3.75
      expect(result!.method).toBe('adaptive');
    });

    it('handles zero standard deviation', () => {
      mockGetMovingAverage.mockReturnValue({ mean: 50, std_dev: 0, sample_count: 15 });
      const result = detectAnomalyAdaptive('c1', 'web', 'cpu', 60);
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(true);
      expect(result!.z_score).toBe(Infinity);
    });
  });
});
