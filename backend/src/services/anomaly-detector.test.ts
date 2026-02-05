import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectAnomaly } from './anomaly-detector.js';

// Mock dependencies
vi.mock('../config/index.js', () => ({
  getConfig: () => ({
    ANOMALY_ZSCORE_THRESHOLD: 2.5,
    ANOMALY_MOVING_AVERAGE_WINDOW: 10,
    ANOMALY_MIN_SAMPLES: 5,
  }),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock metrics-store module
const mockGetMovingAverage = vi.fn();
vi.mock('./metrics-store.js', () => ({
  getMovingAverage: (...args: unknown[]) => mockGetMovingAverage(...args),
}));

describe('anomaly-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectAnomaly', () => {
    it('should return null when insufficient samples', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 10,
        sample_count: 3, // Less than minSamples (5)
      });

      const result = detectAnomaly('container-1', 'test-container', 'cpu', 60);

      expect(result).toBeNull();
      expect(mockGetMovingAverage).toHaveBeenCalledWith('container-1', 'cpu', 10);
    });

    it('should return null when no stats available', () => {
      mockGetMovingAverage.mockReturnValue(null);

      const result = detectAnomaly('container-1', 'test-container', 'cpu', 60);

      expect(result).toBeNull();
    });

    it('should detect anomaly when z-score exceeds threshold', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 10,
        sample_count: 10,
      });

      // Value of 80 gives z-score of (80-50)/10 = 3.0, which exceeds 2.5
      const result = detectAnomaly('container-1', 'test-container', 'cpu', 80);

      expect(result).not.toBeNull();
      expect(result?.is_anomalous).toBe(true);
      expect(result?.z_score).toBe(3.0);
      expect(result?.current_value).toBe(80);
      expect(result?.mean).toBe(50);
      expect(result?.std_dev).toBe(10);
      expect(result?.threshold).toBe(2.5);
    });

    it('should not detect anomaly when z-score is within threshold', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 10,
        sample_count: 10,
      });

      // Value of 60 gives z-score of (60-50)/10 = 1.0, which is within 2.5
      const result = detectAnomaly('container-1', 'test-container', 'cpu', 60);

      expect(result).not.toBeNull();
      expect(result?.is_anomalous).toBe(false);
      expect(result?.z_score).toBe(1.0);
    });

    it('should detect negative z-score anomaly', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 10,
        sample_count: 10,
      });

      // Value of 20 gives z-score of (20-50)/10 = -3.0, absolute value exceeds 2.5
      const result = detectAnomaly('container-1', 'test-container', 'cpu', 20);

      expect(result).not.toBeNull();
      expect(result?.is_anomalous).toBe(true);
      expect(result?.z_score).toBe(-3.0);
    });

    it('should handle zero standard deviation with same value as mean', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 0,
        sample_count: 10,
      });

      // When std_dev is 0 and value equals mean, not anomalous
      const result = detectAnomaly('container-1', 'test-container', 'cpu', 50);

      expect(result).not.toBeNull();
      expect(result?.is_anomalous).toBe(false);
      expect(result?.z_score).toBe(0);
    });

    it('should handle zero standard deviation with different value', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 0,
        sample_count: 10,
      });

      // When std_dev is 0 and value differs from mean, it's anomalous
      const result = detectAnomaly('container-1', 'test-container', 'cpu', 55);

      expect(result).not.toBeNull();
      expect(result?.is_anomalous).toBe(true);
      expect(result?.z_score).toBe(Infinity);
    });

    it('should round z-score to 2 decimal places', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 7,
        sample_count: 10,
      });

      // Value of 60 gives z-score of (60-50)/7 = 1.428571...
      const result = detectAnomaly('container-1', 'test-container', 'cpu', 60);

      expect(result?.z_score).toBe(1.43);
    });

    it('should include container information in result', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 10,
        sample_count: 10,
      });

      const result = detectAnomaly('container-123', 'my-web-app', 'memory', 60);

      expect(result?.container_id).toBe('container-123');
      expect(result?.container_name).toBe('my-web-app');
      expect(result?.metric_type).toBe('memory');
    });

    it('should include timestamp in result', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 10,
        sample_count: 10,
      });

      const before = new Date().toISOString();
      const result = detectAnomaly('container-1', 'test', 'cpu', 60);
      const after = new Date().toISOString();

      expect(result?.timestamp).toBeDefined();
      expect(result?.timestamp! >= before).toBe(true);
      expect(result?.timestamp! <= after).toBe(true);
    });

    it('should handle edge case at exact threshold', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 10,
        sample_count: 10,
      });

      // Value of 75 gives z-score of exactly 2.5
      const result = detectAnomaly('container-1', 'test-container', 'cpu', 75);

      expect(result?.is_anomalous).toBe(false); // Not > threshold, exactly =
      expect(result?.z_score).toBe(2.5);
    });

    it('should handle very small deviations', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50.0001,
        std_dev: 0.0001,
        sample_count: 10,
      });

      const result = detectAnomaly('container-1', 'test-container', 'cpu', 50.0001);

      expect(result?.is_anomalous).toBe(false);
    });

    it('should handle different metric types', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 10,
        sample_count: 10,
      });

      const cpuResult = detectAnomaly('c1', 'test', 'cpu', 60);
      const memoryResult = detectAnomaly('c1', 'test', 'memory', 60);
      const networkResult = detectAnomaly('c1', 'test', 'network_rx', 60);

      expect(cpuResult?.metric_type).toBe('cpu');
      expect(memoryResult?.metric_type).toBe('memory');
      expect(networkResult?.metric_type).toBe('network_rx');
    });

    it('should call getMovingAverage with correct parameters', () => {
      mockGetMovingAverage.mockReturnValue({
        mean: 50,
        std_dev: 10,
        sample_count: 10,
      });

      detectAnomaly('my-container-id', 'container-name', 'cpu', 55);

      expect(mockGetMovingAverage).toHaveBeenCalledWith('my-container-id', 'cpu', 10);
    });
  });
});
