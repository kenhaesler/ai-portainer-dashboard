import { describe, it, expect } from 'vitest';
import { parseSignature, detectionMethodLabel } from './signature-meta';

describe('parseSignature', () => {
  it('parses anomaly:ml-anomaly:cpu', () => {
    expect(parseSignature('anomaly:ml-anomaly:cpu')).toEqual({
      category: 'anomaly',
      detectionMethod: 'ml-anomaly',
      metricType: 'cpu',
    });
  });

  it('parses predictive:prediction:disk', () => {
    expect(parseSignature('predictive:prediction:disk')).toEqual({
      category: 'predictive',
      detectionMethod: 'prediction',
      metricType: 'disk',
    });
  });

  it('parses two-segment signatures (security:scan)', () => {
    expect(parseSignature('security:scan')).toEqual({
      category: 'security',
      detectionMethod: 'scan',
      metricType: null,
    });
  });

  it('parses log:pattern', () => {
    expect(parseSignature('log:pattern')).toEqual({
      category: 'log',
      detectionMethod: 'pattern',
      metricType: null,
    });
  });

  it('returns nulls for unknown:* signatures', () => {
    expect(parseSignature('unknown:something-weird')).toEqual({
      category: 'unknown',
      detectionMethod: null,
      metricType: null,
    });
  });

  it('handles empty string defensively', () => {
    expect(parseSignature('')).toEqual({
      category: 'unknown',
      detectionMethod: null,
      metricType: null,
    });
  });
});

describe('detectionMethodLabel', () => {
  it('returns human label for ml-anomaly', () => {
    expect(detectionMethodLabel('ml-anomaly')).toBe('ML');
  });

  it('returns human label for threshold', () => {
    expect(detectionMethodLabel('threshold')).toBe('Threshold');
  });

  it('returns human label for prediction', () => {
    expect(detectionMethodLabel('prediction')).toBe('Prediction');
  });

  it('returns null for unrecognised methods', () => {
    expect(detectionMethodLabel('bogus')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(detectionMethodLabel(null)).toBeNull();
  });
});
