# Live `/docker/info` Replaces Portainer Snapshots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop reading Portainer's per-endpoint `Snapshots[]` entirely; make live `/docker/info` (counts + CPU/mem) plus live container/stack lists the only source of truth for every container-count, health, CPU/memory, and stack figure across the dashboard, scheduler, status page, monitoring telemetry, and LLM context.

**Architecture:** A new `packages/core/src/portainer/live-fleet.ts` module is the single source of truth. `enrichEndpointsWithLiveDockerInfo` overlays live `/docker/info` onto every up Docker endpoint; `attachStackCounts` fills per-endpoint `stackCount` from Portainer's stacks list; `computeFleetTotals` derives fleet KPIs (running/stopped/total from enriched endpoints, healthy/unhealthy from live container health, stacks from the stacks list); `collectFleetOverview` orchestrates the whole pipeline for consumers that don't already hold container lists. `normalizeEndpoint` no longer reads `Snapshots[]`. Because the module lives in `core`, `ai-intelligence` (which may not import `foundation`) can use it too.

**Tech Stack:** TypeScript (strict), Fastify 5, Vitest (real PostgreSQL on :5433, mock only Portainer/LLM HTTP), npm workspaces monorepo, React 19 frontend.

**Spec:** `docs/superpowers/specs/2026-05-31-live-docker-info-replaces-portainer-snapshot-design.md`

---

## Locked decisions

- Scope: **all up Docker endpoints** (`isDockerEndpoint(type)` = types 1/2/4). K8s (5/6) and Edge Async (7) are not Docker types → never live-queried → `unavailable`.
- Source enum collapses to `'live' | 'unavailable'` (no `'snapshot'`).
- On live-fetch failure / unsupported / kill-switch-off → `unavailable` (no snapshot fallback exists).
- `normalizeEndpoint` reads **no** `Snapshots[]`.
- Remove `containersHealthy` / `containersUnhealthy` from `NormalizedEndpoint` (zero production readers). **Keep** `stackCount` (5 frontend readers) — source it live from Portainer `/api/stacks`.
- Our own `kpi_snapshots` / `monitoring_snapshots` history tables stay; only their inputs change.
- One feature branch, staged commits, TDD.

## File map

**Create**
- `packages/core/src/portainer/live-fleet.ts` — enrichment + stack counts + fleet totals + collector.
- `packages/core/src/portainer/live-fleet.test.ts` — unit tests for the above.

**Modify (core)**
- `packages/core/src/portainer/edge-live-query.ts` — add `ncpu`/`memTotal`; rename `fetchEdgeLiveDockerInfo`→`fetchLiveDockerInfo`, `EdgeDockerInfo`→`LiveDockerInfo`; update header comment.
- `packages/core/src/portainer/edge-live-query.test.ts` — rename refs; assert ncpu/memTotal mapping.
- `packages/core/src/portainer/portainer-normalizers.ts` — drop snapshot reads; drop two health fields; add `endpointSupportsLiveDockerInfo`; extend `applyLiveDockerInfo`; default source `unavailable`.
- `packages/core/src/portainer/portainer-normalizers-edge.test.ts` — rewrite the "Live fallback helpers" describe.
- `packages/core/src/portainer/index.ts` — export live-fleet symbols.

**Modify (foundation)**
- `packages/foundation/src/routes/endpoints.ts` — enrich + attach stack counts.
- `packages/foundation/src/routes/dashboard.ts` — replace snapshot reducers with `computeFleetTotals` + stacks.
- `packages/foundation/src/services/edge-live-enrichment.ts` — **delete**.
- `packages/foundation/src/__tests__/edge-live-enrichment.test.ts` — **delete** (coverage moves to `live-fleet.test.ts`).
- `packages/foundation/src/__tests__/endpoints-route.test.ts` — update for broadened scope + stacks.
- dashboard route tests (whatever exercises `/api/dashboard/*`) — update totals source.

**Modify (server)**
- `packages/server/src/scheduler.ts` — `runKpiSnapshotCollection` uses `collectFleetOverview`.
- `packages/server/src/__tests__/scheduler.test.ts` — add a `runKpiSnapshotCollection` test.

**Modify (ai-intelligence)**
- `packages/ai-intelligence/src/services/monitoring-service.ts` — derive `containersUnhealthy` from live containers.
- `packages/ai-intelligence/src/sockets/llm-chat.ts` — infra summary via `collectFleetOverview`.
- `packages/ai-intelligence/src/services/llm-client.ts` — `buildInfrastructureContext` no longer assumes snapshot fields (running/stopped come from enriched endpoints passed by caller).

**Modify (config + frontend + docs)**
- `packages/core/src/config/env.schema.ts` — comment update.
- `packages/core/src/services/settings-store.ts` — comment update (no code change).
- `frontend/src/features/containers/hooks/use-endpoints.ts` — drop two fields; source enum.
- `frontend/src/features/core/hooks/use-dashboard.ts` — drop two fields on the unused mirror type.
- `frontend/src/features/core/components/settings/shared.tsx` — relabel the 4 live-query settings.
- `frontend/src/features/containers/pages/fleet-overview.tsx` — "Snapshot" → "Updated"/"Data Age".
- `frontend/src/features/containers/pages/container-detail.tsx` — staleness copy.
- Frontend test fixtures that set `containersHealthy`/`containersUnhealthy` or assert `snapshotSource: 'snapshot'`.
- `docker/.env.example`, `docs/architecture.md`, `CLAUDE.md`.

---

# STAGE 1 — Core primitives

### Task 1: Extend the live `/docker/info` fetcher with CPU/memory + rename

**Files:**
- Modify: `packages/core/src/portainer/edge-live-query.ts`
- Test: `packages/core/src/portainer/edge-live-query.test.ts`

- [ ] **Step 1: Update the failing test for NCPU/MemTotal mapping**

In `edge-live-query.test.ts`, find the test "maps Docker `/info` → `EdgeDockerInfo`" (~line 54). Replace the mocked response body and assertions to include the new fields, and rename the symbol under test:

```ts
// at top of file, update the import
import { fetchLiveDockerInfo, edgeLiveQueryCacheKey, getEdgeLiveQueryConfigFromEnv, _resetEdgeLiveQueryState, type LiveDockerInfo } from './edge-live-query.js';

it('maps Docker /info into LiveDockerInfo including NCPU and MemTotal', async () => {
  vi.spyOn(globalThis, 'fetch'); // existing harness; keep your project's existing mock approach
  mockJsonOnce({ Containers: 12, ContainersRunning: 9, ContainersStopped: 3, ContainersPaused: 0, NCPU: 8, MemTotal: 16_000_000_000 });
  const info = await fetchLiveDockerInfo(1, { enabled: true, concurrency: 2, intervalSeconds: 60, timeoutMs: 5000 });
  expect(info).toMatchObject({ containers: 12, containersRunning: 9, containersStopped: 3, ncpu: 8, memTotal: 16_000_000_000 });
});
```

(Use the file's existing fetch-mock helper — do not invent `mockJsonOnce` if the file uses a different pattern; match the surrounding tests. Replace every other `fetchEdgeLiveDockerInfo`/`EdgeDockerInfo` reference in the file with `fetchLiveDockerInfo`/`LiveDockerInfo`.)

- [ ] **Step 2: Run it to verify failure**

Run: `cd packages/core && npx vitest run src/portainer/edge-live-query.test.ts`
Expected: FAIL — `fetchLiveDockerInfo` is not exported / `ncpu` missing.

- [ ] **Step 3: Implement the rename + new fields**

In `edge-live-query.ts`:

```ts
// header comment: replace the "Edge Standard live Docker-info FALLBACK" framing
/**
 * Live Docker-info fetch (primary source for all up Docker endpoints).
 *
 * Portainer's per-endpoint Snapshots[] is no longer a reliable source (edge
 * agents stopped writing it back), so the dashboard reads container counts and
 * host CPU/memory capacity live from `/docker/info` through Portainer's proxy.
 * ... (keep the concurrency / SWR / timeout / graceful-degradation notes) ...
 */

export interface LiveDockerInfo {
  containers: number;
  containersRunning: number;
  containersStopped: number;
  containersPaused?: number;
  /** Docker NCPU — host CPU core count. */
  ncpu: number;
  /** Docker MemTotal — host memory in bytes. */
  memTotal: number;
  fetchedAt: number;
}

interface PortainerDockerInfoResponse {
  Containers?: number;
  ContainersRunning?: number;
  ContainersStopped?: number;
  ContainersPaused?: number;
  NCPU?: number;
  MemTotal?: number;
}
```

In `fetchDockerInfoOnce`, extend the return:

```ts
    const total = body.Containers ?? running + stopped + paused;
    return {
      containers: total,
      containersRunning: running,
      containersStopped: stopped,
      containersPaused: paused,
      ncpu: body.NCPU ?? 0,
      memTotal: body.MemTotal ?? 0,
      fetchedAt: Date.now(),
    };
```

Rename the exported function and its return type:

```ts
export async function fetchLiveDockerInfo(
  endpointId: number,
  cfg: EdgeLiveQueryConfig = getEdgeLiveQueryConfigFromEnv(),
): Promise<LiveDockerInfo | null> {
  // ... unchanged body, but typed cachedFetchSWR<LiveDockerInfo> ...
}
```

Update `fetchDockerInfoOnce` signature return type to `Promise<LiveDockerInfo>`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/core && npx vitest run src/portainer/edge-live-query.test.ts`
Expected: PASS (all existing cases + the new NCPU/MemTotal assertion).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/portainer/edge-live-query.ts packages/core/src/portainer/edge-live-query.test.ts
git commit -m "feat(core): live /docker/info fetch carries NCPU/MemTotal; rename to fetchLiveDockerInfo"
```

---

### Task 2: `normalizeEndpoint` stops reading snapshots; add the support predicate

**Files:**
- Modify: `packages/core/src/portainer/portainer-normalizers.ts`
- Test: `packages/core/src/portainer/portainer-normalizers-edge.test.ts`

- [ ] **Step 1: Rewrite the "Live fallback helpers" describe as failing tests**

In `portainer-normalizers-edge.test.ts`, replace the describe block at lines ~279-386 with:

```ts
describe('Live Docker info helpers', () => {
  it('normalizeEndpoint does not read Snapshots[]: counts 0, source unavailable', () => {
    const ep = normalizeEndpoint(makeEndpoint({
      Id: 1, Type: 1, Status: 1,
      Snapshots: [{ DockerSnapshotRaw: { Containers: 99, ContainersRunning: 99 }, RunningContainerCount: 99, Time: Math.floor(Date.now()/1000) }],
    }));
    expect(ep.containersRunning).toBe(0);
    expect(ep.containersStopped).toBe(0);
    expect(ep.totalContainers).toBe(0);
    expect(ep.totalCpu).toBe(0);
    expect(ep.totalMemory).toBe(0);
    expect(ep.stackCount).toBe(0);
    expect(ep.snapshotAge).toBeNull();
    expect(ep.snapshotSource).toBe('unavailable');
    expect(ep.snapshotFetchedAt).toBeUndefined();
    // removed fields must not exist
    expect((ep as Record<string, unknown>).containersHealthy).toBeUndefined();
    expect((ep as Record<string, unknown>).containersUnhealthy).toBeUndefined();
  });

  it('endpointSupportsLiveDockerInfo: true for up Docker (1/2/4)', () => {
    for (const Type of [1, 2, 4]) {
      const ep = normalizeEndpoint(makeEndpoint({ Id: Type, Type, Status: 1, EdgeID: Type === 4 ? 'e' : undefined, LastCheckInDate: Math.floor(Date.now()/1000) }));
      expect(endpointSupportsLiveDockerInfo(ep)).toBe(true);
    }
  });

  it('endpointSupportsLiveDockerInfo: false for down, K8s (5/6), Edge Async (7)', () => {
    const down = normalizeEndpoint(makeEndpoint({ Id: 1, Type: 1, Status: 2 }));
    expect(endpointSupportsLiveDockerInfo(down)).toBe(false);
    for (const Type of [5, 6, 7]) {
      const ep = normalizeEndpoint(makeEndpoint({ Id: Type, Type, Status: 1, EdgeID: 'e', LastCheckInDate: Math.floor(Date.now()/1000) }));
      expect(endpointSupportsLiveDockerInfo(ep)).toBe(false);
    }
  });

  it('applyLiveDockerInfo overlays counts + cpu/mem and flips source to live', () => {
    const ep = normalizeEndpoint(makeEndpoint({ Id: 1, Type: 4, Status: 1, EdgeID: 'e', LastCheckInDate: Math.floor(Date.now()/1000) }));
    const fetchedAt = Date.now();
    applyLiveDockerInfo(ep, { containers: 12, containersRunning: 9, containersStopped: 3, ncpu: 8, memTotal: 16_000_000_000, fetchedAt });
    expect(ep.containersRunning).toBe(9);
    expect(ep.totalContainers).toBe(12);
    expect(ep.totalCpu).toBe(8);
    expect(ep.totalMemory).toBe(16_000_000_000);
    expect(ep.snapshotSource).toBe('live');
    expect(ep.snapshotFetchedAt).toBe(fetchedAt);
    expect(ep.snapshotAge).toBeGreaterThanOrEqual(0);
  });

  it('markLiveUnavailable sets source unavailable without changing counts', () => {
    const ep = normalizeEndpoint(makeEndpoint({ Id: 1, Type: 4, Status: 1, EdgeID: 'e', LastCheckInDate: Math.floor(Date.now()/1000) }));
    markLiveUnavailable(ep);
    expect(ep.snapshotSource).toBe('unavailable');
    expect(ep.containersRunning).toBe(0);
  });
});
```

Update the imports at the top of the test file to include `endpointSupportsLiveDockerInfo` and `applyLiveDockerInfo`/`markLiveUnavailable`, and drop `endpointNeedsLiveFallback`. (Reuse the file's existing `makeEndpoint` helper; if absent, the existing tests construct endpoints inline — follow that style.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/core && npx vitest run src/portainer/portainer-normalizers-edge.test.ts`
Expected: FAIL — `endpointSupportsLiveDockerInfo` undefined; `containersHealthy` still present.

- [ ] **Step 3: Edit `portainer-normalizers.ts`**

Add `isDockerEndpoint` to the existing import:

```ts
import { isKubernetesEndpoint, isDockerEndpoint } from '../models/portainer.js';
```

In `interface NormalizedEndpoint`, **remove** `containersHealthy` and `containersUnhealthy`. Update the `snapshotSource` doc + type:

```ts
  /**
   * Where the container counts came from.
   * - `live`: fetched live via `/docker/info` through Portainer's proxy.
   * - `unavailable`: not live-queryable (Edge Async / down / K8s) or the live
   *   fetch failed. Counts are 0; the UI renders a distinct "data unavailable".
   */
  snapshotSource: 'live' | 'unavailable';
```

Rewrite the tail of `normalizeEndpoint` — delete the `snapshot`/`raw`/`snapshotTime`/`snapshotAge` snapshot lines and the count `??` chains:

```ts
  const edgeMode: 'standard' | 'async' | null = isEdge
    ? (ep.Type === 7 ? 'async' : 'standard')
    : null;

  return {
    id: ep.Id,
    name: ep.Name,
    type: ep.Type,
    url: ep.URL,
    status,
    containersRunning: 0,
    containersStopped: 0,
    totalContainers: 0,
    stackCount: 0,
    totalCpu: 0,
    totalMemory: 0,
    isEdge,
    edgeMode,
    snapshotAge: null,
    checkInInterval: ep.EdgeCheckinInterval ?? null,
    capabilities: buildCapabilities(edgeMode),
    agentVersion: ep.Agent?.Version,
    lastCheckIn: ep.LastCheckInDate,
    // No snapshot is read; live enrichment flips this to 'live' (or leaves
    // 'unavailable' for endpoints we cannot live-query).
    snapshotSource: 'unavailable',
  };
```

Replace `endpointNeedsLiveFallback` with:

```ts
/**
 * True when an endpoint can be live-queried via `/docker/info`: it must be up
 * and a Docker endpoint (types 1/2/4). K8s (5/6) and Edge Async (7) have no
 * Docker tunnel and are excluded.
 */
export function endpointSupportsLiveDockerInfo(ep: NormalizedEndpoint): boolean {
  return ep.status === 'up' && isDockerEndpoint(ep.type);
}
```

Extend `LiveDockerInfoCounts` and `applyLiveDockerInfo`:

```ts
export interface LiveDockerInfoCounts {
  containers: number;
  containersRunning: number;
  containersStopped: number;
  containersPaused?: number;
  ncpu?: number;
  memTotal?: number;
  fetchedAt: number;
}

export function applyLiveDockerInfo(ep: NormalizedEndpoint, info: LiveDockerInfoCounts): NormalizedEndpoint {
  ep.containersRunning = info.containersRunning;
  ep.containersStopped = info.containersStopped;
  ep.totalContainers = info.containers;
  if (info.ncpu != null) ep.totalCpu = info.ncpu;
  if (info.memTotal != null) ep.totalMemory = info.memTotal;
  ep.snapshotSource = 'live';
  ep.snapshotFetchedAt = info.fetchedAt;
  ep.snapshotAge = Date.now() - info.fetchedAt;
  return ep;
}
```

(`markLiveUnavailable` stays as-is.)

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/core && npx vitest run src/portainer/portainer-normalizers-edge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/portainer/portainer-normalizers.ts packages/core/src/portainer/portainer-normalizers-edge.test.ts
git commit -m "feat(core): normalizeEndpoint stops reading Snapshots[]; add endpointSupportsLiveDockerInfo"
```

---

### Task 3: New `live-fleet.ts` — enrichment, stack counts, fleet totals, collector

**Files:**
- Create: `packages/core/src/portainer/live-fleet.ts`
- Test: `packages/core/src/portainer/live-fleet.test.ts`

- [ ] **Step 1: Write `live-fleet.test.ts` (failing)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichEndpointsWithLiveDockerInfo, attachStackCounts, computeFleetTotals } from './live-fleet.js';
import * as edgeLive from './edge-live-query.js';
import type { NormalizedEndpoint, NormalizedContainer } from './portainer-normalizers.js';

function ep(partial: Partial<NormalizedEndpoint>): NormalizedEndpoint {
  return {
    id: 1, name: 'e', type: 1, url: '', status: 'up',
    containersRunning: 0, containersStopped: 0, totalContainers: 0, stackCount: 0,
    totalCpu: 0, totalMemory: 0, isEdge: false, edgeMode: null, snapshotAge: null,
    checkInInterval: null, capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    snapshotSource: 'unavailable', ...partial,
  };
}
const cfg = { enabled: true, concurrency: 2, intervalSeconds: 60, timeoutMs: 5000 };

describe('enrichEndpointsWithLiveDockerInfo', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('overlays live counts/cpu/mem on up Docker endpoints', async () => {
    vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue({ containers: 12, containersRunning: 9, containersStopped: 3, ncpu: 8, memTotal: 16e9, fetchedAt: Date.now() });
    const eps = [ep({ id: 1, type: 1, status: 'up' })];
    await enrichEndpointsWithLiveDockerInfo(eps, cfg);
    expect(eps[0].snapshotSource).toBe('live');
    expect(eps[0].containersRunning).toBe(9);
    expect(eps[0].totalCpu).toBe(8);
  });

  it('marks unsupported (down / Edge Async / K8s) unavailable without fetching', async () => {
    const spy = vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue(null);
    const eps = [ep({ id: 1, type: 1, status: 'down' }), ep({ id: 7, type: 7, status: 'up', isEdge: true, edgeMode: 'async' })];
    await enrichEndpointsWithLiveDockerInfo(eps, cfg);
    expect(eps[0].snapshotSource).toBe('unavailable');
    expect(eps[1].snapshotSource).toBe('unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('marks supported endpoint unavailable when fetch returns null', async () => {
    vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue(null);
    const eps = [ep({ id: 1, type: 4, status: 'up', isEdge: true, edgeMode: 'standard' })];
    await enrichEndpointsWithLiveDockerInfo(eps, cfg);
    expect(eps[0].snapshotSource).toBe('unavailable');
  });

  it('isolates a single failure across endpoints', async () => {
    vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockImplementation(async (id: number) => id === 1 ? null : { containers: 1, containersRunning: 1, containersStopped: 0, ncpu: 1, memTotal: 1, fetchedAt: Date.now() });
    const eps = [ep({ id: 1, type: 1 }), ep({ id: 2, type: 1 })];
    await enrichEndpointsWithLiveDockerInfo(eps, cfg);
    expect(eps[0].snapshotSource).toBe('unavailable');
    expect(eps[1].snapshotSource).toBe('live');
  });

  it('disabled config leaves everything unavailable, no fetch', async () => {
    const spy = vi.spyOn(edgeLive, 'fetchLiveDockerInfo').mockResolvedValue(null);
    const eps = [ep({ id: 1, type: 1, status: 'up' })];
    await enrichEndpointsWithLiveDockerInfo(eps, { ...cfg, enabled: false });
    expect(eps[0].snapshotSource).toBe('unavailable');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('attachStackCounts', () => {
  it('counts Portainer stacks per endpoint id', () => {
    const eps = [ep({ id: 1 }), ep({ id: 2 })];
    attachStackCounts(eps, [{ EndpointId: 1 }, { EndpointId: 1 }, { EndpointId: 2 }] as any);
    expect(eps[0].stackCount).toBe(2);
    expect(eps[1].stackCount).toBe(1);
  });
  it('zeroes endpoints with no stacks', () => {
    const eps = [ep({ id: 9 })];
    attachStackCounts(eps, [{ EndpointId: 1 }] as any);
    expect(eps[0].stackCount).toBe(0);
  });
});

describe('computeFleetTotals', () => {
  const c = (healthStatus?: string, state = 'running'): NormalizedContainer => ({
    id: 'x', name: 'n', image: 'i', state: state as NormalizedContainer['state'], status: '', created: 0,
    endpointId: 1, endpointName: 'e', ports: [], networks: [], networkIPs: {}, labels: {}, healthStatus,
  });
  it('sums endpoint counts and derives health from containers + stacks total', () => {
    const eps = [ep({ id: 1, status: 'up', containersRunning: 9, containersStopped: 3, totalContainers: 12 }), ep({ id: 2, status: 'down' })];
    const totals = computeFleetTotals(eps, [c('healthy'), c('unhealthy'), c(undefined)], 5);
    expect(totals).toMatchObject({ endpoints: 2, endpointsUp: 1, endpointsDown: 1, running: 9, stopped: 3, total: 12, healthy: 1, unhealthy: 1, stacks: 5 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/core && npx vitest run src/portainer/live-fleet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `live-fleet.ts`**

```ts
/**
 * Live fleet data — the single source of truth for endpoint container counts,
 * host CPU/memory, container health, and stack totals. Replaces all reads of
 * Portainer's per-endpoint Snapshots[] (which edge agents stopped writing back).
 *
 * Lives in core so every layer — foundation routes, the scheduler, and
 * ai-intelligence (which may not import foundation) — can share it.
 */
import pLimit from 'p-limit';
import { getEndpoints, getContainers, getStacks } from './portainer-client.js';
import { cachedFetchSWR, getCacheKey, TTL } from './portainer-cache.js';
import {
  normalizeEndpoint, normalizeContainer, applyLiveDockerInfo, markLiveUnavailable,
  endpointSupportsLiveDockerInfo, type NormalizedEndpoint, type NormalizedContainer,
} from './portainer-normalizers.js';
import { fetchLiveDockerInfo } from './edge-live-query.js';
import { getEffectiveEdgeLiveQueryConfig, type EdgeLiveQueryConfig } from '../services/settings-store.js';
import { isDockerEndpoint, type Stack } from '../models/portainer.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('live-fleet');

export interface FleetTotals {
  endpoints: number; endpointsUp: number; endpointsDown: number;
  running: number; stopped: number; total: number;
  healthy: number; unhealthy: number; stacks: number;
}

/** Overlay live `/docker/info` onto every up Docker endpoint; everything else → unavailable. */
export async function enrichEndpointsWithLiveDockerInfo(
  normalized: NormalizedEndpoint[],
  cfg?: EdgeLiveQueryConfig,
): Promise<NormalizedEndpoint[]> {
  let config = cfg;
  if (!config) {
    try { config = await getEffectiveEdgeLiveQueryConfig(); }
    catch (err) { log.warn({ err }, 'live-query config unavailable — leaving endpoints unavailable'); return normalized; }
  }
  if (!config.enabled) return normalized; // kill-switch: no snapshot fallback → stay unavailable

  const targets = normalized.filter(endpointSupportsLiveDockerInfo);
  const results = await Promise.allSettled(targets.map((ep) => fetchLiveDockerInfo(ep.id, config)));
  for (let i = 0; i < targets.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) applyLiveDockerInfo(targets[i], r.value);
    else markLiveUnavailable(targets[i]);
  }
  return normalized;
}

/** Fill per-endpoint stackCount from Portainer's stacks list (live, grouped by EndpointId). */
export function attachStackCounts(normalized: NormalizedEndpoint[], stacks: Stack[]): NormalizedEndpoint[] {
  const counts = new Map<number, number>();
  for (const s of stacks) counts.set(s.EndpointId, (counts.get(s.EndpointId) ?? 0) + 1);
  for (const ep of normalized) ep.stackCount = counts.get(ep.id) ?? 0;
  return normalized;
}

/** Fleet KPIs: counts from enriched endpoints, health from live containers, stacks from the stacks list. */
export function computeFleetTotals(
  endpoints: NormalizedEndpoint[], containers: NormalizedContainer[], stackTotal: number,
): FleetTotals {
  let running = 0, stopped = 0, total = 0, up = 0, down = 0;
  for (const ep of endpoints) {
    running += ep.containersRunning; stopped += ep.containersStopped; total += ep.totalContainers;
    if (ep.status === 'up') up++; else down++;
  }
  let healthy = 0, unhealthy = 0;
  for (const c of containers) {
    if (c.healthStatus === 'healthy') healthy++;
    else if (c.healthStatus === 'unhealthy') unhealthy++;
  }
  return { endpoints: endpoints.length, endpointsUp: up, endpointsDown: down, running, stopped, total, healthy, unhealthy, stacks: stackTotal };
}

export interface FleetOverview {
  endpoints: NormalizedEndpoint[];
  containers: NormalizedContainer[];
  stacks: Stack[];
  totals: FleetTotals;
}

/**
 * Full pipeline for consumers that don't already hold container lists
 * (endpoints route, scheduler KPI writer, LLM context). Endpoints, stacks, and
 * containers are SWR-cached and shared with the rest of the app.
 */
export async function collectFleetOverview(cfg?: EdgeLiveQueryConfig): Promise<FleetOverview> {
  const raw = (await cachedFetchSWR(getCacheKey('endpoints'), TTL.ENDPOINTS, () => getEndpoints())) ?? [];
  const endpoints = raw.map(normalizeEndpoint);
  await enrichEndpointsWithLiveDockerInfo(endpoints, cfg);

  let stacks: Stack[] = [];
  try { stacks = (await cachedFetchSWR(getCacheKey('stacks'), TTL.STACKS, () => getStacks())) ?? []; }
  catch (err) { log.warn({ err }, 'stacks fetch failed — stack counts default to 0'); }
  attachStackCounts(endpoints, stacks);

  const upDocker = endpoints.filter((ep) => ep.status === 'up' && isDockerEndpoint(ep.type));
  const limit = pLimit(5);
  const settled = await Promise.allSettled(upDocker.map((ep) =>
    limit(() => cachedFetchSWR(getCacheKey('containers', ep.id), TTL.CONTAINERS, () => getContainers(ep.id)).then((cs) => ({ ep, cs }))),
  ));
  const containers: NormalizedContainer[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      const { ep, cs } = r.value;
      for (const c of cs) containers.push(normalizeContainer(c, ep.id, ep.name));
    } else {
      log.warn({ err: r.reason }, 'container fetch failed for an endpoint during fleet overview');
    }
  }
  return { endpoints, containers, stacks, totals: computeFleetTotals(endpoints, containers, stacks.length) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/core && npx vitest run src/portainer/live-fleet.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from the core portainer barrel**

In `packages/core/src/portainer/index.ts` add:

```ts
export * from './live-fleet.js';
```

Run: `cd packages/core && npx vitest run src/portainer/ && npx tsc --noEmit -p .` (or the package's typecheck). Expected: PASS / no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/portainer/live-fleet.ts packages/core/src/portainer/live-fleet.test.ts packages/core/src/portainer/index.ts
git commit -m "feat(core): live-fleet module (enrich, stack counts, fleet totals, collector)"
```

---

# STAGE 2 — Foundation routes

### Task 4: `/api/endpoints` enriches + attaches live stack counts

**Files:**
- Modify: `packages/foundation/src/routes/endpoints.ts`
- Test: `packages/foundation/src/__tests__/endpoints-route.test.ts`

- [ ] **Step 1: Update route tests**

In `endpoints-route.test.ts`: replace the import of `enrichEdgeStandardWithLiveInfo`/`fetchEdgeLiveDockerInfo` mocks with mocks of `@dashboard/core/portainer/index.js` (or the direct `live-fleet.js`/`edge-live-query.js` modules). Rewrite the three live-related cases:

```ts
// "enriches every up Docker endpoint via live /docker/info"
it('enriches up Docker endpoints with live counts', async () => {
  mockGetEndpoints([rawEndpoint({ Id: 1, Type: 1, Status: 1, Snapshots: [] })]);
  vi.spyOn(liveFleet, 'fetchLiveDockerInfo' as never); // if mocking at fetch level, else spy enrich
  mockFetchLiveDockerInfo({ containers: 12, containersRunning: 9, containersStopped: 3, ncpu: 8, memTotal: 16e9, fetchedAt: Date.now() });
  mockGetStacks([{ EndpointId: 1 } as any, { EndpointId: 1 } as any]);
  const res = await app.inject({ method: 'GET', url: '/api/endpoints', headers: auth });
  const body = res.json();
  expect(body[0]).toMatchObject({ snapshotSource: 'live', containersRunning: 9, totalContainers: 12, totalCpu: 8, stackCount: 2 });
});

it('marks endpoint unavailable when live fetch returns null', async () => {
  mockGetEndpoints([rawEndpoint({ Id: 1, Type: 1, Status: 1 })]);
  mockFetchLiveDockerInfo(null);
  mockGetStacks([]);
  const body = (await app.inject({ method: 'GET', url: '/api/endpoints', headers: auth })).json();
  expect(body[0]).toMatchObject({ snapshotSource: 'unavailable', containersRunning: 0, stackCount: 0 });
});

it('does not live-fetch down or K8s endpoints', async () => {
  mockGetEndpoints([rawEndpoint({ Id: 5, Type: 5, Status: 1 })]); // K8s
  const spy = mockFetchLiveDockerInfo(null);
  mockGetStacks([]);
  await app.inject({ method: 'GET', url: '/api/endpoints', headers: auth });
  expect(spy).not.toHaveBeenCalled();
});
```

(Match the file's existing mocking helpers — it already mocks `portainer.getEndpoints`. Add a mock for `portainer.getStacks` and for `fetchLiveDockerInfo`. Keep the auth / 502 / empty-array / undefined-upstream cases unchanged.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/foundation && npx vitest run src/__tests__/endpoints-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the route**

```ts
import { FastifyInstance } from 'fastify';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { normalizeEndpoint } from '@dashboard/core/portainer/portainer-normalizers.js';
import { enrichEndpointsWithLiveDockerInfo, attachStackCounts } from '@dashboard/core/portainer/live-fleet.js';
import { EndpointIdParamsSchema } from '@dashboard/core/models/api-schemas.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';

const log = createChildLogger('route:endpoints');
```

Replace the `/api/endpoints` handler body:

```ts
    try {
      const endpoints = (await cachedFetch(getCacheKey('endpoints'), TTL.ENDPOINTS, () => portainer.getEndpoints())) ?? [];
      const normalized = endpoints.map(normalizeEndpoint);
      await enrichEndpointsWithLiveDockerInfo(normalized);
      // Per-endpoint live stack counts (best-effort — a stacks failure must not 502 the page).
      try {
        const stacks = (await cachedFetch(getCacheKey('stacks'), TTL.STACKS, () => portainer.getStacks())) ?? [];
        attachStackCounts(normalized, stacks);
      } catch (err) {
        log.warn({ err }, 'Failed to fetch stacks for per-endpoint counts');
      }
      return normalized;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err }, 'Failed to fetch endpoints from Portainer');
      return reply.code(502).send({ error: 'Unable to connect to Portainer', details: msg });
    }
```

(`/api/endpoints/:id` and `/api/endpoints/debug/edge-status` keep using `normalizeEndpoint`; the debug route still reads raw `ep.Snapshots?.length` for diagnostics — leave it, it documents that Portainer's snapshots are empty/stale.)

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/foundation && npx vitest run src/__tests__/endpoints-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/foundation/src/routes/endpoints.ts packages/foundation/src/__tests__/endpoints-route.test.ts
git commit -m "feat(foundation): /api/endpoints uses live /docker/info + live stack counts"
```

---

### Task 5: Dashboard routes use `computeFleetTotals`; delete old foundation enrichment

**Files:**
- Modify: `packages/foundation/src/routes/dashboard.ts`
- Delete: `packages/foundation/src/services/edge-live-enrichment.ts`
- Delete: `packages/foundation/src/__tests__/edge-live-enrichment.test.ts`
- Test: existing dashboard route test (find with `grep -rl "/api/dashboard/full" packages/foundation/src/__tests__`).

- [ ] **Step 1: Update the dashboard route test**

Add/adjust an assertion that fleet KPIs come from live data: with one up Docker endpoint whose live `/docker/info` returns 9 running and whose container list has one `healthy` + one `unhealthy` container and 2 Portainer stacks, `summary.kpis` is `{ running: 9, healthy: 1, unhealthy: 1, stacks: 2, ... }`. Mock `portainer.getStacks` and `fetchLiveDockerInfo`. (Follow the file's existing mock setup for `getEndpoints`/`getContainers`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/foundation && npx vitest run src/__tests__/<dashboard test file>`
Expected: FAIL.

- [ ] **Step 3: Edit `dashboard.ts`**

Replace the import:

```ts
import { enrichEndpointsWithLiveDockerInfo, attachStackCounts, computeFleetTotals } from '@dashboard/core/portainer/live-fleet.js';
```

In each handler (`/summary`, `/resources`, `/full`), after `const normalized = endpoints.map(normalizeEndpoint);`:

```ts
      await enrichEndpointsWithLiveDockerInfo(normalized);
      const stacks = await (async () => {
        try { return (await cachedFetchSWR(getCacheKey('stacks'), TTL.STACKS, () => portainer.getStacks())) ?? []; }
        catch (err) { log.warn({ err }, 'stacks fetch failed'); return []; }
      })();
      attachStackCounts(normalized, stacks);
```

For `/summary` (which has no container fetch today), add a container fan-out mirroring `/resources` (reuse `portainerLimit`, `getContainers`, `normalizeContainer`) to build `allContainers`, then:

```ts
      const totals = computeFleetTotals(normalized, allContainers.map((c) => c.container), stacks.length);
```

For `/resources` and `/full`, replace the inline `normalized.reduce(... ep.containersHealthy ...)` totals block with:

```ts
      const totals = computeFleetTotals(
        normalized,
        allContainers.map((c) => c.container),       // /resources
        // allNormalizedContainers.map((c) => c.container) inside /full
        stacks.length,
      );
```

Map the camelCase `totals` straight into the existing `kpis` response shape (keys already match: `endpoints`, `endpointsUp`, `endpointsDown`, `running`, `stopped`, `healthy`, `unhealthy`, `total`, `stacks`).

- [ ] **Step 4: Delete the obsolete foundation enrichment + its test**

```bash
git rm packages/foundation/src/services/edge-live-enrichment.ts packages/foundation/src/__tests__/edge-live-enrichment.test.ts
```

Grep to confirm no remaining importers: `grep -rn "edge-live-enrichment\|enrichEdgeStandardWithLiveInfo" packages/ frontend/` → expect no hits.

- [ ] **Step 5: Run to verify pass**

Run: `cd packages/foundation && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A packages/foundation
git commit -m "feat(foundation): dashboard KPIs derive from live data; remove edge-live-enrichment"
```

---

# STAGE 3 — Scheduler / public status page

### Task 6: KPI snapshot writer uses live data

**Files:**
- Modify: `packages/server/src/scheduler.ts`
- Test: `packages/server/src/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add a failing test for `runKpiSnapshotCollection`**

In `scheduler.test.ts`, add (the file already mocks `@dashboard/observability` incl. `insertKpiSnapshot`):

```ts
it('runKpiSnapshotCollection inserts live-derived totals', async () => {
  vi.spyOn(liveFleet, 'collectFleetOverview').mockResolvedValue({
    endpoints: [{ status: 'up', containersRunning: 9, containersStopped: 3, totalContainers: 12 } as any],
    containers: [{ healthStatus: 'unhealthy' } as any, { healthStatus: 'healthy' } as any],
    stacks: [{ EndpointId: 1 } as any, { EndpointId: 1 } as any],
    totals: { endpoints: 1, endpointsUp: 1, endpointsDown: 0, running: 9, stopped: 3, total: 12, healthy: 1, unhealthy: 1, stacks: 2 },
  });
  await runKpiSnapshotCollection();
  expect(insertKpiSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ endpoints: 1, endpoints_up: 1, endpoints_down: 0, running: 9, stopped: 3, healthy: 1, unhealthy: 1, total: 12, stacks: 2 }),
  );
});
```

Export `runKpiSnapshotCollection` from `scheduler.ts` if not already exported, and import `collectFleetOverview` as `liveFleet`.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/server && npx vitest run src/__tests__/scheduler.test.ts -t "runKpiSnapshotCollection"`
Expected: FAIL.

- [ ] **Step 3: Rewrite `runKpiSnapshotCollection`**

```ts
import { collectFleetOverview } from '@dashboard/core/portainer/index.js';

async function runKpiSnapshotCollection(): Promise<void> {
  log.debug('Running KPI snapshot collection');
  try {
    const { totals } = await collectFleetOverview();
    await insertKpiSnapshot({
      endpoints: totals.endpoints,
      endpoints_up: totals.endpointsUp,
      endpoints_down: totals.endpointsDown,
      running: totals.running,
      stopped: totals.stopped,
      healthy: totals.healthy,
      unhealthy: totals.unhealthy,
      total: totals.total,
      stacks: totals.stacks,
    });
    log.debug('KPI snapshot collected');
  } catch (err) {
    log.error({ err }, 'KPI snapshot collection failed');
  }
}
```

Remove the now-unused `normalizeEndpoint` import from scheduler.ts only if no other function uses it (it is still used by `runMetricsCollection` and `runImageStalenessCheck` — keep the import).

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/server && npx vitest run src/__tests__/scheduler.test.ts`
Expected: PASS. (The public status page now receives live `kpi_snapshots`; no status-page.ts change needed.)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/scheduler.ts packages/server/src/__tests__/scheduler.test.ts
git commit -m "fix(server): KPI snapshot writer uses live fleet data (fixes stale public status page)"
```

---

# STAGE 4 — ai-intelligence (monitoring + LLM)

### Task 7: monitoring-service derives unhealthy from live containers

**Files:**
- Modify: `packages/ai-intelligence/src/services/monitoring-service.ts`
- Test: the file's existing monitoring-service test (grep `insertMonitoringSnapshot`).

- [ ] **Step 1: Update/add the failing test**

Assert that with a container whose `healthStatus` is `unhealthy`, `insertMonitoringSnapshot` is called with `containersUnhealthy: 1` even when endpoints carry no snapshot health. (Match existing test harness.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/ai-intelligence && npx vitest run -t "monitoring"` (narrow to the relevant file).
Expected: FAIL (line still reads `endpoint.containersUnhealthy`, which no longer exists → also a type error).

- [ ] **Step 3: Edit line ~218**

Replace:

```ts
        containersUnhealthy: endpoints.reduce((acc, endpoint) => acc + endpoint.containersUnhealthy, 0),
```

with:

```ts
        containersUnhealthy: normalizedContainers.filter((c) => c.healthStatus === 'unhealthy').length,
```

(`normalizedContainers` is already built at line ~211; `endpointsUp`/`endpointsDown` keep reading `endpoint.status`, which is unaffected.)

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/ai-intelligence && npx vitest run` (or narrowed). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-intelligence/src/services/monitoring-service.ts packages/ai-intelligence/src/services/<test file>
git commit -m "fix(ai): monitoring telemetry derives unhealthy from live container health"
```

---

### Task 8: LLM infrastructure context uses live totals

**Files:**
- Modify: `packages/ai-intelligence/src/sockets/llm-chat.ts`
- Modify: `packages/ai-intelligence/src/services/llm-client.ts`
- Test: existing llm-chat / llm-client tests (grep `buildInfrastructureContext`, `Infrastructure Summary`).

- [ ] **Step 1: Update the failing test**

For `buildInfrastructureContext` (llm-client.ts): it already derives container counts from the `containers` arg; only the per-endpoint line uses `ep.containersRunning/Stopped`. Add/adjust a test asserting the summary reflects enriched endpoint counts (pass endpoints with live `containersRunning`). No code change may be needed in llm-client if callers pass enriched endpoints — verify.

For the llm-chat socket infra summary: assert the `### Containers` line shows live `Running/Stopped/Unhealthy/Stacks` derived from `collectFleetOverview`.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/ai-intelligence && npx vitest run -t "infrastructure"`.
Expected: FAIL (compile error: `ep.containersUnhealthy` / `ep.stackCount` summed from removed/unpopulated fields).

- [ ] **Step 3: Edit `llm-chat.ts`**

Replace the block at lines ~375-393 (endpoint fetch + manual reduce) with the collector:

```ts
import { collectFleetOverview } from '@dashboard/core/portainer/index.js';

    // Fetch infrastructure data (live — counts, health, stacks)
    const { endpoints: normalizedEndpoints, totals } = await collectFleetOverview();
    const totalRunning = totals.running;
    const totalStopped = totals.stopped;
    const totalUnhealthy = totals.unhealthy;
    const totalStacks = totals.stacks;
```

The `endpointSummary` (lines ~408-410) keeps using `normalizedEndpoints` with `ep.containersRunning/Stopped` (now live). The returned template at lines ~416-427 is unchanged. Remove the now-unused `cachedFetch`/`getCacheKey`/`normalizeEndpoint`/`portainer.getEndpoints` imports **only if** no other code in the file uses them (grep first).

- [ ] **Step 4: Edit `llm-client.ts` (if needed)**

`buildInfrastructureContext` already computes container counts from its `containers` arg and per-endpoint running/stopped from `endpoints`. No snapshot field is read. Confirm the callers pass **enriched** endpoints (post-`enrichEndpointsWithLiveDockerInfo`); if a caller passes raw `normalizeEndpoint` output, route it through `collectFleetOverview().endpoints`. No edit if callers already enrich.

- [ ] **Step 5: Run to verify pass**

Run: `cd packages/ai-intelligence && npx vitest run`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-intelligence/src/sockets/llm-chat.ts packages/ai-intelligence/src/services/llm-client.ts packages/ai-intelligence/src/**/*test*
git commit -m "feat(ai): LLM infrastructure context uses live fleet totals"
```

---

# STAGE 5 — Config, frontend copy, docs

### Task 9: Config comments + kill-switch documentation

**Files:**
- Modify: `packages/core/src/config/env.schema.ts`
- Modify: `packages/core/src/services/settings-store.ts` (comment only)
- Modify: `docker/.env.example`

- [ ] **Step 1: Edit `env.schema.ts` (lines ~46-51)**

```ts
  // Live /docker/info — PRIMARY source for container counts + host CPU/memory on
  // all up Docker endpoints (Portainer's per-endpoint Snapshots[] is no longer
  // written back by edge agents). Env names kept for compatibility.
  // ENABLED=false is a hard kill-switch: with no snapshot fallback, endpoints
  // then render as "unavailable" (0 counts).
  EDGE_LIVE_QUERY_ENABLED: z.string().default('true').transform((v) => v === 'true' || v === '1'),
  EDGE_LIVE_QUERY_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  EDGE_LIVE_QUERY_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  EDGE_LIVE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(5000),
```

- [ ] **Step 2: Update `docker/.env.example`**

Find the `EDGE_LIVE_QUERY_*` block and update its comment to match (primary source; kill-switch warning). If the keys are absent, add them with the comment.

- [ ] **Step 3: Update the `settings-store.ts` doc comment** above `getEffectiveEdgeLiveQueryConfig` to say "live Docker info (primary source)".

- [ ] **Step 4: Typecheck + commit**

Run: `cd packages/core && npx tsc --noEmit -p .`
```bash
git add packages/core/src/config/env.schema.ts packages/core/src/services/settings-store.ts docker/.env.example
git commit -m "docs(config): EDGE_LIVE_QUERY_* is the primary source + kill-switch note"
```

### Task 10: Frontend `Endpoint` type + dead-field removal

**Files:**
- Modify: `frontend/src/features/containers/hooks/use-endpoints.ts`
- Modify: `frontend/src/features/core/hooks/use-dashboard.ts`

- [ ] **Step 1: Edit `use-endpoints.ts` (lines 19-20, 40)**

Remove `containersHealthy` and `containersUnhealthy`. Change the source enum:

```ts
  snapshotSource: 'live' | 'unavailable';
```

(Keep `stackCount`, `totalCpu`, `totalMemory`, `snapshotAge`, `snapshotFetchedAt`.)

- [ ] **Step 2: Edit `use-dashboard.ts` (lines 27-28)**

Remove `containersHealthy`/`containersUnhealthy` from the mirror `NormalizedEndpoint` interface (and `snapshotSource` enum if present).

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only in test fixtures (fixed in Task 12) and copy files (Task 11). Note them.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/containers/hooks/use-endpoints.ts frontend/src/features/core/hooks/use-dashboard.ts
git commit -m "refactor(frontend): drop dead containersHealthy/Unhealthy; source enum live|unavailable"
```

### Task 11: Frontend user-facing copy (settings + fleet + container detail)

**Files:**
- Modify: `frontend/src/features/core/components/settings/shared.tsx`
- Modify: `frontend/src/features/containers/pages/fleet-overview.tsx`
- Modify: `frontend/src/features/containers/pages/container-detail.tsx`

- [ ] **Step 1: Settings copy (`shared.tsx` lines 145-148)** — replace the four objects:

```tsx
    { key: 'edge.live_query_enabled', label: 'Live Container Data', description: 'Read container counts and host CPU/memory live via /docker/info through Portainer (primary source — replaces stale snapshots). Disabling shows endpoints as "data unavailable".', type: 'boolean', defaultValue: 'true' },
    { key: 'edge.live_query_concurrency', label: 'Live Fetch Concurrency', description: 'Max parallel live /docker/info calls across endpoints. Keep low (1–3) for large fleets to avoid stampeding Portainer.', type: 'number', defaultValue: '2', min: 1, max: 20 },
    { key: 'edge.live_query_interval_seconds', label: 'Live Fetch Interval (seconds)', description: 'Per-endpoint cache TTL. The dashboard returns cached data instantly while refreshing in the background.', type: 'number', defaultValue: '60', min: 15, max: 3600 },
    { key: 'edge.live_query_timeout_ms', label: 'Live Fetch Timeout (ms)', description: 'Per-call timeout — a slow agent never blocks the dashboard.', type: 'number', defaultValue: '5000', min: 1000, max: 30000 },
```

If there's a section comment at lines 142-144 mentioning "Edge Standard fallback", update it to "Live container data (all Docker endpoints)".

- [ ] **Step 2: Fleet overview copy**

Card (lines 150-152): change `Snapshot: {formatRelativeTime(...)}` to `Updated: {formatRelativeTime(endpoint.snapshotAge)}`.

Table column (lines 719-728): change `header: 'Snapshot Age'` → `header: 'Data Age'`, and broaden the cell to show for any endpoint with live data (not just `isEdge`):

```tsx
      cell: ({ row }) => row.original.snapshotAge != null ? (
        <span className={cn('text-xs', getSnapshotAgeColor(row.original.snapshotAge))}>
          {formatRelativeTime(row.original.snapshotAge)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
```

(`getSnapshotAgeColor` keeps its name — internal helper.)

- [ ] **Step 3: Container detail copy (lines 189, 193)**

Line 189: `Edge Agent — Data may be stale` → `Data may be stale`.
Line 193: `Snapshot age:` → `Data age:`.

- [ ] **Step 4: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit` (copy files should now be clean; fixtures still pending Task 12).
```bash
git add frontend/src/features/core/components/settings/shared.tsx frontend/src/features/containers/pages/fleet-overview.tsx frontend/src/features/containers/pages/container-detail.tsx
git commit -m "feat(frontend): relabel snapshot copy to live data wording"
```

### Task 12: Frontend test fixtures

**Files (from the audit):**
- `frontend/src/features/containers/hooks/use-endpoints.test.ts`
- `frontend/src/features/containers/components/fleet/fleet-search-filter.test.ts`
- `frontend/src/features/containers/components/fleet/fleet-overview-cards.test.tsx`
- `frontend/src/features/core/components/layout/command-palette.test.tsx`
- `frontend/src/features/containers/pages/fleet-overview.test.tsx`
- `frontend/src/__tests__/a11y-pages.test.tsx` (line ~303)

- [ ] **Step 1: Update fixtures**

In each, remove `containersHealthy:`/`containersUnhealthy:` properties from endpoint fixture objects, and replace any `snapshotSource: 'snapshot'` with `snapshotSource: 'live'`. Keep `stackCount` (still a valid field). Do **not** touch `status-page.test.tsx:49` (that's the dashboard-snapshot shape, unrelated).

- [ ] **Step 2: Run frontend tests + typecheck**

Run: `cd frontend && npx tsc --noEmit && npm run test`
Expected: PASS, no type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/**/*.test.ts frontend/src/**/*.test.tsx
git commit -m "test(frontend): update endpoint fixtures for live source + removed fields"
```

### Task 13: Docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1:** In `docs/architecture.md`, find any description of endpoint/snapshot data flow and document the new live pipeline (`live-fleet.ts`, `/docker/info` primary, snapshot removed, Edge Async → unavailable). If there's a data-flow diagram or endpoints section, update it.

- [ ] **Step 2:** In `CLAUDE.md` (project), update any mention of the Edge Standard snapshot fallback (#1249) to reflect that live `/docker/info` is now the primary source for all Docker endpoints and Portainer snapshots are no longer read.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md CLAUDE.md
git commit -m "docs: live /docker/info is the primary endpoint data source"
```

---

## Final verification

- [ ] **Full typecheck:** `npm run typecheck` → clean.
- [ ] **Full lint:** `npm run lint` → clean.
- [ ] **Backend + packages tests:** `npm run test -w backend` and per-package `npx vitest run` for core/foundation/server/ai-intelligence (requires PostgreSQL on :5433). All green.
- [ ] **Frontend tests:** `npm run test -w frontend` → green.
- [ ] **Grep guard:** `grep -rn "Snapshots\?\.\[0\]\|containersHealthy\|containersUnhealthy\|endpointNeedsLiveFallback\|enrichEdgeStandardWithLiveInfo\|snapshotSource.*'snapshot'" packages/ frontend/ --include=*.ts --include=*.tsx | grep -v debug/edge-status` → only the intentional debug-route raw read remains.
- [ ] **Manual smoke (optional, via /run):** load Home + Fleet Overview against a live Portainer; confirm Edge Standard endpoints show live counts and source `live`, Edge Async shows `unavailable`.

## Spec coverage self-check

- Snapshot removal from `normalizeEndpoint` → Task 2. ✓
- Live counts + CPU/mem → Tasks 1–2 (`applyLiveDockerInfo` ncpu/memTotal). ✓
- Health + stacks live → Task 3 (`computeFleetTotals`, `attachStackCounts`). ✓
- All consumers (endpoints, dashboard, scheduler/status, monitoring, LLM) → Tasks 4–8. ✓
- Edge Async / kill-switch → unavailable → Tasks 2–3 + Task 9 docs. ✓
- Config + copy + docs → Tasks 9–13. ✓
- `kpi_snapshots`/`monitoring_snapshots` tables preserved (only inputs change) → Tasks 6–7. ✓
