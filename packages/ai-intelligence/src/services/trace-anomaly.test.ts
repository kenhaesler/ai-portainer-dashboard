import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub getConfig() before the SUT imports it — test env doesn't satisfy the
// full production env schema (JWT_SECRET, DASHBOARD_USERNAME, etc.).
vi.mock('@dashboard/core/config/index.js', () => ({
  getConfig: () => ({
    TRACES_ANOMALY_P95_ZSCORE: 2.5,
    TRACES_ANOMALY_ERROR_RATE_PCT: 5,
  }),
}));

import { runTraceAnomalyCycle, __resetTraceAnomalyLogState } from './trace-anomaly.js';
import * as insightsStore from './insights-store.js';

interface RedRow {
  group: string;
  rate: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  callCount: number;
}
interface RedBucket { bucketStart: string; rows: RedRow[] }
interface RedResult { buckets: RedBucket[]; truncated: boolean }

function buildBaseline(
  service: string,
  p95: number,
  errorRate: number,
  count = 24,
): RedResult {
  const buckets: RedBucket[] = [];
  for (let i = 0; i < count; i++) {
    buckets.push({
      bucketStart: new Date(Date.UTC(2026, 4, 13, i)).toISOString(),
      rows: [
        {
          group: service,
          rate: 10,
          errorRate,
          p50Ms: p95 * 0.5,
          p95Ms: p95,
          p99Ms: p95 * 1.1,
          callCount: 100,
        },
      ],
    });
  }
  return { buckets, truncated: false };
}

function buildRecent(
  service: string,
  p95: number,
  errorRate: number,
  buckets = 5,
): RedResult {
  const out: RedBucket[] = [];
  for (let i = 0; i < buckets; i++) {
    out.push({
      bucketStart: new Date(Date.UTC(2026, 4, 14, 12, i)).toISOString(),
      rows: [
        {
          group: service,
          rate: 10,
          errorRate,
          p50Ms: p95 * 0.5,
          p95Ms: p95,
          p99Ms: p95 * 1.1,
          callCount: 100,
        },
      ],
    });
  }
  return { buckets: out, truncated: false };
}

describe('runTraceAnomalyCycle', () => {
  beforeEach(() => {
    __resetTraceAnomalyLogState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a latency_p95 anomaly when recent p95 spikes far above baseline', async () => {
    const inserted: insightsStore.InsightInsert[] = [];
    const spy = vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    const computeRed = vi.fn(async (q: { bucket: string }) => {
      if (q.bucket === '1h') {
        return buildBaseline('api', 20, 0.001, 24);
      }
      // Recent (1m) — last bucket is a huge spike
      const recent = buildRecent('api', 20, 0.001, 5);
      recent.buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString(),
        rows: [
          {
            group: 'api',
            rate: 10,
            errorRate: 0.001,
            p50Ms: 400,
            p95Ms: 800,
            p99Ms: 900,
            callCount: 100,
          },
        ],
      });
      return recent;
    });

    await runTraceAnomalyCycle({ computeRed: computeRed as never });

    expect(spy).toHaveBeenCalled();
    const latencyAnomalies = inserted.filter((r) => r.metric_type === 'latency_p95');
    expect(latencyAnomalies.length).toBeGreaterThan(0);
    expect(latencyAnomalies[0].category).toBe('anomaly');
    expect(latencyAnomalies[0].detection_method).toBe('ml-anomaly');
    expect(latencyAnomalies[0].title.toLowerCase()).toContain('latency');
    expect(latencyAnomalies[0].title.toLowerCase()).toContain('api');
  });

  it('writes an error_rate anomaly when recent error rate exceeds threshold', async () => {
    const inserted: insightsStore.InsightInsert[] = [];
    vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    const computeRed = vi.fn(async (q: { bucket: string }) => {
      if (q.bucket === '1h') {
        return buildBaseline('api', 20, 0.001, 24);
      }
      const recent = buildRecent('api', 20, 0.001, 5);
      // Spike error rate to 8% in latest bucket
      recent.buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString(),
        rows: [
          {
            group: 'api',
            rate: 10,
            errorRate: 0.08,
            p50Ms: 10,
            p95Ms: 20,
            p99Ms: 22,
            callCount: 100,
          },
        ],
      });
      return recent;
    });

    await runTraceAnomalyCycle({ computeRed: computeRed as never });

    const errorAnomalies = inserted.filter((r) => r.metric_type === 'error_rate');
    expect(errorAnomalies.length).toBeGreaterThan(0);
    expect(errorAnomalies[0].category).toBe('anomaly');
    expect(errorAnomalies[0].title.toLowerCase()).toContain('error');
    expect(errorAnomalies[0].title.toLowerCase()).toContain('api');
  });

  it('does not write anomalies when recent values are within baseline', async () => {
    const spy = vi.spyOn(insightsStore, 'insertInsights').mockResolvedValue(new Set());

    const computeRed = vi.fn(async () => buildBaseline('api', 20, 0.001, 24));

    await runTraceAnomalyCycle({ computeRed: computeRed as never });

    // Either not called or called with empty array
    for (const call of spy.mock.calls) {
      expect(call[0]).toEqual([]);
    }
  });

  it('returns gracefully when computeRed throws', async () => {
    const spy = vi.spyOn(insightsStore, 'insertInsights').mockResolvedValue(new Set());
    const computeRed = vi.fn(async () => {
      throw new Error('db down');
    });

    await expect(
      runTraceAnomalyCycle({ computeRed: computeRed as never }),
    ).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
