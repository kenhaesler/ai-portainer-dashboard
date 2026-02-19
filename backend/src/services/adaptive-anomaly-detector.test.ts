import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    ANOMALY_ZSCORE_THRESHOLD: 2.5,
    ANOMALY_MOVING_AVERAGE_WINDOW: 30,
    ANOMALY_MIN_SAMPLES: 10,
    ANOMALY_DETECTION_METHOD: 'adaptive',
    BOLLINGER_BANDS_ENABLED: true,
  }),
}));

const mockGetMovingAverage = vi.fn();
vi.mock('./metrics-store.js', () => ({
  getMovingAverage: (...args: unknown[]) => mockGetMovingAverage(...args),
}));

import { calculateBollingerBands, detectAnomalyAdaptive } from './adaptive-anomaly-detector.js';
const { getConfig } = await import('../config/index.js');

describe('adaptive-anomaly-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      ANOMALY_ZSCORE_THRESHOLD: 2.5,
      ANOMALY_MOVING_AVERAGE_WINDOW: 30,
      ANOMALY_MIN_SAMPLES: 10,
      ANOMALY_DETECTION_METHOD: 'adaptive',
      BOLLINGER_BANDS_ENABLED: true,
    });
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
    it('returns null when insufficient samples', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 3 });
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 60);
      expect(result).toBeNull();
    });

    it('detects anomaly with z-score method', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // z-score = (75 - 50) / 5 = 5 > 2.5 threshold
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 75, 'zscore');
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(true);
      expect(result!.method).toBe('zscore');
    });

    it('detects normal values correctly', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // z-score = (52 - 50) / 5 = 0.4 < 2.5 threshold
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 52, 'zscore');
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(false);
    });

    it('detects anomaly with bollinger bands', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // Bollinger upper = 50 + 2*5 = 60. Value 65 > 60 → anomaly
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 65, 'bollinger');
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(true);
      expect(result!.method).toBe('bollinger');
    });

    it('uses adaptive method with high variance', async () => {
      // cv = 20/50 = 0.4 > 0.3 → adaptive method with scaled threshold
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 20, sample_count: 25 });
      // z-score = (80 - 50) / 20 = 1.5, adaptive threshold = 2.5 * 1.5 = 3.75
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 80, 'adaptive');
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(false); // 1.5 < 3.75
      expect(result!.method).toBe('adaptive');
    });

    it('widens threshold for low variance adaptive mode', async () => {
      // cv = 5/100 = 0.05 -> low variance -> threshold = 2.5 * 1.2 = 3.0
      mockGetMovingAverage.mockResolvedValue({ mean: 100, std_dev: 5, sample_count: 25 });
      // z-score = (114 - 100) / 5 = 2.8 -> not anomalous with widened threshold
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 114, 'adaptive');
      expect(result).not.toBeNull();
      expect(result!.threshold).toBe(3);
      expect(result!.is_anomalous).toBe(false);
    });

    it('handles zero standard deviation', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 0, sample_count: 15 });
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 60);
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(true);
      expect(result!.z_score).toBe(2);
    });

    it('does not flag tiny deviations on very low mean when std dev is zero', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 0.2, std_dev: 0, sample_count: 15 });
      const result = await detectAnomalyAdaptive('c1', 'web', 'memory', 0.21, 'adaptive');
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(false);
      expect(result!.z_score).toBe(0);
    });

    it('falls back from bollinger to zscore when bollinger is disabled', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        ANOMALY_ZSCORE_THRESHOLD: 2.5,
        ANOMALY_MOVING_AVERAGE_WINDOW: 30,
        ANOMALY_MIN_SAMPLES: 10,
        ANOMALY_DETECTION_METHOD: 'adaptive',
        BOLLINGER_BANDS_ENABLED: false,
      });
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 20 });
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 65, 'bollinger');
      expect(result).not.toBeNull();
      expect(result!.method).toBe('zscore');
    });
  });
});
