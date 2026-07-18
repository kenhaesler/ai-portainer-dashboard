import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

// Timescale is mocked (no TimescaleDB in the unit suite) — assert on the SQL.
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: (...args: unknown[]) => mockQuery(...args) }),
}));

import { getLatestMetrics, getLatestMetricsBatch } from '../services/metrics-store.js';

// #1493 — "latest" reads must carry a recency bound so TimescaleDB can prune
// chunks. #1567 additionally requires a coherent collection cycle: when the
// scheduler omits an unknown CPU row but writes memory/network rows, readers
// must not carry an older CPU row forward from another cycle.
describe('getLatestMetrics — latest-cycle coherence and recency bound (#1493/#1567)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({
      rows: [
        { metric_type: 'cpu', value: 42 },
        { metric_type: 'memory', value: 61 },
      ],
    });
  });

  it('returns only rows from the newest collection timestamp', async () => {
    await getLatestMetrics('c1');
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/MAX\(timestamp\) AS timestamp/i);
    expect(sql).toMatch(/JOIN latest_cycle latest ON m\.timestamp = latest\.timestamp/i);
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

describe('getLatestMetricsBatch — latest-cycle coherence and recency bound (#1493/#1567)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({
      rows: [
        { container_id: 'c1', metric_type: 'cpu', value: 42 },
        { container_id: 'c2', metric_type: 'memory', value: 61 },
      ],
    });
  });

  it('returns each container only from its own newest collection timestamp', async () => {
    await getLatestMetricsBatch(['c1', 'c2']);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/SELECT container_id, MAX\(timestamp\) AS timestamp/i);
    expect(sql).toMatch(/GROUP BY container_id/i);
    expect(sql).toMatch(/m\.timestamp = latest\.timestamp/i);
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
