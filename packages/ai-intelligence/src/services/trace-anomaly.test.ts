import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub getConfig() before the SUT imports it — test env doesn't satisfy the
// full production env schema (JWT_SECRET, DASHBOARD_USERNAME, etc.).
vi.mock('@dashboard/core/config/index.js', () => ({
  getConfig: () => ({
    TRACES_ANOMALY_P95_ZSCORE: 3.0,
    TRACES_ANOMALY_ERROR_RATE_PCT: 5,
    // Per-service rate limit & warm-up controls introduced in #1294.
    TRACES_ANOMALY_PER_SERVICE_MIN: 5,
    TRACES_ANOMALY_MIN_SAMPLES: 10,
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
    // Service name is projected into container_name so existing dashboard
    // correlation that groups by container picks the anomaly up (#1236).
    expect(latencyAnomalies[0].container_name).toBe('api');
  });

  it('suppresses duplicate inserts during the cooldown window', async () => {
    const inserted: insightsStore.InsightInsert[] = [];
    vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    const computeRed = vi.fn(async (q: { bucket: string }) => {
      if (q.bucket === '1h') return buildBaseline('api', 20, 0.001, 24);
      // Persistent latency spike that stays anomalous across multiple cycles.
      const recent = buildRecent('api', 20, 0.001, 5);
      recent.buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString(),
        rows: [{ group: 'api', rate: 10, errorRate: 0.001, p50Ms: 400, p95Ms: 800, p99Ms: 900, callCount: 100 }],
      });
      return recent;
    });

    await runTraceAnomalyCycle({ computeRed: computeRed as never });
    await runTraceAnomalyCycle({ computeRed: computeRed as never });
    await runTraceAnomalyCycle({ computeRed: computeRed as never });

    const latencyAnomalies = inserted.filter((r) => r.metric_type === 'latency_p95');
    // Only the first cycle inserts; the cooldown suppresses the rest.
    expect(latencyAnomalies).toHaveLength(1);
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

  // ─── Fix 7 regression — per-service rate limit (#1294) ─────────────────
  it('per-service rate limit collapses a 1-minute burst into a single anomaly', async () => {
    // Burst scenario: a single service (`api`) flaps badly enough that both
    // latency_p95 AND error_rate would fire on every cycle. Without the
    // per-service rate limit added in #1294 the existing per-(service,
    // metric_type) cooldown would let every cycle emit a fresh anomaly per
    // metric_type, allowing two anomalies per cycle. The new rate limit caps
    // the service to one anomaly per `TRACES_ANOMALY_PER_SERVICE_MIN` minutes
    // regardless of metric_type. Across 10 cycles within 1 minute we expect
    // exactly 1 persisted insight (the very first one).
    const inserted: insightsStore.InsightInsert[] = [];
    vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    const computeRed = vi.fn(async (q: { bucket: string }) => {
      if (q.bucket === '1h') return buildBaseline('api', 20, 0.001, 24);
      // Recent: persistent latency spike (800ms vs 20ms baseline) AND
      // simultaneous error-rate spike (8% vs 0.1%) — both branches would fire
      // on every cycle absent the rate limit.
      const recent = buildRecent('api', 20, 0.001, 5);
      recent.buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString(),
        rows: [{ group: 'api', rate: 10, errorRate: 0.08, p50Ms: 400, p95Ms: 800, p99Ms: 900, callCount: 100 }],
      });
      return recent;
    });

    // 10 cycles back-to-back, well within the 5-minute window.
    for (let i = 0; i < 10; i++) {
      await runTraceAnomalyCycle({ computeRed: computeRed as never });
    }

    expect(inserted).toHaveLength(1);
  });

  // ─── Fix 7 upper-bound — burst clears once the rate-limit window expires ──
  it('per-service rate limit releases after TRACES_ANOMALY_PER_SERVICE_MIN expires', async () => {
    // Lower-bound twin of the burst test above: after the per-service window
    // (5 min for this test) elapses, the next anomalous cycle MUST fire again.
    // Uses fake timers to advance Date.now() past the rate-limit window without
    // sleeping. The 10-min per-(service, metric_type) cooldown is also keyed on
    // Date.now() so we advance well past it (10 min + buffer).
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 14, 13, 0, 0)));

    const inserted: insightsStore.InsightInsert[] = [];
    vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
      inserted.push(...rows);
      return new Set(rows.map((r) => r.id));
    });

    const computeRed = vi.fn(async (q: { bucket: string }) => {
      if (q.bucket === '1h') return buildBaseline('api', 20, 0.001, 24);
      const recent = buildRecent('api', 20, 0.001, 5);
      recent.buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString(),
        rows: [{ group: 'api', rate: 10, errorRate: 0.08, p50Ms: 400, p95Ms: 800, p99Ms: 900, callCount: 100 }],
      });
      return recent;
    });

    // First cycle fires once (latency or error; either is fine for the bound).
    await runTraceAnomalyCycle({ computeRed: computeRed as never });
    expect(inserted.length).toBeGreaterThanOrEqual(1);
    const firstCount = inserted.length;

    // Second cycle still inside the window — suppressed.
    await runTraceAnomalyCycle({ computeRed: computeRed as never });
    expect(inserted).toHaveLength(firstCount);

    // Advance past both the per-service window (5 min) and the per-key cooldown
    // (10 min). 11 minutes is comfortably past both.
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

    await runTraceAnomalyCycle({ computeRed: computeRed as never });
    // Upper-bound: at least one fresh anomaly must have fired after the window.
    expect(inserted.length).toBeGreaterThan(firstCount);

    vi.useRealTimers();
  });

  // ─── Fix 8 regression — trace-path baseline warm-up (#1294) ─────────────
  it('skips a brand-new service with < TRACES_ANOMALY_MIN_SAMPLES baseline buckets', async () => {
    // Warm-up scenario: a freshly-deployed service has only 5 baseline
    // buckets — below the 10-sample floor configured above. Even though the
    // recent reading is a clear spike that *would* have been flagged with
    // 24 buckets of baseline, the warm-up gate must suppress it entirely.
    const insertSpy = vi.spyOn(insightsStore, 'insertInsights').mockResolvedValue(new Set());

    const computeRed = vi.fn(async (q: { bucket: string }) => {
      if (q.bucket === '1h') {
        // Only 5 baseline buckets — under the minBaselineSamples = 10 floor.
        return buildBaseline('newsvc', 20, 0.001, 5);
      }
      // Recent: clear latency + error spike that would normally fire.
      const recent = buildRecent('newsvc', 20, 0.001, 5);
      recent.buckets.push({
        bucketStart: new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString(),
        rows: [{ group: 'newsvc', rate: 10, errorRate: 0.08, p50Ms: 400, p95Ms: 800, p99Ms: 900, callCount: 100 }],
      });
      return recent;
    });

    await runTraceAnomalyCycle({ computeRed: computeRed as never });

    // Warm-up branch reached: computeRed was queried for both buckets, but
    // because baseline samples are below the floor the SUT never reaches the
    // store. runTraceAnomalyCycle short-circuits on `insights.length === 0`,
    // so `insertInsights` must not be called at all (cf. trace-anomaly.ts:286).
    expect(computeRed).toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
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

  // ──────────────────────────────────────────────────────────────────────
  // Correlated suppression (#1296)
  // ──────────────────────────────────────────────────────────────────────

  describe('correlated suppression (#1296)', () => {
    /**
     * Helper: build a computeRed mock whose recent bucket carries both a
     * p95 spike and an elevated error rate in the SAME minute bucket.
     */
    function spikedRecent(p95: number, errorRate: number, bucketIso: string): RedResult {
      const recent = buildRecent('api', 20, 0.001, 5);
      recent.buckets.push({
        bucketStart: bucketIso,
        rows: [
          {
            group: 'api',
            rate: 10,
            errorRate,
            p50Ms: p95 * 0.5,
            p95Ms: p95,
            p99Ms: p95 * 1.1,
            callCount: 100,
          },
        ],
      });
      return recent;
    }

    it('collapses two dimensions in the same minute into ONE record with dimensions=[p95, error_rate]', async () => {
      const inserted: insightsStore.InsightInsert[] = [];
      vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
        inserted.push(...rows);
        return new Set(rows.map((r) => r.id));
      });

      const sameMinute = new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString();
      const computeRed = vi.fn(async (q: { bucket: string }) => {
        if (q.bucket === '1h') return buildBaseline('api', 20, 0.001, 24);
        // Both dimensions cross threshold in the same minute bucket.
        return spikedRecent(800, 0.08, sameMinute);
      });

      await runTraceAnomalyCycle({ computeRed: computeRed as never });

      // Exactly one record, with both signals in `dimensions`.
      expect(inserted).toHaveLength(1);
      const [record] = inserted;
      expect(record.dimensions).toBeDefined();
      expect(record.dimensions).toHaveLength(2);
      const types = record.dimensions!.map((d) => d.type).sort();
      expect(types).toEqual(['error_rate', 'latency_p95']);
      // The primary metric_type drives signature derivation; both signals
      // are surfaced in the title.
      expect(['latency_p95', 'error_rate']).toContain(record.metric_type);
      expect(record.title.toLowerCase()).toContain('correlated');
      expect(record.title).toContain('error_rate');
      expect(record.title).toContain('latency_p95');
      // Service name is projected into container_name so existing
      // correlation infra picks the record up.
      expect(record.container_name).toBe('api');
      // Each dimension carries enough context for downstream UI rendering.
      for (const d of record.dimensions!) {
        expect(typeof d.value).toBe('number');
        expect(typeof d.baseline).toBe('number');
        expect(typeof d.zScore).toBe('number');
        expect(['warning', 'critical']).toContain(d.severity);
      }
    });

    it('writes TWO separate records when the two dimensions fire in different minutes', async () => {
      const inserted: insightsStore.InsightInsert[] = [];
      vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
        inserted.push(...rows);
        return new Set(rows.map((r) => r.id));
      });

      // First cycle: only p95 spikes in minute T.
      const cycleAt = (bucketIso: string, p95: number, errorRate: number) => {
        return vi.fn(async (q: { bucket: string }) => {
          if (q.bucket === '1h') return buildBaseline('api', 20, 0.001, 24);
          return spikedRecent(p95, errorRate, bucketIso);
        });
      };

      const minute1 = new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString();
      const minute2 = new Date(Date.UTC(2026, 4, 14, 13, 15)).toISOString();

      // Cycle 1 — only latency spikes.
      await runTraceAnomalyCycle({ computeRed: cycleAt(minute1, 800, 0.001) as never });
      // Reset cooldown so cycle 2 actually fires a new error-rate insert
      // (the cooldown is real-time, so on a fresh process this is moot —
      // but be explicit to guard against test-order dependence).
      __resetTraceAnomalyLogState();
      // Cycle 2 — only error rate spikes in a different minute.
      await runTraceAnomalyCycle({ computeRed: cycleAt(minute2, 20, 0.08) as never });

      // No correlated record: each cycle produces a single-dim insight.
      expect(inserted.filter((r) => r.dimensions)).toHaveLength(0);
      expect(inserted).toHaveLength(2);
      const types = inserted.map((r) => r.metric_type).sort();
      expect(types).toEqual(['error_rate', 'latency_p95']);
    });

    it('preserves single-dimension behaviour: one dimension only → one record without `dimensions`', async () => {
      const inserted: insightsStore.InsightInsert[] = [];
      vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
        inserted.push(...rows);
        return new Set(rows.map((r) => r.id));
      });

      const computeRed = vi.fn(async (q: { bucket: string }) => {
        if (q.bucket === '1h') return buildBaseline('api', 20, 0.001, 24);
        // Only p95 spikes; error rate stays at baseline.
        return spikedRecent(800, 0.001, new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString());
      });

      await runTraceAnomalyCycle({ computeRed: computeRed as never });

      expect(inserted).toHaveLength(1);
      expect(inserted[0].dimensions).toBeUndefined();
      expect(inserted[0].metric_type).toBe('latency_p95');
      // Title is the original single-dim form, NOT the correlated form.
      expect(inserted[0].title.toLowerCase()).toContain('latency');
      expect(inserted[0].title.toLowerCase()).not.toContain('correlated');
    });

    it('correlated cooldown blocks BOTH per-dimension and re-correlated alerts on the same service', async () => {
      const inserted: insightsStore.InsightInsert[] = [];
      vi.spyOn(insightsStore, 'insertInsights').mockImplementation(async (rows) => {
        inserted.push(...rows);
        return new Set(rows.map((r) => r.id));
      });

      const minute1 = new Date(Date.UTC(2026, 4, 14, 13, 0)).toISOString();
      const minute2 = new Date(Date.UTC(2026, 4, 14, 13, 5)).toISOString();
      const computeRed = vi.fn(async (q: { bucket: string }) => {
        if (q.bucket === '1h') return buildBaseline('api', 20, 0.001, 24);
        // Bucket alternates to simulate two different recent minutes
        // both crossing both thresholds.
        const callCount = computeRed.mock.calls.length;
        const bucket = callCount <= 2 ? minute1 : minute2;
        return spikedRecent(800, 0.08, bucket);
      });

      // Cycle 1 — fires the correlated insert.
      await runTraceAnomalyCycle({ computeRed: computeRed as never });
      // Cycle 2 — even though both thresholds are crossed in a different
      // minute, the 10-minute cooldown on the per-dimension keys still
      // suppresses the new alert. The minute-bucket part of the
      // correlated key is documented as "per minute" — but the
      // per-dimension keys override that to enforce the existing
      // "one anomaly per service per cooldown window" guarantee.
      await runTraceAnomalyCycle({ computeRed: computeRed as never });

      const newInsights = inserted.filter((r) => r.category === 'anomaly');
      expect(newInsights).toHaveLength(1);
      expect(newInsights[0].dimensions).toHaveLength(2);
    });
  });
});
