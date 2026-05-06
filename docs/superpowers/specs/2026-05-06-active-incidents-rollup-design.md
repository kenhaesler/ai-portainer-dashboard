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

`packages/core/src/db/postgres-migrations/<NNN>_add_incident_signature.sql`:

```sql
ALTER TABLE incidents ADD COLUMN signature TEXT;
CREATE INDEX idx_incidents_signature_status ON incidents (signature, status);
CREATE INDEX idx_incidents_endpoint_status ON incidents (endpoint_id, status);
```

`signature` is nullable in this migration so the column add is non-blocking. The backfill populates it; thereafter all writes set it. `NOT NULL` is enforced in a follow-up after one week of clean writes (see §5.5).

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
- Calls `deriveSignature(rootInsight)`; falls through to `deriveSignatureFromTitle(incident.title)` if the root insight is missing (deleted, archived).
- `UPDATE incidents SET signature = ? WHERE id = ? AND signature IS NULL` (idempotent — only fills nulls).
- Logs progress every 500 rows and a final `(signature, count)` summary.
- A `--force` flag re-derives all rows (drops the `IS NULL` predicate). Default behaviour is null-only.

Run once at deploy time. Re-runnable safely.

### 3.5 New endpoint: `GET /api/incidents/groups`

**Request:**

```
GET /api/incidents/groups?status=active&endpoint_id=42&since=24h&severity=critical
```

All query params optional. `status` defaults to `active`. `since` filters incidents whose `created_at >= NOW() - <window>`; accepts `1h`, `24h`, `7d`, or omitted (= all-time). The aggregate counts in the response reflect only the filtered set — including `top_containers` and `endpoint_facets`.

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
  }>,
  endpoint_facets: Array<{
    endpoint_id: number | null;
    endpoint_name: string | null;
    incident_count: number;
  }>,                             // for the chip row
  total_active: number;           // for summary strip and headers
}
```

**Implementation:** one CTE per dimension (signature aggregate, endpoint facet, top-N per signature using `ROW_NUMBER() OVER (PARTITION BY signature ORDER BY severity_rank, created_at DESC)`), wrapped into a single round-trip.

**Auth:** `fastify.authenticate` (read-only). No new RBAC role required.

**Resolve action stays on the per-incident endpoint.** The aggregate endpoint is read-only.

### 3.6 Tests

Added to `packages/ai-intelligence/src/__tests__/`:

| File | Covers |
|---|---|
| `signature.test.ts` | Derivation: every category/method/metric combo, fallbacks, label lookup, stability across known title variants. |
| `incidents-groups.test.ts` | New route end-to-end: aggregate counts, top-N ordering, severity rollup, endpoint filter, since filter, empty result, auth. |
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
| Summary strip | Single line. Computed client-side from `groups`. Shows `critical kinds / containers` + `warning kinds / containers`. Info bucket only renders if non-zero. |
| Time range tabs | Existing controls, moved to header line. URL `?range=` (already in use). Defaults to `24h` if no URL state. |
| Endpoint chip row | Renders only when `endpoint_facets.length > 1`. Active chip is URL-driven (`?endpoint=`). "All" clears the param. |
| Group card collapsed | Severity dot · label · `N containers · M alerts` · chevron. Critical groups expanded by default; warnings/info collapsed. |
| Group card expanded | Top 10 container rows from `top_containers`. Each row: checkbox, container chip (linked to `/containers/:endpointId/:containerId`), severity badge, age, endpoint, individual `[Resolve]`. |
| "Show all N" link | Visible when `container_count > 10`. Click → fetches `/api/incidents?status=active&signature=X` and replaces the top-10 list with the full set. Per-group state, not URL. |
| Per-row resolve | Calls existing `useResolveIncident()`. No change. |
| Per-group "Resolve all" | New action. Confirms via existing `ConfirmDialog`. Iterates `POST /api/incidents/:id/resolve` for incident IDs in the group; reuses bulk-resolve error handling (partial-failure surfacing). |
| Multi-select bar | Existing bulk-action bar stays for cross-group selection. Selection survives expand/collapse. |
| Search | Existing search input filters groups by signature label and by container names in `top_containers`. A group is hidden if it has no match in either. When a group matches because of a container hit, the group auto-expands to show the matching rows. Long-tail containers fetched via "Show all" are also filtered. No backend change. |
| Sort | Existing severity/time toggle applies inside groups. Group order is fixed: severity → container_count desc. |
| Empty state | "No active incidents in this view." Reuses the dashed-border box already used by the page. |

### 4.4 URL state

| Param | Values | Default |
|---|---|---|
| `range` | `1h` / `24h` / `7d` / `all` | `24h` |
| `endpoint` | endpoint id | absent (= all) |
| `sort` | `severity` / `time` | `severity` (existing) |
| `signature` | signature string | absent (= no group focus; reserved for deep-link to one group) |

Expand/collapse is **not** in the URL — local state only. Groups are bounded (~10–30), defaults are good, URL noise outweighs the benefit.

### 4.5 Resolve paths

Three resolve paths coexist; the contract is explicit:

| Trigger | Scope | Confirm? |
|---|---|---|
| Per-row button | one incident | no |
| Multi-select bar (existing) | selected ids across groups | yes (existing) |
| Per-group "Resolve all N" | every incident in one signature | yes (new dialog) |

The new "Resolve all" runs through the same partial-failure path as multi-select bulk: failures stay highlighted, user can retry without losing context.

### 4.6 Tests

Added to `frontend/src/features/ai-intelligence/`:

| File | Covers |
|---|---|
| `hooks/use-incident-groups.test.ts` | Query key, params serialization, 30s refetch + visibility gating. |
| `components/incident-groups-view.test.tsx` | Renders summary, chips, collapsed/expanded groups, top-10, "Show all" expansion, severity-dot per group. |
| `components/incident-groups-view.resolve.test.tsx` | Per-row resolve, per-group "Resolve all" with confirm + partial-failure recovery, multi-select interop. |
| `components/incident-groups-view.search.test.tsx` | Search filters labels and container names; group cards hide when no matches. |
| `pages/ai-monitor.test.tsx` (additions) | The page renders `IncidentGroupsView` instead of the flat list; existing assertions for non-incident sections still pass. |

Mocks: `useIncidentGroups` for component tests (frontend mocks API at the boundary). No backend changes required to run frontend tests.

## 5. Rollout

### 5.1 Merge order

Single PR against `dev`, commits in this order so each step is independently revertable:

1. Migration: add nullable `signature` column + indexes. (No code reads it yet.)
2. `signature.ts` derivation function + tests. (Pure module, no callers.)
3. `monitoring-service.ts`: emit optional `metric_type` / `detection_method`. (Backward-compatible.)
4. `incident-correlator.ts`: write `signature` on insert. (New rows populated; legacy rows still NULL.)
5. Backfill script. Run once at deploy. Idempotent.
6. New `GET /api/incidents/groups` endpoint + tests.
7. Frontend hook + `IncidentGroupsView` component + tests.
8. Swap the page section in `ai-monitor.tsx`.

If anything goes sideways during rollout, steps 1–6 stay (the column is harmless if unused) and step 8 is the only revert needed to restore the old UI.

### 5.2 Production verification

Done by the deployer after merge:

- [ ] Migration applied; `signature` column present on `incidents`.
- [ ] Backfill script run; `SELECT COUNT(*) FROM incidents WHERE signature IS NULL` returns 0.
- [ ] `GET /api/incidents/groups` returns within 250ms p95 against the live dataset (size noted in PR).
- [ ] `/health` page renders the new view; existing per-incident drill-down still works (click container → existing `/incidents/:id`).
- [ ] Manual: resolve one incident via per-row, one via per-group "Resolve all", one via multi-select. All three update counts and refetch.
- [ ] Manual: endpoint filter chip changes the URL and the visible groups; refresh preserves the filter.
- [ ] No regression in existing security-regression tests (auth, RBAC on new route).

### 5.3 Rollback

| Failure mode | Rollback |
|---|---|
| Frontend rendering broken | Revert step 8 only — old flat list returns. Backend stays. |
| `/api/incidents/groups` slow or wrong | Revert steps 6–8. Backfilled column is harmless. |
| Backfill produced wrong signatures | Re-run with corrected `deriveSignature`; the script is idempotent and only overwrites NULLs by default. Use `--force` for full re-derivation. |
| Migration concerns | `ALTER TABLE ADD COLUMN nullable` is non-blocking on Postgres; the indexes can be created `CONCURRENTLY` if the table is large at deploy time. |

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

- [ ] `incidents.signature` column exists, indexed alongside `status` and `endpoint_id`.
- [ ] `signature.ts` exports `deriveSignature()` and `signatureLabel()`, with full test coverage of the derivation matrix.
- [ ] `monitoring-service.ts` emits `metric_type` and `detection_method` on anomaly + predictive insights.
- [ ] `incident-correlator.ts` writes `signature` on every new incident. Existing tests continue to pass.
- [ ] Backfill script populates all existing incidents with non-null signatures; runnable safely more than once.
- [ ] `GET /api/incidents/groups` returns the response shape in §3.5, supports `status` / `endpoint_id` / `since` / `severity` filters, returns within 250ms p95 against production data.
- [ ] `/health` page renders `IncidentGroupsView` with summary strip, endpoint chips, collapsed/expanded groups, top-10 container rows, "Show all" expansion.
- [ ] All three resolve paths (per-row, multi-select, per-group) work and surface partial-failure correctly.
- [ ] Search filters both group labels and container names.
- [ ] URL params (`range`, `endpoint`, `sort`) survive refresh and deep-linking.
- [ ] All new and existing tests pass on backend, frontend, and packages workspaces.
- [ ] No new ESLint or TypeScript errors. No regression in security-regression tests.
