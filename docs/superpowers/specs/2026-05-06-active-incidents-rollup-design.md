# Active Incidents — Two-Level Rollup

**Status:** Design (approved, ready for implementation plan)
**Date:** 2026-05-06
**Related:** [#1195 — Reduce duplicate emissions in the incident correlation engine](https://github.com/kenhaesler/ai-portainer-dashboard/issues/1195)

## 1. Problem & Goal

The Active Incidents block on `/health` shows a flat list of 455 rows. Each prediction ETA and each container-level anomaly is its own row, so the same underlying problem appears many times and unique problems get buried. Users can't form an overview of the system.

**Goal.** Replace the flat list with a two-level rollup that gives a 5-second overview, scales to thousands of incidents, and preserves all existing capabilities (search, time range, sort, per-incident resolve, drill-down).

### In scope

- Backend: new `signature` column on `incidents`, populated at insert time from the source insight's structured fields. Backfill migration for existing rows. New `GET /api/incidents/groups` aggregate endpoint.
- Frontend: replace today's flat `Active Incidents` section with a summary strip + grouped list. Per-group expand → top-10 containers + "Show all" → click container → existing per-incident detail/resolve.
- Endpoint filter chip row above the list.
- Tests: backend (signature mapping, groups query, backfill), frontend (rendering, expand, top-N, resolve flows, search interop).

### Out of scope

- Changes to the correlation engine's grouping/dedup logic — tracked in [#1195](https://github.com/kenhaesler/ai-portainer-dashboard/issues/1195). Engine work waits for one week of production `signature` data so it can be data-driven.
- Resolved-incidents view redesign — same pattern, different defaults; separate follow-up.
- Endpoint-scoped sub-grouping (third nesting level). Endpoint is a *filter* in this PR, not a grouping axis. Adding it later is non-breaking.
- Reducing the *number* of incidents the system creates (that's the engine work in #1195).

### Non-goals

- Changing detection sensitivity (anomaly thresholds, ML models, cooldown sweeps).
- Changing per-incident detail or resolve semantics.

## 2. Architecture

### Data flow

```
[monitoring-service emits insight]
        │
        ▼
[insertInsights] ──── insights table (unchanged shape)
        │             (insight schema gains optional metric_type / detection_method)
        ▼
[correlateInsights] ── decides: new incident OR join existing
        │              (logic unchanged in this PR — engine work is #1195)
        ▼
[insertIncident / addInsightToIncident]
        │  ←── NEW: incident.signature is set here via deriveSignature()
        ▼
   incidents table  ─── NEW column: signature TEXT, indexed
        │
        ├─► /api/incidents             (existing, unchanged response shape)
        │
        └─► /api/incidents/groups      (NEW: SQL aggregate)
                  │
                  ▼
          [Active Incidents UI]
            • summary strip
            • flat list of signature groups
            • each group → top-10 containers + "Show all"
            • endpoint filter chips
```

### Layer ownership

| Layer | Owns | New in this PR |
|---|---|---|
| `incident-correlator.ts` | Building the `IncidentInsert` payload | Compute `signature` from the source insight's `category` + structured `metric_type` / `detection_method`. Falls back via title-derivation. |
| `incident-store.ts` | Persistence + queries | New `signature` column, new `getIncidentGroups()` SQL aggregate, backfill function. |
| `incidents.ts` route | HTTP surface | New `GET /api/incidents/groups` endpoint. Existing endpoints unchanged. |
| `monitoring-service.ts` | Insight emission | Optional `metric_type` and `detection_method` fields on anomaly + predictive insights. |
| `signature.ts` (new) | Signature derivation | Pure module, single source of truth. Imported by both correlator and backfill. |
| Frontend `use-incident-groups.ts` (new) | Data hook | `useIncidentGroups()` alongside existing `useIncidents()`. |
| Frontend `incident-groups-view.tsx` (new) | Group rendering | Summary strip, group cards, top-N containers, endpoint filter chips. |
| `ai-monitor.tsx` | Page render | Swap the `Active Incidents` flat-list block for `IncidentGroupsView`. |

### Boundary decisions

1. **Aggregate in SQL, not in JS.** `getIncidentGroups()` returns one row per signature with counts already computed. At 10K incidents the request stays a single fast query, not a 10K-row payload that the frontend reduces.
2. **Top-N containers picked in SQL.** The aggregate endpoint includes `top_containers` per signature (worst 10 by severity then most-recent). "Show all" calls existing `/api/incidents?status=active&signature=X` for the long tail — pagination cost lives where it belongs.
3. **Signature derivation in one place.** `deriveSignature()` in `signature.ts` is the single source of truth, used by both `buildIncident()` and the backfill. Single point to test, single point to evolve.
4. **Endpoint filter is a query param, not a separate endpoint.** `/api/incidents/groups?endpoint_id=42` filters server-side. Keeps URL/state cheap.
5. **Title is for humans, signature is for grouping.** They diverge by design. Title text remains free-form; signature is enum-like and stable.

## 3. Backend

### 3.1 Migration

The migration is split into two phases to avoid a write-blocking index build at deploy time. The auto-migration runner in `packages/core/src/db/postgres.ts` runs migrations inside a transaction; `CREATE INDEX` (without `CONCURRENTLY`) inside a transaction takes an `ACCESS EXCLUSIVE` lock and blocks writes for the duration. On a large `incidents` table that's an unacceptable deploy stall.

**Phase A — column add (auto-migration, transactional, fast):**

`packages/core/src/db/postgres-migrations/<NNN>_add_incident_signature.sql`:

```sql
ALTER TABLE incidents ADD COLUMN signature TEXT;
```

This is `O(1)` on Postgres (metadata-only) and runs safely inside the migration transaction.

**Phase B — index creation (deploy-time script, non-transactional):**

`packages/ai-intelligence/scripts/create-incident-signature-indexes.ts` runs after the column-add migration but outside any transaction:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_signature_status
  ON incidents (signature, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_endpoint_status
  ON incidents (endpoint_id, status);
```

`CONCURRENTLY` requires running outside a transaction block, which is why this can't live in the standard migration runner. The script connects directly via `pg`, runs each `CREATE INDEX CONCURRENTLY` separately (each must be its own transaction), and uses `IF NOT EXISTS` so it's safe to re-run. It's invoked once during deploy after the column-add migration completes.

`signature` is nullable across both phases so the column add is non-blocking. The backfill populates it; thereafter all writes set it. `NOT NULL` is enforced in a follow-up after one week of clean writes (see §5.5).

### 3.2 Insight schema additions

Two optional structured fields on the `Insight` model in `packages/core/src/models/monitoring.ts`:

```ts
metric_type: z.enum(['cpu', 'memory', 'disk', 'network', 'restart']).optional(),
detection_method: z.enum([
  'threshold',
  'ml-anomaly',
  'prediction',
  'health-check',
  'log-pattern',
  'security-scan'
]).optional(),
```

`monitoring-service.ts` populates these on every emission path it owns (anomaly, prediction, health-check, log-analysis, security). Existing insights without these fields keep working — the fallback path in `deriveSignature` covers them.

### 3.3 Signature derivation

`packages/ai-intelligence/src/services/signature.ts`:

```ts
import type { Insight } from '@dashboard/core/models/monitoring.js';

export function deriveSignature(
  rootCause: Pick<Insight, 'category' | 'metric_type' | 'detection_method' | 'title'>
): string {
  // Preferred path: structured fields
  if (rootCause.metric_type && rootCause.detection_method) {
    return `${rootCause.category}:${rootCause.detection_method}:${rootCause.metric_type}`;
  }
  // Category-only fallbacks
  if (rootCause.category === 'security') return 'security:scan';
  if (rootCause.category === 'log-analysis') return 'log:pattern';
  if (rootCause.category === 'ai-analysis') return 'ai:analysis';
  // Last resort — derive from title with a documented regex set
  return deriveSignatureFromTitle(rootCause.title);
}

export function signatureLabel(signature: string): string {
  return SIGNATURE_LABELS[signature] ?? humanizeSignature(signature);
}
```

`deriveSignatureFromTitle` is a small set of explicit regexes covering the title patterns currently emitted (e.g., `/predicted (\w+) exhaustion/i` → `predictive:prediction:$1`, `/has no health check/i` → `config:health-check:missing`). Each regex is unit-tested. If no regex matches, it returns `unknown:<slugified-title>` so the row is still groupable rather than dropped.

`humanizeSignature` converts a signature string into a readable label as a last-resort label when no entry exists in `SIGNATURE_LABELS` — e.g., `anomaly:threshold:disk` → `Anomaly · threshold · disk`. It is purely cosmetic; it never affects grouping or persistence.

The signature is set **once at incident creation** by `buildIncident()`. `addInsightToIncident` does not modify the signature when joining a new insight to an existing incident.

Resulting signatures (illustrative, not exhaustive):

| Source | Signature | Human label |
|---|---|---|
| Anomaly, ML, CPU | `anomaly:ml-anomaly:cpu` | Anomalous CPU usage (ML) |
| Anomaly, threshold, memory | `anomaly:threshold:memory` | High memory usage |
| Prediction, memory exhaustion | `predictive:prediction:memory` | Predicted memory exhaustion |
| Prediction, CPU exhaustion | `predictive:prediction:cpu` | Predicted CPU exhaustion |
| Health-check missing | `config:health-check:missing` (via title fallback) | Missing health check |
| Security scan finding | `security:scan` | Security scan finding |

The signature is the *kind* of problem; it does not include container or endpoint. Those are the dimensions we group across.

### 3.4 Backfill

`packages/ai-intelligence/scripts/backfill-incident-signatures.ts`:

- Selects incidents where `signature IS NULL` in batches of 500.
- Joins each row's `root_cause_insight_id` against `insights` to get category + structured fields.
- Calls **the same `deriveSignature` function** used by live writes (single source of truth). The function's preference order is unchanged: structured fields → category-only fallback → title regex.
- `UPDATE incidents SET signature = ? WHERE id = ? AND signature IS NULL` (idempotent — only fills nulls).
- Logs progress every 500 rows and a final `(signature, count)` summary.
- A `--force` flag re-derives all rows (drops the `IS NULL` predicate). Default behaviour is null-only.

Run once at deploy time. Re-runnable safely.

**Drift verification (mandatory before merge).** The risk is that legacy incidents whose root insight lacks the new structured fields fall through to the title regex and produce a signature that doesn't match what live writes produce for the same problem class — splitting the rollup. To prevent this:

1. Export a representative sample of historical incident titles from a real environment (script provided alongside the backfill: `dump-historical-titles.ts`, dumps to a CSV).
2. Add a test in `signature.test.ts` that loads this CSV and asserts every historical title maps to a signature in the known-good set (i.e., no `unknown:*` results, and the regex outputs match what the structured-field path would emit for the same problem class).
3. Any title that produces a mismatch is a regex bug to fix in `deriveSignatureFromTitle` before merge — not an acceptable "legacy fallback".

The CSV is checked in as a test fixture so the corpus stays stable across PRs. Add to it whenever new title patterns are discovered in production.

### 3.5 New endpoint: `GET /api/incidents/groups`

**Request:**

```
GET /api/incidents/groups?status=active&endpoint_id=42&since=24h&severity=critical
```

All query params optional. `status` defaults to `active`. `since` filters incidents whose **`COALESCE(latest_at, updated_at, created_at) >= NOW() - <window>`** — i.e., "recently active", not "recently created". A long-running active incident from 25 hours ago is *not* hidden by `since=24h` if it's still being updated. Accepts `1h`, `24h`, `7d`, or omitted (= all-time). The aggregate counts in the response reflect only the filtered set — including `top_containers`, `all_container_names`, and `endpoint_facets`.

**Response:**

```ts
{
  groups: Array<{
    signature: string;            // 'predictive:prediction:memory'
    label: string;                // 'Predicted memory exhaustion'
    severity: 'critical' | 'warning' | 'info';   // highest in the group
    incident_count: number;       // unique incidents in this group
    container_count: number;      // unique container names across the group
    alert_count: number;          // sum of insight_count
    earliest_at: string;          // ISO timestamp
    latest_at: string;
    top_containers: Array<{
      incident_id: string;
      container_name: string;
      endpoint_id: number | null;
      endpoint_name: string | null;
      severity: 'critical' | 'warning' | 'info';
      created_at: string;
    }>;                           // worst 10 by severity then recency
    all_container_names: string[]; // every distinct container name in the group,
                                  // for client-side search across the long tail
  }>,
  endpoint_facets: Array<{
    endpoint_id: number | null;
    endpoint_name: string | null;
    incident_count: number;
  }>,                             // for the chip row
  total_active: number;           // for summary strip and headers
}
```

`all_container_names` is intentionally just strings (not full incident records) to keep the payload bounded. At 200 containers per group × 30 groups × 50 chars/name ≈ 300 KB worst-case — acceptable. If empirical payloads exceed 500 KB, we cap the array at, say, 1000 names per group and require server-side search for groups beyond that (deferred until measured).

**Implementation:** one CTE per dimension (signature aggregate with `array_agg(DISTINCT container_name) AS all_container_names`, endpoint facet, top-N per signature using `ROW_NUMBER() OVER (PARTITION BY signature ORDER BY severity_rank, created_at DESC)`), wrapped into a single round-trip.

**Caching:** the route handler wraps the DB query in `cachedFetchSWR()` (existing pattern in `portainer-cache.ts`) keyed on `(status, endpoint_id, since, severity)` with a 20s TTL. Stale-while-revalidate ensures the 30s frontend poll hits the DB at most once per cache window per filter tuple. Cache invalidation: `invalidateTag('incidents')` is called on every `insertIncident`, `addInsightToIncident`, and `resolveIncident` so the next read refreshes.

**Auth:** `fastify.authenticate` (read-only). No new RBAC role required.

**Resolve action stays on the per-incident endpoint** for single resolves; a new batch endpoint (§3.6) handles multi-resolve.

### 3.6 New endpoint: `POST /api/incidents/resolve` (batch)

200 sequential `POST /api/incidents/:id/resolve` calls is unacceptable wall-clock for "Resolve all 200 in this group". Add a batch endpoint:

**Request:**

```
POST /api/incidents/resolve
Content-Type: application/json
{ "ids": ["uuid-1", "uuid-2", ...] }
```

Validated by Zod: `ids` must be a non-empty array of UUIDs, capped at 500 per call. Same auth as the single-resolve route: `fastify.authenticate` + `fastify.requireRole('admin')` (matches existing single-resolve RBAC at `incidents.ts:81`).

**Response:**

```ts
{
  resolved: string[];                              // ids successfully resolved
  failed: Array<{ id: string; error: string }>;    // per-id failure reasons
}
```

**Implementation:** wraps the existing `resolveIncident()` per id in a single transaction; per-id failures are caught and surfaced in `failed[]` rather than aborting the whole batch. Audit-logs each resolution like the single-resolve route. Tag-invalidates `incidents` once at the end. Single round trip, returns within ~1s for batches of 500.

### 3.7 Tests

Added to `packages/ai-intelligence/src/__tests__/`:

| File | Covers |
|---|---|
| `signature.test.ts` | Derivation: every category/method/metric combo, fallbacks, label lookup, stability across known title variants, **and the historical-titles drift corpus from §3.4 (every CSV row maps to a known signature, no `unknown:*`)**. |
| `incidents-groups.test.ts` | New route end-to-end: aggregate counts, top-N ordering, `all_container_names` correctness, severity rollup, endpoint filter, `since` filter using `latest_at` semantics, empty result, auth, cache invalidation on resolve. |
| `incidents-resolve-batch.test.ts` | New batch resolve route: success path, partial failure (some ids resolved, others not), input validation (cap, UUID shape), RBAC (admin required), audit-log emission, tag invalidation. |
| `incidents-backfill.test.ts` | Backfill: populates null signatures, idempotent on re-run, handles missing root insight, batch boundary, `--force` flag. |
| `incident-correlator.test.ts` (additions) | `buildIncident()` writes `signature` correctly for structured-fields path and falls back for legacy insights. |

All DB tests use the real-PostgreSQL helper (`test-db-helper.ts`).

## 4. Frontend

### 4.1 New hook

`frontend/src/features/ai-intelligence/hooks/use-incident-groups.ts`:

```ts
export function useIncidentGroups(params: {
  status?: 'active' | 'resolved';
  endpointId?: number;
  since?: '1h' | '24h' | '7d';
  severity?: 'critical' | 'warning' | 'info';
})
```

Same `refetchInterval` (30s + page-visibility gating) as `useIncidents`. Existing `useIncidents()` and `useIncidentDetail()` stay — they back the per-container drill-down inside an expanded group.

### 4.2 Component layout

`frontend/src/features/ai-intelligence/components/incident-groups-view.tsx` replaces the flat-list block in `ai-monitor.tsx`.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Active Incidents                                       [1h|24h|7d|All]
│  ──────────────────────────────────────────────────────────────────  │
│  Critical: 3 kinds across 8 containers   ·   Warning: 5 / 22         │ ← summary strip
│  ──────────────────────────────────────────────────────────────────  │
│  Endpoint:  [All 158]  [endpoint-A 89]  [endpoint-B 52]  [...12]     │ ← chip row
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│ ● Critical  Predicted memory exhaustion       12 containers · 38 alerts ▼
│   ───────────────────────────────────────────────────────────────── │
│   ▢ docker-postgres-app-1     critical · 24h · endpoint-A     [Resolve]
│   ▢ docker-timescale-1        critical · 18h · endpoint-A     [Resolve]
│   ▢ portainer-app-3           warning  · 12h · endpoint-B     [Resolve]
│   ... (7 more shown)                                                │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │  Show all 12 containers                                       │ │
│   └───────────────────────────────────────────────────────────────┘ │
│   [☑ Resolve 3 selected]   [Resolve all 12 in this group]           │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│ ● Warning   Anomalous CPU usage (ML-detected)   22 containers · 89 alerts ▶
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 Behavior

| Element | Behavior |
|---|---|
| Summary strip | Single line. Computed client-side from `groups`. Each container is counted **at most once across severity buckets** — by its highest severity. So "Critical: 3 kinds across 8 containers · Warning: 5 kinds across 22 containers" means 8 containers have at least one critical incident, and 22 *additional* containers have at least one warning (and no critical). Info bucket only renders if non-zero. |
| Time range tabs | Existing controls, moved to header line. URL `?range=` (already in use). Defaults to `24h` if no URL state. |
| Endpoint chip row | Renders only when `endpoint_facets.length > 1`. Active chip is URL-driven (`?endpoint=`). "All" clears the param. |
| Group card collapsed | Severity dot · label · `N containers · M alerts` · chevron. Critical groups expanded by default; warnings/info collapsed. |
| Group card expanded | Top 10 container rows from `top_containers`. Each row: checkbox, container chip (linked to `/containers/:endpointId/:containerId`), severity badge, age, endpoint, individual `[Resolve]`. |
| "Show all N" link | Visible when `container_count > 10`. Click → fetches `/api/incidents?status=active&signature=X` and replaces the top-10 list with the full set. Per-group state, not URL. |
| Per-row resolve | Calls existing `useResolveIncident()`. No change. |
| Per-group "Resolve all" | New action. Confirms via existing `ConfirmDialog`. Calls the new **`POST /api/incidents/resolve`** batch endpoint with all incident IDs in the group (one round trip, see §3.6). Failures surfaced per-id via the partial-failure rules below. |
| Multi-select bar | Existing bulk-action bar stays for cross-group selection. Now also calls the batch endpoint. Selection survives expand/collapse. |
| Search | Filters groups by (a) signature label and (b) **`all_container_names`** (the full server-provided list, including the long tail — no false negatives). When a group matches via a container hit, it auto-expands. If the matching container is in the long tail (not in `top_containers`), the page auto-triggers the "Show all" fetch for that group so the matching row is visible. No backend change. |
| Sort | Existing severity/time toggle applies inside groups. Group order is fixed: severity → container_count desc. |
| Empty state | "No active incidents in this view." Reuses the dashed-border box already used by the page. |

### 4.4 URL state

| Param | Values | Default |
|---|---|---|
| `range` | `1h` / `24h` / `7d` / `all` | `24h` |
| `endpoint` | endpoint id | absent (= all) |
| `sort` | `severity` / `time` | `severity` (existing) |
| `expand` | comma-separated signature strings | absent (= use default expand-by-severity rule) |

Expand state is URL-tracked when the user explicitly toggles a group, so deep-linking to "this exact view" works (refresh, share). Toggling a critical group closed adds it to `?expand=` with a `-` prefix (e.g., `?expand=-anomaly:ml-anomaly:cpu`), so the URL captures *deviations* from the default, not the full state. Initial render with no `?expand=` follows the "critical expanded by default" rule from §4.3.

`?signature=` is **not** introduced — search-and-expand covers the deep-link use case. Avoiding ship-but-unused URL params.

### 4.5 Resolve paths

Three resolve paths coexist; the contract is explicit:

| Trigger | Scope | Confirm? |
|---|---|---|
| Per-row button | one incident | no |
| Multi-select bar (existing) | selected ids across groups | yes (existing) |
| Per-group "Resolve all N" | every incident in one signature | yes (new dialog) |

**Partial-failure UX** (applies to both multi-select and per-group "Resolve all"):

- The batch endpoint returns `{ resolved: [...], failed: [...] }`.
- If `failed.length === 0`: dismiss the action bar with a "Resolved N" toast.
- If `failed.length <= 5`: keep the failed rows visible with a red border and the per-id error message inline. The action bar shows "Retry N failed".
- If `failed.length > 5`: collapse to a single banner — "N of M resolves failed" — with one **Retry failed only** button that re-issues the batch with just `failed[].id`. No 200-row error list. The button retains state until the user dismisses or all retries succeed.
- Action bar selection is replaced with the failed-id set after each batch so retry is one click away. Successful resolves are removed from selection regardless of retry state.

### 4.6 Tests

Added to `frontend/src/features/ai-intelligence/`:

| File | Covers |
|---|---|
| `hooks/use-incident-groups.test.ts` | Query key, params serialization, 30s refetch + visibility gating. |
| `components/incident-groups-view.test.tsx` | Renders summary (with single-bucket-per-container rule), chips, collapsed/expanded groups, default-expand-on-critical, top-10, severity-dot per group. |
| `components/incident-groups-view.resolve.test.tsx` | Per-row resolve, per-group "Resolve all" via batch endpoint, multi-select interop, partial-failure UX (≤5 fail → inline; >5 fail → collapsed banner with Retry failed only). |
| `components/incident-groups-view.search.test.tsx` | Search filters via `all_container_names` (long-tail container is found, not just `top_containers`); auto-expand on container hit; auto-trigger "Show all" when match is in long tail. |
| `components/incident-groups-view.show-all.test.tsx` | "Show all N" pagination flow: fetch via `/api/incidents?signature=X`, replaces top-10, search remains scoped to the expanded set. |
| `components/incident-groups-view.url.test.tsx` | URL state: `range`, `endpoint`, `sort`, `expand` (with `-` prefix for closed-by-default deviations) survive refresh; deep-link URL renders matching state. |
| `pages/ai-monitor.test.tsx` (additions) | The page renders `IncidentGroupsView` instead of the flat list; existing assertions for non-incident sections still pass. |

Mocks: `useIncidentGroups` for component tests (frontend mocks API at the boundary). No backend changes required to run frontend tests.

**i18n note.** Signature labels and copy in this view are English-only. The codebase has no i18n layer yet; adding one is a global concern outside this work. Labels live in `signature.ts` (`SIGNATURE_LABELS`) so a future i18n pass is one-file scope.

## 5. Rollout

### 5.1 Merge order

Single PR against `dev`, commits in this order so each step is independently revertable:

1. **Phase A migration:** add nullable `signature` column. (Auto-migration, transactional, fast.)
2. **Index-creation script:** non-transactional `CREATE INDEX CONCURRENTLY` script (§3.1 Phase B). Runs at deploy time, before user-facing reads.
3. `signature.ts` derivation function + tests + historical-titles drift corpus. (Pure module, no callers.)
4. `monitoring-service.ts`: emit optional `metric_type` / `detection_method`. (Backward-compatible.)
5. `incident-correlator.ts`: write `signature` on insert. (New rows populated; legacy rows still NULL.)
6. Backfill script. Run once at deploy. Idempotent.
7. New `POST /api/incidents/resolve` batch endpoint + tests.
8. New `GET /api/incidents/groups` endpoint with `cachedFetchSWR` + tests.
9. Frontend hook + `IncidentGroupsView` component + tests.
10. Swap the page section in `ai-monitor.tsx`.

If anything goes sideways during rollout, steps 1–8 stay (the column, indexes, and endpoints are harmless if unused) and step 10 is the only revert needed to restore the old UI.

### 5.2 Production verification

Done by the deployer after merge:

- [ ] Phase A migration applied; `signature` column present on `incidents`.
- [ ] Phase B index script run; `idx_incidents_signature_status` and `idx_incidents_endpoint_status` exist (verify via `\d+ incidents`).
- [ ] Backfill script run; `SELECT COUNT(*) FROM incidents WHERE signature IS NULL` returns 0.
- [ ] Drift verification passed locally (signature.test.ts CSV corpus assertion green) before merge.
- [ ] `GET /api/incidents/groups` returns within 250ms p95 against the live dataset (size noted in PR). Cache hit ratio >70% during steady-state (visible in logs).
- [ ] `POST /api/incidents/resolve` returns within ~1s for a 100-id batch; partial-failure response shape verified.
- [ ] `/health` page renders the new view; existing per-incident drill-down still works (click container → existing `/incidents/:id`).
- [ ] Manual: resolve one incident via per-row, one via per-group "Resolve all", one via multi-select. All three update counts and refetch. Force a partial failure (e.g., resolve an already-resolved id mid-batch) and verify the >5-fail collapsed-banner UX.
- [ ] Manual: endpoint filter chip changes the URL and the visible groups; refresh preserves the filter.
- [ ] Manual: search for a container in the long tail (not in `top_containers`) — group auto-expands and auto-fetches "Show all".
- [ ] No regression in existing security-regression tests (auth, RBAC on new routes — both `groups` and batch `resolve`).

### 5.3 Rollback

| Failure mode | Rollback |
|---|---|
| Frontend rendering broken | Revert step 10 only — old flat list returns. Backend stays. |
| `/api/incidents/groups` slow or wrong | Revert steps 8–10. Backfilled column and indexes are harmless. |
| Cache misbehaving (stale data, missed invalidations) | Bypass cache via env flag (set `INCIDENTS_GROUPS_CACHE_TTL_MS=0`) — endpoint stays correct, just slower. Then debug. |
| Batch resolve endpoint failing | Frontend feature-flags fall-back to looped single-resolve calls. Worse UX, still functional. |
| Backfill produced wrong signatures | Re-run with corrected `deriveSignature`; the script is idempotent and only overwrites NULLs by default. Use `--force` for full re-derivation. |
| Phase B index creation fails mid-flight | `CREATE INDEX CONCURRENTLY` failures leave behind invalid indexes. Drop them (`DROP INDEX IF EXISTS …`) and re-run the script. Reads keep working without the indexes (slower full scans), so this isn't user-blocking. |
| Phase A migration concerns | `ALTER TABLE ADD COLUMN nullable` is `O(1)` on Postgres (metadata-only). No expected blocker. |

`NOT NULL` is **not** added in this PR. Follow-up after one week of clean writes.

### 5.4 Telemetry

Two cheap log emissions that pay back during the engine work in #1195:

- On `getIncidentGroups()` query: log `(signature, container_count, alert_count)` at debug level. One line per group.
- On `insertIncident`: log `(signature, correlation_type)`. Already partially logged; just add `signature`.

These give us the "alerts per container per signature" ratio that #1195 needs to prioritize engine fixes.

### 5.5 Follow-ups

| Follow-up | When |
|---|---|
| [#1195](https://github.com/kenhaesler/ai-portainer-dashboard/issues/1195) — engine dedup work | After this PR + 1 week of signature data |
| Signature `NOT NULL` enforcement | One week after this PR; trivial migration |
| Resolved-incidents view redesign | Smaller separate PR; same group structure, different defaults |
| Endpoint-scoped sub-grouping (third nesting level) | Only if telemetry shows endpoint distribution is uneven enough to warrant it |

## 6. Acceptance criteria

- [ ] `incidents.signature` column exists (Phase A); `idx_incidents_signature_status` and `idx_incidents_endpoint_status` exist (Phase B, `CONCURRENTLY`).
- [ ] `signature.ts` exports `deriveSignature()` and `signatureLabel()`, with full test coverage of the derivation matrix **and** the historical-titles drift corpus.
- [ ] `monitoring-service.ts` emits `metric_type` and `detection_method` on anomaly + predictive + health-check + log-analysis + security insights.
- [ ] `incident-correlator.ts` writes `signature` on every new incident via `deriveSignature` (single source of truth shared with backfill). Existing tests continue to pass.
- [ ] Backfill script populates all existing incidents with non-null signatures; runnable safely more than once. Drift verification CSV passes before merge.
- [ ] `GET /api/incidents/groups` returns the response shape in §3.5 (including `all_container_names`), supports `status` / `endpoint_id` / `since` / `severity` filters, applies `since` against `latest_at`, returns within 250ms p95, wrapped in `cachedFetchSWR` with tag invalidation on incident writes.
- [ ] `POST /api/incidents/resolve` batch endpoint exists, admin-RBAC-gated, validates input, returns `{ resolved, failed }`, and audit-logs each resolution.
- [ ] `/health` page renders `IncidentGroupsView` with summary strip (single-bucket-per-container), endpoint chips, collapsed/expanded groups, top-10 container rows, "Show all" expansion.
- [ ] All three resolve paths (per-row, multi-select, per-group) use the batch endpoint where multi-id and surface partial-failure per the §4.5 rules (≤5 inline, >5 collapsed banner with Retry failed only).
- [ ] Search filters via `all_container_names` (long-tail container names found, not just `top_containers`); auto-expands and auto-fetches "Show all" when needed.
- [ ] URL params (`range`, `endpoint`, `sort`, `expand` with `-` prefix) survive refresh and deep-linking. No unused URL params shipped.
- [ ] All new and existing tests pass on backend, frontend, and packages workspaces.
- [ ] No new ESLint or TypeScript errors. No regression in security-regression tests (auth + RBAC on both new routes).
