# Live `/docker/info` replaces Portainer endpoint snapshots

**Date:** 2026-05-31
**Status:** Approved (design) — ready for implementation plan
**Branch:** `feature/live-docker-info-primary`

## Problem

Container counts, CPU/memory capacity, health, and stack totals shown across the
dashboard are sourced from Portainer's per-endpoint `Snapshots[]` array (read in
`normalizeEndpoint`). Since recent Portainer/Edge-agent versions, the edge agent
no longer writes snapshot data back to Portainer, so `Snapshots[]` is stale (or
empty) for edge endpoints. The dashboard therefore shows out-of-date numbers.

A live fallback already exists (issue #1249): for Edge Standard endpoints whose
`Snapshots[]` is empty, the route layer fetches a live `/docker/info` summary
through Portainer's chisel tunnel (`fetchEdgeLiveDockerInfo` →
`enrichEdgeStandardWithLiveInfo`). But it only triggers on the *empty-snapshot*
case (`endpointNeedsLiveFallback`), only for Edge Standard, and only in the
dashboard/endpoints routes — three other consumers still read the stale snapshot.

## Goal

Make live data the **only** source of truth for endpoint container counts,
CPU/memory capacity, container health, and stack totals. Stop reading Portainer's
per-endpoint `Snapshots[]` entirely. No KPI, scheduler job, status page, or LLM
context may read the snapshot.

## Non-goals / explicitly preserved

- **Our own history tables stay.** This removes reliance on Portainer's
  per-endpoint `Snapshots[]`. It does **not** touch the dashboard's own
  `kpi_snapshots` (status-page history) or `monitoring_snapshots`
  (ai-intelligence telemetry) tables — those remain; we simply compute their
  rows from live data.
- Container *lists*, the home "Overall Health Score", and live metrics are
  already fetched live and are unchanged in source.
- No new container-mutating actions (observer-first).

## Decisions (locked)

| Question | Decision |
|---|---|
| Scope | **All reachable endpoints**, not just Edge Standard. |
| Richer fields (cpu/mem/health/stacks) | **Derive everything live** — no KPI reads the snapshot. |
| Snapshot reliance | **Remove completely** — `normalizeEndpoint` stops reading `Snapshots[]`. |
| Live-fetch failure | Mark **`unavailable`** (no snapshot fallback exists anymore). |
| Edge Async (Type 7, no tunnel) | **Becomes `unavailable`** — cannot be live-queried; user does not run Edge Async. |
| Delivery | **One feature branch**, staged commits, TDD. |

## Architecture

### Source enum collapses

`NormalizedEndpoint.snapshotSource` becomes `'live' | 'unavailable'` (the
`'snapshot'` value is removed). Field identifiers (`snapshotSource`,
`snapshotAge`, `snapshotFetchedAt`) are **kept** to bound frontend churn; their
semantics change to "live data" (e.g. `snapshotAge` = age of the last successful
live fetch). A full rename to `dataSource`/`dataAge`/`dataFetchedAt` is noted as
an optional follow-up, out of scope here.

### New core module: `packages/core/src/portainer/live-fleet.ts`

The single source of truth, importable by every layer (it depends only on core,
so `ai-intelligence` — which may not import `foundation` — can use it too).

- `enrichEndpointsWithLiveDockerInfo(normalized): Promise<NormalizedEndpoint[]>`
  Moved out of `foundation/src/services/edge-live-enrichment.ts` and broadened.
  For each endpoint where `endpointSupportsLiveDockerInfo` is true, fetch live
  `/docker/info` (concurrency-limited, SWR-cached) and overlay
  running/stopped/total + cpu/mem; on failure or unsupported, mark
  `unavailable`. Endpoints that cannot be live-queried (Edge Async, down) are
  marked `unavailable` **without** a fetch attempt (no wasted call/timeout).

- `computeFleetTotals(endpoints, normalizedContainers)` → fleet KPI object
  `{ endpoints, endpointsUp, endpointsDown, running, stopped, total, healthy,
  unhealthy, stacks }`. `running/stopped/total` come from the (already enriched)
  endpoints; `healthy/unhealthy` from each container's parsed `healthStatus`;
  `stacks` from distinct `com.docker.compose.project` labels. This is the **only**
  place fleet totals are computed — all aggregating consumers call it.

### Changed: `packages/core/src/portainer/portainer-normalizers.ts`

- `normalizeEndpoint`: delete all `Snapshots[]` reads (`snapshot`, `raw`,
  `DockerSnapshotRaw`, the `??` count chains, `Time`-derived age). Counts and
  cpu/mem initialise to `0`; `snapshotSource` initialises to `'unavailable'`;
  `snapshotAge` initialises to `null`.
- Remove `containersHealthy`, `containersUnhealthy`, `stackCount` from
  `NormalizedEndpoint` (nothing populates them anymore; fleet totals own them).
  Confirmed not rendered on endpoint cards.
- Remove `endpointNeedsLiveFallback`; add
  `endpointSupportsLiveDockerInfo(ep)` = `status === 'up' && isDockerEndpoint(type)
  && edgeMode !== 'async'`.
- `applyLiveDockerInfo(ep, info)`: also sets `totalCpu`/`totalMemory` and
  `snapshotAge` (now from `fetchedAt`). `markLiveUnavailable` unchanged in intent.

### Changed: `packages/core/src/portainer/edge-live-query.ts`

- Extend the fetched shape with `ncpu` (Docker `NCPU` → `totalCpu`) and
  `memTotal` (Docker `MemTotal` → `totalMemory`).
- Rename `fetchEdgeLiveDockerInfo` → `fetchLiveDockerInfo`; keep a thin
  re-export alias during the staged commits to avoid churn-by-rename in one shot.
- Update the header comment: this is the **primary** path now, not a
  "fallback for empty snapshots".
- (Optional) rename file to `live-docker-info.ts`; keep if it reduces diff noise.

### Consumers adopt the core collector

| Consumer | Change |
|---|---|
| `foundation/routes/endpoints.ts` | Call `enrichEndpointsWithLiveDockerInfo` (broadened). |
| `foundation/routes/dashboard.ts` (`summary`/`resources`/`full`) | Enrich, then build totals via `computeFleetTotals` over the container lists these routes already fetch (no extra Portainer calls). `summary` (no container fetch today) either fetches containers or returns counts-only health derived where available — see Open Questions. |
| `server/scheduler.ts` KPI writer (`runKpiSnapshotCollection`) | Enrich + use the container lists (already warmed by the 60s metrics job) → `computeFleetTotals` → `insertKpiSnapshot`. **Fixes the public status page**, which reads `getLatestSnapshot()`. |
| `ai-intelligence/monitoring-service.ts` | Enrich before computing telemetry totals (now legal — core import). |
| `ai-intelligence/llm-chat.ts`, `llm-client.ts` | Enrich endpoints; use `computeFleetTotals` (or running/stopped only) for narrative context instead of snapshot fields. |
| `observability/status-page.ts` | **Unchanged** — values become correct once the scheduler writes live KPIs. |
| `foundation/services/edge-live-enrichment.ts` | Removed (moved to core) or reduced to a re-export. |

### Data flow

```
getEndpoints() (cached)
  → normalizeEndpoint()         // no snapshot reads; counts 0, source 'unavailable'
  → enrichEndpointsWithLiveDockerInfo()
        per up Docker non-async endpoint:
          fetchLiveDockerInfo()  // /docker/info via tunnel; SWR-cached, p-limited
          → applyLiveDockerInfo() // running/stopped/total + cpu/mem; source 'live'
        else: markLiveUnavailable()
  → (aggregators) getContainers() per up Docker endpoint (cached, shared)
  → computeFleetTotals(endpoints, containers)  // health + stacks live
```

## Config & copy

- Keep `EDGE_LIVE_QUERY_*` env vars and `edge.live_query_*` settings keys
  (renaming breaks existing deployments). Update their comments/descriptions.
- `EDGE_LIVE_QUERY_ENABLED=false` is now a **hard kill-switch**: with no snapshot
  fallback, disabling live query means endpoints render `unavailable`. Document
  this clearly (env.schema comment, `.env.example`, Settings UI help text).
- Settings UI (`frontend/.../settings/shared.tsx`): relabel from
  "Live Container Counts Fallback / when an Edge Standard endpoint has no
  snapshot" to "Live container data (primary source)".
- Frontend copy: `fleet-overview.tsx` "Snapshot: X ago" → "Updated X ago";
  `container-detail.tsx` staleness wording; hexagon tooltip "(live, refreshed Xs
  ago)" stays. `resource-overview-card.tsx` unchanged (still reads
  `totalCpu`/`totalMemory`, now live).

## Testing strategy (TDD)

Update/extend (real PostgreSQL where applicable, mock only Portainer/LLM HTTP):

- `core/portainer/portainer-normalizers-edge.test.ts`: drop
  `endpointNeedsLiveFallback`; add `endpointSupportsLiveDockerInfo` truth table
  (up/down × local/agent/edge-standard/edge-async/k8s); assert `normalizeEndpoint`
  no longer reads `Snapshots[]` (counts 0, source `unavailable`).
- `core/portainer/edge-live-query.test.ts`: NCPU/MemTotal mapping; rename.
- New `core/portainer/live-fleet.test.ts`: `enrichEndpointsWithLiveDockerInfo`
  (broadened scope, async/down → unavailable without fetch, failure → unavailable)
  and `computeFleetTotals` (health from `healthStatus`, stacks from compose label).
- `foundation/__tests__/endpoints-route.test.ts`, dashboard route tests: live
  totals, no snapshot reliance.
- `server/__tests__/scheduler.test.ts`: KPI writer now enriches + derives health
  from containers.
- `ai-intelligence`: monitoring-service + LLM context now enrich.
- Frontend: copy/label assertions where they exist.

## Delivery — staged commits on one branch

1. **core**: `live-fleet.ts` (+ enrichment move/broaden), normalizer changes,
   `edge-live-query` cpu/mem + rename, tests.
2. **foundation**: endpoints + dashboard routes adopt collector; remove old
   foundation enrichment; tests.
3. **server**: scheduler KPI writer; tests. (Status page verified.)
4. **ai-intelligence**: monitoring-service + LLM context; tests.
5. **config + copy + docs**: env comments, `.env.example`, Settings UI + frontend
   copy, `docs/architecture.md`, `CLAUDE.md`.

## Open questions / risks

- **`/api/dashboard/summary` cost.** It currently does *not* fetch container
  lists. To report live `healthy/unhealthy/stacks` it must either fetch them
  (making it as heavy as `/resources`) or omit those three. The frontend largely
  uses `/full`; confirm whether `summary` still needs health/stacks or can return
  counts-only. **Default plan:** have `summary` fetch containers too (consistency
  over a marginal cost; SWR-cached and shared with other routes).
- **`/api/endpoints` latency.** With the snapshot gone, the first uncached load
  fans out `/docker/info` across the fleet (p-limited, SWR-cached). Mitigated by
  caching + concurrency settings; documented.
- **Edge Async goes dark** by design (accepted). The `unavailable` UI state
  (stone hexagon + tooltip) already exists.
