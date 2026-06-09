# Metrics Dashboard overhaul — design (#1429)

**Status:** Approved (brainstorming) — ready for implementation plan
**Issue:** #1429
**Date:** 2026-06-04
**Scope:** UI / observer-only. One new **read-only** backend endpoint. No schema/migration changes, no container-mutating actions.

## Problem

The Metrics Dashboard (`/metrics`) has four rough edges that make it slower to use and easy to misread:

1. **No container search** — containers are chosen via chained `ThemedSelect` dropdowns (endpoint → stack → container); on endpoints with dozens/hundreds of containers, scrolling to find one is tedious. Every other workload view offers `FleetSearch`; this page does not.
2. **Ambiguous CPU% / memory%** — "Avg CPU 240%" / "Avg Memory 63%" give no indication of what they're relative to. CPU% follows the Docker `docker stats` convention (100% = one core, peaks at `100% × online CPUs`); memory% is `(usage − cache) ÷ limit`, where "limit" silently falls back to total host RAM for unconstrained containers.
3. **Layout wastes vertical space** — CPU / Memory / Memory(Absolute) charts are full-width and stacked one per row; comparing CPU vs memory means scrolling. The KPI row also carries a "Container" card whose only content is the container's name.

## Decisions (resolved during brainstorming)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Source of memory limit / online-CPU data (not currently exposed to the frontend) | **Small read-only backend endpoint** returning exact `memoryLimitBytes` + `onlineCpus` | Most accurate; reuses already-cached container stats, so no extra Portainer load and no persisted data. |
| CPU% presentation | **Keep raw Docker value + clarifying sub-label** | Does not change the meaning of already-stored history or charts. |
| Where the container name renders | **Global header breadcrumb** (`Metrics Dashboard › nginx-proxy`, before build badge) | Matches the acceptance criteria; wired via a small zustand slice (see §E). |
| Search vs dropdown | **Augment the dropdown** | `FleetSearch` only emits a filter query — it does not select. Keeping the `ThemedSelect` for selection and filtering its options is the least disruptive change and preserves keyboard select semantics. |
| 4th chart cell (charts go 2-up) | **Leave it to flow naturally** (last cell empty on `lg`) | The existing Network RX/TX panel stays where it is above the charts; moving it in would duplicate/complicate. |

## Findings that shaped the design

- `packages/observability/src/services/metrics-collector.ts` computes `memoryLimit` and `numCpus` (`online_cpus`) but **discards both** — only `cpu`, `memory` (%), `memoryBytes`, and network bytes are persisted. So the per-container memory **limit** and **online-CPU count** are not available to the frontend today.
- `Endpoint` (`use-endpoints.ts`) already carries `totalCpu` (host cores) and `totalMemory` (host RAM); `Container` (`use-containers.ts`) has **no** memory-limit field.
- `FleetSearch` (`fleet-search.tsx`) is debounced/clearable and emits an `onSearch(query)` callback; it renders no result list and performs no selection — the consumer filters.
- The metrics page renders **inline cards**, not the `KpiCard` component (though `KpiCard` exposes a `hoverDetail` sub-label slot and a tooltip-friendly structure we can mirror).
- `header.tsx` builds breadcrumbs from a static `routeLabels` map and renders the build badge at `:138-146`; it has no awareness of page-level state today.

## Design

### A. Backend — expose memory limit + online CPUs (new, read-only)

- **Route:** `GET /api/metrics/:endpointId/:containerId/meta` in `packages/observability/src/routes/metrics.ts`.
- **Auth:** `preHandler: [fastify.authenticate]` only — read-only operational metric, consistent with the sibling `GET /api/metrics/:endpointId/:containerId`. No `requireRole('admin')` (not in the sensitive-reads set: Backups/Settings/Cache/User Management).
- **Implementation:** reuse `cachedFetch(getCacheKey('stats', endpointId, containerId), TTL.STATS, () => getContainerStats(endpointId, containerId))` — the exact cached call the collector already makes, so effectively no added Portainer load. Compute and return:
  ```jsonc
  {
    "memoryLimitBytes": 536870912,   // stats.memory_stats.limit
    "onlineCpus": 4,                 // stats.cpu_stats.online_cpus ?? 1
    "usedBytes": 337641472           // usage − cache (for label freshness)
  }
  ```
- **Params:** validated with the existing `ContainerParamsSchema` (Zod). On stats failure (endpoint down / Edge Async / stats unavailable), respond with a shape the frontend treats as "meta unavailable" (e.g. `{ memoryLimitBytes: null, onlineCpus: null, usedBytes: null }`) so the labels degrade gracefully rather than erroring the page.
- **No schema/migration, no persisted data.** Observer-safe.
- **The "no limit set (host total)" decision lives on the frontend** by comparing `memoryLimitBytes` against `endpoint.totalMemory` (data the frontend already has) — keeps the endpoint a pure stats projection.

### B. Frontend — CPU% / memory% clarification labels

- **Hook:** `useContainerMetricsMeta(endpointId?, containerId?)` → `GET …/meta`, enabled only when both are set; same query conventions as `useContainerMetrics`.
- **CPU tile (`Avg CPU`):**
  - Value unchanged (e.g. `240%`).
  - Sub-label: `≈2.4 of N cores (max N×100%)`, where `N = onlineCpus ?? endpoint.totalCpu ?? 1` (e.g. `≈2.4 of 4 cores (max 400%)`).
  - Tooltip (`ⓘ`): "Docker `docker stats` convention — 100% = one full CPU core, so this peaks at 100% × online cores."
- **Memory tile (`Avg Memory`):**
  - Value unchanged (e.g. `63%`).
  - Denominator sub-label, two branches:
    - **Limit set** (`memoryLimitBytes` < `endpoint.totalMemory × 0.99`): `322 / 512 MB limit`.
    - **No limit set** (`memoryLimitBytes` ≈ `endpoint.totalMemory`, within ~1%): `2.6 GB / 32 GB host (no limit set)`.
  - When meta is unavailable: fall back to the current bare `63%` (no misleading denominator).
  - Tooltip (`ⓘ`): "memory% = (usage − cache) ÷ limit. Unconstrained containers report the host's total RAM as the limit."
- Implemented by mirroring `KpiCard`'s `hoverDetail`/sub-label pattern on the page's inline cards (or adopting `KpiCard`); the existing `AnomalySparkline` stays.

### C. Frontend — container search (augment dropdown)

- Add a `FleetSearch` above the container `ThemedSelect` (`metrics-dashboard.tsx:518-531`).
- New local state `containerQuery`; `FleetSearch.onSearch` sets it (already debounced).
- Filter `groupedContainerOptions` by query (match on container **name** and **stack/group label**, case-insensitive) before passing to `ThemedSelect`. `filteredCount` / `totalCount` drive the count badge.
- `Esc` clears (built into `FleetSearch`). Selection still flows through `setSelectedContainer` via the dropdown — unchanged.
- If the current `selectedContainer` is filtered out, the dropdown simply shows the placeholder; selection state is not auto-cleared.

### D. Frontend — charts 2-up

- Replace the `space-y-6` wrapper around the CPU / Memory / Memory(Absolute) cards (`metrics-dashboard.tsx:733-831`) with `grid gap-6 lg:grid-cols-2` (single column below `lg`).
- Keep zoom support (`height={300 * zoomLevel}`); charts already use `ResponsiveContainer`, so they fit the narrower card.
- The 3 charts leave the 4th cell empty on `lg` — acceptable. The Network RX/TX panel remains in its current position above the charts.

### E. Frontend — container name in header + 3-up KPI grid

- **Remove** the "Container" KPI card (`metrics-dashboard.tsx:665-672`).
- **KPI grid:** `md:grid-cols-4` → `md:grid-cols-3` for the remaining Avg CPU / Avg Memory / Peak Memory cards.
- **Header wiring:** a small zustand slice (e.g. `useHeaderContextStore` with `metricsContainerName: string | null`, default `null`).
  - The metrics page sets `metricsContainerName` to the selected container's name on selection, and **clears it to `null` on unmount** and when selection is cleared.
  - `header.tsx` reads the slice and, **only when non-null**, renders `‹separator› {name}` after the current breadcrumb label and before the build badge. Nothing renders on other routes or when no container is selected (no stray separator/badge).
- Chosen over route state because it is the least invasive, self-clearing, and keeps `header.tsx` free of route-specific branching.

### F. Tests & docs

- **Backend:** route test for `/meta` (auth required; correct shape; graceful degradation when stats fail) + an unauthenticated-rejection assertion in the appropriate `security-regression-*.test.ts`.
- **Frontend:**
  - Search filters the container list (typing narrows options; clear restores).
  - CPU% sub-label renders core count + max; memory% sub-label renders both the "limit" and "host (no limit set)" branches; graceful fallback when meta is missing.
  - 3-up KPI grid: the "Container" card is gone; three metric cards remain.
  - Header shows the container name on `/metrics` when selected and **nothing** on other routes / no selection.
- **Docs:** update `docs/architecture.md`, `CLAUDE.md`, and document the new read-only `/meta` endpoint (and its observer-only/auth posture).

## Files affected

| File | Change |
|------|--------|
| `packages/observability/src/routes/metrics.ts` | New `GET …/meta` route (A) |
| `packages/observability/src/routes/*.test.ts` / `backend/src/routes/security-regression-*.test.ts` | Route + auth tests (F) |
| `frontend/src/features/observability/hooks/use-metrics.ts` | `useContainerMetricsMeta` hook (B) |
| `frontend/src/features/observability/pages/metrics-dashboard.tsx` | Search (C), labels (B), 2-up grid (D), remove Container card + 3-up KPI grid (E) |
| `frontend/src/features/core/components/layout/header.tsx` | Render container name from store slice (E) |
| `frontend/src/stores/*` | New `useHeaderContextStore` slice (E) |
| `frontend/src/**/*.test.{ts,tsx}` | Frontend tests (F) |
| `docs/architecture.md`, `CLAUDE.md` | Docs (F) |

## Non-goals / out of scope

- No change to how CPU%/memory% are **computed or stored** (label-only clarification).
- No new container-mutating actions; the page stays observer-only.
- No DB schema or migration changes.
- The Network RX/TX panel is not relocated into the chart grid.
- No normalization of CPU% to a 0–100 gauge (would break history semantics).
