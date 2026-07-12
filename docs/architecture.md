# Architecture

This project's architecture documentation is maintained in [docs/ai-instructions/architecture.md](ai-instructions/architecture.md).

For detailed diagrams and data flow, see:
- **[Visual architecture map](architecture/ARCHITECTURE.md)** — component & data-flow diagrams (Mermaid, renders on GitHub)
- **[Interactive architecture diagram](architecture/architecture.html)** — open in a browser for hover-to-trace edges, package deps, data flows & deployment views
- [Architecture Overview](ai-instructions/architecture.md) — monorepo structure, dependency graph, and key patterns
- [Database Schema](ai-instructions/architecture.md#database-schema) — app (PostgreSQL) + metrics (TimescaleDB) tables
- [Data Flows](ai-instructions/architecture.md#data-flows) — metrics, monitoring/anomaly, remediation, and LLM chat paths
- [Background Scheduler](ai-instructions/architecture.md#background-scheduler) — interval jobs and cadences
- [Security Checklist](ai-instructions/security-checklist.md)
- [UI Design System](ai-instructions/ui-design-system.md)

## Portainer Integration & Live Data Source

All per-endpoint container counts, host CPU/memory, and stack totals are obtained by calling the Docker API directly via live `/docker/info` requests — Portainer's per-endpoint `Snapshots[]` array is **no longer read**. The pipeline is implemented in `packages/core/src/portainer/live-fleet.ts` and exposes four functions used by foundation routes and the scheduler:

- `enrichEndpointsWithLiveDockerInfo` — fans out `/docker/info` calls across all eligible endpoints and annotates each with live counts; endpoints that fail or are unreachable are marked `unavailable`.
- `attachStackCounts` — overlays live stack counts (from Portainer's stacks list) onto each endpoint.
- `computeFleetTotals` — derives fleet-wide KPIs (running/stopped/healthy/unhealthy/stacks) from the enriched endpoints and live containers.
- `collectFleetOverview` — orchestrates the full pipeline for dashboard aggregation.

**Source states:** Docker endpoints that respond to `/docker/info` are `live`; all others (down, non-Docker, or Edge Async / Type 7) are `unavailable`. Our `kpi_snapshots` and `monitoring_snapshots` history tables are unchanged — only their inputs are now live rather than snapshot-derived.

**Kill-switch:** Setting `EDGE_LIVE_QUERY_ENABLED=false` disables all live queries; affected endpoints remain `unavailable` with no snapshot fallback.

## Portainer cache (L1 memory + L2 Redis, SWR)

`packages/core/src/portainer/portainer-cache.ts` provides a two-layer cache (`HybridCache`: in-memory `TtlCache` L1 + optional Redis L2) with `cachedFetch` (blocking, stampede-deduplicated via a shared `inFlight` map) and `cachedFetchSWR` (stale-while-revalidate). Key semantics (#1495, #1499):

- **Freshness follows the caller's TTL.** Entries become stale at 80% of their TTL (`STALE_FRACTION`) and expire at 100%. L2 values are stored in a staleness envelope (`{ __swrEnvelope: 1, staleAt, data }`), so an L2 hit inside its fresh window is served without a background origin fetch; legacy bare-JSON entries are treated as stale and revalidated. In multi-layer mode L1 remains a 30s hot layer but carries the full-TTL `staleAt`; in memory-only mode (no `REDIS_URL`, or Redis in failure backoff) L1 honors the full TTL instead of capping at 30s. Result: the `TTL` presets (ENDPOINTS 900s, CONTAINERS 300s, ...) bound Portainer load in both modes.
- **Background revalidations resolve to data.** SWR revalidation promises are registered in the same `inFlight` map that `cachedFetch` consults before any cache lookup, so they MUST resolve to the fetched value (`Promise<T>`, never `Promise<void>`); on fetch failure the cache entry is invalidated (next call retries) but the promise resolves to the previously-served stale value, so a concurrent `cachedFetch` sharing it never receives `undefined`.

**Hot-path staging (#1500):** Live enrichment mutates only counts/`totalCpu`/`totalMemory`/`snapshotSource` — never the `status`/`type` fields the downstream up/Docker filters read — so `/api/dashboard/full`, `/api/dashboard/summary`, `/api/dashboard/resources`, and `collectFleetOverview` run it **concurrently** (`Promise.all`) with the stacks fetch and the per-endpoint container fan-out instead of serializing ahead of them; wall-clock latency is bounded by the slowest stage rather than their sum. Failed `/docker/info` probes are also **negative-cached** for `EDGE_LIVE_NEGATIVE_TTL_SECONDS` (30s, distinct `edge-live-info-failed:<id>` cache keys — see `packages/core/src/portainer/edge-live-query.ts`), so an endpoint Portainer reports "up" but whose agent is unreachable fails fast on subsequent dashboard loads instead of re-paying the `EDGE_LIVE_QUERY_TIMEOUT_MS` timeout on every request. The marker respects `CACHE_ENABLED`, and the kill-switch still short-circuits before any cache or network access.

**Shared dashboard aggregation (#1543):** The container fan-out + TimescaleDB latest-metrics read + per-stack top-N aggregation used by `/api/dashboard/resources` and the `resources` section of `/api/dashboard/full` lives in a single `buildFleetResources()` helper in `packages/foundation/src/routes/dashboard.ts`, so the two routes return identical resource shapes and cannot drift. `/summary` intentionally stays container-free (#801) and sources healthy/unhealthy from the latest KPI snapshot. The standalone `/summary` and `/resources` endpoints remain public API; the frontend's unused `useDashboard()`/`useDashboardResources()` hooks are marked deprecated (the home page uses `useDashboardFull()` only).

## CI E2E Portainer fixture

The opt-in `e2e` CI job runs the production compose stack with a CI-only override (`docker/docker-compose.e2e.yml`) that adds a **WireMock `portainer-mock`** service serving canned fleet data from `docker/portainer-mock/{mappings,__files}`, with the backend's `PORTAINER_API_URL` pointed at it. This lets the data-dependent E2E specs (container list/detail, the #1310 dropdown-anchor regression guard) run against real data instead of timing out. The fixtures are contract-tested against the backend's actual Zod schemas + normalizers in `packages/core/src/portainer/portainer-mock-fixtures.test.ts`, so they fail loudly if a parser changes. See #1420.

## Metrics Dashboard resource labels (#1429)

The Metrics Dashboard (`/metrics`) clarifies its per-container CPU% and memory% figures with denominator sub-labels. CPU% keeps the Docker `docker stats` convention (100% = one full core) and is annotated with the host's online-core count and cap (`of N cores (max N×100%)`); memory% shows `used / limit` and flags host-total when the container has no explicit limit. The limit and online-CPU count come from a read-only endpoint, `GET /api/metrics/:endpointId/:containerId/meta` (`packages/observability/src/routes/metrics.ts`), which projects the already-cached Docker container stats into `{ memoryLimitBytes, onlineCpus, usedBytes }` — no new persisted data, `authenticate`-only (observer-safe), and degrades to nulls when stats are unavailable (a Docker-reported `0` limit is treated as unset). The selected container name also appears in the global header via the ephemeral `useHeaderContextStore` slice (`frontend/src/stores/header-context-store.ts`), set by the page and cleared on unmount.

## Public status page (#1526, #1506)

`GET /api/status` (`packages/observability/src/routes/status-page.ts`) is unauthenticated and exempt from the global rate limit, so its DB cost is bounded server-side:

- **Payload cache:** the fully assembled response (including the disabled/404 state) is cached in memory for `STATUS_PAGE_CACHE_TTL_MS` (15s). Concurrent cold-cache requests share one in-flight load, failed loads are not cached, and invalidation is TTL-only — admin changes to `status.page.*` settings take effect within the TTL (the settings save path lives in `@dashboard/foundation` and has no hook into the observability route module).
- **Query batching:** `getStatusPageConfig` reads its five `status.page.*` settings with one `getSettingsByKeys` query (`packages/core/src/services/settings-store.ts`); the six 24h/7d/30d container+endpoint uptime SUMs are collapsed into a single scan of the 30-day superset window using `FILTER (WHERE created_at >= ...)` clauses (`getUptimeSummary` in `packages/observability/src/services/status-page-store.ts`); the remaining independent queries run under `Promise.all`. When the page is disabled only the config lookup runs.
- **Aggregate typing:** pg returns uncast `SUM()`/`COUNT()`/`AVG()` aggregates as strings, which made the `total === 0` guards miss and rendered NaN uptime on empty windows (#1526). The status-page and trace-store aggregate queries now cast to `::integer`/`::float`, and the uptime guards coerce with `Number()` defensively. Regression tests run the real queries against an empty table (`packages/observability/src/__tests__/status-page-store-db.test.ts`, `packages/core/src/tracing/trace-store-aggregates.test.ts`).

## UI notes

- Global themed scrollbar styling lives in `frontend/src/index.css` (see the comment block `GLOBAL THEMED SCROLLBAR`). It applies to `html`/`body` and any element with the `.scrollbar-themed` opt-in class, reading `--color-foreground` via `color-mix` so all 16 themes share one rule. The sidebar (`aside nav`) keeps its hover-reveal behavior via cascade order.
- `.spotlight-card` in `frontend/src/index.css` deliberately omits `transform`. A transformed ancestor creates a containing block for `position: fixed` descendants, which breaks the placement of Radix popover/select portals (the dropdown ended up at viewport `0, 0` — see #1310). Use `isolation: isolate` or `will-change: transform` if a future change needs a stacking context or GPU layer on this card, never `transform`.
- The Network Topology graph (`frontend/src/features/containers/components/network/`) renders containers grouped into Docker Compose stacks with `@xyflow/react`, laid out by `elkjs`: the root packs the (mostly disconnected) stack boxes into a compact, deterministic grid via `rectpacking` + `SEPARATE_CHILDREN`, while each stack lays out its interior with `stress`. The canvas is **static** — pan / zoom / click-to-select only, no node dragging and no force simulation — so the layout is fully reproducible from elkjs. The viewport uses a low `minZoom` (0.1) with a capped `fitView` and `onlyRenderVisibleElements` so a large fleet (~200 containers) stays readable in one zoomed-out overview. Layout/viewport constants live in `topology-graph.tsx` (`ROOT_LAYOUT_OPTIONS`, `GROUP_LAYOUT_OPTIONS`, `FIT_VIEW_OPTIONS`); see the design spec under `docs/superpowers/specs/2026-05-30-topology-overview-scale-design.md`.
- **Page-level error isolation:** `AppLayout` (`frontend/src/features/core/components/layout/app-layout.tsx`) wraps the router `<Outlet>` in an `ErrorBoundary` (`PageBoundary`). A render error in one page degrades to an inline error card while the sidebar and header stay mounted, instead of bubbling to the `/` route's `errorElement` and replacing the whole shell. The boundary renders inside the route-keyed wrapper, so it resets on navigation. This also kept the CI E2E suite's authenticated shell alive on Portainer-backed routes when Portainer was unreachable. See #1420.
