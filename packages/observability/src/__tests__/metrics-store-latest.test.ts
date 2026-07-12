import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

// Timescale is mocked (no TimescaleDB in the unit suite) — assert on the SQL.
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: (...args: unknown[]) => mockQuery(...args) }),
}));

import { getLatestMetrics, getLatestMetricsBatch } from '../services/metrics-store.js';

// #1493 — "latest" reads must carry a recency bound so TimescaleDB can prune
// chunks. Without it the DISTINCT ON queries walk the container's ENTIRE
// retention window (days of rows) on every dashboard poll / monitoring cycle.
describe('getLatestMetrics — recency bound (#1493)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({
      rows: [
        { metric_type: 'cpu', value: 42 },
        { metric_type: 'memory', value: 61 },
      ],
    });
  });

  it('bounds the DISTINCT ON scan to a recent window (chunk pruning)', async () => {
    await getLatestMetrics('c1');
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/DISTINCT ON \(metric_type\)/i);
    expect(sql).toMatch(/timestamp\s*>\s*NOW\(\)\s*-\s*\(\$2::int \* INTERVAL '1 minute'\)/i);
  });

  it('passes the max-age constant as a parameter (15 minutes)', async () => {
    await getLatestMetrics('c1');
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['c1', 15]);
  });

  it('maps rows to a metric_type → value record', async () => {
    expect(await getLatestMetrics('c1')).toEqual({ cpu: 42, memory: 61 });
  });

  it('returns {} when the container has no recent samples (idle beyond the bound)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await getLatestMetrics('idle')).toEqual({});
  });
});

describe('getLatestMetricsBatch — recency bound (#1493)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({
      rows: [
        { container_id: 'c1', metric_type: 'cpu', value: 42 },
        { container_id: 'c2', metric_type: 'memory', value: 61 },
      ],
    });
  });

  it('bounds the batch DISTINCT ON scan to the same recent window', async () => {
    await getLatestMetricsBatch(['c1', 'c2']);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/DISTINCT ON \(container_id, metric_type\)/i);
    expect(sql).toMatch(/timestamp\s*>\s*NOW\(\)\s*-\s*\(\$2::int \* INTERVAL '1 minute'\)/i);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [['c1', 'c2'], 15]);
  });

  it('groups rows per container', async () => {
    const result = await getLatestMetricsBatch(['c1', 'c2']);
    expect(result.get('c1')).toEqual({ cpu: 42 });
    expect(result.get('c2')).toEqual({ memory: 61 });
  });

  it('omits containers with no recent samples — callers treat that as "no recent data"', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await getLatestMetricsBatch(['idle-1', 'idle-2']);
    expect(result.size).toBe(0);
  });

  it('short-circuits without querying for an empty id list', async () => {
    const result = await getLatestMetricsBatch([]);
    expect(result.size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
