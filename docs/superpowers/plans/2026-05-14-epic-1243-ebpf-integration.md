# Epic #1243 — Beyla eBPF Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Companion design doc:** `docs/superpowers/specs/2026-05-14-epic-1243-ebpf-integration-design.md` — read it before starting any task. File paths, env vars, and acceptance criteria are authoritative there.

**Goal:** Thread Beyla eBPF trace data through Network Topology, Container Detail, Workloads, Anomaly Detection, Logs, LLM Observability, and Security Audit; add operational guardrails (retention, sampling) the trace store needs before fleet rollout.

**Architecture:** Single RED-metrics endpoint `/api/traces/red` feeds every page; head sampling + per-source token-bucket rate limit at ingest; daily retention job; observer-only. No new packages — work fits inside `packages/observability/`, `packages/ai-intelligence/`, `packages/security/`, `frontend/`.

**Tech Stack:** Fastify 5, fastify-type-provider-zod, Zod, Postgres ≥13 (`percentile_cont`, JSONB), Vitest, React 19, Recharts, React Flow, jose, npm workspaces.

**Conventions every task must follow:**

- Branch names: `feature/1243-phase1-enablers`, `feature/1243-phase2-red-pages`, `feature/1243-phase3-advanced`.
- One commit per task in plan, message format: `<scope>(<area>): <what> (#<issue>)`. Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- `npm run lint` and `npm run typecheck` from the repo root after each task; never commit with failing typecheck.
- Vitest from the relevant workspace (e.g. `cd packages/observability && npx vitest run src/services/trace-red.test.ts`).
- Routes use existing pattern: `import '@dashboard/core/plugins/auth.js'`, `preHandler: [fastify.authenticate]` for authenticated reads, `preHandler: [fastify.authenticate, fastify.requireRole('admin')]` for admin actions.
- DB access via `getDbForDomain('traces')` (or `'app'` for non-trace data).
- All `spans` SQL uses `start_time` not `startTime`. The table has typed columns (`http_method`, `container_name`, etc.) and a JSONB `attributes` column.
- Tests against real Postgres via `test-db-helper.ts`. Never mock the DB.
- Frontend: hooks under `frontend/src/features/<feature>/hooks/`, components under `.../components/`. Mock `globalThis.fetch` in tests via `vi.spyOn`.
- Shared empty-state component `frontend/src/features/observability/components/no-trace-data-callout.tsx` ships in Phase 2 Task 1; all subsequent frontend tasks reuse it.

---

## Phase 1 — Backend enablers (#1234, #1241, #1242)

**Branch:** `feature/1243-phase1-enablers` (from `dev`)
**PR title:** `feat(observability): RED endpoint, span retention, ingest sampling (#1234 #1241 #1242)`

### Task 1.1 — RED query service (#1234, part 1)

**Files:**
- Create: `packages/observability/src/services/trace-red.ts`
- Test: `packages/observability/src/services/trace-red.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// trace-red.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { initTestDb, resetTracesTable, insertTestSpan } from '../../../core/src/db/test-db-helper.js';
import { computeRed } from './trace-red.js';

describe('computeRed', () => {
  beforeEach(async () => { await initTestDb(); await resetTracesTable(); });

  it('returns p50/p95/p99 per bucket grouped by service', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    for (let i = 1; i <= 100; i++) {
      await insertTestSpan({ service_name: 'api', duration_ms: i, start_time: now, status: 'ok' });
    }
    const result = await computeRed({
      from: new Date('2026-05-14T11:00:00Z'),
      to:   new Date('2026-05-14T13:00:00Z'),
      bucket: '1h', groupBy: 'service',
    });
    expect(result.truncated).toBe(false);
    expect(result.buckets).toHaveLength(1);
    const row = result.buckets[0].rows.find(r => r.group === 'api')!;
    expect(row.callCount).toBe(100);
    expect(row.p50Ms).toBeCloseTo(50.5, 0);
    expect(row.p95Ms).toBeCloseTo(95, 0);
    expect(row.p99Ms).toBeCloseTo(99, 0);
    expect(row.errorRate).toBe(0);
  });

  it('errorRate counts only status=error', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    for (let i = 0; i < 80; i++) await insertTestSpan({ service_name: 'api', duration_ms: 10, start_time: now, status: 'ok' });
    for (let i = 0; i < 20; i++) await insertTestSpan({ service_name: 'api', duration_ms: 10, start_time: now, status: 'error' });
    const result = await computeRed({ from: new Date('2026-05-14T11:00:00Z'), to: new Date('2026-05-14T13:00:00Z'), bucket: '1h', groupBy: 'service' });
    expect(result.buckets[0].rows[0].errorRate).toBeCloseTo(0.2);
  });

  it('truncates and flags when row count exceeds 100 per bucket', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    for (let i = 0; i < 150; i++) await insertTestSpan({ service_name: `svc-${i}`, duration_ms: 1, start_time: now, status: 'ok' });
    const result = await computeRed({ from: new Date('2026-05-14T11:00:00Z'), to: new Date('2026-05-14T13:00:00Z'), bucket: '1h', groupBy: 'service' });
    expect(result.truncated).toBe(true);
    expect(result.buckets[0].rows).toHaveLength(100);
  });

  it('filters by container', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    await insertTestSpan({ service_name: 'api', duration_ms: 10, start_time: now, container_name: 'webA', status: 'ok' });
    await insertTestSpan({ service_name: 'api', duration_ms: 20, start_time: now, container_name: 'webB', status: 'ok' });
    const result = await computeRed({ from: new Date('2026-05-14T11:00:00Z'), to: new Date('2026-05-14T13:00:00Z'), bucket: '1h', groupBy: 'service', filters: { container: 'webA' } });
    expect(result.buckets[0].rows[0].callCount).toBe(1);
  });
});
```

If `insertTestSpan` does not exist in `test-db-helper.ts`, add it now as a small helper that inserts a span with sensible defaults — keep it in the same file as other helpers; reuse the test-db pool already exported.

- [ ] **Step 2: Run, expect FAIL.** `cd packages/observability && npx vitest run src/services/trace-red.test.ts`
- [ ] **Step 3: Implement `trace-red.ts`.**

```ts
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';

export type RedBucket = '1m' | '5m' | '1h';
export type RedGroupBy = 'service' | 'route' | 'container' | 'namespace';

export interface RedQuery {
  from: Date;
  to: Date;
  bucket: RedBucket;
  groupBy: RedGroupBy;
  filters?: { service?: string; route?: string; container?: string; endpointId?: number };
}

export interface RedRow {
  group: string;
  rate: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  callCount: number;
}

export interface RedResult { buckets: { bucketStart: string; rows: RedRow[] }[]; truncated: boolean }

const GROUP_COL: Record<RedGroupBy, string> = {
  service: 'service_name',
  route: 'http_route',
  container: 'container_name',
  namespace: 'k8s_namespace',
};
const BUCKET_INTERVAL: Record<RedBucket, string> = { '1m': '1 minute', '5m': '5 minutes', '1h': '1 hour' };
const ROW_CAP = 100;

export async function computeRed(q: RedQuery): Promise<RedResult> {
  const db = getDbForDomain('traces');
  const groupCol = GROUP_COL[q.groupBy];
  const bucketInterval = BUCKET_INTERVAL[q.bucket];
  const params: any[] = [q.from, q.to];
  const filterClauses: string[] = [`${groupCol} IS NOT NULL`];
  if (q.filters?.service)   { params.push(q.filters.service);   filterClauses.push(`service_name = $${params.length}`); }
  if (q.filters?.route)     { params.push(q.filters.route);     filterClauses.push(`http_route = $${params.length}`); }
  if (q.filters?.container) { params.push(q.filters.container); filterClauses.push(`container_name = $${params.length}`); }
  // endpointId requires join to endpoints if/when needed; omitted in v1 since spans aren't keyed by endpoint
  const seconds = Math.max(1, (q.to.getTime() - q.from.getTime()) / 1000);
  params.push(seconds);
  const secondsParam = `$${params.length}`;
  const sql = `
    WITH agg AS (
      SELECT
        date_bin('${bucketInterval}'::interval, start_time, $1) AS bucket_start,
        ${groupCol} AS grp,
        count(*)::int AS call_count,
        count(*) FILTER (WHERE status = 'error')::float / NULLIF(count(*), 0) AS error_rate,
        count(*)::float / ${secondsParam} AS rate,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
      FROM spans
      WHERE start_time >= $1 AND start_time < $2
        AND ${filterClauses.join(' AND ')}
      GROUP BY bucket_start, grp
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY bucket_start ORDER BY call_count DESC) AS rn
      FROM agg
    )
    SELECT bucket_start, grp, call_count, error_rate, rate, p50, p95, p99
    FROM ranked
    WHERE rn <= ${ROW_CAP + 1}
    ORDER BY bucket_start, call_count DESC;
  `;
  const rows = await db.query<any>(sql, params);
  const byBucket = new Map<string, RedRow[]>();
  let truncated = false;
  for (const r of rows) {
    const key = new Date(r.bucket_start).toISOString();
    const list = byBucket.get(key) ?? [];
    if (list.length >= ROW_CAP) { truncated = true; continue; }
    list.push({
      group: r.grp,
      rate: Number(r.rate ?? 0),
      errorRate: Number(r.error_rate ?? 0),
      p50Ms: Number(r.p50 ?? 0),
      p95Ms: Number(r.p95 ?? 0),
      p99Ms: Number(r.p99 ?? 0),
      callCount: Number(r.call_count ?? 0),
    });
    byBucket.set(key, list);
  }
  return {
    buckets: Array.from(byBucket.entries()).map(([bucketStart, rows]) => ({ bucketStart, rows })),
    truncated,
  };
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit:** `feat(observability): RED query service (#1234)`

### Task 1.2 — RED route + Zod schema (#1234, part 2)

**Files:**
- Modify: `packages/observability/src/routes/traces.ts` (append new route)
- Test: `packages/observability/src/routes/traces-red.test.ts`

- [ ] **Step 1: Write the failing route test.**

```ts
// traces-red.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { buildTestApp } from '../../../core/src/test-utils/build-test-app.js'; // existing helper
import { initTestDb, resetTracesTable, insertTestSpan } from '../../../core/src/db/test-db-helper.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  await initTestDb();
  app = await buildTestApp();
});
beforeEach(async () => { await resetTracesTable(); });

describe('GET /api/traces/red', () => {
  it('400 on missing from/to', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/traces/red', headers: { authorization: 'Bearer test' } });
    expect(res.statusCode).toBe(400);
  });
  it('returns RED rows for the seeded span set', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    for (let i = 1; i <= 50; i++) await insertTestSpan({ service_name: 'api', duration_ms: i, start_time: now, status: 'ok' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/traces/red?from=2026-05-14T11:00:00Z&to=2026-05-14T13:00:00Z&bucket=1h&groupBy=service`,
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.truncated).toBe(false);
    expect(body.buckets[0].rows[0].callCount).toBe(50);
  });
  it('rejects invalid bucket enum', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/traces/red?from=2026-05-14T11:00:00Z&to=2026-05-14T13:00:00Z&bucket=2m&groupBy=service`,
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

Use the existing test-app builder; if there isn't one for the observability package, look for the pattern used by neighbouring route tests (`traces.test.ts` should exist alongside `traces.ts`). If no test-app helper exists, create the route test by importing the route registrar directly into a fresh Fastify instance with the standard test auth decorator.

- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Add the route.** Insert after the existing `/api/traces/summary` handler in `traces.ts`:

```ts
import { z } from 'zod';
import { computeRed } from '../services/trace-red.js';

const RedQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  bucket: z.enum(['1m', '5m', '1h']).default('5m'),
  groupBy: z.enum(['service', 'route', 'container', 'namespace']).default('service'),
  service: z.string().optional(),
  route: z.string().optional(),
  container: z.string().optional(),
});

fastify.get('/api/traces/red', {
  preHandler: [fastify.authenticate],
  schema: { querystring: RedQuerySchema },
}, async (request) => {
  const q = request.query as z.infer<typeof RedQuerySchema>;
  return computeRed({
    from: new Date(q.from), to: new Date(q.to),
    bucket: q.bucket, groupBy: q.groupBy,
    filters: { service: q.service, route: q.route, container: q.container },
  });
});
```

- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit:** `feat(observability): GET /api/traces/red endpoint (#1234)`

### Task 1.3 — Retention service + scheduler wiring (#1241)

**Files:**
- Create: `packages/observability/src/services/trace-retention.ts`
- Test:   `packages/observability/src/services/trace-retention.test.ts`
- Modify: `packages/core/src/config/env.schema.ts` (add `TRACES_RETENTION_DAYS`)
- Modify: `packages/observability/src/index.ts` (export `cleanOldSpans`)
- Modify: `packages/server/src/scheduler.ts` (call `cleanOldSpans` from the daily cleanup block)
- Modify: `.env.example`, `CLAUDE.md` env section, `docs/ebpf-trace-ingestion.md`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { initTestDb, resetTracesTable, insertTestSpan, getDbForDomain } from '../../../core/src/db/test-db-helper.js';
import { cleanOldSpans } from './trace-retention.js';

describe('cleanOldSpans', () => {
  beforeEach(async () => { await initTestDb(); await resetTracesTable(); });

  it('deletes spans older than retention window, keeps recent', async () => {
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const recent = new Date();
    await insertTestSpan({ service_name: 's', start_time: old, status: 'ok', duration_ms: 1 });
    await insertTestSpan({ service_name: 's', start_time: recent, status: 'ok', duration_ms: 1 });
    const result = await cleanOldSpans(7);
    expect(result.deleted).toBe(1);
    const db = getDbForDomain('traces');
    const rows = await db.query<{ c: number }>('SELECT count(*)::int as c FROM spans');
    expect(rows[0].c).toBe(1);
  });

  it('returns 0 on empty table', async () => {
    expect((await cleanOldSpans(7)).deleted).toBe(0);
  });

  it('rejects non-positive days', async () => {
    await expect(cleanOldSpans(0)).rejects.toThrow();
    await expect(cleanOldSpans(-1)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Implement `trace-retention.ts`.**

```ts
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { logger } from '@dashboard/core/logger.js';

const BATCH = 10_000;

export async function cleanOldSpans(days: number): Promise<{ deleted: number }> {
  if (!Number.isInteger(days) || days < 1) throw new Error('days must be a positive integer');
  const db = getDbForDomain('traces');
  let total = 0;
  while (true) {
    const rows = await db.query<{ id: string }>(
      `DELETE FROM spans WHERE id IN (
         SELECT id FROM spans WHERE start_time < now() - ($1 || ' days')::interval LIMIT ${BATCH}
       ) RETURNING id`,
      [String(days)],
    );
    total += rows.length;
    if (rows.length < BATCH) break;
  }
  if (total > 0) logger.info({ deleted: total, retentionDays: days }, 'spans cleanup');
  return { deleted: total };
}
```

- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Wire into env schema.** In `packages/core/src/config/env.schema.ts` add near `METRICS_RETENTION_DAYS`:

```ts
TRACES_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
```

- [ ] **Step 6: Wire into scheduler.** In `packages/server/src/scheduler.ts`, near `cleanOldMetrics(...)`, add:

```ts
try {
  const { deleted } = await cleanOldSpans(config.TRACES_RETENTION_DAYS);
  if (deleted > 0) log.info({ deleted, retentionDays: config.TRACES_RETENTION_DAYS }, 'Spans retention cleanup');
} catch (err) {
  log.error({ err }, 'Spans cleanup failed');
}
```

Import `cleanOldSpans` from `@dashboard/observability`.

- [ ] **Step 7: Export from package.** In `packages/observability/src/index.ts`, re-export: `export { cleanOldSpans } from './services/trace-retention.js';`
- [ ] **Step 8: Docs.** Append to `.env.example`:

```
# How many days of Beyla/OTLP spans to retain before the daily cleanup job removes them.
TRACES_RETENTION_DAYS=7
```

Append a short line to `CLAUDE.md`'s env section and to `docs/ebpf-trace-ingestion.md` under a new "Retention" subsection.

- [ ] **Step 9: Run lint+typecheck:** `npm run lint && npm run typecheck`
- [ ] **Step 10: Commit:** `feat(observability): daily spans retention job (#1241)`

### Task 1.4 — Trace sampler (#1242, part 1)

**Files:**
- Create: `packages/observability/src/services/trace-sampler.ts`
- Test:   `packages/observability/src/services/trace-sampler.test.ts`
- Modify: `packages/core/src/config/env.schema.ts` (add `TRACES_SAMPLE_RATE`, `TRACES_INGEST_MAX_SPANS_PER_SEC`)

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSampler } from './trace-sampler.js';

describe('createSampler', () => {
  it('head sampling deterministic on trace_id', () => {
    const s = createSampler({ sampleRate: 0.5, maxSpansPerSec: 0 });
    const tid = '0123456789abcdef0123456789abcdef';
    const d1 = s.shouldAccept({ trace_id: tid, service_name: 'a' } as any);
    const d2 = s.shouldAccept({ trace_id: tid, service_name: 'a' } as any);
    expect(d1).toBe(d2);
  });

  it('sampleRate=1.0 accepts all', () => {
    const s = createSampler({ sampleRate: 1.0, maxSpansPerSec: 0 });
    for (let i = 0; i < 100; i++) {
      expect(s.shouldAccept({ trace_id: `t${i}`.padEnd(32, '0'), service_name: 'a' } as any)).toBe(true);
    }
  });

  it('sampleRate=0 rejects all', () => {
    const s = createSampler({ sampleRate: 0, maxSpansPerSec: 0 });
    expect(s.shouldAccept({ trace_id: 'x'.repeat(32), service_name: 'a' } as any)).toBe(false);
  });

  it('token-bucket drops above maxSpansPerSec', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00Z'));
    const s = createSampler({ sampleRate: 1.0, maxSpansPerSec: 10 });
    let accepted = 0;
    for (let i = 0; i < 100; i++) if (s.shouldAccept({ trace_id: `t${i}`.padEnd(32, '0'), service_name: 'a' } as any)) accepted++;
    expect(accepted).toBeLessThanOrEqual(10);
    vi.useRealTimers();
  });

  it('per-source isolation: one noisy service does not affect another', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00Z'));
    const s = createSampler({ sampleRate: 1.0, maxSpansPerSec: 5 });
    for (let i = 0; i < 50; i++) s.shouldAccept({ trace_id: `t${i}`.padEnd(32, '0'), service_name: 'noisy' } as any);
    expect(s.shouldAccept({ trace_id: 'z'.repeat(32), service_name: 'quiet' } as any)).toBe(true);
    vi.useRealTimers();
  });

  it('getStats reports accepted/dropped totals', () => {
    const s = createSampler({ sampleRate: 0, maxSpansPerSec: 0 });
    for (let i = 0; i < 5; i++) s.shouldAccept({ trace_id: `t${i}`.padEnd(32, '0'), service_name: 'a' } as any);
    expect(s.getStats().droppedTotal).toBe(5);
    expect(s.getStats().acceptedTotal).toBe(0);
  });
});
```

- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Implement.**

```ts
// trace-sampler.ts
import { logger } from '@dashboard/core/logger.js';

export interface SamplerConfig { sampleRate: number; maxSpansPerSec: number }
export interface PerSource { tokens: number; lastRefill: number; accepted: number; dropped: number; lastWarnedAt: number }
export interface Sampler {
  shouldAccept(span: { trace_id: string; service_name?: string; service_namespace?: string }): boolean;
  getStats(): { acceptedTotal: number; droppedTotal: number; perSource: Record<string, { accepted: number; dropped: number }> };
}

const WARN_INTERVAL_MS = 60_000;

export function createSampler(cfg: SamplerConfig): Sampler {
  let acceptedTotal = 0;
  let droppedTotal = 0;
  const sources = new Map<string, PerSource>();

  function headSample(traceId: string): boolean {
    if (cfg.sampleRate >= 1) return true;
    if (cfg.sampleRate <= 0) return false;
    // Use trailing 4 hex chars as 16-bit hash — deterministic on trace_id.
    const hash = parseInt(traceId.slice(-4) || '0', 16) / 0xffff;
    return hash < cfg.sampleRate;
  }

  function rateLimit(key: string): boolean {
    if (cfg.maxSpansPerSec <= 0) return true;
    const now = Date.now();
    const src = sources.get(key) ?? { tokens: cfg.maxSpansPerSec, lastRefill: now, accepted: 0, dropped: 0, lastWarnedAt: 0 };
    const elapsed = (now - src.lastRefill) / 1000;
    src.tokens = Math.min(cfg.maxSpansPerSec, src.tokens + elapsed * cfg.maxSpansPerSec);
    src.lastRefill = now;
    if (src.tokens >= 1) {
      src.tokens -= 1;
      sources.set(key, src);
      return true;
    }
    sources.set(key, src);
    return false;
  }

  return {
    shouldAccept(span) {
      const key = span.service_namespace || span.service_name || 'unknown';
      const src = sources.get(key) ?? { tokens: cfg.maxSpansPerSec || 0, lastRefill: Date.now(), accepted: 0, dropped: 0, lastWarnedAt: 0 };
      if (!headSample(span.trace_id) || !rateLimit(key)) {
        src.dropped++;
        droppedTotal++;
        const now = Date.now();
        if (now - src.lastWarnedAt > WARN_INTERVAL_MS) {
          logger.warn({ source: key, dropped: src.dropped, sampleRate: cfg.sampleRate, maxSpansPerSec: cfg.maxSpansPerSec }, 'trace ingest sampler dropped spans');
          src.lastWarnedAt = now;
        }
        sources.set(key, src);
        return false;
      }
      src.accepted++;
      acceptedTotal++;
      sources.set(key, src);
      return true;
    },
    getStats() {
      const perSource: Record<string, { accepted: number; dropped: number }> = {};
      for (const [k, v] of sources) perSource[k] = { accepted: v.accepted, dropped: v.dropped };
      return { acceptedTotal, droppedTotal, perSource };
    },
  };
}
```

- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Add env vars.**

```ts
TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1.0),
TRACES_INGEST_MAX_SPANS_PER_SEC: z.coerce.number().int().min(0).default(0),
```

- [ ] **Step 6: Commit:** `feat(observability): trace ingest sampler service (#1242)`

### Task 1.5 — Wire sampler into ingest + stats endpoint (#1242, part 2)

**Files:**
- Modify: `packages/observability/src/routes/traces-ingest.ts` (call sampler between transform and insert; expose stats accessor)
- Modify: `packages/observability/src/routes/traces.ts` (add `GET /api/traces/ingest-stats`, admin-gated)
- Test:   `packages/observability/src/routes/traces-ingest-sampler.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildTestApp } from '../../../core/src/test-utils/build-test-app.js';
import { initTestDb, resetTracesTable, getDbForDomain } from '../../../core/src/db/test-db-helper.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => { await initTestDb(); app = await buildTestApp({ env: { TRACES_INGESTION_ENABLED: 'true', TRACES_SAMPLE_RATE: '0', TRACES_INGESTION_API_KEY: 'k' } }); });

describe('ingest sampler integration', () => {
  it('rejects all spans when sampleRate=0 and increments droppedTotal', async () => {
    await resetTracesTable();
    const otlp = { resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'a' } }] }, scopeSpans: [{ spans: [{ traceId: 'AA'.repeat(16), spanId: 'BB'.repeat(8), name: 'op', startTimeUnixNano: '1', endTimeUnixNano: '1000000', kind: 1 }] }] }] };
    const res = await app.inject({ method: 'POST', url: '/api/traces/otlp', headers: { 'content-type': 'application/json', 'x-api-key': 'k' }, payload: otlp });
    expect(res.statusCode).toBe(200);
    const count = (await getDbForDomain('traces').query<{ c: number }>('SELECT count(*)::int as c FROM spans'))[0].c;
    expect(count).toBe(0);
    const stats = await app.inject({ method: 'GET', url: '/api/traces/ingest-stats', headers: { authorization: 'Bearer admin' } });
    expect(stats.json().droppedTotal).toBeGreaterThan(0);
  });

  it('ingest-stats requires admin role', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/traces/ingest-stats', headers: { authorization: 'Bearer user' } });
    expect([401, 403]).toContain(res.statusCode);
  });
});
```

- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Wire into `traces-ingest.ts`.** Construct a module-level sampler from env on first use; call `sampler.shouldAccept(span)` over the produced `SpanInsert[]`, filter, then `insertSpans()`. Export `getSamplerStats` from the module.

Add near the top of `traces-ingest.ts`:

```ts
import { createSampler, type Sampler } from '../services/trace-sampler.js';
import { getConfig } from '@dashboard/core/config/index.js';

let _sampler: Sampler | null = null;
function getSampler(): Sampler {
  if (!_sampler) {
    const c = getConfig();
    _sampler = createSampler({ sampleRate: c.TRACES_SAMPLE_RATE, maxSpansPerSec: c.TRACES_INGEST_MAX_SPANS_PER_SEC });
  }
  return _sampler;
}
export function getSamplerStats() { return getSampler().getStats(); }
export function __resetSamplerForTests() { _sampler = null; }
```

After `transformOtlpToSpans` produces the `SpanInsert[]`, before `insertSpans`:

```ts
const sampler = getSampler();
const accepted = spans.filter(s => sampler.shouldAccept(s as any));
await insertSpans(accepted);
```

- [ ] **Step 4: Add the stats route to `traces.ts`.**

```ts
import { getSamplerStats } from './traces-ingest.js';

fastify.get('/api/traces/ingest-stats', {
  preHandler: [fastify.authenticate, fastify.requireRole('admin')],
}, async () => getSamplerStats());
```

- [ ] **Step 5: Run, PASS.**
- [ ] **Step 6: Add env-var docs** to `.env.example`, `CLAUDE.md`, and `docs/ebpf-trace-ingestion.md` with a "Sampling & rate-limit" subsection covering both env vars.
- [ ] **Step 7: Security regression test.** Append a test to `backend/src/routes/security-regression-rbac.test.ts` (or whichever file matches; if none — create `security-regression-traces.test.ts`) asserting `/api/traces/ingest-stats` returns 401/403 for non-admin and 200 for admin.
- [ ] **Step 8: Commit:** `feat(observability): wire sampler into ingest + admin stats endpoint (#1242)`

### Task 1.6 — Open Phase 1 PR

- [ ] Verify locally: `npm run lint && npm run typecheck && npm test -w @dashboard/observability && npm test -w @dashboard/core`.
- [ ] Update `docs/ebpf-trace-ingestion.md` "Read API" section to list `/api/traces/red`, `/api/traces/ingest-stats`, and add the "Retention" and "Sampling & rate-limit" subsections.
- [ ] Push and open PR `feature/1243-phase1-enablers → dev`. Title: `feat(observability): RED endpoint, span retention, ingest sampling (#1234 #1241 #1242)`. Body summarizes each issue, links them, and explains the no-op defaults.
- [ ] **STOP. Wait for user review of Phase 1 PR before starting Phase 2.**

---

## Phase 2 — RED-consumer pages (#1233, #1235, #1237)

**Branch:** `feature/1243-phase2-red-pages` (from `dev` after Phase 1 merges).
**PR title:** `feat(ui): network-topology RPC overlay, container Calls tab, workloads RED columns (#1233 #1235 #1237)`

### Task 2.1 — Shared `useRed`, `useServiceMap`, and `<NoTraceDataCallout/>` hooks/components

**Files:**
- Create: `frontend/src/features/observability/hooks/use-red.ts`
- Create: `frontend/src/features/observability/hooks/use-service-map.ts`
- Create: `frontend/src/features/observability/components/no-trace-data-callout.tsx`
- Test:   `frontend/src/features/observability/hooks/use-red.test.ts`
- Test:   `frontend/src/features/observability/components/no-trace-data-callout.test.tsx`

- [ ] **Step 1: Tests** — assert hook returns `{ data, loading, error }`, calls `/api/traces/red` with serialized query params, mocks `fetch`. Callout renders the Beyla CTA link.
- [ ] **Step 2: Implement** using the project's existing fetch wrapper (search `apiFetch` / `useFetch` in `frontend/src/lib/` — match the pattern). Hook type:

```ts
export interface UseRedOptions { from: Date; to: Date; bucket: '1m'|'5m'|'1h'; groupBy: 'service'|'route'|'container'|'namespace'; service?: string; container?: string; route?: string; }
export function useRed(opts: UseRedOptions): { data: RedResult | undefined; loading: boolean; error?: Error };
```

- [ ] **Step 3: Commit:** `feat(ui): shared RED hook + no-trace-data callout (#1243)`

### Task 2.2 — Network Topology RPC overlay (#1233)

**Files:**
- Modify: `frontend/src/features/containers/pages/network-topology.tsx`
- Modify: `frontend/src/features/containers/components/network/topology-graph.tsx`
- Test:   `frontend/src/features/containers/pages/network-topology.test.tsx`

- [ ] **Step 1: Test** — render the page with a mocked service-map response (`{ nodes: [...], edges: [{from:'a',to:'b',callCount:100,errorCount:5,avgDuration:50}, ...] }`). Assert 4 merged edges with correct weight (`thickness ∝ log1p(callCount)`) and colour bucketing (green/amber/red by errorRate).
- [ ] **Step 2: Implement** — add header toggle "Observed traffic" (default on if service-map returned any edges in last 24h). Merge observed edges with the Docker-derived graph by container/service name. Cap at 100 edges (sort by callCount desc). Hover tooltip shows `callCount`, `avgDurationMs`, `errorRate`. Structural-only edges fade to background when overlay is on.
- [ ] **Step 3: Commit:** `feat(ui): network topology RPC edge overlay (#1233)`

### Task 2.3 — Container Detail Calls tab (#1235)

**Files:**
- Create: `frontend/src/features/containers/components/container-traces-tab.tsx`
- Create: `frontend/src/features/containers/components/container-traces-tab.test.tsx`
- Modify: `frontend/src/features/containers/pages/container-detail.tsx` (register tab)

- [ ] **Step 1: Test** — render with mocked RED + traces fixtures (empty, partial, full). Assert each of the four panels renders the expected values and the empty-state shows `<NoTraceDataCallout/>` when no data.
- [ ] **Step 2: Implement** four panels in `container-traces-tab.tsx`:
  - RED summary (last 1h, bucket=1h, filters.container=this container) — display `rate`, `errorRate*100`, `p50/p95/p99`.
  - Top outgoing calls — `/api/traces?container=<name>&kind=client&limit=10` (sort by duration desc client-side).
  - Top incoming calls — same but `kind=server`.
  - Latency sparkline + error timeline — RED with `bucket=1m` over 60 min (Recharts `LineChart`).
- Add the tab to `container-detail.tsx`. Each list row links to `/observability/trace-explorer?trace=<id>`.
- [ ] **Step 3: Commit:** `feat(ui): container detail Calls tab (#1235)`

### Task 2.4 — Workloads RED columns (#1237)

**Files:**
- Modify: `frontend/src/features/containers/pages/workload-explorer.tsx`
- Test:   `frontend/src/features/containers/pages/workload-explorer.test.tsx`

- [ ] **Step 1: Test** — render with mocked RED response covering 2 of 3 visible workloads. Assert sortable Rate/Errors/p95 columns appear; workloads without data show `–` (not `0`); single fetch is made (not N).
- [ ] **Step 2: Implement** — one batched fetch `useRed({ groupBy: 'service', bucket: '5m', from: now-5m, to: now })`. Map rows by `service_name`. Click on any of the three cells navigates to `/observability/trace-explorer?service=<name>&from=...&to=...`.
- [ ] **Step 3: Commit:** `feat(ui): workloads RED metrics columns (#1237)`

### Task 2.5 — Phase 2 PR

- [ ] Verify: `npm run lint && npm run typecheck && npm test -w frontend`.
- [ ] Update `docs/ebpf-trace-ingestion.md` "Consumer pages" subsection: list topology, container detail Calls tab, workloads columns.
- [ ] Open PR. **STOP. Wait for user review before starting Phase 3.**

---

## Phase 3 — Advanced integrations (#1236, #1238, #1239, #1240)

**Branch:** `feature/1243-phase3-advanced` (from `dev` after Phase 2 merges).
**PR title:** `feat: trace anomaly detection, log↔trace correlation, LLM latency breakdown, security observed destinations (#1236 #1238 #1239 #1240)`

The four tasks in this phase are independent and can be implemented in parallel worktrees. Each is small enough to fit a single subagent.

### Task 3.1 — Trace anomaly detection (#1236)

**Files:**
- Create: `packages/ai-intelligence/src/services/trace-anomaly.ts`
- Test:   `packages/ai-intelligence/src/services/trace-anomaly.test.ts`
- Modify: `packages/ai-intelligence/src/services/monitoring-service.ts` (call into trace-anomaly each cycle)
- Modify: `packages/core/src/config/env.schema.ts` (`TRACES_ANOMALY_P95_ZSCORE` default 2.5, `TRACES_ANOMALY_ERROR_RATE_PCT` default 5) — done in Phase 1 if not yet.

- [ ] **Step 1: Test** — seed two series (a "normal" baseline 24h of p95≈20ms and an "anomalous" spike to 800ms; a normal error rate 0.1% with one minute at 8%). Assert `runTraceAnomalyCycle` writes one anomaly per series with the correct `metricType` (`latency_p95` / `error_rate`) and source attributes.
- [ ] **Step 2: Implement** — `runTraceAnomalyCycle()` calls `computeRed({ groupBy: 'service', bucket: '1m', from: now-1h, to: now })`, builds rolling 24h baselines from a second call with `bucket: '1h'`, runs the existing adaptive z-score detector (reuse `adaptive-anomaly-detector.ts`), and writes anomalies into the same predictive-alerts table the metric anomalies use (look at `monitoring-service.ts`'s existing write path and mirror it).
- [ ] **Step 3: Wire** into `monitoring-service.ts` cycle. Sample log lines (≤ 1 line/min per series).
- [ ] **Step 4: Commit:** `feat(ai): trace-driven latency + error-rate anomaly detection (#1236)`

### Task 3.2 — Trace ↔ logs correlation (#1238)

**Files:**
- Modify: `frontend/src/features/observability/pages/trace-explorer.tsx` (span drawer: "View logs" link)
- Modify: `frontend/src/features/observability/pages/log-viewer.tsx` (read `from`, `to`, `trace`, `containerId` query params; banner)
- Modify: `frontend/src/features/observability/lib/log-viewer.ts` (`filterLines(lines, { trace? })`)
- Tests:  `log-viewer.test.tsx` (filter via URL param, banner shown, disable filter clears it)

- [ ] **Step 1: Test** — open `/observability/logs?trace=abc&containerId=c1&from=2026-05-14T11:00:00Z&to=2026-05-14T11:05:00Z`, assert the trace filter input is pre-populated, only matching lines render, banner displayed, and clicking "Disable filter" removes both URL param and filter.
- [ ] **Step 2: Implement** — use existing `useSearchParams` (or equivalent router hook). Substring filter on the full line. Banner styling matches existing dashboard `<Alert variant="info">` (search for the pattern).
- [ ] **Step 3: Add "View logs" link** on each span row in Trace Explorer's span drawer. URL: `/observability/logs?containerId=<span.container_id>&trace=<trace_id>&from=<span.start_time>&to=<span.end_time + 2s>`.
- [ ] **Step 4: Commit:** `feat(ui): trace↔logs correlation in logs viewer (#1238)`

### Task 3.3 — LLM latency breakdown (#1239)

**Files:**
- Modify: `packages/ai-intelligence/src/services/llm-client.ts` (emit correlation ID; set `x-trace-correlation-id` header on outbound LLM HTTP)
- Create: `frontend/src/features/ai-intelligence/components/llm-latency-breakdown.tsx`
- Modify: `frontend/src/features/ai-intelligence/pages/llm-observability.tsx` (mount the new panel)
- Modify: `packages/core/src/config/env.schema.ts` (`LLM_PEER_HOSTNAMES`, default `api.anthropic.com,api.openai.com,api.mistral.ai,api.deepseek.com,api.groq.com`)
- Test:   `llm-latency-breakdown.test.tsx`

- [ ] **Step 1: Test** — render with two spans (`net_peer_name=api.anthropic.com` 1200ms, `api.openai.com` 800ms) and two LLM log entries with matching correlation IDs (one with `model_latency_ms=900`, one with `model_latency_ms=600`). Assert stacked bar shows network vs model split per provider.
- [ ] **Step 2: Implement** — on the frontend, fetch `/api/traces?netPeerName=<host>&from=...&to=...` for each configured peer hostname (env-derived list exposed via existing `/api/config/public` or hardcoded for now if no public-config endpoint exists). Match each span to LLM log entries by correlation ID where available; aggregate otherwise. Empty state via `<NoTraceDataCallout/>`.
- [ ] **Step 3: Commit:** `feat(ai): LLM latency breakdown panel (#1239)`

### Task 3.4 — Security observed destinations (#1240)

**Files:**
- Create: `packages/core/src/db/postgres-migrations/032_security_destination_rules.sql`
- Create: `packages/security/src/services/observed-destinations.ts`
- Test:   `packages/security/src/services/observed-destinations.test.ts`
- Modify: `packages/security/src/routes/security.ts` (or the file that registers security routes — `grep -r "fastify.get.*'/api/security" packages/security/`)
- Create: `frontend/src/features/security/components/observed-destinations-panel.tsx`
- Modify: `frontend/src/features/security/pages/security-audit.tsx` (mount panel)

- [ ] **Step 1: Migration.** New file `032_security_destination_rules.sql`:

```sql
CREATE TABLE IF NOT EXISTS security_destination_rules (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,                    -- CIDR or hostname suffix (".internal", "10.0.0.0/8")
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('cidr', 'suffix')),
  verdict TEXT NOT NULL CHECK (verdict IN ('allow', 'warn', 'deny')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_destination_rules_verdict ON security_destination_rules(verdict);

INSERT INTO security_destination_rules (pattern, pattern_type, verdict, reason) VALUES
  ('10.0.0.0/8',     'cidr',   'allow', 'RFC1918 private network'),
  ('172.16.0.0/12',  'cidr',   'allow', 'RFC1918 private network'),
  ('192.168.0.0/16', 'cidr',   'allow', 'RFC1918 private network'),
  ('127.0.0.0/8',    'cidr',   'allow', 'loopback'),
  ('localhost',      'suffix', 'allow', 'loopback hostname'),
  ('.internal',      'suffix', 'allow', 'internal DNS suffix'),
  ('.svc',           'suffix', 'allow', 'Kubernetes service suffix')
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Test the service** — seed three rules (one allow, one warn, one deny) and three spans with matching `net_peer_name`s; assert `aggregateObservedDestinations(endpointId, from, to)` returns the correct verdict per peer.
- [ ] **Step 3: Implement service.** Aggregate via SQL:

```sql
SELECT
  COALESCE(net_peer_name, server_address) AS peer,
  COALESCE(net_peer_port, server_port) AS port,
  count(*) AS call_count,
  min(start_time) AS first_seen,
  max(start_time) AS last_seen
FROM spans
WHERE start_time >= $1 AND start_time < $2
GROUP BY peer, port
ORDER BY call_count DESC
LIMIT 200;
```

Then in code, match each `peer` against the rules table (CIDR via `ip-cidr` or built-in IPv4 math; suffix via `endsWith`). Default verdict when no rule matches: `warn`.

- [ ] **Step 4: Add route `GET /api/security/observed-destinations?endpointId=&from=&to=`** with `preHandler: [fastify.authenticate, fastify.requireRole('admin')]`. Zod-validated query.
- [ ] **Step 5: Frontend panel** below the existing findings list. Columns: Peer, Port, Calls, First seen, Last seen, Verdict badge.
- [ ] **Step 6: Security regression test** — admin-only enforcement in `backend/src/routes/security-regression-rbac.test.ts`.
- [ ] **Step 7: Commit:** `feat(security): observed-destinations panel + rule store (#1240)`

### Task 3.5 — Phase 3 PR

- [ ] Verify all workspaces: `npm run lint && npm run typecheck && npm test`.
- [ ] Update `docs/ebpf-trace-ingestion.md` "Consumer pages" with anomaly detection, logs ↔ traces, LLM latency, security destinations.
- [ ] Open PR. Body links #1236 #1238 #1239 #1240. Note that the four sub-features are mostly independent.

---

## Self-review checklist (run before opening any PR)

- [ ] Every code block in this plan that was implemented has a matching test.
- [ ] No `// TODO`, no skipped tests, no unused exports.
- [ ] `.env.example`, `CLAUDE.md` env section, and `docs/ebpf-trace-ingestion.md` are updated in every phase that introduces an env var or a new endpoint.
- [ ] `npm run lint` and `npm run typecheck` are clean.
- [ ] Every page that integrates trace data renders `<NoTraceDataCallout/>` when empty.
- [ ] Sampler / retention / RED defaults are no-op for existing deployments.
- [ ] Security observed-destinations endpoint is admin-only and has a regression test.
- [ ] All commits carry the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
