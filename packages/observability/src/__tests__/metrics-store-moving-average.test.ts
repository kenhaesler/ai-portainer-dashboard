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

describe('getMovingAverageByHourOfDay — reads metrics_1hour aggregate (#1307)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // metrics_1hour rows: per-day hourly buckets (avg + sample stddev + count).
    mockQuery.mockResolvedValue({
      rows: [
        { avg_value: 50, stddev_value: 5, sample_count: 60 },
        { avg_value: 54, stddev_value: 3, sample_count: 60 },
      ],
    });
  });

  it('queries the metrics_1hour continuous aggregate, not the raw hypertable', async () => {
    await getMovingAverageByHourOfDay('c1', 'cpu', 9, 14);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/from\s+metrics_1hour/i);
    expect(sql).toMatch(/date_part\('hour'.*bucket/i);
  });

  it('excludes the current (incomplete) hour bucket — the point under test', async () => {
    await getMovingAverageByHourOfDay('c1', 'cpu', 9, 14);
    const sql: string = mockQuery.mock.calls[0][0];
    // Only completed past hours form the baseline; the in-progress hour is dropped.
    expect(sql).toMatch(/bucket\s*<\s*date_trunc\('hour'/i);
  });

  it('pools the hourly buckets into population mean + std over the raw samples', async () => {
    const result = await getMovingAverageByHourOfDay('c1', 'cpu', 9, 14);
    // Two equal-count buckets (avg 50±5, avg 54±3, n=60 each): pooled mean 52,
    // pooled population variance = (5²·59 + 3²·59)/120 + (2²·60 + 2²·60)/120.
    expect(result!.mean).toBeCloseTo(52, 9);
    expect(result!.sample_count).toBe(120);
    const within = (25 * 59 + 9 * 59) / 120;
    const between = (60 * 4 + 60 * 4) / 120;
    expect(result!.std_dev).toBeCloseTo(Math.sqrt(within + between), 9);
  });

  it('passes container/metric/lookback/hour params (hour-of-day only)', async () => {
    await getMovingAverageByHourOfDay('c1', 'cpu', 9, 14);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['c1', 'cpu', 14, 9]);
  });

  it('filters by day-of-week and passes it as a param when supplied', async () => {
    await getMovingAverageByHourOfDay('c1', 'cpu', 9, 28, 1 /* Monday */);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/date_part\('dow'.*bucket/i);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['c1', 'cpu', 28, 9, 1]);
  });

  it('returns null when the aggregate has no matching buckets', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await getMovingAverageByHourOfDay('c1', 'cpu', 9, 14)).toBeNull();
  });

  it('returns null without querying for an out-of-range hour', async () => {
    expect(await getMovingAverageByHourOfDay('c1', 'cpu', 24, 14)).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
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

  it('filters raw samples by day-of-week and passes it as a param when supplied (#1307)', async () => {
    await getMetricWindowByHourOfDay('c1', 'cpu', 9, 28, 1 /* Monday */);
    const sql: string = mockQuery.mock.calls[0][0];
    // Still RAW samples (median+MAD needs them) — just narrowed to the weekday.
    expect(sql).toMatch(/from\s+metrics\b/i);
    expect(sql).toMatch(/date_part\('dow'/i);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['c1', 'cpu', 28, 9, 1]);
  });

  it('does not add a day-of-week filter when none is given', async () => {
    await getMetricWindowByHourOfDay('c1', 'cpu', 9, 14);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).not.toMatch(/date_part\('dow'/i);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['c1', 'cpu', 14, 9]);
  });
});
