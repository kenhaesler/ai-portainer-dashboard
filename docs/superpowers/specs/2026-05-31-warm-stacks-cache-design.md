# Pre-warm per-endpoint stacks cache at startup (#1393)

**Date:** 2026-05-31
**Issue:** #1393 — "Portainer API trace latency spike … causing all endpoints to be sluggish"
**Status:** Approved design.

## Problem & honest framing

The reported symptom is Portainer API calls taking ~3s (p95), with spikes to 5s+, making dashboard/containers/stacks/endpoints pages stall. Investigation found:

- The **~3s baseline is the external Portainer instance itself** (per-request latency), not a defect in this repo. It cannot be fixed here.
- The `trace-anomaly` alert that fired (`zScore=40.96` on a 3,051ms±14ms baseline) is **working correctly** — a 5s spike on a tight baseline genuinely is an outlier. No detector change.
- Our request pipeline is already well-built: single-flight request coalescing (`portainer-cache.ts`), stale-while-revalidate, per-endpoint circuit breakers, 15s timeouts, a dashboard `pLimit(5)` sub-limit.
- `warmCache()` (`packages/server/src/scheduler.ts`) **already** runs at boot and warms **endpoints + per-endpoint containers**.

The one remaining in-repo cold-start gap: **per-endpoint stacks are not pre-warmed**. After a backend restart, the first `/stacks` page load (and the dashboard's stack counts) fan out across all Docker endpoints into cold ~3s Portainer calls — a self-inflicted herd that the warm-up should have already absorbed.

## Scope (chosen)

Extend the existing `warmCache()` to also pre-warm per-endpoint **stacks**, mirroring the existing containers warm-up. Nothing else.

This does **not** speed up an individual Portainer call (external) — it removes the cold-start stall for the stacks-backed views, matching how containers are already handled.

## Design

Single function changed: `warmCache()` in `packages/server/src/scheduler.ts`.

Current behavior:
1. `cachedFetch(getCacheKey('endpoints'), TTL.ENDPOINTS, () => getEndpoints())`
2. For each Docker endpoint: `cachedFetch(getCacheKey('containers', ep.Id), TTL.CONTAINERS, () => getContainers(ep.Id))` in one `Promise.allSettled`.

Add, for each Docker endpoint, in the same fan-out:
```ts
cachedFetch(getCacheKey('stacks', ep.Id), TTL.STACKS, () => getStacksByEndpoint(ep.Id))
```

Key details (must match what the stacks route reads — `packages/foundation/src/routes/stacks.ts`):
- Cache key: `getCacheKey('stacks', ep.Id)` — same key the route reads via `cachedFetchSWR`.
- TTL: `TTL.STACKS` (600s).
- Fetcher: `getStacksByEndpoint(ep.Id)` — the **per-endpoint** stacks call the route uses (NOT the global `getStacks()`).
- `getStacksByEndpoint` is reachable from `@dashboard/core/portainer/index.js` (barrel `export *` of `portainer-client.js`); add it to the scheduler's existing import from that barrel.

Supporting changes:
- Warm containers and stacks for each Docker endpoint within the same `Promise.allSettled` pass (one coordinated boot-time warm, bounded by the existing global `pLimit(PORTAINER_CONCURRENCY)` and absorbed by single-flight coalescing).
- Update the warm-up log message and the success log counts to mention stacks.
- `export` `warmCache` so it is unit-testable in isolation (it is currently module-private).

### Why this is safe
- `warmCache()` is already invoked fire-and-forget (`warmCache().catch(() => {})`) after Portainer readiness — it never blocks startup, and a failure only logs a warning.
- Stacks fetches reuse the existing single-flight + circuit-breaker + timeout machinery; no new herd, no new failure mode.
- Additive: no change to routes, the anomaly detector, concurrency limits, the connection pool, or any env var.

## Testing (TDD)

`packages/server/src/__tests__/scheduler.test.ts` already mocks `@dashboard/core/portainer/portainer-client.js` (spies on `getEndpoints`/`getContainers`) and makes `cachedFetch` a passthrough that calls the fetcher.

- Import the now-exported `warmCache`.
- Add a spy: `getStacksByEndpointMock = vi.spyOn(portainerClient, 'getStacksByEndpoint').mockResolvedValue([])` in the global `beforeEach`.
- New test: given `getEndpoints` returns one Docker endpoint (Type 1), `await warmCache()` calls `getStacksByEndpoint` with that endpoint's id **and** still calls `getContainers` with it (containers warm-up unchanged).
- Optional second test: a non-Docker (Kubernetes) endpoint (e.g. Type 5) is NOT warmed for stacks (mirrors the existing `isDockerEndpoint` filter).

## Non-goals (YAGNI)

- No warming of images/networks (lower-traffic routes).
- No change to the external Portainer baseline, the `trace-anomaly` detector, the concurrency limiter, the connection pool, or cache TTLs.
- No new environment variable.
- Not closing #1393's external root cause — this PR only removes the stacks cold-start stall; the issue can note the ~3s baseline is the Portainer instance.

## Docs

- `docs/ai-instructions/architecture.md` if it documents the cache warm-up; otherwise no doc change is warranted (no new surface, no env var).
