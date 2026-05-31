# Container lifecycle tracking — fix cross-container metric dilution (#1394)

**Date:** 2026-05-31
**Issue:** #1394 (epic #1397). #1395 and #1396 were closed as duplicates of #1394.
**Status:** Approved design.

## Problem

The dashboard's **fleet-level** CPU/memory averages read far lower than reality —
e.g. a stored fleet average of ~1.4% memory while `docker stats` shows individual
containers (elasticsearch) at ~42%. Over a one-hour window the metrics store
contains ~222 unique `container_id`s while only ~21 containers are actually
running; all-time it holds 621 unique containers.

## Root cause (verified against source)

- **Per-container views and the collector are correct.** The Workload Explorer
  shows each container's own time series via `/api/metrics/{endpointId}/{containerId}`
  (filtered by `container_id`), and `metrics-collector` computes
  `mem% = (usage − cache) / limit × 100` and the standard Docker CPU formula —
  matching `docker stats`. A single container's stored values are accurate.
- **The bug is cross-container averaging.** Fleet/summary aggregations time-filter
  but do **not** filter to currently-running containers, so every `container_id`
  seen in-window is weighted equally. ~21 live containers are swamped by ~200
  dead/idle/short-lived ones, collapsing the fleet average.

The three diluted sites (all in `packages/observability/src/routes/reports.ts`):

| Site | What dilutes | Location |
|---|---|---|
| `/api/reports/utilization` `fleetSummary.avgCpu/avgMemory` | mean of per-container averages across all in-window containers | reports.ts ~338–346 (JS) |
| `/api/reports/trends` hourly fleet average | `AVG(value)` grouped by hour across all containers | reports.ts ~439/449 (SQL) |
| `/api/reports/management` `weeklyTrends` daily fleet average | `AVG(value)` grouped by day across all containers | reports.ts ~617/628 (SQL) |

Per-container report rows, the utilization per-container list, `topServices`
(top-10 by usage — idle containers already sink out), forecasts, the anomaly
detector, and `getMovingAverage` are **not** diluted and are out of scope.

## Architectural constraint

Metrics live in **TimescaleDB** (`getReportsDb()` / `getMetricsDb()` →
`TIMESCALE_URL`), a **separate database** from the app Postgres
(`POSTGRES_APP_URL`). Therefore the lifecycle table must live in TimescaleDB so
the read-path filter can be an in-database subquery, and the collector writes it
via `getMetricsDb()`.

## Scope decisions (chosen)

1. **Mechanism = lifecycle tracking.** A small `container_lifecycle` table,
   upserted each collection cycle, recording per-container `running` state and
   `last_seen`. (Chosen over a recency proxy or a query-time live-set fetch
   because it is robust, reusable, and lays groundwork for a future *safe* purge.)
2. **Read-side filter = fleet aggregates only.** Apply `running = TRUE` to the
   three diluted averages above. Per-container rows/charts, forecasts, and the
   anomaly detector stay untouched.

## Design

### 1. Data model — `timescale-migrations/002_container_lifecycle.sql`

Additive only (`CREATE TABLE IF NOT EXISTS`); touches no existing data.

```sql
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

### 2. Lifecycle store — `packages/observability/src/services/container-lifecycle-store.ts`

Exported via the observability barrel. Uses `getMetricsDb()`.

- `upsertContainerLifecycle(endpointId, containers)` where `containers` is the
  **full** current list (all states: `{ Id, Names?, State }[]`):
  1. Upsert every current container in one parameterized statement —
     set `container_name`, `last_seen = NOW()`, `running = (State === 'running')`;
     on conflict update those columns and keep `first_seen`.
  2. Mark anything gone in one statement:
     `UPDATE container_lifecycle SET running = FALSE
      WHERE endpoint_id = $1 AND container_id <> ALL($2::text[])`
     — handles both stopped and deleted containers.
  - Called only when the endpoint's container list was fetched successfully, so a
    failed fetch never mass-marks containers as not-running.
  - No-op (skips both statements) when `containers` is empty.
- `getRunningContainerIds(endpointId?)` → `Promise<Set<string> | null>`:
  `SELECT container_id FROM container_lifecycle WHERE running = TRUE
   [AND endpoint_id = $1]`. Returns `null` when the table has **no rows** for the
  scope, signalling callers to **fail open** (don't filter). Tolerates a missing
  table via `isUndefinedTableError` → returns `null`.

### 3. Collector wiring — `packages/server/src/scheduler.ts`

`collectEndpointMetrics` already fetches the full container list (`getContainers`
defaults to `all=true`) and derives `running`. Add a single additive call to
`upsertContainerLifecycle(endpointId, containers)` within the existing per-endpoint
success path (before returning the metric rows). A lifecycle-upsert failure must
not abort metrics collection — wrap in its own try/catch that logs and continues.

> Overlap note: PR #1399 (#1389) also edits `collectEndpointMetrics`. The lifecycle
> call is a distinct additive line; any merge overlap is trivial.

### 4. Read-path filter — `packages/observability/src/routes/reports.ts` (fail-open)

- **Utilization `fleetSummary`:** fetch `getRunningContainerIds(endpointId)`.
  If non-null, compute `avgCpu`/`avgMemory`/`maxCpu`/`maxMemory` over only the
  containers whose `container_id` is in the running set; if null, current
  behavior. The per-container `containers` array returned to the client is
  **unchanged** (stopped containers still listed with their real history).
- **Trends hourly avg + management `weeklyTrends` daily avg:** add a fail-open
  clause to the aggregation `WHERE`:
  ```sql
  AND (
    NOT EXISTS (SELECT 1 FROM container_lifecycle clf
                WHERE clf.endpoint_id = <scope>)         -- no data yet → include all
    OR container_id IN (SELECT container_id FROM container_lifecycle
                        WHERE running = TRUE AND clf.endpoint_id = <scope>)
  )
  ```
  When `endpointId` is not supplied, the scope predicate is dropped (whole table).
- `topServices` (management top-10) is **not** filtered.

### Fail-open guarantee

If `container_lifecycle` is empty — fresh deploy, migration just ran, or
pre-existing metrics before the table populates — every read behaves exactly as
today. No zeroed dashboards during the populate window (one collection interval,
default 60s).

## Testing strategy (TDD)

Follows the observability convention of mocking the DB client at
`getMetricsDb`/`getReportsDb` (see `reports-route.test.ts`).

- **`container-lifecycle-store.test.ts`** (new): `upsertContainerLifecycle` issues
  the upsert + the reconcile (`<> ALL`) statements with correct params and the
  right `running` flags; skips when the list is empty.
  `getRunningContainerIds` returns a `Set` of running ids, returns `null` when no
  rows exist, and returns `null` on `undefined table`.
- **`scheduler.test.ts`** (extend): `runMetricsCollection` calls
  `upsertContainerLifecycle` with the **full** container list (all states) per
  endpoint; a thrown lifecycle upsert does not abort the cycle (metrics still
  inserted).
- **`reports-route.test.ts`** (extend): with a running subset, `fleetSummary`
  excludes non-running containers from `avgCpu`/`avgMemory`; the trends and
  management aggregation SQL contains the fail-open lifecycle clause; with no
  lifecycle data (`getRunningContainerIds` → null / `NOT EXISTS` true) all
  containers are included (no regression).

## Non-goals (YAGNI)

- **No `DELETE`/purge of metric rows.** The table *enables* a future safe purge
  but we do not implement one now; destructive metric deletion is barred by the
  repo data-safety rule, and time-based retention already exists.
- Per-container charts, the utilization per-container list, `topServices`,
  forecasts, the anomaly detector, `getMovingAverage`, Prometheus export — all
  unchanged.
- No table partitioning, no data-quality alerting, no schema change to `metrics`.

## Migration & rollout safety

- Additive `CREATE TABLE IF NOT EXISTS` + partial index — zero impact on existing
  rows; runs via the existing TimescaleDB migration runner.
- Fail-open reads mean correct behavior before/while the table populates.
- Reversible: dropping the read filter restores prior behavior; the table can be
  dropped with no data loss to metrics.

## Docs to update on implementation

- `docs/architecture.md` — note the `container_lifecycle` table and the
  running-only fleet-average filter.
- No new env vars; `docker/.env.example` unchanged.
