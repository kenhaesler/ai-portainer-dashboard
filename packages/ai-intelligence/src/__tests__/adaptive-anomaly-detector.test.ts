import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import { calculateBollingerBands, detectAnomalyAdaptive, detectAnomalyRobust } from '../services/adaptive-anomaly-detector.js';

// DI pattern — getMovingAverage is passed as a parameter, no @dashboard/observability needed
const mockGetMovingAverage = vi.fn();

describe('adaptive-anomaly-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConfigForTest({
      ANOMALY_ZSCORE_THRESHOLD: 2.5,
      ANOMALY_MOVING_AVERAGE_WINDOW: 30,
      ANOMALY_MIN_SAMPLES: 10,
      ANOMALY_DETECTION_METHOD: 'adaptive',
      BOLLINGER_BANDS_ENABLED: true,
    });
  });

  afterEach(() => {
    resetConfig();
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
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 60, undefined, mockGetMovingAverage);
      expect(result).toBeNull();
    });

    it('detects anomaly with z-score method', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // z-score = (75 - 50) / 5 = 5 > 2.5 threshold
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 75, 'zscore', mockGetMovingAverage);
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(true);
      expect(result!.method).toBe('zscore');
    });

    it('detects normal values correctly', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // z-score = (52 - 50) / 5 = 0.4 < 2.5 threshold
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 52, 'zscore', mockGetMovingAverage);
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(false);
    });

    it('detects anomaly with bollinger bands', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // Bollinger upper = 50 + 2*5 = 60. Value 65 > 60 → anomaly
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 65, 'bollinger', mockGetMovingAverage);
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(true);
      expect(result!.method).toBe('bollinger');
    });

    it('uses adaptive method with high variance', async () => {
      // cv = 20/50 = 0.4 > 0.3 → adaptive method with scaled threshold
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 20, sample_count: 25 });
      // z-score = (80 - 50) / 20 = 1.5, adaptive threshold = 2.5 * 1.5 = 3.75
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 80, 'adaptive', mockGetMovingAverage);
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(false); // 1.5 < 3.75
      expect(result!.method).toBe('adaptive');
    });

    it('applies 1.2× multiplier for medium CV (0.1 ≤ CV < 0.3) adaptive mode', async () => {
      // Issue #1295: medium-CV regime widens the threshold by 1.2×.
      // cv = 10/50 = 0.2 → medium → threshold = 2.5 * 1.2 = 3.0.
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 10, sample_count: 25 });
      // z-score = (78 - 50) / 10 = 2.8 → not anomalous against widened threshold
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 78, 'adaptive', mockGetMovingAverage);
      expect(result).not.toBeNull();
      expect(result!.threshold).toBeCloseTo(3.0, 6);
      expect(result!.is_anomalous).toBe(false);
    });

    it('keeps the base threshold for low CV (< 0.1) adaptive mode', async () => {
      // Issue #1295 — CV-based variance scaling: low-CV regime uses the
      // unmodified base threshold (1.0× multiplier). cv = 5/100 = 0.05.
      mockGetMovingAverage.mockResolvedValue({ mean: 100, std_dev: 5, sample_count: 25 });
      // z-score = (114 - 100) / 5 = 2.8 > 2.5 → anomalous at the base threshold
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 114, 'adaptive', mockGetMovingAverage);
      expect(result).not.toBeNull();
      expect(result!.threshold).toBe(2.5);
      expect(result!.is_anomalous).toBe(true);
    });

    // #1361 fix 3 — one-sided detection across the adaptive branches.
    it('does NOT flag a drop (zscore method) under the default spike direction', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // z-score = (25 - 50) / 5 = -5 (a drop). Default 'spike' → not anomalous.
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 25, 'zscore', mockGetMovingAverage);
      expect(result!.is_anomalous).toBe(false);
      expect(result!.z_score).toBe(-5);
    });

    it('does NOT flag a value below the lower Bollinger band under default spike', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      // Lower band = 50 - 2*5 = 40. Value 35 < 40, but it is a drop → not flagged.
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 35, 'bollinger', mockGetMovingAverage);
      expect(result!.is_anomalous).toBe(false);
    });

    it('flags a drop (zscore method) when direction is "both"', async () => {
      setConfigForTest({
        ANOMALY_ZSCORE_THRESHOLD: 2.5,
        ANOMALY_MOVING_AVERAGE_WINDOW: 30,
        ANOMALY_MIN_SAMPLES: 10,
        ANOMALY_DETECTION_METHOD: 'adaptive',
        BOLLINGER_BANDS_ENABLED: true,
        ANOMALY_DETECTION_DIRECTION: 'both',
      });
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 25, 'zscore', mockGetMovingAverage);
      expect(result!.is_anomalous).toBe(true);
      expect(result!.z_score).toBe(-5);
    });

    it('still flags a spike (zscore method) under default spike', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 15 });
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 75, 'zscore', mockGetMovingAverage); // z=+5
      expect(result!.is_anomalous).toBe(true);
    });

    it('handles zero standard deviation', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 0, sample_count: 15 });
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 60, undefined, mockGetMovingAverage);
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(true);
      expect(result!.z_score).toBe(2);
    });

    it('does not flag tiny deviations on very low mean when std dev is zero', async () => {
      mockGetMovingAverage.mockResolvedValue({ mean: 0.2, std_dev: 0, sample_count: 15 });
      const result = await detectAnomalyAdaptive('c1', 'web', 'memory', 0.21, 'adaptive', mockGetMovingAverage);
      expect(result).not.toBeNull();
      expect(result!.is_anomalous).toBe(false);
      expect(result!.z_score).toBe(0);
    });

    // #1362 — robust median+MAD detection (one-sided, outlier-resistant).
    describe('detectAnomalyRobust', () => {
      // median 50, MAD 4 → modified-z threshold (2.5) is crossed at value > ~64.8.
      const spread = () => [44, 46, 48, 50, 50, 52, 54, 56, 42, 58];

      it('flags a spike beyond the modified-z threshold', async () => {
        const getWindow = vi.fn().mockResolvedValue(spread());
        const r = await detectAnomalyRobust('c1', 'web', 'cpu', 80, getWindow);
        expect(r).not.toBeNull();
        expect(r!.is_anomalous).toBe(true);
        expect(r!.method).toBe('robust-mad');
        expect(getWindow).toHaveBeenCalledWith('c1', 'cpu', 30);
      });

      it('does NOT flag a value within the robust band', async () => {
        const getWindow = vi.fn().mockResolvedValue(spread());
        const r = await detectAnomalyRobust('c1', 'web', 'cpu', 60, getWindow);
        expect(r!.is_anomalous).toBe(false);
      });

      it('does NOT flag a drop (one-sided spike default)', async () => {
        const getWindow = vi.fn().mockResolvedValue(spread());
        const r = await detectAnomalyRobust('c1', 'web', 'cpu', 20, getWindow);
        expect(r!.is_anomalous).toBe(false);
      });

      it('is robust: a prior spike in the window does not mask a real anomaly', async () => {
        // The 200 wrecks mean/std (which would hide the 70); median/MAD ignore it.
        const getWindow = vi.fn().mockResolvedValue([44, 46, 48, 50, 50, 52, 54, 56, 42, 200]);
        const r = await detectAnomalyRobust('c1', 'web', 'cpu', 70, getWindow);
        expect(r!.is_anomalous).toBe(true);
      });

      it('returns null below the minimum sample count', async () => {
        const getWindow = vi.fn().mockResolvedValue([50, 50, 50]); // < ANOMALY_MIN_SAMPLES (10)
        expect(await detectAnomalyRobust('c1', 'web', 'cpu', 80, getWindow)).toBeNull();
      });

      it('uses a relative tolerance when MAD is 0 (perfectly stable baseline)', async () => {
        const flat = Array(12).fill(50);
        const getWindow = vi.fn().mockResolvedValue(flat);
        const spike = await detectAnomalyRobust('c1', 'web', 'cpu', 80, getWindow);
        const tiny = await detectAnomalyRobust('c1', 'web', 'cpu', 50.2, getWindow);
        expect(spike!.is_anomalous).toBe(true);
        expect(tiny!.is_anomalous).toBe(false); // within 10% tolerance of median
      });

      // #1362 review — keep #1295 seasonality: prefer the hour-of-day window.
      it('uses the hour-of-day window when it has enough samples (not the flat window)', async () => {
        const flat = vi.fn().mockResolvedValue(Array(30).fill(50)); // MAD 0 → would not flag 80? it would via tolerance
        const hourly = vi.fn().mockResolvedValue(spread()); // median 50, MAD 4
        const r = await detectAnomalyRobust('c1', 'web', 'cpu', 80, flat, hourly);
        expect(hourly).toHaveBeenCalledWith('c1', 'cpu', expect.any(Number), 14); // (hourOfDay, lookbackDays)
        expect(flat).not.toHaveBeenCalled();
        expect(r!.is_anomalous).toBe(true);
      });

      it('falls back to the flat window when the hour bucket is below the warm-up threshold', async () => {
        const flat = vi.fn().mockResolvedValue(spread());
        const hourly = vi.fn().mockResolvedValue([50, 50]); // < ANOMALY_HOUROFDAY_MIN_SAMPLES (3)
        const r = await detectAnomalyRobust('c1', 'web', 'cpu', 80, flat, hourly);
        expect(hourly).toHaveBeenCalled();
        expect(flat).toHaveBeenCalledWith('c1', 'cpu', 30);
        expect(r!.is_anomalous).toBe(true);
      });

      it('uses the flat window when no hour-of-day fetcher is injected (back-compat)', async () => {
        const flat = vi.fn().mockResolvedValue(spread());
        const r = await detectAnomalyRobust('c1', 'web', 'cpu', 80, flat);
        expect(flat).toHaveBeenCalledWith('c1', 'cpu', 30);
        expect(r!.method).toBe('robust-mad');
      });
    });

    it('falls back from bollinger to zscore when bollinger is disabled', async () => {
      setConfigForTest({
        ANOMALY_ZSCORE_THRESHOLD: 2.5,
        ANOMALY_MOVING_AVERAGE_WINDOW: 30,
        ANOMALY_MIN_SAMPLES: 10,
        ANOMALY_DETECTION_METHOD: 'adaptive',
        BOLLINGER_BANDS_ENABLED: false,
      });
      mockGetMovingAverage.mockResolvedValue({ mean: 50, std_dev: 5, sample_count: 20 });
      const result = await detectAnomalyAdaptive('c1', 'web', 'cpu', 65, 'bollinger', mockGetMovingAverage);
      expect(result).not.toBeNull();
      expect(result!.method).toBe('zscore');
    });
  });
});
