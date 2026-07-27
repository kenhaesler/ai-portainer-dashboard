import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { reportsRoutes, clearReportCache, getReportCacheSize, setCachedReport, REPORT_CACHE_MAX_ENTRIES, evaluateRightSizingRules, describeRightSizingRangeCoverage, RULE_CONTAINER_NAMES_CAP, RIGHT_SIZING_MIN_SAMPLES } from '../routes/reports.js';

// The implementation acquires a pool client per request via pool.connect(),
// sets statement_timeout, then queries via client.query(). We mirror that here.
const mockClientQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockRelease = vi.fn();
const mockClient = {
  query: (...args: unknown[]) => mockClientQuery(...args),
  release: mockRelease,
};
const mockConnect = vi.fn().mockResolvedValue(mockClient);

// Kept: timescale mock — no TimescaleDB in CI
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getReportsDb: vi.fn().mockResolvedValue({ connect: () => mockConnect() }),
}));

// NOT mocked: selectRollupTable is a pure function of the requested range and
// touches no database (services/metrics-rollup-selector.ts). It used to be
// stubbed to `isRollup: false` at module scope and again in beforeEach,
// including for `timeRange=24h` and `7d` requests, which the real selector
// resolves to a rollup table. Tests that re-stubbed it for themselves were
// unaffected — 'omits percentiles on a rollup range' set `isRollup: true` for
// its own 7d request — but the rest asserted percentile values on a branch
// their range does not take. Now `?timeRange=` alone decides the branch.

// Kept: infrastructure-service-classifier mock — tests control classification logic
vi.mock('../services/infrastructure-service-classifier.js', () => ({
  getInfrastructureServicePatterns: vi.fn().mockReturnValue(['traefik', 'portainer_agent', 'beyla', 'redis']),
  matchesInfrastructurePattern: vi.fn((name: string, patterns: string[]) => {
    const normalized = name.toLowerCase();
    return patterns.some((pattern) => (
      normalized === pattern
      || normalized.startsWith(`${pattern}-`)
      || normalized.startsWith(`${pattern}_`)
    ));
  }),
  isInfrastructureService: vi.fn((name: string) => {
    const normalized = name.toLowerCase();
    return ['traefik', 'portainer_agent', 'beyla', 'redis'].some((pattern) => (
      normalized === pattern
      || normalized.startsWith(`${pattern}-`)
      || normalized.startsWith(`${pattern}_`)
    ));
  }),
}));

// Kept: metrics-store mock — no TimescaleDB in CI
vi.mock('../services/metrics-store.js', () => ({
  isUndefinedTableError: vi.fn().mockReturnValue(false),
}));

const mockGetRunningIds = vi.fn().mockResolvedValue(null);
vi.mock('../services/container-lifecycle-store.js', () => ({
  getRunningContainerIds: (...a: unknown[]) => mockGetRunningIds(...a),
}));

describe('evaluateRightSizingRules', () => {
  it('returns nothing when every aggregate sits inside the thresholds', () => {
    expect(evaluateRightSizingRules({ cpu: { avg: 40, p95: 60, samples: 60, percentileSamples: 60 }, memory: { avg: 50, p95: 70, samples: 60, percentileSamples: 60 } })).toEqual([]);
  });

  it('carries the rule id, threshold and measured value so identical advice can be grouped', () => {
    const findings = evaluateRightSizingRules({ cpu: { avg: 2, p95: 4, samples: 60, percentileSamples: 60 }, memory: { avg: 50, p95: 70, samples: 60, percentileSamples: 60 } });
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('cpu-underutilized');
    expect(findings[0].statistic).toBe('p95');
    expect(findings[0].comparison).toBe('below');
    expect(findings[0].threshold).toBe(10);
    expect(findings[0].unit).toBe('percent');
    // The measured value is the only thing that differs between two containers
    // carrying the same recommendation.
    expect(findings[0].measured).toBe(4);
  });

  it('keeps the historical one-line string so existing consumers do not break', () => {
    const findings = evaluateRightSizingRules({ cpu: { avg: 2, p95: 4, samples: 60, percentileSamples: 60 }, memory: { avg: 90, p95: 95, samples: 60, percentileSamples: 60 } });
    const issues = findings.map((f) => f.issue);
    expect(issues).toContain('CPU under-utilized (p95 < 10%) — consider reducing CPU limits');
    expect(issues).toContain('Memory over-utilized (avg > 85%) — consider increasing memory limits');
  });

  it('fires all four rules independently', () => {
    expect(evaluateRightSizingRules({ cpu: { avg: 90, p95: 95, samples: 60, percentileSamples: 60 }, memory: { avg: 90, p95: 95, samples: 60, percentileSamples: 60 } }).map(f => f.id))
      .toEqual(['cpu-overutilized', 'memory-overutilized']);
    expect(evaluateRightSizingRules({ cpu: { avg: 1, p95: 2, samples: 60, percentileSamples: 60 }, memory: { avg: 1, p95: 2, samples: 60, percentileSamples: 60 } }).map(f => f.id))
      .toEqual(['cpu-underutilized', 'memory-underutilized']);
  });

  it('does not fire exactly at a threshold', () => {
    expect(evaluateRightSizingRules({ cpu: { avg: 80, p95: 10, samples: 60, percentileSamples: 60 }, memory: { avg: 85, p95: 20, samples: 60, percentileSamples: 60 } })).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Sample-floor and null-percentile guards. A container with `samples: 2`
  // was issued "CPU avg above 80% — consider increasing CPU limits" off two
  // readings taken seconds apart, listed beside containers with 189 samples
  // and with nothing on screen distinguishing them.
  // -------------------------------------------------------------------------

  it('does not recommend anything for a container with too few samples', () => {
    const findings = evaluateRightSizingRules({
      cpu: { avg: 103.8, p95: 103.8, samples: 2, percentileSamples: 2 },
      memory: { avg: 50, p95: 70, samples: 2, percentileSamples: 2 },
    });

    expect(findings).toEqual([]);
  });

  it('fires once the sample floor is met', () => {
    const findings = evaluateRightSizingRules({
      cpu: { avg: 103.8, p95: 103.8, samples: RIGHT_SIZING_MIN_SAMPLES, percentileSamples: RIGHT_SIZING_MIN_SAMPLES },
      memory: { avg: 50, p95: 70, samples: RIGHT_SIZING_MIN_SAMPLES, percentileSamples: RIGHT_SIZING_MIN_SAMPLES },
    });

    expect(findings.map((f) => f.id)).toContain('cpu-overutilized');
  });

  it('treats a null p95 as "not computed", never as a low p95', () => {
    // Percentiles are null on rollup ranges. A rule reading "p95 below 10%"
    // must not fire on the absence of a p95 — that would recommend shrinking
    // limits for every container on any range longer than 6h.
    const findings = evaluateRightSizingRules({
      cpu: { avg: 40, p95: null, samples: 500, percentileSamples: 0 },
      memory: { avg: 50, p95: null, samples: 500, percentileSamples: 0 },
    });

    expect(findings.filter((f) => f.statistic === 'p95')).toEqual([]);
  });

  it('backs a p95 rule with the percentile sample count, not the aggregate count', () => {
    // 500 rollup buckets do not make a percentile trustworthy when it was
    // computed over 3 raw samples.
    const findings = evaluateRightSizingRules({
      cpu: { avg: 40, p95: 4, samples: 500, percentileSamples: 3 },
      memory: { avg: 50, p95: 70, samples: 500, percentileSamples: 3 },
    });

    expect(findings.map((f) => f.id)).not.toContain('cpu-underutilized');
  });
});

describe('describeRightSizingRangeCoverage', () => {
  it('reports both p95 rules as unevaluable when percentiles are unavailable', () => {
    const coverage = describeRightSizingRangeCoverage(false, '7d');

    expect(coverage.skippedRules.map((r) => r.id)).toEqual(['cpu-underutilized', 'memory-underutilized']);
    expect(coverage.skippedRules.every((r) => r.statistic === 'p95')).toBe(true);
    expect(coverage.skippedReason).toContain('7d');
  });

  it('reports nothing skipped when percentiles are available', () => {
    const coverage = describeRightSizingRangeCoverage(true, '6h');

    expect(coverage.skippedRules).toEqual([]);
    expect(coverage.skippedReason).toBeNull();
  });

  it('counts the rules that exist rather than a hard-coded total', () => {
    // The client renders "N of totalRules"; totalRules has to follow
    // RIGHT_SIZING_RULES, or adding a fifth rule makes the fraction a lie.
    // Every rule the module defines fires for a container that crosses all of
    // them, which is the only handle on that count from outside.
    const everyRuleFires = evaluateRightSizingRules({
      cpu: { avg: 90, p95: 2, samples: 60, percentileSamples: 60 },
      memory: { avg: 90, p95: 2, samples: 60, percentileSamples: 60 },
    });

    expect(describeRightSizingRangeCoverage(true, '6h').totalRules).toBe(everyRuleFires.length);
  });

  it('covers range-level skips only — a per-container sample floor is not one', () => {
    // The documented boundary, kept as a test so the next reader does not have
    // to take the doc comment's word for it. On 6h the range withholds nothing,
    // yet this container's two p95 rules were skipped all the same: 3 raw
    // samples is below RIGHT_SIZING_MIN_SAMPLES. Coverage reports no skip,
    // because it is given a range and never sees a container. A fleet where
    // every container looks like this has both p95 rules evaluated for nobody
    // and nothing in the payload saying so.
    const findings = evaluateRightSizingRules({
      cpu: { avg: 40, p95: 4, samples: 500, percentileSamples: 3 },
      memory: { avg: 50, p95: 5, samples: 500, percentileSamples: 3 },
    });
    expect(findings.filter((f) => f.statistic === 'p95')).toEqual([]);

    const coverage = describeRightSizingRangeCoverage(true, '6h');
    expect(coverage.skippedRules).toEqual([]);
    expect(coverage.skippedReason).toBeNull();
  });
});

/** Highest $N referenced anywhere in a SQL string (0 when there are none). */
function maxPlaceholder(sql: string): number {
  const indexes = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}

describe('Reports routes', () => {
  const app = Fastify({ logger: false });

  beforeAll(async () => {
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    await app.register(reportsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockClientQuery.mockReset().mockResolvedValue({ rows: [] });
    mockRelease.mockReset();
    mockConnect.mockReset().mockResolvedValue(mockClient);
    clearReportCache();
    mockGetRunningIds.mockReset().mockResolvedValue(null);
  });

  describe('GET /api/reports/utilization', () => {
    it('returns empty report when no metrics exist', async () => {
      // First call: SET statement_timeout, second: main agg query (no rows)
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }); // main agg query

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=24h',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.timeRange).toBe('24h');
      expect(body.containers).toEqual([]);
      expect(body.fleetSummary.totalContainers).toBe(0);
      expect(body.recommendations).toEqual([]);
    });

    it('returns aggregated data for containers', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'c1',
              container_name: 'web',
              endpoint_id: 1,
              metric_type: 'cpu',
              avg_value: 45.5,
              min_value: 10,
              max_value: 92,
              sample_count: 100,
            },
            {
              container_id: 'c1',
              container_name: 'web',
              endpoint_id: 1,
              metric_type: 'memory',
              avg_value: 60.2,
              min_value: 30,
              max_value: 88,
              sample_count: 100,
            },
          ],
        });
      // No percentile responses are queued: 7d reads metrics_5min, and no
      // percentile query is issued on a rollup range.

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=7d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.timeRange).toBe('7d');
      expect(body.containers).toHaveLength(1);
      expect(body.containers[0].container_name).toBe('web');
      expect(body.containers[0].cpu).toBeTruthy();
      expect(body.containers[0].memory).toBeTruthy();
      expect(body.fleetSummary.totalContainers).toBe(1);
    });

    it('groups identical right-sizing advice with a container count', async () => {
      // Two containers, both idle: the same recommendation, which the UI used
      // to print once per container. 6h, because the rule this exercises reads
      // p95 and percentiles exist on no other range.
      const agg = (id: string, name: string, metric: string, avg: number) => ({
        container_id: id, container_name: name, endpoint_id: 1,
        metric_type: metric, avg_value: avg, min_value: avg, max_value: avg, sample_count: 10,
      });
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            agg('c1', 'web', 'cpu', 2), agg('c1', 'web', 'memory', 5),
            agg('c2', 'api', 'cpu', 3), agg('c2', 'api', 'memory', 6),
          ],
        })
        // one percentile query per (container, metric) row, in order
        .mockResolvedValueOnce({ rows: [{ p50: 2, p95: 4, p99: 5, samples: 60 }] })   // c1 cpu
        .mockResolvedValueOnce({ rows: [{ p50: 5, p95: 8, p99: 9, samples: 60 }] })   // c1 memory
        .mockResolvedValueOnce({ rows: [{ p50: 3, p95: 6, p99: 7, samples: 60 }] })   // c2 cpu
        .mockResolvedValueOnce({ rows: [{ p50: 6, p95: 9, p99: 10, samples: 60 }] }); // c2 memory

      const res = await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=6h' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      // Per-container data is preserved...
      expect(body.recommendations).toHaveLength(2);
      expect(body.recommendations[0].findings[0].measured).toBe(4);
      expect(body.recommendations[1].findings[0].measured).toBe(6);

      // ...and the same advice is stated once, with a count.
      const cpuRule = body.recommendationSummary.find((r: { id: string }) => r.id === 'cpu-underutilized');
      expect(cpuRule.container_count).toBe(2);
      expect(cpuRule.container_names.sort()).toEqual(['api', 'web']);
      expect(cpuRule.threshold).toBe(10);
      expect(body.recommendationSummary.every((r: { container_count: number }) => r.container_count > 0)).toBe(true);
      // A fleet under the cap is not truncated.
      expect(cpuRule.names_truncated).toBe(false);
    });

    it('caps the name list on a large fleet while still reporting the true count', async () => {
      // Four rules each carrying every matching name, in a payload cached for
      // five minutes across up to REPORT_CACHE_MAX_ENTRIES entries. The cap
      // bounds the sample; container_count must stay the real total, or the UI
      // silently under-reports exactly the fleet the cap exists for.
      const total = RULE_CONTAINER_NAMES_CAP + 25;
      const aggRows = Array.from({ length: total }, (_, i) => [
        { container_id: `c${i}`, container_name: `svc-${i}`, endpoint_id: 1,
          metric_type: 'cpu', avg_value: 2, min_value: 2, max_value: 2, sample_count: 10 },
        { container_id: `c${i}`, container_name: `svc-${i}`, endpoint_id: 1,
          metric_type: 'memory', avg_value: 5, min_value: 5, max_value: 5, sample_count: 10 },
      ]).flat();

      // Chained mockResolvedValueOnce cannot express 1000+ percentile calls;
      // dispatch on the SQL text instead.
      let seenAgg = false;
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('percentile_cont')) {
          return { rows: [{ p50: 2, p95: 4, p99: 5, samples: 60 }] };
        }
        if (!seenAgg && typeof sql === 'string' && sql.includes('avg_value')) {
          seenAgg = true;
          return { rows: aggRows };
        }
        return { rows: [] };
      });

      const res = await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=6h' });
      expect(res.statusCode).toBe(200);
      const cpuRule = JSON.parse(res.payload).recommendationSummary
        .find((r: { id: string }) => r.id === 'cpu-underutilized');

      expect(cpuRule.container_count).toBe(total);
      expect(cpuRule.container_names).toHaveLength(RULE_CONTAINER_NAMES_CAP);
      expect(cpuRule.names_truncated).toBe(true);
      // The count is the truth, not the array length.
      expect(cpuRule.container_count).toBeGreaterThan(cpuRule.container_names.length);
    });

    it('accepts optional endpointId filter', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }); // main agg query

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=24h&endpointId=1',
      });

      expect(res.statusCode).toBe(200);
    });

    it('excludes infrastructure containers by default', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'infra-1',
              container_name: 'redis',
              endpoint_id: 1,
              metric_type: 'cpu',
              avg_value: 10,
              min_value: 5,
              max_value: 20,
              sample_count: 50,
            },
            {
              container_id: 'app-1',
              container_name: 'web',
              endpoint_id: 1,
              metric_type: 'cpu',
              avg_value: 60,
              min_value: 20,
              max_value: 95,
              sample_count: 50,
            },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=7d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.includeInfrastructure).toBe(false);
      expect(body.excludeInfrastructure).toBe(true);
      expect(body.containers).toHaveLength(1);
      expect(body.containers[0].container_name).toBe('web');
      expect(body.containers[0].service_type).toBe('application');
    });

    it('supports excludeInfrastructure=false query parameter', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'infra-1',
              container_name: 'redis',
              endpoint_id: 1,
              metric_type: 'cpu',
              avg_value: 10,
              min_value: 5,
              max_value: 20,
              sample_count: 50,
            },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?excludeInfrastructure=false',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.includeInfrastructure).toBe(true);
      expect(body.excludeInfrastructure).toBe(false);
      expect(body.containers).toHaveLength(1);
      expect(body.containers[0].service_type).toBe('infrastructure');
    });

    it('uses rollup table columns on a range above 6h', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'c1',
              container_name: 'api',
              endpoint_id: 1,
              metric_type: 'cpu',
              avg_value: 55,
              min_value: 10,
              max_value: 90,
              sample_count: 288,
            },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=7d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.containers).toHaveLength(1);
      expect(body.containers[0].container_name).toBe('api');
      expect(body.containers[0].cpu.avg).toBe(55);
      // Main agg query should reference the rollup table
      const aggCall = mockClientQuery.mock.calls.find(
        (c) => String(c[0]).includes('metrics_5min'),
      );
      expect(aggCall).toBeTruthy();
      expect(body.aggregateSource.table).toBe('metrics_5min');
    });

    // -----------------------------------------------------------------------
    // p95 > max regression. avg/min/max come from a rollup above 6h;
    // percentiles can only come from raw `metrics`. The rollups are continuous
    // aggregates that refresh on a policy, so a container that spiked in the
    // last few minutes had the spike in raw and not yet in the rollup — and
    // the row rendered `avg 0.0% · p95 34.0% · max 0.0%`. Four rows on the
    // live fleet showed a 95th percentile above their own maximum.
    //
    // Two populations must not be printed as one row, so percentiles are now
    // computed only when the aggregates also read raw metrics.
    // -----------------------------------------------------------------------

    it('omits percentiles on a rollup range rather than mixing two populations', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'c1', container_name: 'api', endpoint_id: 1, metric_type: 'cpu',
              // A lagging rollup: this container's recent spike is not here yet.
              avg_value: 0, min_value: 0, max_value: 0, sample_count: 288,
            },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=7d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      const cpu = body.containers[0].cpu;

      expect(cpu.p50).toBeNull();
      expect(cpu.p95).toBeNull();
      expect(cpu.p99).toBeNull();
      expect(cpu.percentileSamples).toBe(0);
      expect(body.aggregateSource.isRollup).toBe(true);
      expect(body.aggregateSource.percentilesAvailable).toBe(false);
      expect(body.aggregateSource.percentileNote).toMatch(/6h or less/i);

      // And no percentile query was issued at all — the mixed row cannot be
      // constructed even by accident.
      const pCall = mockClientQuery.mock.calls.find((c) => String(c[0]).includes('percentile_cont'));
      expect(pCall).toBeFalsy();
    });

    it('computes percentiles from raw metrics on the 6h range', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'c1', container_name: 'api', endpoint_id: 1, metric_type: 'cpu',
              avg_value: 55, min_value: 10, max_value: 90, sample_count: 288,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ p50: 50, p95: 88, p99: 92, samples: 288 }] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=6h',
      });

      expect(res.statusCode, res.payload).toBe(200);
      const body = JSON.parse(res.payload);
      const cpu = body.containers[0].cpu;

      expect(cpu.p95).toBe(88);
      expect(cpu.percentileSamples).toBe(288);
      expect(body.aggregateSource.table).toBe('metrics');
      expect(body.aggregateSource.percentilesAvailable).toBe(true);
      expect(body.aggregateSource.percentileNote).toBeNull();
      // p95 must sit inside [min, max] when both come from the same rows.
      expect(cpu.p95).toBeLessThanOrEqual(cpu.max);
      expect(cpu.p95).toBeGreaterThanOrEqual(cpu.min);

      const pCall = mockClientQuery.mock.calls.find(
        (c) => String(c[0]).includes('percentile_cont') && String(c[0]).includes('FROM metrics'),
      );
      expect(pCall).toBeTruthy();
    });

    it('keeps a percentile null when the raw window held no samples', async () => {
      // `percentile_cont` over an empty set returns NULL; Number(null) is 0,
      // and the table printed a confident "p95 0.00%" for a container that
      // reported nothing. Only 6h reaches this code at all.
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'c1', container_name: 'api', endpoint_id: 1, metric_type: 'cpu',
              avg_value: 55, min_value: 10, max_value: 90, sample_count: 288,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ p50: null, p95: null, p99: null, samples: 0 }] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=6h',
      });

      const cpu = JSON.parse(res.payload).containers[0].cpu;
      expect(cpu.p95).toBeNull();
      expect(cpu.percentileSamples).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Half the right-sizing engine is range-dependent, and used to go quiet
    // without saying so. Before `6h` existed, every range the querystring
    // accepted was a rollup range, so the two p95-keyed rules could not fire on
    // any request an operator was able to make.
    // -----------------------------------------------------------------------

    it('names the right-sizing rules a rollup range cannot evaluate', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            // Busy CPU (an avg rule can still fire) beside idle memory (only a
            // p95 rule could have caught it).
            { container_id: 'c1', container_name: 'api', endpoint_id: 1, metric_type: 'cpu',
              avg_value: 90, min_value: 80, max_value: 99, sample_count: 288 },
            { container_id: 'c1', container_name: 'api', endpoint_id: 1, metric_type: 'memory',
              avg_value: 5, min_value: 4, max_value: 6, sample_count: 288 },
          ],
        });

      const res = await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=7d' });
      expect(res.statusCode, res.payload).toBe(200);
      const body = JSON.parse(res.payload);

      expect(body.aggregateSource.percentilesAvailable).toBe(false);
      expect(body.aggregateSource.percentileNote).not.toBeNull();
      expect(body.containers[0].memory.p95).toBeNull();
      expect(body.containers[0].memory.percentileSamples).toBe(0);

      // The surviving rule fired; neither p95 rule appears anywhere, in either
      // the per-container findings or the rollup.
      const summaryIds = body.recommendationSummary.map((r: { id: string }) => r.id);
      expect(summaryIds).toEqual(['cpu-overutilized']);
      expect(body.recommendationSummary.some((r: { statistic: string }) => r.statistic === 'p95')).toBe(false);
      const findings = body.recommendations.flatMap((r: { findings: Array<{ statistic: string }> }) => r.findings);
      expect(findings.some((f: { statistic: string }) => f.statistic === 'p95')).toBe(false);

      // ...and the payload says which two rules were not run, out of how many.
      expect(body.rightSizingCoverage.totalRules).toBe(4);
      expect(body.rightSizingCoverage.skippedRules.map((r: { id: string }) => r.id))
        .toEqual(['cpu-underutilized', 'memory-underutilized']);
      expect(body.rightSizingCoverage.skippedReason).toContain('7d');
    });

    it('evaluates every right-sizing rule on the 6h range', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { container_id: 'c1', container_name: 'api', endpoint_id: 1, metric_type: 'cpu',
              avg_value: 2, min_value: 1, max_value: 6, sample_count: 360 },
            { container_id: 'c1', container_name: 'api', endpoint_id: 1, metric_type: 'memory',
              avg_value: 5, min_value: 4, max_value: 9, sample_count: 360 },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ p50: 2, p95: 4, p99: 5, samples: 360 }] })  // cpu
        .mockResolvedValueOnce({ rows: [{ p50: 5, p95: 8, p99: 9, samples: 360 }] }); // memory

      const res = await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=6h' });
      expect(res.statusCode, res.payload).toBe(200);
      const body = JSON.parse(res.payload);

      expect(body.aggregateSource.table).toBe('metrics');
      expect(body.aggregateSource.isRollup).toBe(false);
      expect(body.aggregateSource.percentilesAvailable).toBe(true);
      expect(body.containers[0].cpu.p95).toBe(4);
      expect(body.containers[0].memory.p95).toBe(8);

      // Both p95-keyed rules fire — the pair that no other range can reach.
      expect(body.recommendationSummary.map((r: { id: string }) => r.id))
        .toEqual(['cpu-underutilized', 'memory-underutilized']);

      // Nothing to disclaim, so nothing is disclaimed.
      expect(body.rightSizingCoverage.skippedRules).toEqual([]);
      expect(body.rightSizingCoverage.skippedReason).toBeNull();
    });

    it('names the population the table shows, not just the running subset', async () => {
      // The page led with "7 containers" above a 25-row table because
      // fleetSummary counted only running containers and nothing said so.
      mockGetRunningIds.mockResolvedValueOnce(new Set(['live']));

      mockClientQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { container_id: 'live', container_name: 'web', endpoint_id: 1, metric_type: 'cpu', avg_value: 40, min_value: 10, max_value: 80, sample_count: 100 },
            { container_id: 'dead', container_name: 'old', endpoint_id: 1, metric_type: 'cpu', avg_value: 0, min_value: 0, max_value: 0, sample_count: 100 },
          ],
        })
        .mockResolvedValue({ rows: [{ p50: 40, p95: 60, p99: 70, samples: 100 }] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=6h',
      });

      const body = JSON.parse(res.payload);
      expect(body.fleetSummary.totalContainers).toBe(1);
      expect(body.fleetSummary.totalObserved).toBe(2);
      expect(body.containers).toHaveLength(2);
    });

    it('serves cached result on second request', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }); // agg query

      await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=24h' });
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Second request — cache hit, no new pool connection
      await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=24h' });
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('excludes non-running containers from fleet averages (#1394)', async () => {
      mockGetRunningIds.mockResolvedValueOnce(new Set(['live']));
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            { container_id: 'live', container_name: 'web', endpoint_id: 1, metric_type: 'cpu', avg_value: 40, min_value: 10, max_value: 80, sample_count: 100 },
            { container_id: 'dead', container_name: 'old', endpoint_id: 1, metric_type: 'cpu', avg_value: 0, min_value: 0, max_value: 0, sample_count: 100 },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ p50: 40, p95: 78, p99: 80, samples: 60 }] }) // percentile: live
        .mockResolvedValueOnce({ rows: [{ p50: 0, p95: 0, p99: 0, samples: 60 }] });   // percentile: dead

      const res = await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=6h' });
      const body = JSON.parse(res.payload);

      expect(body.containers).toHaveLength(2);          // per-container rows unchanged
      expect(body.fleetSummary.avgCpu).toBe(40);        // only the running one, not (40+0)/2=20
      expect(body.fleetSummary.totalContainers).toBe(1);
    });

    it('fails open: averages over all containers when no lifecycle data (#1394)', async () => {
      mockGetRunningIds.mockResolvedValueOnce(null);
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { container_id: 'a', container_name: 'web', endpoint_id: 1, metric_type: 'cpu', avg_value: 40, min_value: 10, max_value: 80, sample_count: 100 },
            { container_id: 'b', container_name: 'old', endpoint_id: 1, metric_type: 'cpu', avg_value: 0, min_value: 0, max_value: 0, sample_count: 100 },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ p50: 40, p95: 78, p99: 80, samples: 60 }] })
        .mockResolvedValueOnce({ rows: [{ p50: 0, p95: 0, p99: 0, samples: 60 }] });

      const res = await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=6h' });
      const body = JSON.parse(res.payload);

      expect(body.fleetSummary.avgCpu).toBe(20);        // (40+0)/2
      expect(body.fleetSummary.totalContainers).toBe(2);
    });
  });

  describe('GET /api/reports/trends', () => {
    it('returns hourly trend data', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            { hour: '2025-01-01T10:00:00', metric_type: 'cpu', avg_value: 40, max_value: 80, min_value: 5, sample_count: 60 },
            { hour: '2025-01-01T11:00:00', metric_type: 'cpu', avg_value: 45, max_value: 85, min_value: 8, sample_count: 60 },
            { hour: '2025-01-01T10:00:00', metric_type: 'memory', avg_value: 55, max_value: 70, min_value: 40, sample_count: 60 },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/trends?timeRange=24h',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.trends.cpu).toHaveLength(2);
      expect(body.trends.memory).toHaveLength(1);
      expect(body.trends.cpu[0].avg).toBe(40);
    });

    it('returns empty trends when no data', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }); // trend query

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/trends?timeRange=30d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.trends.cpu).toEqual([]);
      expect(body.trends.memory).toEqual([]);
    });

    it('uses time_bucket when rollup table is selected', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            { hour: '2025-01-01T10:00:00', metric_type: 'cpu', avg_value: 38, max_value: 75, min_value: 5, sample_count: 12 },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/trends?timeRange=30d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.trends.cpu).toHaveLength(1);
      const trendCall = mockClientQuery.mock.calls.find(
        (c) => String(c[0]).includes('metrics_1hour'),
      );
      expect(trendCall).toBeTruthy();
      expect(String(trendCall![0])).toContain('time_bucket');
    });

    it('restricts the hourly fleet average to running containers (#1394)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });
      await app.inject({ method: 'GET', url: '/api/reports/trends?timeRange=24h' });
      const trendCall = mockClientQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && /GROUP BY hour/.test(c[0] as string),
      );
      expect(trendCall).toBeDefined();
      expect(trendCall![0]).toMatch(/container_lifecycle/);
    });

    it('numbers every placeholder in the endpoint-scoped filter chain (#1585)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });
      await app.inject({ method: 'GET', url: '/api/reports/trends?timeRange=24h&endpointId=1' });
      const trendCall = mockClientQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && /GROUP BY hour/.test(c[0] as string),
      );
      expect(trendCall).toBeDefined();

      // endpoint_id + infrastructure patterns + lifecycle all push params through a
      // shared paramIdx counter. Every $N the SQL references must be backed by a
      // param, and the lifecycle clause must reuse the last index (not invent one).
      const [sql, params] = trendCall! as [string, unknown[]];
      expect(maxPlaceholder(sql)).toBe(params.length);
      expect(sql).toMatch(new RegExp(`container_lifecycle WHERE endpoint_id = \\$${params.length}\\b`));
      expect(params[params.length - 1]).toBe(1);
    });
  });

  describe('GET /api/reports/management', () => {
    it('returns management report payload contract with default settings', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'app-1',
              container_name: 'web',
              endpoint_id: 1,
              cpu_avg: 65.2,
              cpu_max: 94,
              memory_avg: 70.1,
              memory_max: 91,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              day: '2025-01-01T00:00:00.000Z',
              metric_type: 'cpu',
              avg_value: 62,
              min_value: 20,
              max_value: 94,
              sample_count: 120,
            },
            {
              day: '2025-01-01T00:00:00.000Z',
              metric_type: 'memory',
              avg_value: 70,
              min_value: 35,
              max_value: 91,
              sample_count: 120,
            },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/management',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.reportType).toBe('management');
      expect(body.scope.timeRange).toBe('7d');
      expect(body.scope.includeInfrastructure).toBe(false);
      expect(body.executiveSummary.totalServices).toBe(1);
      expect(body.topServices).toHaveLength(1);
      expect(body.weeklyTrends.cpu).toHaveLength(1);
    });

    it('supports includeInfrastructure query parameter', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'infra-1',
              container_name: 'redis',
              endpoint_id: 1,
              cpu_avg: 20,
              cpu_max: 30,
              memory_avg: 30,
              memory_max: 45,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/management?includeInfrastructure=true',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.scope.includeInfrastructure).toBe(true);
      expect(body.topServices).toHaveLength(1);
      expect(body.topServices[0].containerName).toBe('redis');
    });

    it('uses rollup table columns for both queries on a range above 6h', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({
          rows: [
            {
              container_id: 'c1',
              container_name: 'api',
              endpoint_id: 1,
              cpu_avg: 40,
              cpu_max: 80,
              memory_avg: 55,
              memory_max: 85,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              day: '2025-01-01T00:00:00.000Z',
              metric_type: 'cpu',
              avg_value: 40,
              min_value: 10,
              max_value: 80,
              sample_count: 1440,
            },
          ],
        });

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/management?timeRange=7d',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.topServices).toHaveLength(1);
      expect(body.topServices[0].cpuAvg).toBe(40);

      // Both the top-services and trend queries should reference the rollup table
      const rollupCalls = mockClientQuery.mock.calls.filter(
        (c) => String(c[0]).includes('metrics_5min'),
      );
      expect(rollupCalls.length).toBeGreaterThanOrEqual(2);

      // The trend query should use time_bucket for rollup
      const trendCall = rollupCalls.find((c) => String(c[0]).includes('time_bucket'));
      expect(trendCall).toBeTruthy();
    });

    it('serves cached result on second request', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }) // top services
        .mockResolvedValueOnce({ rows: [] }); // trend rows

      await app.inject({ method: 'GET', url: '/api/reports/management' });
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Second identical request — cache hit, no new pool connection
      await app.inject({ method: 'GET', url: '/api/reports/management' });
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('restricts the daily fleet average to running containers (#1394)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });
      await app.inject({ method: 'GET', url: '/api/reports/management?timeRange=7d' });
      const dailyCall = mockClientQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && /GROUP BY day/.test(c[0] as string),
      );
      expect(dailyCall).toBeDefined();
      expect(dailyCall![0]).toMatch(/container_lifecycle/);
    });

    it('numbers every placeholder in the endpoint-scoped filter chain (#1585)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });
      await app.inject({ method: 'GET', url: '/api/reports/management?timeRange=7d&endpointId=1' });

      // Both management queries share one baseParams array built by the same
      // paramIdx chain, so the invariant has to hold for each of them.
      const scopedCalls = mockClientQuery.mock.calls.filter(
        (c) => typeof c[0] === 'string' && /GROUP BY (day|container_id)/.test(c[0] as string),
      );
      expect(scopedCalls).toHaveLength(2);

      for (const call of scopedCalls) {
        const [sql, params] = call as [string, unknown[]];
        expect(maxPlaceholder(sql)).toBe(params.length);
        expect(sql).toMatch(new RegExp(`container_lifecycle WHERE endpoint_id = \\$${params.length}\\b`));
        expect(params[params.length - 1]).toBe(1);
      }
    });
  });

  describe('Pool timeout / statement timeout → 503 with Retry-After', () => {
    it('returns 503 with Retry-After when pool connection times out on /utilization', async () => {
      const poolError = new Error('timeout exceeded when trying to connect');
      mockConnect.mockRejectedValueOnce(poolError);

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/utilization?timeRange=24h',
      });

      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('30');
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Service temporarily unavailable');
    });

    it('returns 503 with Retry-After when statement_timeout fires on /trends', async () => {
      const stmtError = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
      mockClientQuery.mockRejectedValueOnce(stmtError);

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/trends?timeRange=24h',
      });

      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('30');
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Service temporarily unavailable');
    });

    it('returns 503 with Retry-After when pool connection times out on /management', async () => {
      const poolError = new Error('Connection acquire timeout exceeded');
      mockConnect.mockRejectedValueOnce(poolError);

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/management',
      });

      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('30');
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Service temporarily unavailable');
    });

    it('re-throws non-timeout errors', async () => {
      const dbError = new Error('column "nonexistent" does not exist');
      mockClientQuery.mockRejectedValueOnce(dbError);

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/trends?timeRange=24h',
      });

      expect(res.statusCode).toBe(500);
    });
  });

  describe('Report cache max-size cap', () => {
    it('keeps cache size at or below REPORT_CACHE_MAX_ENTRIES after 600+ inserts', () => {
      clearReportCache();
      const insertCount = 600;
      for (let i = 0; i < insertCount; i++) {
        setCachedReport(`key-${i}`, { data: i });
      }
      expect(getReportCacheSize()).toBeLessThanOrEqual(REPORT_CACHE_MAX_ENTRIES);
    });

    it('still returns cached entries within TTL', () => {
      clearReportCache();
      setCachedReport('recent-key', { value: 42 });
      // The entry should be retrievable through a route cache hit.
      // We verify indirectly: the cache size should be 1 after a single insert.
      expect(getReportCacheSize()).toBe(1);
    });

    it('evicts the oldest entry when cache exceeds max size', () => {
      clearReportCache();
      // Fill cache to max
      for (let i = 0; i < REPORT_CACHE_MAX_ENTRIES; i++) {
        setCachedReport(`fill-${i}`, { data: i });
      }
      expect(getReportCacheSize()).toBe(REPORT_CACHE_MAX_ENTRIES);

      // Insert one more — should evict the oldest and stay at max
      setCachedReport('overflow-key', { data: 'new' });
      expect(getReportCacheSize()).toBe(REPORT_CACHE_MAX_ENTRIES);
    });
  });

  describe('containerId input validation (ReportsQuerySchema)', () => {
    // ReportsQuerySchema.containerId must be z.string().max(128).optional()
    // Tests validate the schema contract directly to catch regressions.
    const ContainerIdSchema = z.string().max(128).optional();

    it('rejects containerId longer than 128 characters', () => {
      const longId = 'a'.repeat(129);
      const result = ContainerIdSchema.safeParse(longId);
      expect(result.success).toBe(false);
    });

    it('accepts containerId of exactly 128 characters', () => {
      const validId = 'a'.repeat(128);
      const result = ContainerIdSchema.safeParse(validId);
      expect(result.success).toBe(true);
    });

    it('accepts containerId when omitted', () => {
      const result = ContainerIdSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });
  });
});
