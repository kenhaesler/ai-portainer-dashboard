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

## UI notes

- Global themed scrollbar styling lives in `frontend/src/index.css` (see the comment block `GLOBAL THEMED SCROLLBAR`). It applies to `html`/`body` and any element with the `.scrollbar-themed` opt-in class, reading `--color-foreground` via `color-mix` so all 16 themes share one rule. The sidebar (`aside nav`) keeps its hover-reveal behavior via cascade order.
- `.spotlight-card` in `frontend/src/index.css` deliberately omits `transform`. A transformed ancestor creates a containing block for `position: fixed` descendants, which breaks the placement of Radix popover/select portals (the dropdown ended up at viewport `0, 0` — see #1310). Use `isolation: isolate` or `will-change: transform` if a future change needs a stacking context or GPU layer on this card, never `transform`.
- The Network Topology graph (`frontend/src/features/containers/components/network/`) renders containers grouped into Docker Compose stacks with `@xyflow/react`, laid out by `elkjs`: the root packs the (mostly disconnected) stack boxes into a compact, deterministic grid via `rectpacking` + `SEPARATE_CHILDREN`, while each stack lays out its interior with `stress`. The canvas is **static** — pan / zoom / click-to-select only, no node dragging and no force simulation — so the layout is fully reproducible from elkjs. The viewport uses a low `minZoom` (0.1) with a capped `fitView` and `onlyRenderVisibleElements` so a large fleet (~200 containers) stays readable in one zoomed-out overview. Layout/viewport constants live in `topology-graph.tsx` (`ROOT_LAYOUT_OPTIONS`, `GROUP_LAYOUT_OPTIONS`, `FIT_VIEW_OPTIONS`); see the design spec under `docs/superpowers/specs/2026-05-30-topology-overview-scale-design.md`.
- **Page-level error isolation:** `AppLayout` (`frontend/src/features/core/components/layout/app-layout.tsx`) wraps the router `<Outlet>` in an `ErrorBoundary` (`PageBoundary`). A render error in one page degrades to an inline error card while the sidebar and header stay mounted, instead of bubbling to the `/` route's `errorElement` and replacing the whole shell. The boundary renders inside the route-keyed wrapper, so it resets on navigation. This also kept the CI E2E suite's authenticated shell alive on Portainer-backed routes when Portainer was unreachable. See #1420.
