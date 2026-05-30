import { describe, it, expect } from 'vitest';
import { MetricSchema, AnomalyDetectionSchema } from './metrics.js';

describe('Metrics Models', () => {
  describe('MetricSchema', () => {
    it('should validate a complete metric', () => {
      const metric = {
        id: 1,
        endpoint_id: 1,
        container_id: 'container-123',
        container_name: 'web-server',
        metric_type: 'cpu',
        value: 45.5,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = MetricSchema.safeParse(metric);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metric_type).toBe('cpu');
        expect(result.data.value).toBe(45.5);
      }
    });

    it('should validate cpu metric type', () => {
      const metric = {
        id: 1,
        endpoint_id: 1,
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'cpu',
        value: 75.0,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = MetricSchema.safeParse(metric);
      expect(result.success).toBe(true);
    });

    it('should validate memory metric type', () => {
      const metric = {
        id: 1,
        endpoint_id: 1,
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'memory',
        value: 60.0,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = MetricSchema.safeParse(metric);
      expect(result.success).toBe(true);
    });

    it('should validate memory_bytes metric type', () => {
      const metric = {
        id: 1,
        endpoint_id: 1,
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'memory_bytes',
        value: 1073741824,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = MetricSchema.safeParse(metric);
      expect(result.success).toBe(true);
    });

    it('should reject invalid metric type', () => {
      const metric = {
        id: 1,
        endpoint_id: 1,
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'disk', // Invalid type
        value: 50.0,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = MetricSchema.safeParse(metric);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const metric = {
        id: 1,
        endpoint_id: 1,
        // Missing container_id, container_name, etc.
      };

      const result = MetricSchema.safeParse(metric);
      expect(result.success).toBe(false);
    });

    it('should reject non-numeric value', () => {
      const metric = {
        id: 1,
        endpoint_id: 1,
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'cpu',
        value: 'high', // Should be number
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = MetricSchema.safeParse(metric);
      expect(result.success).toBe(false);
    });

    it('should handle zero values', () => {
      const metric = {
        id: 1,
        endpoint_id: 1,
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'cpu',
        value: 0,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = MetricSchema.safeParse(metric);
      expect(result.success).toBe(true);
    });

    it('should handle negative values', () => {
      const metric = {
        id: 1,
        endpoint_id: 1,
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'cpu',
        value: -1, // Edge case
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = MetricSchema.safeParse(metric);
      expect(result.success).toBe(true); // Schema doesn't restrict negative values
    });
  });

  describe('AnomalyDetectionSchema', () => {
    it('should validate a complete anomaly detection result', () => {
      const anomaly = {
        container_id: 'container-123',
        container_name: 'web-server',
        metric_type: 'cpu',
        current_value: 95.5,
        mean: 50.0,
        std_dev: 10.0,
        z_score: 4.55,
        is_anomalous: true,
        threshold: 2.5,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = AnomalyDetectionSchema.safeParse(anomaly);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_anomalous).toBe(true);
        expect(result.data.z_score).toBe(4.55);
      }
    });

    it('should validate non-anomalous detection', () => {
      const anomaly = {
        container_id: 'container-123',
        container_name: 'web-server',
        metric_type: 'memory',
        current_value: 55.0,
        mean: 50.0,
        std_dev: 10.0,
        z_score: 0.5,
        is_anomalous: false,
        threshold: 2.5,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = AnomalyDetectionSchema.safeParse(anomaly);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_anomalous).toBe(false);
      }
    });

    it('should handle zero standard deviation', () => {
      const anomaly = {
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'cpu',
        current_value: 50.0,
        mean: 50.0,
        std_dev: 0,
        z_score: 0,
        is_anomalous: false,
        threshold: 2.5,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = AnomalyDetectionSchema.safeParse(anomaly);
      expect(result.success).toBe(true);
    });

    it('should handle negative z-score', () => {
      const anomaly = {
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'cpu',
        current_value: 20.0,
        mean: 50.0,
        std_dev: 10.0,
        z_score: -3.0,
        is_anomalous: true,
        threshold: 2.5,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = AnomalyDetectionSchema.safeParse(anomaly);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.z_score).toBe(-3.0);
      }
    });

    it('should handle Infinity z-score', () => {
      const anomaly = {
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'cpu',
        current_value: 100.0,
        mean: 50.0,
        std_dev: 0,
        z_score: Infinity,
        is_anomalous: true,
        threshold: 2.5,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = AnomalyDetectionSchema.safeParse(anomaly);
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const anomaly = {
        container_id: 'c1',
        // Missing other fields
      };

      const result = AnomalyDetectionSchema.safeParse(anomaly);
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean is_anomalous', () => {
      const anomaly = {
        container_id: 'c1',
        container_name: 'app',
        metric_type: 'cpu',
        current_value: 50.0,
        mean: 50.0,
        std_dev: 10.0,
        z_score: 0,
        is_anomalous: 'yes', // Should be boolean
        threshold: 2.5,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const result = AnomalyDetectionSchema.safeParse(anomaly);
      expect(result.success).toBe(false);
    });
  });
});
