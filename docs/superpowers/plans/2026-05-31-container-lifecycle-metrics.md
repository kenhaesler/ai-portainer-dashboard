# Container Lifecycle Tracking — Fix Metric Dilution (#1394) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dead/idle containers from diluting the dashboard's cross-container fleet CPU/memory averages by tracking per-container running state in TimescaleDB and filtering the three fleet-average reads to running containers (fail-open).

**Architecture:** A new `container_lifecycle` table in TimescaleDB is upserted each metrics-collection cycle from the full container list (all states) and reconciles vanished containers to `running=false`. The utilization `fleetSummary` JS aggregation and the trends/management SQL fleet averages filter to running containers, failing open (no filter) when the table has no rows for the scope.

**Tech Stack:** TypeScript, Fastify, TimescaleDB (via `pg`), Vitest. Spec: `docs/superpowers/specs/2026-05-31-container-lifecycle-metric-dilution-design.md`.

**Branch:** `feature/1394-container-lifecycle-metrics` (already created off `dev`).

---

### Task 1: TimescaleDB migration — `container_lifecycle` table

**Files:**
- Create: `packages/core/src/db/timescale-migrations/002_container_lifecycle.sql`

This is a declarative SQL config file run by the existing TimescaleDB migration runner (`packages/core/src/db/timescale.ts`), which splits on `;\n`, executes each statement, and records the filename in `_ts_migrations`. Per the TDD config-file exception (spec approved), there is no unit test for the SQL file itself; its behavior is exercised by the store tests (Tasks 2–3) and CI integration.

- [ ] **Step 1: Create the migration file**

```sql
-- Container lifecycle: one row per (endpoint, container) tracking whether the
-- container is currently running. Upserted each metrics-collection cycle so
-- fleet averages can exclude stopped/removed containers (#1394). Lives in
-- TimescaleDB alongside the metrics hypertable so read-path filters can join
-- in-database.
CREATE TABLE IF NOT EXISTS container_lifecycle (
  endpoint_id    INTEGER     NOT NULL,
  container_id   TEXT        NOT NULL,
  container_name TEXT        NOT NULL,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  running        BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (endpoint_id, container_id)
);

CREATE INDEX IF NOT EXISTS idx_container_lifecycle_running
  ON container_lifecycle (endpoint_id) WHERE running;
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/db/timescale-migrations/002_container_lifecycle.sql
git commit -m "feat(metrics): add container_lifecycle table (#1394)"
```

---

### Task 2: Lifecycle store — `getRunningContainerIds`

**Files:**
- Create: `packages/observability/src/services/container-lifecycle-store.ts`
- Test: `packages/observability/src/__tests__/container-lifecycle-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/observability/src/__tests__/container-lifecycle-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the TimescaleDB pool — no Timescale in CI (matches reports-route.test.ts).
const mockQuery = vi.fn();
vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn().mockResolvedValue({ query: (...a: unknown[]) => mockQuery(...a) }),
}));

import { getRunningContainerIds } from '../services/container-lifecycle-store.js';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('getRunningContainerIds', () => {
  it('returns the set of currently-running container ids', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { container_id: 'a', running: true },
        { container_id: 'b', running: false },
        { container_id: 'c', running: true },
      ],
    });
    const ids = await getRunningContainerIds(4);
    expect(ids).toEqual(new Set(['a', 'c']));
  });

  it('returns null (fail open) when the scope has no lifecycle rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getRunningContainerIds(4)).toBeNull();
  });

  it('returns null when the table does not exist yet (42P01)', async () => {
    const err = Object.assign(new Error('relation "container_lifecycle" does not exist'), { code: '42P01' });
    mockQuery.mockRejectedValueOnce(err);
    expect(await getRunningContainerIds()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/observability src/__tests__/container-lifecycle-store.test.ts`
Expected: FAIL — `Failed to resolve import "../services/container-lifecycle-store.js"` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `packages/observability/src/services/container-lifecycle-store.ts`:

```ts
import { getMetricsDb } from '@dashboard/core/db/timescale.js';
import { isUndefinedTableError } from './metrics-store.js';

/**
 * Returns the set of currently-running container ids for the given endpoint
 * (or all endpoints when omitted). Returns `null` to signal "fail open" — the
 * lifecycle table has no rows for this scope (fresh deploy / not yet populated)
 * or does not exist — so callers should NOT filter. An empty Set means the
 * scope is known but nothing is running.
 */
export async function getRunningContainerIds(endpointId?: number): Promise<Set<string> | null> {
  const db = await getMetricsDb();
  try {
    const { rows } = endpointId
      ? await db.query(
          'SELECT container_id, running FROM container_lifecycle WHERE endpoint_id = $1',
          [endpointId],
        )
      : await db.query('SELECT container_id, running FROM container_lifecycle');
    if (rows.length === 0) return null; // no data for scope → fail open
    return new Set(
      (rows as Array<{ container_id: string; running: boolean }>)
        .filter((r) => r.running)
        .map((r) => r.container_id),
    );
  } catch (err) {
    if (isUndefinedTableError(err)) return null; // table not created yet → fail open
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/observability src/__tests__/container-lifecycle-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/services/container-lifecycle-store.ts packages/observability/src/__tests__/container-lifecycle-store.test.ts
git commit -m "feat(metrics): getRunningContainerIds lifecycle reader (#1394)"
```

---

### Task 3: Lifecycle store — `upsertContainerLifecycle`

**Files:**
- Modify: `packages/observability/src/services/container-lifecycle-store.ts`
- Test: `packages/observability/src/__tests__/container-lifecycle-store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/observability/src/__tests__/container-lifecycle-store.test.ts`:

```ts
import { upsertContainerLifecycle } from '../services/container-lifecycle-store.js';

describe('upsertContainerLifecycle', () => {
  it('upserts current containers and marks absent ones not-running', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await upsertContainerLifecycle(4, [
      { Id: 'aaa', Names: ['/web'], State: 'running' },
      { Id: 'bbb', Names: ['/db'], State: 'exited' },
    ]);

    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [upsertSql, upsertParams] = mockQuery.mock.calls[0];
    expect(upsertSql).toMatch(/INSERT INTO container_lifecycle/);
    expect(upsertSql).toMatch(/ON CONFLICT \(endpoint_id, container_id\) DO UPDATE/);
    expect(upsertParams[0]).toBe(4);
    expect(upsertParams[1]).toEqual(['aaa', 'bbb']);   // ids
    expect(upsertParams[2]).toEqual(['web', 'db']);    // names, leading slash stripped
    expect(upsertParams[3]).toEqual([true, false]);    // running flags

    const [reconcileSql, reconcileParams] = mockQuery.mock.calls[1];
    expect(reconcileSql).toMatch(/SET running = FALSE/);
    expect(reconcileSql).toMatch(/<> ALL/);
    expect(reconcileParams).toEqual([4, ['aaa', 'bbb']]);
  });

  it('is a no-op when the container list is empty', async () => {
    await upsertContainerLifecycle(4, []);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/observability src/__tests__/container-lifecycle-store.test.ts -t "upsertContainerLifecycle"`
Expected: FAIL — `upsertContainerLifecycle is not a function` / import resolves to undefined.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/observability/src/services/container-lifecycle-store.ts` (above `getRunningContainerIds`):

```ts
/** Minimal container shape needed for lifecycle tracking (subset of Portainer's Container). */
export interface LifecycleContainer {
  Id: string;
  Names?: string[];
  State?: string;
}

/**
 * Record the full current container list (all states) for an endpoint so fleet
 * aggregates can exclude stopped/removed containers (#1394). Upserts every
 * present container (refreshing name/last_seen/running) then marks any
 * previously-known container that is no longer present as not running — which
 * covers both stopped and deleted containers. Call only with a successfully
 * fetched full list, so a failed fetch never mass-marks containers as gone.
 */
export async function upsertContainerLifecycle(
  endpointId: number,
  containers: LifecycleContainer[],
): Promise<void> {
  if (containers.length === 0) return;
  const db = await getMetricsDb();

  const ids: string[] = [];
  const names: string[] = [];
  const running: boolean[] = [];
  for (const c of containers) {
    ids.push(c.Id);
    names.push(c.Names?.[0]?.replace(/^\//, '') || c.Id.slice(0, 12));
    running.push(c.State === 'running');
  }

  await db.query(
    `INSERT INTO container_lifecycle (endpoint_id, container_id, container_name, last_seen, running)
     SELECT $1::int, cid, cname, NOW(), crun
     FROM unnest($2::text[], $3::text[], $4::bool[]) AS t(cid, cname, crun)
     ON CONFLICT (endpoint_id, container_id) DO UPDATE
       SET container_name = EXCLUDED.container_name,
           last_seen      = EXCLUDED.last_seen,
           running        = EXCLUDED.running`,
    [endpointId, ids, names, running],
  );

  await db.query(
    `UPDATE container_lifecycle
        SET running = FALSE
      WHERE endpoint_id = $1 AND container_id <> ALL($2::text[])`,
    [endpointId, ids],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/observability src/__tests__/container-lifecycle-store.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/services/container-lifecycle-store.ts packages/observability/src/__tests__/container-lifecycle-store.test.ts
git commit -m "feat(metrics): upsertContainerLifecycle with deletion reconcile (#1394)"
```

---

### Task 4: Export lifecycle store from the observability barrel

**Files:**
- Modify: `packages/observability/src/index.ts`

No dedicated test — the export is exercised by the scheduler (Task 5) and reports (Task 6) which import from `@dashboard/observability` / `../services/container-lifecycle-store.js`. A typecheck failure would surface any breakage.

- [ ] **Step 1: Add the barrel export**

In `packages/observability/src/index.ts`, immediately after the existing `metrics-store.js` export block (the `export { ... } from './services/metrics-store.js';` ending around line 23), add:

```ts
export type { LifecycleContainer } from './services/container-lifecycle-store.js';
export {
  upsertContainerLifecycle,
  getRunningContainerIds,
} from './services/container-lifecycle-store.js';
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add packages/observability/src/index.ts
git commit -m "feat(metrics): export container lifecycle store from barrel (#1394)"
```

---

### Task 5: Wire lifecycle upsert into the metrics scheduler

**Files:**
- Modify: `packages/server/src/scheduler.ts` (import on line ~11; `collectEndpointMetrics` body)
- Test: `packages/server/src/__tests__/scheduler.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/server/src/__tests__/scheduler.test.ts`:

(a) Add a mock fn near the other observability mock fns (after the `insertMetricsMock` declaration around line 40):

```ts
const upsertLifecycleMock = vi.fn().mockResolvedValue(undefined);
```

(b) Add it to the `@dashboard/observability` mock object (inside the `return { ... }` around lines 29–37):

```ts
    upsertContainerLifecycle: (...args: unknown[]) => upsertLifecycleMock(...args),
```

(c) Re-set its default in the global `beforeEach` (after `insertMetricsMock.mockResolvedValue(undefined);` around line 142):

```ts
  upsertLifecycleMock.mockReset().mockResolvedValue(undefined);
```

(d) Add two tests inside the `describe('scheduler/setup – runMetricsCollection', ...)` block:

```ts
  it('records container lifecycle with the full list (all states) per endpoint (#1394)', async () => {
    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' }] as any);
    getContainersMock.mockResolvedValueOnce([
      { Id: 'run-1', Names: ['/web'], State: 'running' },
      { Id: 'dead-1', Names: ['/old'], State: 'exited' },
    ] as any);

    await runMetricsCollection();

    expect(upsertLifecycleMock).toHaveBeenCalledWith(1, [
      { Id: 'run-1', Names: ['/web'], State: 'running' },
      { Id: 'dead-1', Names: ['/old'], State: 'exited' },
    ]);
  });

  it('still inserts metrics when the lifecycle upsert throws (#1394)', async () => {
    upsertLifecycleMock.mockRejectedValueOnce(new Error('lifecycle db down'));
    getEndpointsMock.mockResolvedValueOnce([{ Id: 1, Name: 'ep1', Status: 1, Type: 1, URL: 'tcp://localhost' }] as any);
    getContainersMock.mockResolvedValueOnce([{ Id: 'run-1', Names: ['/web'], State: 'running' }] as any);

    await runMetricsCollection();

    expect(insertMetricsMock).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --root packages/server src/__tests__/scheduler.test.ts -t "lifecycle"`
Expected: FAIL — `upsertLifecycleMock` never called (production code does not call it yet).

- [ ] **Step 3: Write minimal implementation**

In `packages/server/src/scheduler.ts`, add `upsertContainerLifecycle` to the existing `@dashboard/observability` import (line ~11):

```ts
import { collectMetrics, insertMetrics, cleanOldMetrics, cleanOldSpans, type MetricInsert, recordNetworkSample, insertKpiSnapshot, cleanOldKpiSnapshots, pruneStaleEntries, upsertContainerLifecycle } from '@dashboard/observability';
```

In `collectEndpointMetrics`, replace the final `return metrics;` with a best-effort lifecycle upsert followed by the return (place after the existing `if (containerMetricsFailures > 0) { ... }` block):

```ts
  // Record container lifecycle (full list, all states) so fleet aggregates can
  // exclude stopped/removed containers (#1394). Best-effort — never abort the
  // metrics cycle on a lifecycle write failure.
  try {
    await upsertContainerLifecycle(endpointId, containers);
  } catch (err) {
    log.warn({ err, endpointId }, 'Failed to upsert container lifecycle');
  }

  return metrics;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --root packages/server src/__tests__/scheduler.test.ts`
Expected: PASS (full scheduler file, including the 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/scheduler.ts packages/server/src/__tests__/scheduler.test.ts
git commit -m "feat(metrics): record container lifecycle each collection cycle (#1394)"
```

---

### Task 6: Filter the utilization `fleetSummary` to running containers

**Files:**
- Modify: `packages/observability/src/routes/reports.ts` (imports; `/api/reports/utilization` handler around lines 332–346)
- Test: `packages/observability/src/__tests__/reports-route.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/observability/src/__tests__/reports-route.test.ts`:

(a) Add a mock for the lifecycle store near the other `vi.mock` blocks (after the metrics-store mock around line 58):

```ts
const mockGetRunningIds = vi.fn().mockResolvedValue(null);
vi.mock('../services/container-lifecycle-store.js', () => ({
  getRunningContainerIds: (...a: unknown[]) => mockGetRunningIds(...a),
}));
```

(b) Reset it in the `beforeEach` (after `clearReportCache();` around line 84):

```ts
    mockGetRunningIds.mockReset().mockResolvedValue(null);
```

(c) Add two tests inside `describe('GET /api/reports/utilization', ...)`:

```ts
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
        .mockResolvedValueOnce({ rows: [{ p50: 40, p95: 78, p99: 80 }] }) // percentile: live
        .mockResolvedValueOnce({ rows: [{ p50: 0, p95: 0, p99: 0 }] });   // percentile: dead

      const res = await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=24h' });
      const body = JSON.parse(res.payload);

      // Per-container rows are unchanged — both still listed.
      expect(body.containers).toHaveLength(2);
      // Fleet average counts only the running container (40), not (40+0)/2 = 20.
      expect(body.fleetSummary.avgCpu).toBe(40);
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
        .mockResolvedValueOnce({ rows: [{ p50: 40, p95: 78, p99: 80 }] })
        .mockResolvedValueOnce({ rows: [{ p50: 0, p95: 0, p99: 0 }] });

      const res = await app.inject({ method: 'GET', url: '/api/reports/utilization?timeRange=24h' });
      const body = JSON.parse(res.payload);

      expect(body.fleetSummary.avgCpu).toBe(20); // (40 + 0) / 2
      expect(body.fleetSummary.totalContainers).toBe(2);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --root packages/observability src/__tests__/reports-route.test.ts -t "1394"`
Expected: FAIL — first test gets `avgCpu` = 20 and `totalContainers` = 2 (no filtering yet).

- [ ] **Step 3: Write minimal implementation**

In `packages/observability/src/routes/reports.ts`, add the import (after the `isUndefinedTableError` import around line 11):

```ts
import { getRunningContainerIds } from '../services/container-lifecycle-store.js';
```

In the `/api/reports/utilization` handler, replace the fleet-summary block (currently lines ~332–346):

```ts
      const containers = Array.from(containersMap.values());
      const cpuEntries = containers.filter(c => c.cpu);
      const memEntries = containers.filter(c => c.memory);

      const fleetSummary = {
        totalContainers: containers.length,
        avgCpu: cpuEntries.length > 0
          ? Math.round(cpuEntries.reduce((s, c) => s + c.cpu!.avg, 0) / cpuEntries.length * 100) / 100
          : 0,
        maxCpu: cpuEntries.length > 0 ? Math.max(...cpuEntries.map(c => c.cpu!.max)) : 0,
        avgMemory: memEntries.length > 0
          ? Math.round(memEntries.reduce((s, c) => s + c.memory!.avg, 0) / memEntries.length * 100) / 100
          : 0,
        maxMemory: memEntries.length > 0 ? Math.max(...memEntries.map(c => c.memory!.max)) : 0,
      };
```

with:

```ts
      const containers = Array.from(containersMap.values());

      // Fleet summary counts only currently-running containers so dead/idle
      // ones don't dilute the averages (#1394). Fail open: when the lifecycle
      // table has no data for this scope, getRunningContainerIds returns null
      // and every container is counted (prior behavior).
      const runningIds = await getRunningContainerIds(endpointId);
      const isRunning = (id: string) => runningIds === null || runningIds.has(id);
      const fleetContainers = containers.filter(c => isRunning(c.container_id));
      const cpuEntries = fleetContainers.filter(c => c.cpu);
      const memEntries = fleetContainers.filter(c => c.memory);

      const fleetSummary = {
        totalContainers: fleetContainers.length,
        avgCpu: cpuEntries.length > 0
          ? Math.round(cpuEntries.reduce((s, c) => s + c.cpu!.avg, 0) / cpuEntries.length * 100) / 100
          : 0,
        maxCpu: cpuEntries.length > 0 ? Math.max(...cpuEntries.map(c => c.cpu!.max)) : 0,
        avgMemory: memEntries.length > 0
          ? Math.round(memEntries.reduce((s, c) => s + c.memory!.avg, 0) / memEntries.length * 100) / 100
          : 0,
        maxMemory: memEntries.length > 0 ? Math.max(...memEntries.map(c => c.memory!.max)) : 0,
      };
```

> Note: the per-container `containers` array returned to the client is unchanged — only the summary now uses `fleetContainers`. The `recommendations` block below continues to use `containers` (unchanged).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --root packages/observability src/__tests__/reports-route.test.ts`
Expected: PASS (full reports-route file, including the 2 new tests; the existing `returns aggregated data` test still sees `totalContainers` = 1 because its `mockGetRunningIds` default is null → fail open).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/routes/reports.ts packages/observability/src/__tests__/reports-route.test.ts
git commit -m "fix(reports): exclude non-running containers from fleet summary (#1394)"
```

---

### Task 7: Filter trends + management fleet averages with a fail-open SQL clause

**Files:**
- Modify: `packages/observability/src/routes/reports.ts` (add helper; `/api/reports/trends` ~line 432; `/api/reports/management` ~line 556)
- Test: `packages/observability/src/__tests__/reports-route.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/observability/src/__tests__/reports-route.test.ts`, add one test in `describe('GET /api/reports/trends', ...)` and one in `describe('GET /api/reports/management', ...)`:

```ts
    it('restricts the hourly fleet average to running containers (#1394)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });
      await app.inject({ method: 'GET', url: '/api/reports/trends?timeRange=24h' });
      const trendCall = mockClientQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && /GROUP BY hour/.test(c[0] as string),
      );
      expect(trendCall).toBeDefined();
      expect(trendCall![0]).toMatch(/container_lifecycle/);
    });
```

```ts
    it('restricts the daily fleet average to running containers (#1394)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });
      await app.inject({ method: 'GET', url: '/api/reports/management?timeRange=7d' });
      const dailyCall = mockClientQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && /GROUP BY day/.test(c[0] as string),
      );
      expect(dailyCall).toBeDefined();
      expect(dailyCall![0]).toMatch(/container_lifecycle/);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --root packages/observability src/__tests__/reports-route.test.ts -t "fleet average"`
Expected: FAIL — the trend/daily SQL does not yet contain `container_lifecycle`.

- [ ] **Step 3: Write minimal implementation**

In `packages/observability/src/routes/reports.ts`, add a helper next to `addInfrastructureSqlFilter` (after it ends, around line 166):

```ts
/**
 * Fail-open "running containers only" filter for fleet AVERAGE queries (#1394).
 * If container_lifecycle has no rows for the scope (fresh deploy / not yet
 * populated) the clause matches every row, preserving prior behavior. Reuses
 * the same param placeholder twice (valid in PostgreSQL).
 */
function addLifecycleRunningFilter(
  conditions: string[],
  params: unknown[],
  startParamIdx: number,
  endpointId?: number,
): number {
  if (endpointId) {
    const idx = startParamIdx;
    params.push(endpointId);
    conditions.push(
      `(NOT EXISTS (SELECT 1 FROM container_lifecycle WHERE endpoint_id = $${idx})
        OR container_id IN (SELECT container_id FROM container_lifecycle WHERE running = TRUE AND endpoint_id = $${idx}))`,
    );
    return idx + 1;
  }
  conditions.push(
    `(NOT EXISTS (SELECT 1 FROM container_lifecycle)
      OR container_id IN (SELECT container_id FROM container_lifecycle WHERE running = TRUE))`,
  );
  return startParamIdx;
}
```

In the `/api/reports/trends` handler, replace the infrastructure-filter line (around line 432):

```ts
      addInfrastructureSqlFilter(conditions, params, paramIdx, excludeInfrastructure, infrastructurePatterns);
```

with:

```ts
      paramIdx = addInfrastructureSqlFilter(conditions, params, paramIdx, excludeInfrastructure, infrastructurePatterns);
      addLifecycleRunningFilter(conditions, params, paramIdx, endpointId);
```

In the `/api/reports/management` handler, replace the infrastructure-filter line (around line 556):

```ts
      addInfrastructureSqlFilter(baseConditions, baseParams, paramIdx, excludeInfrastructure, infrastructurePatterns);
```

with:

```ts
      paramIdx = addInfrastructureSqlFilter(baseConditions, baseParams, paramIdx, excludeInfrastructure, infrastructurePatterns);
      addLifecycleRunningFilter(baseConditions, baseParams, paramIdx, endpointId);
```

> Note: this `where` feeds both the management `topServices` query and the `weeklyTrends` daily-average query. Filtering `topServices` to running containers is acceptable (it is a top-10-by-usage list; idle/dead containers already rank last) and keeps the two management queries consistent. Per-container time-series, forecasts, and the anomaly detector are untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --root packages/observability src/__tests__/reports-route.test.ts`
Expected: PASS (full reports-route file, including the 2 new tests and all pre-existing ones — the fail-open clause leaves prior assertions intact).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/routes/reports.ts packages/observability/src/__tests__/reports-route.test.ts
git commit -m "fix(reports): running-only fail-open filter on trends/management fleet averages (#1394)"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Add an architecture note**

Find the metrics/observability section of `docs/architecture.md` (search for "metrics" / "TimescaleDB") and add a short subsection:

```markdown
#### Container lifecycle (`container_lifecycle`, TimescaleDB)

The metrics scheduler upserts one row per `(endpoint_id, container_id)` each
collection cycle from the full container list (all states), marking `running`
true/false and reconciling vanished containers to `running = false`. Fleet-level
CPU/memory averages (utilization `fleetSummary`, trends hourly average,
management daily average) filter to `running = TRUE` so stopped/removed
containers no longer dilute them (#1394). The filter is fail-open: if the table
has no rows for the queried scope, all containers are counted. Per-container
charts, forecasts, and the anomaly detector are unaffected. No metric rows are
deleted — time-based retention is unchanged.
```

- [ ] **Step 2: Run full affected suites + typecheck**

Run:
```bash
npx vitest run --root packages/observability src/__tests__/container-lifecycle-store.test.ts src/__tests__/reports-route.test.ts
npx vitest run --root packages/server src/__tests__/scheduler.test.ts
npm run typecheck
```
Expected: all PASS / clean.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: container lifecycle metric-dilution fix (#1394)"
```

---

## Self-Review

**Spec coverage:**
- Data model → Task 1. ✓
- Lifecycle store (`getRunningContainerIds`, `upsertContainerLifecycle`) → Tasks 2–3. ✓
- Barrel export → Task 4. ✓
- Collector wiring (full list, best-effort) → Task 5. ✓
- Read-path: utilization fleetSummary → Task 6; trends + management fleet averages (fail-open) → Task 7. ✓
- Fail-open everywhere → Tasks 2 (null), 6 (null branch), 7 (NOT EXISTS clause). ✓
- Non-goals (no DELETE; per-container/forecast/anomaly untouched) → respected; no task touches them. ✓
- Docs → Task 8. ✓

**Placeholder scan:** No TBD/TODO; every code/SQL/test step shows complete content. ✓

**Type consistency:** `getRunningContainerIds(endpointId?) → Set<string>|null`, `upsertContainerLifecycle(endpointId, LifecycleContainer[])`, `LifecycleContainer { Id; Names?; State? }`, `addLifecycleRunningFilter(conditions, params, startParamIdx, endpointId?) → number` — used identically across Tasks 2–7. Mock names (`mockGetRunningIds`, `upsertLifecycleMock`, `mockQuery`) are consistent within their test files. ✓

**Cross-PR note:** Task 5 edits `collectEndpointMetrics`, also touched by PR #1399 (#1389). The lifecycle call is appended after the failure-logging block, so any merge overlap is trivial.
