import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

// Timescale is mocked (no TimescaleDB in the unit suite) — assert on the SQL.
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: (...args: unknown[]) => mockQuery(...args) }),
}));

import {
  getMovingAverage,
  getMovingAverageByHourOfDay,
  getMetricWindow,
  getMetricWindowByHourOfDay,
} from '../services/metrics-store.js';

describe('getMovingAverage — baseline leakage (#1361 fix 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [{ mean: 50, std_dev: 5, sample_count: 60 }] });
  });

  it('excludes the most recent sample (the point under test) from the baseline', async () => {
    await getMovingAverage('c1', 'cpu', 60);

    const sql: string = mockQuery.mock.calls[0][0];
    // The window must end BEFORE the latest sample: order newest-first and skip
    // the first row so a spike/regression cannot poison or mask its own baseline.
    expect(sql).toMatch(/ORDER BY\s+timestamp\s+DESC/i);
    expect(sql).toMatch(/OFFSET\s+1/i);
  });

  it('still windows by the requested size and container/metric', async () => {
    await getMovingAverage('c1', 'cpu', 60);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['c1', 'cpu', 60]);
  });

  it('maps the aggregate row to a MovingAverageResult', async () => {
    const result = await getMovingAverage('c1', 'cpu', 60);
    expect(result).toEqual({ mean: 50, std_dev: 5, sample_count: 60 });
  });
});

describe('getMovingAverageByHourOfDay — baseline leakage (#1361 fix 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [{ mean: 50, std_dev: 5, sample_count: 40 }] });
  });

  it('excludes the point under test (the latest sample) from the hour bucket', async () => {
    await getMovingAverageByHourOfDay('c1', 'cpu', 9, 14);
    const sql: string = mockQuery.mock.calls[0][0];
    // The current observation is the most recent sample; exclude it so the
    // hour-of-day baseline cannot include / be poisoned by the value under test.
    expect(sql).toMatch(/timestamp\s*<\s*\(\s*SELECT\s+MAX\(timestamp\)/i);
  });

  it('still aggregates the requested hour bucket over the lookback window', async () => {
    await getMovingAverageByHourOfDay('c1', 'cpu', 9, 14);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/date_part\('hour'/i);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['c1', 'cpu', 14, 9]);
  });
});

describe('getMetricWindow — raw window for robust stats (#1362)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw values newest-first, excluding the point under test', async () => {
    mockQuery.mockResolvedValue({ rows: [{ value: 3 }, { value: 2 }, { value: 1 }] });
    const window = await getMetricWindow('c1', 'cpu', 60);
    expect(window).toEqual([3, 2, 1]);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/ORDER BY\s+timestamp\s+DESC/i);
    expect(sql).toMatch(/OFFSET\s+1/i); // same leakage exclusion as getMovingAverage
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['c1', 'cpu', 60]);
  });

  it('coerces values to numbers and tolerates an empty window', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await getMetricWindow('c1', 'cpu', 60)).toEqual([]);
  });
});

describe('getMetricWindowByHourOfDay — robust hour-of-day window (#1362)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [{ value: 3 }, { value: 2 }, { value: 1 }] });
  });

  it('returns raw values for the hour bucket, excluding the point under test', async () => {
    const window = await getMetricWindowByHourOfDay('c1', 'cpu', 9, 14);
    expect(window).toEqual([3, 2, 1]);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/date_part\('hour'/i);
    // same leakage exclusion as the aggregate hour-of-day baseline
    expect(sql).toMatch(/timestamp\s*<\s*\(\s*SELECT\s+MAX\(timestamp\)/i);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['c1', 'cpu', 14, 9]);
  });

  it('returns [] for an out-of-range hour without querying', async () => {
    expect(await getMetricWindowByHourOfDay('c1', 'cpu', 24, 14)).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
