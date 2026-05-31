# Pre-warm Stacks Cache (#1393) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the startup `warmCache()` to also pre-warm per-endpoint Portainer stacks, removing the cold-start herd on the first `/stacks` page load (and dashboard stack counts) after a restart (#1393).

**Architecture:** `warmCache()` in `packages/server/src/scheduler.ts` already warms endpoints + per-endpoint containers at boot. Add per-endpoint stacks to the same `Promise.allSettled` fan-out for Docker endpoints, using the exact cache key + fetcher the `/stacks` route reads. Export `warmCache` so it is unit-testable.

**Tech Stack:** TypeScript, Fastify, Vitest. Spec: `docs/superpowers/specs/2026-05-31-warm-stacks-cache-design.md`.

**Branch:** `feature/1393-warm-stacks-cache` (already created off `ef4d5b0c`).

---

### Task 1: Pre-warm per-endpoint stacks in `warmCache()`

**Files:**
- Modify: `packages/server/src/scheduler.ts` (import line ~4; `warmCache()` at ~455-486)
- Test: `packages/server/src/__tests__/scheduler.test.ts`

**Reference — current `warmCache()` (for orientation; do not retype unchanged):**
```ts
async function warmCache(): Promise<void> {
  log.info('Warming cache: endpoints + containers');
  try {
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => getEndpoints(),
    );
    // Pre-fetch containers for Docker endpoints only (K8s endpoints use different API)
    const dockerEndpoints = endpoints.filter((ep) => isDockerEndpoint(ep.Type));
    await Promise.allSettled(
      dockerEndpoints.map((ep) =>
        cachedFetch(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => getContainers(ep.Id),
        ),
      ),
    );
    log.info({ endpoints: endpoints.length, dockerEndpoints: dockerEndpoints.length }, 'Cache warmed successfully');
  } catch (err) {
    log.warn({ err }, 'Cache warming failed — first requests will be slower');
  }
}
```

The test harness already: mocks `@dashboard/core/portainer/portainer-client.js` (imported as `* as portainerClient`), spies `getEndpoints`/`getContainers`/`getImages` in the global `beforeEach`, and makes `cachedFetch` a passthrough that invokes its fetcher: `vi.spyOn(portainerCache, 'cachedFetch').mockImplementation(async (_k, _t, fn) => fn())`. So calling `warmCache()` drives the real fetchers through the spies.

- [ ] **Step 1: Write the failing test**

(a) Add `warmCache` to the existing import from `../scheduler.js` (the block importing `runCleanup, runImageStalenessCheck, runMetricsCollection, isMetricsCycleRunning, _resetMetricsMutex`):

```ts
import {
  runCleanup,
  runImageStalenessCheck,
  runMetricsCollection,
  isMetricsCycleRunning,
  _resetMetricsMutex,
  warmCache,
} from '../scheduler.js';
```

(b) Declare a spy ref alongside the other `let ...Mock: any;` declarations (near `let getImagesMock: any;`):

```ts
let getStacksByEndpointMock: any;
```

(c) In the global `beforeEach`, right after the `getImagesMock = vi.spyOn(portainerClient, 'getImages').mockResolvedValue([] as any);` line, add:

```ts
  getStacksByEndpointMock = vi.spyOn(portainerClient, 'getStacksByEndpoint').mockResolvedValue([] as any);
```

(d) Add a new describe block (e.g. after the `runMetricsCollection` describe):

```ts
describe('scheduler/setup – warmCache (#1393)', () => {
  it('pre-warms per-endpoint stacks for Docker endpoints only, alongside containers', async () => {
    getEndpointsMock.mockResolvedValueOnce([
      { Id: 1, Name: 'docker-ep', Status: 1, Type: 1, URL: 'tcp://localhost' },
      { Id: 5, Name: 'k8s-ep', Status: 1, Type: 5, URL: 'tcp://localhost' },
    ] as any);

    await warmCache();

    // Stacks pre-warmed for the Docker endpoint, not the Kubernetes one.
    expect(getStacksByEndpointMock).toHaveBeenCalledWith(1);
    expect(getStacksByEndpointMock).not.toHaveBeenCalledWith(5);
    // Containers warm-up still happens for the Docker endpoint (unchanged).
    expect(getContainersMock).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/server src/__tests__/scheduler.test.ts -t "warmCache"`
Expected: FAIL — `warmCache` is currently module-private (not exported), so the import is `undefined` and the call throws `warmCache is not a function`. (After it's exported in Step 3, the meaningful assertion is `getStacksByEndpoint` being called with `1`.)

- [ ] **Step 3: Write minimal implementation**

In `packages/server/src/scheduler.ts`, add `getStacksByEndpoint` to the portainer import (line ~4):

```ts
import { getEndpoints, getContainers, getStacksByEndpoint, isEndpointDegraded, getImages } from '@dashboard/core/portainer/index.js';
```

Replace the whole `warmCache` function with the exported version that warms stacks too:

```ts
export async function warmCache(): Promise<void> {
  log.info('Warming cache: endpoints + containers + stacks');
  try {
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => getEndpoints(),
    );
    // Pre-fetch containers + stacks for Docker endpoints only (K8s endpoints use different API)
    const dockerEndpoints = endpoints.filter((ep) => isDockerEndpoint(ep.Type));
    await Promise.allSettled(
      dockerEndpoints.flatMap((ep) => [
        cachedFetch(
          getCacheKey('containers', ep.Id),
          TTL.CONTAINERS,
          () => getContainers(ep.Id),
        ),
        cachedFetch(
          getCacheKey('stacks', ep.Id),
          TTL.STACKS,
          () => getStacksByEndpoint(ep.Id),
        ),
      ]),
    );
    log.info({ endpoints: endpoints.length, dockerEndpoints: dockerEndpoints.length }, 'Cache warmed successfully');
  } catch (err) {
    log.warn({ err }, 'Cache warming failed — first requests will be slower');
  }
}
```

Note: `getStacksByEndpoint(endpointId)` is the per-endpoint stacks call the `/stacks` route uses; `getCacheKey('stacks', ep.Id)` / `TTL.STACKS` are the exact key and TTL the route reads via `cachedFetchSWR`, so the route hits the warmed entry. Do not change the `startScheduler` call site — it already invokes `warmCache().catch(() => {})`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/server src/__tests__/scheduler.test.ts`
Expected: PASS — full scheduler test file green, including the new `warmCache` test.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/scheduler.ts packages/server/src/__tests__/scheduler.test.ts
git commit -m "fix(scheduler): pre-warm per-endpoint stacks cache at startup (#1393)"
```
Note: the commit/pre-push hook prints a lot of npm output — that is normal; success = `git commit` exits 0. Never use `--no-verify`. Do NOT stage `.gitignore` or `CLAUDE.md`.

---

### Task 2: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the scheduler suite + CI typecheck**

Run:
```bash
npx vitest run --root packages/server src/__tests__/scheduler.test.ts
npm run typecheck
```
Expected: scheduler suite PASS; typecheck clean (exit 0).

- [ ] **Step 2: Confirm no doc change is needed**

`docs/ai-instructions/architecture.md:307` describes the scheduler starting "after the cache is warmed" generically — it does not enumerate what is warmed, so it remains accurate with stacks added. No `docs/architecture.md`, `docker/.env.example`, or `CLAUDE.md` change is warranted (no new surface, no env var). No commit for this step.

---

## Self-Review

**Spec coverage:**
- Extend `warmCache()` to warm per-endpoint stacks → Task 1. ✓
- Use `getCacheKey('stacks', ep.Id)` / `TTL.STACKS` / `getStacksByEndpoint(ep.Id)` (per-endpoint, matching the route) → Task 1 Step 3. ✓
- Add `getStacksByEndpoint` to the scheduler import → Task 1 Step 3. ✓
- Export `warmCache` for testing → Task 1 Step 3. ✓
- Containers warm-up unchanged; Docker-only filter preserved → asserted in Task 1 Step 1 test (Type 1 warmed, Type 5 not). ✓
- Test via the existing `cachedFetch` passthrough + portainer-client spies → Task 1. ✓
- Non-goals (no images/networks, no env var, no detector/limiter/pool change) → respected; no task touches them. ✓
- Docs decision → Task 2 Step 2. ✓

**Placeholder scan:** No TBD/TODO; every code/test step shows complete content. ✓

**Type consistency:** `warmCache(): Promise<void>` (exported), `getStacksByEndpoint(endpointId: number)`, `getCacheKey('stacks', ep.Id)`, `TTL.STACKS` — used consistently. Test spy `getStacksByEndpointMock` and assertions reference `getStacksByEndpoint`/`getContainers` exactly as spied. ✓
