import { describe, expect, it } from 'vitest';
import { decimateTimeSeries } from './metrics-decimation';

describe('decimateTimeSeries', () => {
  it('returns the original series when below limit', () => {
    const points = [
      { timestamp: '2026-01-01T00:00:00Z', value: 10 },
      { timestamp: '2026-01-01T00:01:00Z', value: 20 },
      { timestamp: '2026-01-01T00:02:00Z', value: 30 },
    ];

    const result = decimateTimeSeries(points, 10);

    expect(result).toEqual(points);
  });

  it('caps large series and preserves first and last point', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
      value: i,
    }));

    const result = decimateTimeSeries(points, 120);

    expect(result.length).toBeLessThanOrEqual(120);
    expect(result[0]).toEqual(points[0]);
    expect(result[result.length - 1]).toEqual(points[points.length - 1]);
  });

  it('keeps anomaly points when decimating', () => {
    const points = Array.from({ length: 600 }, (_, i) => ({
      timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
      value: i % 100,
      isAnomaly: i === 125 || i === 410,
    }));

    const result = decimateTimeSeries(points, 80);

    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.some((point) => point.timestamp === points[125].timestamp)).toBe(true);
    expect(result.some((point) => point.timestamp === points[410].timestamp)).toBe(true);
  });

  it('returns empty array for invalid limits', () => {
    const points = [{ timestamp: '2026-01-01T00:00:00Z', value: 1 }];

    expect(decimateTimeSeries(points, 0)).toEqual([]);
    expect(decimateTimeSeries(points, -1)).toEqual([]);
  });
});
